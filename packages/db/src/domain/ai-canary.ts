import { v7 as uuidv7 } from "uuid";
import {
  DEFAULT_HALT_CRITERIA,
  DEFAULT_PROMOTION_CRITERIA,
  createAiProviderForModel,
  deployedProviderName,
  evaluateHalt,
  evaluatePromotionGate,
  getSharedBreaker,
  runShadowExtraction,
  selectModels,
  withCircuitBreaker,
  type CanaryMetrics,
  type ExtractionResult,
  type ModelRole,
  type ModelSelection,
  type ModelVersion,
  type PromotionDecision,
  type ShadowExtractionInput,
} from "@su-maek/core/ai";
import { getSharedSql } from "../client";
import { CANARY_KILL_SWITCH_KEY } from "../kill-switch";
import { estimateCostUsd, hasPricing } from "./ai-usage";

/* ─────────────────────────────────────────────────────────────
 * AI 모델 카나리 — 레지스트리 · 섀도 기록 · 승격 게이트 (인수 36).
 *
 * 판정은 전부 packages/core/src/ai/model-registry.ts 에 있다. 여기는
 * DB 왕복과 부작용(감사·알림·중단)만 맡는다.
 *
 * 세 가지 안전 규칙:
 *  1. 섀도는 사용자에게 영향을 줄 수 없다 — runCanaryShadow는 던지지 않는다.
 *  2. 카나리는 실사용과 **다른 회로 차단기**를 쓴다. 같은 차단기를 쓰면
 *     카나리 장애가 실사용 공급자의 회로를 열어, 섀도가 사용자 경로를
 *     망가뜨리게 된다.
 *  3. 섀도 비용은 ai_usage_events(조직 예산)에 넣지 않는다. 카나리는
 *     플랫폼의 실험이지 조직의 지출이 아니고, 실험이 조직의 월 한도를
 *     소진해 실사용을 차단하면 인수 37과 정면으로 충돌한다. 대신
 *     ai_shadow_evaluations.canary_cost_usd에 남겨 승격 게이트가 읽는다.
 *
 * 알려진 절충: 섀도가 사용자 요청 안에서 돈다. 결과는 안 쓰지만 기다리는
 * 시간은 사용자의 것이다 — SHADOW_BREAKER_OPTIONS로 짧게 끊고 오래 쉬게
 * 해 두었지만, 근본 해결은 워커 큐로 옮기는 것이다 (미구현).
 * ───────────────────────────────────────────────────────────── */

export const EXTRACT_QUESTIONS_OPERATION = "extract_questions";

/** 중단 판정이 보는 최근 표본 창 — 오래전 한 번의 장애로 영영 멈추지 않도록 */
export const HALT_WINDOW_SAMPLES = 50;

/**
 * 카나리 전용 회로 차단기 정책 — 실사용(DEFAULT_BREAKER_OPTIONS)보다
 * **빨리 포기하고 오래 쉰다.**
 *
 * 섀도 호출은 지금 사용자 요청 안에서 돈다. 결과를 쓰지 않더라도 기다리는
 * 시간은 사용자의 것이므로, 실사용의 30초 제한을 그대로 쓰면 카나리가
 * 느려질 때 반입 체감 시간이 그만큼 늘어난다. 3회 실패에 열고 5분 쉬면,
 * 아픈 카나리는 몇 번 만에 회로가 열려 이후 비용이 사실상 0이 된다.
 *
 * 남은 일: 섀도를 워커 큐로 옮기면 이 절충 자체가 사라진다.
 */
export const SHADOW_BREAKER_OPTIONS = {
  failureThreshold: 3,
  cooldownMs: 300_000,
  timeoutMs: 10_000,
} as const;

interface ModelVersionRow {
  id: string;
  operation: string;
  provider: string;
  model: string;
  role: string;
  halt_reason: string | null;
}

function toModelVersion(row: ModelVersionRow): ModelVersion {
  return {
    id: row.id,
    operation: row.operation,
    provider: row.provider,
    model: row.model,
    role: row.role as ModelRole,
  };
}

