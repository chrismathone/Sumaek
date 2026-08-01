import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "../client";

/* ─────────────────────────────────────────────────────────────
 * 조직별 AI 비용 집계·한도 (골프롬프트 28장 · 인수 37).
 *
 * - 모든 공급자 호출을 ai_usage_events에 기록한다 (가격표 버전 포함 —
 *   가격 개정 시 재계산 가능).
 * - 예산(ai_budgets)이 설정된 조직은 월 사용액 기준으로 80% 경고,
 *   100% 차단. 예산 미설정 조직은 기록만 하고 막지 않는다 (정직한 기본).
 * - 목 공급자도 같은 경로로 기록해 한도 로직이 처음부터 검증된다.
 * ───────────────────────────────────────────────────────────── */

export const PRICING_VERSION = "pricing/2026-07";

/** provider:model → USD per 1M tokens. 목은 실제 도입가 가정치로 기록한다. */
const PRICING: Record<
  string,
  { inputPerMTokUsd: number; outputPerMTokUsd: number }
> = {
  "mock:mock-extractor-v1": { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
};

export function estimateCostUsd(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[`${provider}:${model}`];
  if (!pricing) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTokUsd +
    (outputTokens / 1_000_000) * pricing.outputPerMTokUsd
  );
}

export interface BudgetEvaluation {
  allowed: boolean;
  warn: boolean;
  monthToDateUsd: number;
  limitUsd: number | null;
  message: string;
}

/** 순수 판정 — 한도·경고 임계 (단위 테스트 대상) */
export function evaluateBudget(input: {
  monthToDateUsd: number;
  limitUsd: number | null;
  warnRatio: number;
}): BudgetEvaluation {
  const { monthToDateUsd, limitUsd, warnRatio } = input;
  if (limitUsd === null) {
    return {
      allowed: true,
      warn: false,
      monthToDateUsd,
      limitUsd: null,
      message: "예산 미설정 — 기록만 합니다.",
    };
  }
  if (monthToDateUsd >= limitUsd) {
    return {
      allowed: false,
      warn: true,
      monthToDateUsd,
      limitUsd,
      message: `이번 달 AI 사용액 $${monthToDateUsd.toFixed(2)}이 한도 $${limitUsd.toFixed(2)}에 도달했습니다. 새 AI 작업이 차단됩니다.`,
    };
  }
  const warn = monthToDateUsd >= limitUsd * warnRatio;
  return {
    allowed: true,
    warn,
    monthToDateUsd,
    limitUsd,
    message: warn
      ? `이번 달 AI 사용액 $${monthToDateUsd.toFixed(2)} / 한도 $${limitUsd.toFixed(2)} — 경고 임계(${Math.round(warnRatio * 100)}%)를 넘었습니다.`
      : `이번 달 AI 사용액 $${monthToDateUsd.toFixed(2)} / 한도 $${limitUsd.toFixed(2)}`,
  };
}

/** 조직의 이번 달 예산 상태 조회 (DB 시계 기준 월 경계) */
export async function checkAiBudget(
  organizationId: string,
): Promise<BudgetEvaluation> {
  const sql = getSharedSql();
  const [row] = await sql<
    { month_to_date: string; limit_usd: string | null; warn_ratio: string | null }[]
  >`
    select
      coalesce((
        select sum(estimated_cost_usd) from ai_usage_events
        where organization_id = ${organizationId}
          -- 월 경계는 **조직 시간대** 기준이다. date_trunc('month', now())만
          -- 쓰면 세션 시간대(UTC)로 끊겨 KST 1일 00:00~09:00이 전달로 잡힌다.
          and created_at >= (date_trunc('month', now() at time zone o.timezone)
                             at time zone o.timezone)
      ), 0)::text as month_to_date,
      b.monthly_limit_usd::text as limit_usd,
      b.warn_ratio::text as warn_ratio
    from organizations o
    left join ai_budgets b on b.organization_id = o.id
    where o.id = ${organizationId}
  `;
  return evaluateBudget({
    monthToDateUsd: Number(row?.month_to_date ?? 0),
    limitUsd: row?.limit_usd === null || row?.limit_usd === undefined
      ? null
      : Number(row.limit_usd),
    warnRatio: Number(row?.warn_ratio ?? 0.8),
  });
}

/** 사용량 기록 + 경고 임계 최초 도달 시 월 1회 업무함 알림 */
export async function recordAiUsage(options: {
  organizationId: string;
  provider: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  relatedType?: string;
  relatedId?: string;
}): Promise<{ costUsd: number }> {
  const sql = getSharedSql();
  const costUsd = estimateCostUsd(
    options.provider,
    options.model,
    options.inputTokens,
    options.outputTokens,
  );
  await sql`
    insert into ai_usage_events (
      id, organization_id, provider, model, operation,
      input_tokens, output_tokens, estimated_cost_usd, pricing_version,
      related_type, related_id
    ) values (
      ${uuidv7()}, ${options.organizationId}, ${options.provider},
      ${options.model}, ${options.operation}, ${options.inputTokens},
      ${options.outputTokens}, ${costUsd.toFixed(6)}, ${PRICING_VERSION},
      ${options.relatedType ?? null}, ${options.relatedId ?? null}
    )
  `;

  const evaluation = await checkAiBudget(options.organizationId);
  if (evaluation.warn && evaluation.limitUsd !== null) {
    // 경고 묶음 키의 월도 집계 창과 **같은 시간대**로 끊는다 —
    // 둘이 어긋나면 월초에 경고가 두 번 가거나 아예 가지 않는다.
    const [monthRow] = await sql<{ month_key: string }[]>`
      select to_char(now() at time zone o.timezone, 'YYYY-MM') as month_key
      from organizations o where o.id = ${options.organizationId}
    `;
    const monthKey =
      monthRow?.month_key ?? new Date().toISOString().slice(0, 7);
    const groupKey = `ai-budget-warn:${monthKey}`;
    const [existing] = await sql<{ id: string }[]>`
      select id from notifications
      where organization_id = ${options.organizationId}
        and group_key = ${groupKey}
      limit 1
    `;
    if (!existing) {
      const recipients = await sql<{ user_id: string }[]>`
        select user_id from memberships
        where organization_id = ${options.organizationId}
          and status = 'active' and role in ('owner', 'program_director')
      `;
      for (const r of recipients) {
        await sql`
          insert into notifications (
            id, organization_id, recipient_user_id, kind, title, body,
            link_path, related_type, related_id, group_key
          ) values (
            ${uuidv7()}, ${options.organizationId}, ${r.user_id},
            'system_notice', 'AI 사용액 경고 임계 도달',
            ${sql.json({
              what: evaluation.message,
              why: "ai_budget",
              action: "설정에서 사용량을 확인하고 필요하면 한도를 조정하세요",
            } as never)},
            '/app/settings', 'ai_budget', null, ${groupKey}
          )
        `;
      }
    }
  }
  return { costUsd };
}
