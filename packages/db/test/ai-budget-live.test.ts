import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../src/client";
import { checkAiBudget } from "../src/domain/ai-usage";

/* ─────────────────────────────────────────────────────────────
 * AI 월 한도 집행 (인수 37) — 라이브 DB.
 *
 * 순수 판정(evaluateBudget)은 ai-usage.test.ts가 덮지만, 그것만으로는
 * **제품에서 그 분기에 도달할 수 있는지**를 증명하지 못한다. ai_budgets에
 * 쓰는 경로가 없던 동안 limit_usd는 항상 null이었고 100% 차단은 죽은 코드였다.
 * 여기서는 예산 행이 있을 때 checkAiBudget이 실제로 집계를 읽어 경고·차단으로
 * 넘어가는지를 확인한다 (설정 화면의 setAiBudget이 만드는 것과 같은 행).
 *
 * 연결은 beforeAll에서 만든다 — 최상단 createSql()은 skip 판정 전에 던진다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const ORG = uuidv7();

async function spend(amountUsd: number): Promise<void> {
  await sql`
    insert into ai_usage_events (
      id, organization_id, provider, model, operation,
      input_tokens, output_tokens, estimated_cost_usd, pricing_version
    ) values (
      ${uuidv7()}, ${ORG}, 'mock', 'mock-1', 'test',
      0, 0, ${amountUsd.toFixed(6)}, 'test'
    )
  `;
}

async function setLimit(limitUsd: number, warnRatio = 0.8): Promise<void> {
  await sql`
    insert into ai_budgets (id, organization_id, monthly_limit_usd, warn_ratio)
    values (${uuidv7()}, ${ORG}, ${limitUsd.toFixed(2)}, ${warnRatio.toFixed(2)})
    on conflict (organization_id) do update
      set monthly_limit_usd = excluded.monthly_limit_usd,
          warn_ratio = excluded.warn_ratio
  `;
}

describe.skipIf(!hasDb)("AI 월 한도 집행 (인수 37)", () => {
  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug)
      values (${ORG}, 'AI 예산 테스트', ${`ai-budget-${ORG.slice(0, 8)}`})
    `;
  });

  afterAll(async () => {
    await sql`delete from ai_usage_events where organization_id = ${ORG}`;
    await sql`delete from ai_budgets where organization_id = ${ORG}`;
    await sql`delete from notifications where organization_id = ${ORG}`;
    await sql`delete from organizations where id = ${ORG}`;
    await sql.end({ timeout: 5 });
  });

  it("예산 행이 없으면 기록만 하고 막지 않는다", async () => {
    await spend(5);
    const e = await checkAiBudget(ORG);
    expect(e.limitUsd).toBeNull();
    expect(e.allowed).toBe(true);
    expect(e.warn).toBe(false);
  });

  it("예산 행이 생기면 같은 사용액이 경고 임계로 판정된다", async () => {
    // 누적 $5 · 한도 $6 → 83% > 80%
    await setLimit(6);
    const e = await checkAiBudget(ORG);
    expect(e.limitUsd).toBe(6);
    expect(e.monthToDateUsd).toBeCloseTo(5, 2);
    expect(e.allowed).toBe(true);
    expect(e.warn).toBe(true);
  });

  it("한도 도달은 실제로 차단된다 — 쓰기 경로가 없으면 도달 불가능했던 분기", async () => {
    await spend(2); // 누적 $7 ≥ 한도 $6
    const e = await checkAiBudget(ORG);
    expect(e.monthToDateUsd).toBeCloseTo(7, 2);
    expect(e.allowed).toBe(false);
    expect(e.message).toContain("차단");
  });

  it("한도를 해제하면 다시 통과한다 (설정 화면의 빈 값 저장과 같은 상태)", async () => {
    await sql`delete from ai_budgets where organization_id = ${ORG}`;
    const e = await checkAiBudget(ORG);
    expect(e.limitUsd).toBeNull();
    expect(e.allowed).toBe(true);
  });
});