/** 조직·작업의 레지스트리 전체 (운영 CLI의 list) */
export async function listModelVersions(options: {
  organizationId: string;
  operation?: string;
}): Promise<
  Array<ModelVersion & { haltReason: string | null }>
> {
  const sql = getSharedSql();
  const rows = await sql<ModelVersionRow[]>`
    select id, operation, provider, model, role, halt_reason
    from ai_model_versions
    where organization_id = ${options.organizationId}
      and (${options.operation ?? null}::text is null
           or operation = ${options.operation ?? null})
    order by operation, role, provider, model
  `;
  return rows.map((r) => ({ ...toModelVersion(r), haltReason: r.halt_reason }));
}

/**
 * 이번 호출에 쓸 모델 — 실사용(active)과 섀도(canary).
 *
 * active가 null이면 호출자는 공급자 기본 모델을 쓴다. 레지스트리가 비어 있는
 * 조직에서 동작이 달라지지 않게 하는 것이 의도다 — 이 기능을 켜지 않은 조직은
 * 예전과 정확히 같은 경로를 탄다.
 */
export async function resolveModelSelection(options: {
  organizationId: string;
  operation: string;
}): Promise<ModelSelection> {
  const sql = getSharedSql();
  const rows = await sql<ModelVersionRow[]>`
    select id, operation, provider, model, role, halt_reason
    from ai_model_versions
    where organization_id = ${options.organizationId}
      and operation = ${options.operation}
      and role in ('active', 'canary')
  `;
  return selectModels(rows.map(toModelVersion), {
    operation: options.operation,
    deployedProvider: deployedProviderName(),
  });
}

export type ShadowOutcome =
  | { status: "skipped"; reason: string }
  | { status: "recorded"; agreement: number | null; halted: boolean };

/**
 * 실사용 호출 **직후** 카나리를 같은 입력으로 한 번 더 부르고 기록만 한다.
 *
 * 기준선 결과(baseline)는 이미 사용자에게 갈 결과다 — 여기서 다시 계산하지
 * 않고, 카나리 결과는 어디에도 저장하지 않는다.
 *
 * 이 함수는 **절대 던지지 않는다.** 섀도 기록이 실패해도 반입은 성공해야
 * 하기 때문이다. 대신 삼킨 오류는 console.error로 남긴다 — 조용히 사라지면
 * "카나리가 도는 줄 알았는데 표본이 0건"이 된다.
 */
export async function runCanaryShadow(options: {
  organizationId: string;
  operation: string;
  baseline: ExtractionResult;
  baselineLatencyMs: number;
  input: ShadowExtractionInput;
  relatedType?: string;
  relatedId?: string;
  /** 테스트 주입 — 기본은 실시간 선택 */
  selection?: ModelSelection;
}): Promise<ShadowOutcome> {
  const sql = getSharedSql();
  try {
    /* kill switch (인수 40 개념 재사용) — 카나리가 말썽이면 코드 배포 없이
     * 즉시 끈다. 실사용 추출은 그대로 돈다. */
    const [blocked] = await sql<{ id: string }[]>`
      select id from kill_switches
      where key = ${CANARY_KILL_SWITCH_KEY}
        and enabled = false
        and (expires_at is null or expires_at > now())
        and (organization_id is null
             or organization_id = ${options.organizationId})
      limit 1
    `;
    if (blocked) {
      return { status: "skipped", reason: "kill switch로 섀도 평가가 중지됨" };
    }

    const selection =
      options.selection ??
      (await resolveModelSelection({
        organizationId: options.organizationId,
        operation: options.operation,
      }));
    const canary = selection.canary;
    if (!canary) {
      return { status: "skipped", reason: "카나리 모델이 없음" };
    }

    /* 실사용과 **다른** 차단기 (파일 머리 규칙 2). 이름에 shadow: 접두사를
     * 붙여 getSharedBreaker의 공급자별 저장소에서 확실히 갈라놓는다. */
    const shadowProvider = withCircuitBreaker(
      createAiProviderForModel(canary.provider, canary.model),
      getSharedBreaker(
        `shadow:${canary.provider}:${canary.model}`,
        SHADOW_BREAKER_OPTIONS,
      ),
    );
    const observation = await runShadowExtraction({
      baseline: options.baseline,
      canary: shadowProvider,
      canaryModel: canary.model,
      input: options.input,
    });

    const baselinePriced = hasPricing(
      options.baseline.provider,
      options.baseline.model,
    );
    const canaryPriced = hasPricing(canary.provider, canary.model);
    const baselineCost = baselinePriced
      ? estimateCostUsd(
          options.baseline.provider,
          options.baseline.model,
          options.baseline.usage.inputTokens,
          options.baseline.usage.outputTokens,
        ).toFixed(6)
      : null;
    const canaryCost =
      observation.ok && canaryPriced
        ? estimateCostUsd(
            canary.provider,
            canary.model,
            observation.inputTokens,
            observation.outputTokens,
          ).toFixed(6)
        : null;

    await sql`
      insert into ai_shadow_evaluations (
        id, organization_id, operation,
        baseline_provider, baseline_model, canary_provider, canary_model,
        ok, error_kind, error_message, agreement,
        baseline_latency_ms, canary_latency_ms,
        baseline_cost_usd, canary_cost_usd,
        canary_input_tokens, canary_output_tokens,
        detail, related_type, related_id
      ) values (
        ${uuidv7()}, ${options.organizationId}, ${options.operation},
        ${options.baseline.provider}, ${options.baseline.model},
        ${canary.provider}, ${canary.model},
        ${observation.ok}, ${observation.errorKind},
        ${observation.errorMessage}, ${observation.agreement?.score.toFixed(3) ?? null},
        ${Math.round(options.baselineLatencyMs)}, ${Math.round(observation.latencyMs)},
        ${baselineCost}, ${canaryCost},
        ${observation.inputTokens}, ${observation.outputTokens},
        ${observation.agreement ? sql.json(observation.agreement as never) : null},
        ${options.relatedType ?? null}, ${options.relatedId ?? null}
      )
    `;

    /* 운영 중 악화 감시 — 표본 하나 쌓을 때마다 최근 창을 다시 본다.
     * 배경 작업으로 미루지 않는 이유: 미루면 "악화된 채 계속 돈 시간"이
     * 그 주기만큼 생기고, 그 시간이 정확히 이 기능이 없애려던 것이다. */
    const halted = await maybeHaltCanary({
      organizationId: options.organizationId,
      operation: options.operation,
      canaryModel: canary.model,
    });

    return {
      status: "recorded",
      agreement: observation.agreement?.score ?? null,
      halted,
    };
  } catch (error) {
    // 섀도 기록 실패가 사용자의 반입을 깨뜨리면 안 된다 (규칙 1).
    console.error("[ai-canary] 섀도 평가 기록 실패", error);
    return { status: "skipped", reason: "섀도 기록 중 오류 (반입에는 영향 없음)" };
  }
}

/**
 * 카나리 표본 집계.
 *
 * @param windowSamples 최근 N건만 본다 (중단 판정용). 생략하면 전체 —
 *   승격 판정은 누적 표본 전체를 본다.
 */
export async function loadCanaryMetrics(options: {
  organizationId: string;
  operation: string;
  canaryModel: string;
  windowSamples?: number;
}): Promise<CanaryMetrics> {
  const sql = getSharedSql();
  const limit = options.windowSamples ?? null;
  const [row] = await sql<
    {
      samples: number;
      error_count: number;
      mean_agreement: string | null;
      baseline_p95: string | null;
      canary_p95: string | null;
      baseline_cost: string | null;
      canary_cost: string | null;
      unpriced: number;
    }[]
  >`
    with recent as (
      select * from ai_shadow_evaluations
      where organization_id = ${options.organizationId}
        and operation = ${options.operation}
        and canary_model = ${options.canaryModel}
      order by created_at desc, id desc
      limit ${limit}
    )
    select
      count(*)::int as samples,
      count(*) filter (where not ok)::int as error_count,
      avg(agreement) filter (where ok)::text as mean_agreement,
      -- 지연·비용은 **성공한 호출끼리만** 비교한다. 실패 표본의 지연은
      -- "죽는 데 걸린 시간"이고 비용은 0이라, 섞으면 카나리가 실패할수록
      -- 빠르고 싸 보이는 역전이 생긴다. 실패는 error_count가 따로 잡는다.
      percentile_cont(0.95) within group (
        order by baseline_latency_ms) filter (where ok)::text as baseline_p95,
      percentile_cont(0.95) within group (
        order by canary_latency_ms) filter (where ok)::text as canary_p95,
      coalesce(sum(baseline_cost_usd) filter (where ok), 0)::text
        as baseline_cost,
      coalesce(sum(canary_cost_usd) filter (where ok), 0)::text as canary_cost,
      -- 성공했는데 비용이 null이면 가격표에 없는 모델이다.
      count(*) filter (where ok and canary_cost_usd is null)::int as unpriced
    from recent
  `;
  const samples = row?.samples ?? 0;
  return {
    samples,
    errorCount: row?.error_count ?? 0,
    meanAgreement:
      row?.mean_agreement === null || row?.mean_agreement === undefined
        ? null
        : Number(row.mean_agreement),
    baselineLatencyP95Ms: Number(row?.baseline_p95 ?? 0),
    canaryLatencyP95Ms: Number(row?.canary_p95 ?? 0),
    baselineCostUsd: Number(row?.baseline_cost ?? 0),
    canaryCostUsd: Number(row?.canary_cost ?? 0),
    // 표본이 없으면 "가격표 확인 불가"가 아니라 "아직 모른다"다.
    // 승격은 어차피 표본 부족으로 막히므로 여기서는 true로 둔다.
    costPriced: samples === 0 ? true : (row?.unpriced ?? 0) === 0,
  };
}

/** 현재 카나리의 승격 판정 (운영 CLI의 status) */
export async function evaluateCanaryPromotion(options: {
  organizationId: string;
  operation: string;
}): Promise<
  | { canary: null; metrics: null; decision: null }
  | { canary: ModelVersion; metrics: CanaryMetrics; decision: PromotionDecision }
> {
  const sql = getSharedSql();
  const [row] = await sql<ModelVersionRow[]>`
    select id, operation, provider, model, role, halt_reason
    from ai_model_versions
    where organization_id = ${options.organizationId}
      and operation = ${options.operation}
      and role = 'canary'
  `;
  if (!row) return { canary: null, metrics: null, decision: null };
  const canary = toModelVersion(row);
  const metrics = await loadCanaryMetrics({
    organizationId: options.organizationId,
    operation: options.operation,
    canaryModel: canary.model,
  });
  return {
    canary,
    metrics,
    decision: evaluatePromotionGate(metrics, DEFAULT_PROMOTION_CRITERIA),
  };
}

export interface CanaryActionResult {
  ok: boolean;
  message: string;
}

/** 레지스트리 등록·역할 변경 (운영 CLI의 register) */
export async function registerModelVersion(options: {
  organizationId: string;
  operation: string;
  provider: string;
  model: string;
  role: ModelRole;
  actorUserId?: string | null;
  notes?: string;
}): Promise<CanaryActionResult> {
  if (options.role === "halted") {
    // 중단은 사유가 필요하다 — haltCanary를 쓰라는 뜻이다.
    return { ok: false, message: "중단은 halt 명령으로 하세요 (사유 필수)." };
  }
  /* 등록 시점에 공급자·모델이 실제로 만들어지는지 확인한다.
   * 오타 난 모델을 active로 등록하면 다음 반입이 통째로 실패한다 —
   * 그 실패를 사용자 요청 중이 아니라 여기서 만난다. */
  try {
    createAiProviderForModel(options.provider, options.model);
  } catch (error) {
    return {
      ok: false,
      message: `공급자·모델을 만들 수 없습니다: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const sql = getSharedSql();
  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into ai_model_versions (
          id, organization_id, operation, provider, model, role, notes,
          promoted_at
        ) values (
          ${uuidv7()}, ${options.organizationId}, ${options.operation},
          ${options.provider}, ${options.model}, ${options.role},
          ${options.notes ?? null},
          ${options.role === "active" ? sql`now()` : null}
        )
        on conflict (organization_id, operation, provider, model) do update
          set role = excluded.role,
              notes = coalesce(excluded.notes, ai_model_versions.notes),
              halted_at = null,
              halt_reason = null,
              retired_at = null,
              promoted_at = case when excluded.role = 'active'
                                 then now() else ai_model_versions.promoted_at end,
              updated_at = now()
      `;
      await tx`
        insert into audit_events (
          id, organization_id, actor_type, actor_id, action,
          target_type, target_id, after
        ) values (
          ${uuidv7()}, ${options.organizationId},
          ${options.actorUserId ? "user" : "automation"},
          ${options.actorUserId ?? null},
          'ai.model-register', 'ai_model_version', null,
          ${tx.json({
            operation: options.operation,
            provider: options.provider,
            model: options.model,
            role: options.role,
          } as never)}
        )
      `;
    });
  } catch (error) {
    return {
      ok: false,
      message: `등록 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return {
    ok: true,
    message: `${options.provider}:${options.model} → ${options.role} 로 등록했습니다.`,
  };
}

/**
 * 카나리 승격. **게이트를 통과하지 못하면 승격하지 않는다.**
 *
 * 우회 플래그를 일부러 두지 않았다. 우회가 있으면 급할 때 항상 쓰이고,
 * 그러면 게이트는 문서 속에만 존재하게 된다.
 */
export async function promoteCanary(options: {
  organizationId: string;
  operation: string;
  actorUserId?: string | null;
}): Promise<CanaryActionResult & { decision: PromotionDecision | null }> {
  const evaluation = await evaluateCanaryPromotion({
    organizationId: options.organizationId,
    operation: options.operation,
  });
  if (!evaluation.canary) {
    return {
      ok: false,
      message: "승격할 카나리가 없습니다.",
      decision: null,
    };
  }
  if (!evaluation.decision.promotable) {
    return {
      ok: false,
      message: `승격이 차단되었습니다 — ${evaluation.decision.failures
        .map((f) => f.message)
        .join(" / ")}`,
      decision: evaluation.decision,
    };
  }

  const sql = getSharedSql();
  const canary = evaluation.canary;
  await sql.begin(async (tx) => {
    const [before] = await tx<{ provider: string; model: string }[]>`
      select provider, model from ai_model_versions
      where organization_id = ${options.organizationId}
        and operation = ${options.operation} and role = 'active'
    `;
    /* 순서가 중요하다 — 부분 유니크 인덱스(active 1행) 때문에 물러날 행을
     * 먼저 retired로 바꿔야 카나리를 active로 올릴 수 있다. */
    await tx`
      update ai_model_versions
      set role = 'retired', retired_at = now(), updated_at = now()
      where organization_id = ${options.organizationId}
        and operation = ${options.operation} and role = 'active'
    `;
    await tx`
      update ai_model_versions
      set role = 'active', promoted_at = now(), updated_at = now()
      where id = ${canary.id}
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action,
        target_type, target_id, before, after, reason
      ) values (
        ${uuidv7()}, ${options.organizationId},
        ${options.actorUserId ? "user" : "automation"},
        ${options.actorUserId ?? null},
        'ai.model-promote', 'ai_model_version', ${canary.id},
        ${before ? tx.json(before as never) : null},
        ${tx.json({ provider: canary.provider, model: canary.model } as never)},
        ${evaluation.decision.summary}
      )
    `;
  });

  return {
    ok: true,
    message: `${canary.provider}:${canary.model} 을(를) 실사용으로 승격했습니다. ${evaluation.decision.summary}`,
    decision: evaluation.decision,
  };
}

/**
 * 카나리 중단 — 사유를 반드시 남긴다 (DB CHECK도 같은 것을 강제한다).
 * 운영자가 부를 수도 있고(수동), 악화 감시가 부를 수도 있다(자동).
 */
export async function haltCanary(options: {
  organizationId: string;
  operation: string;
  reason: string;
  actorUserId?: string | null;
}): Promise<CanaryActionResult> {
  if (options.reason.trim() === "") {
    return { ok: false, message: "중단 사유를 적으세요." };
  }
  const sql = getSharedSql();
  const [row] = await sql<{ id: string; provider: string; model: string }[]>`
    select id, provider, model from ai_model_versions
    where organization_id = ${options.organizationId}
      and operation = ${options.operation} and role = 'canary'
  `;
  if (!row) return { ok: false, message: "중단할 카나리가 없습니다." };

  await sql.begin(async (tx) => {
    await tx`
      update ai_model_versions
      set role = 'halted', halted_at = now(), halt_reason = ${options.reason},
          updated_at = now()
      where id = ${row.id}
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action,
        target_type, target_id, before, after, reason
      ) values (
        ${uuidv7()}, ${options.organizationId},
        ${options.actorUserId ? "user" : "automation"},
        ${options.actorUserId ?? null},
        'ai.model-halt', 'ai_model_version', ${row.id},
        ${tx.json({ role: "canary" } as never)},
        ${tx.json({ role: "halted", provider: row.provider, model: row.model } as never)},
        ${options.reason}
      )
    `;
    /* 업무함 고지 — 자동 중단은 아무도 지켜보지 않는 시각에 일어난다.
     * group_key로 같은 모델의 중복 고지를 막는다. */
    const recipients = await tx<{ user_id: string }[]>`
      select user_id from memberships
      where organization_id = ${options.organizationId}
        and status = 'active' and role in ('owner', 'program_director')
    `;
    for (const r of recipients) {
      await tx`
        insert into notifications (
          id, organization_id, recipient_user_id, kind, title, body,
          link_path, related_type, related_id, group_key
        ) values (
          ${uuidv7()}, ${options.organizationId}, ${r.user_id},
          'system_notice', 'AI 카나리 모델 중단',
          ${tx.json({
            what: `${row.provider}:${row.model} 카나리를 중단했습니다.`,
            why: options.reason,
            action:
              "pnpm ai-canary status 로 표본을 확인하고, 원인을 고친 뒤 다시 등록하세요",
          } as never)},
          '/app/settings', 'ai_model_version', ${row.id},
          ${`ai-canary-halt:${row.provider}:${row.model}`}
        )
        on conflict do nothing
      `;
    }
  });

  return {
    ok: true,
    message: `${row.provider}:${row.model} 카나리를 중단했습니다. 사유: ${options.reason}`,
  };
}

/**
 * 최근 창 기준 악화 감시. 중단했으면 true.
 * 섀도 기록마다 호출된다 — 그래서 도달 불가능한 분기가 아니다.
 */
export async function maybeHaltCanary(options: {
  organizationId: string;
  operation: string;
  canaryModel: string;
}): Promise<boolean> {
  const metrics = await loadCanaryMetrics({
    organizationId: options.organizationId,
    operation: options.operation,
    canaryModel: options.canaryModel,
    windowSamples: HALT_WINDOW_SAMPLES,
  });
  const decision = evaluateHalt(metrics, DEFAULT_HALT_CRITERIA);
  if (!decision.halt || decision.reason === null) return false;
  const result = await haltCanary({
    organizationId: options.organizationId,
    operation: options.operation,
    reason: `자동 중단 — ${decision.reason}`,
  });
  return result.ok;
}
