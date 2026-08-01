import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  DEFAULT_MOCK_MODEL,
  FAILING_MODEL_NAME,
  MockAiProvider,
  getSharedBreaker,
} from "@su-maek/core/ai";
import { normalizeMixedText } from "@su-maek/core/math";
import { createSql } from "../src/client";
import { processSourceFile } from "../src/domain/ingestion";
import {
  EXTRACT_QUESTIONS_OPERATION,
  evaluateCanaryPromotion,
  haltCanary,
  promoteCanary,
  registerModelVersion,
} from "../src/domain/ai-canary";

/* ─────────────────────────────────────────────────────────────
 * AI 모델 카나리 (인수 36) — 라이브 DB.
 *
 * 순수 판정은 core/test/ai/model-registry.test.ts 가 덮는다. 여기서
 * 확인하는 것은 **제품 안에서 그 판정에 도달하는가**다. 인수 37에서
 * 겪은 실패(쓰는 경로가 없어 차단 분기가 영영 실행되지 않았다)를
 * 되풀이하지 않기 위해, 전부 실제 반입 경로(processSourceFile)를 통과시킨다.
 *
 *  1) 레지스트리가 비어 있으면 예전과 똑같이 돈다 (섀도 0건)
 *  2) 카나리를 등록하면 섀도 표본이 쌓이고, **저장된 문항은 여전히
 *     실사용 모델의 것**이다 — 카나리 산출물은 어디에도 들어가지 않는다
 *  3) kill switch로 섀도만 멈춘다 — 반입은 계속된다
 *  4) 카나리가 죽어도 반입은 성공하고, 표본이 쌓이면 자동 중단된다
 *  5) 기준 미달이면 승격이 막힌다 / 기준을 넘으면 승격되고
 *     그 다음 반입이 실제로 새 모델을 쓴다
 *
 * 고정 ID 픽스처 — audit_events가 append-only라 조직을 지울 수 없다.
 * 연결은 beforeAll에서 만든다 (최상단 createSql()은 skip 판정 전에 던진다).
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const ORG = "ffffffff-0000-7000-8000-000000360001";
const OWNER = "ffffffff-0000-7000-8000-000000360002";
const CANARY_MODEL = "mock-extractor-v2";

async function cleanupOperationalRows(): Promise<void> {
  await sql`delete from ai_shadow_evaluations where organization_id = ${ORG}`;
  await sql`delete from ai_model_versions where organization_id = ${ORG}`;
  await sql`delete from ai_usage_events where organization_id = ${ORG}`;
  await sql`delete from notifications where organization_id = ${ORG}`;
  await sql`delete from formula_reviews where organization_id = ${ORG}`;
  await sql`delete from content_reviews where organization_id = ${ORG}`;
  await sql`delete from question_alignments where organization_id = ${ORG}`;
  await sql`update questions set current_version_id = null
            where organization_id = ${ORG}`;
  await sql`delete from question_versions where organization_id = ${ORG}`;
  await sql`delete from questions where organization_id = ${ORG}`;
  await sql`delete from source_files where organization_id = ${ORG}`;
  await sql`delete from kill_switches where organization_id = ${ORG}`;
}

/**
 * 반입 1회 — 파일마다 새 checksum (조직×checksum 유니크).
 * checksum을 넘기면 추출 결과가 고정된다 (목 공급자가 결정론적이므로).
 */
async function ingestOnce(
  fixedChecksum?: string,
): Promise<{ fileId: string; checksum: string }> {
  const fileId = uuidv7();
  const checksum = fixedChecksum ?? `sha256:${fileId}`;
  await sql`
    insert into source_files (
      id, organization_id, storage_path, file_name, mime_type,
      byte_size, checksum, page_count, status, uploaded_by
    ) values (
      ${fileId}, ${ORG}, ${`${ORG}/sources/${fileId}/원본.pdf`}, '단원평가.pdf',
      'application/pdf', 1024, ${checksum}, 2, 'uploaded', ${OWNER}
    )
  `;
  const result = await processSourceFile({
    organizationId: ORG,
    sourceFileId: fileId,
    actorUserId: OWNER,
  });
  expect(result.ok).toBe(true);
  return { fileId, checksum };
}

/** 그 파일로 저장된 문항들이 어느 모델에서 나왔는가 */
async function storedModels(fileId: string): Promise<string[]> {
  const rows = await sql<{ model: string }[]>`
    select distinct v.extraction->>'model' as model
    from question_versions v
    join questions q on q.id = v.question_id
    where q.source_file_id = ${fileId}
  `;
  return rows.map((r) => r.model).sort();
}

async function storedBodies(fileId: string): Promise<string[]> {
  const rows = await sql<{ body: string }[]>`
    select v.body->0->>'text' as body
    from question_versions v
    join questions q on q.id = v.question_id
    where q.source_file_id = ${fileId}
    order by q.printed_number
  `;
  return rows.map((r) => r.body);
}

async function shadowRows(canaryModel?: string): Promise<
  Array<{
    ok: boolean;
    agreement: string | null;
    canary_model: string;
    baseline_model: string;
    error_kind: string | null;
  }>
> {
  return sql<
    {
      ok: boolean;
      agreement: string | null;
      canary_model: string;
      baseline_model: string;
      error_kind: string | null;
    }[]
  >`
    select ok, agreement::text, canary_model, baseline_model, error_kind
    from ai_shadow_evaluations
    where organization_id = ${ORG}
      and (${canaryModel ?? null}::text is null
           or canary_model = ${canaryModel ?? null})
    order by created_at
  `;
}

async function roleOf(model: string): Promise<string | null> {
  const [row] = await sql<{ role: string }[]>`
    select role from ai_model_versions
    where organization_id = ${ORG} and model = ${model}
  `;
  return row?.role ?? null;
}

/** 승격 게이트가 읽는 표본을 직접 넣는다 (아래 describe 주석 참고) */
async function seedGoodSamples(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await sql`
      insert into ai_shadow_evaluations (
        id, organization_id, operation,
        baseline_provider, baseline_model, canary_provider, canary_model,
        ok, agreement, baseline_latency_ms, canary_latency_ms,
        baseline_cost_usd, canary_cost_usd,
        canary_input_tokens, canary_output_tokens
      ) values (
        ${uuidv7()}, ${ORG}, ${EXTRACT_QUESTIONS_OPERATION},
        'mock', ${DEFAULT_MOCK_MODEL}, 'mock', ${CANARY_MODEL},
        true, '0.990', 800, 810, '0.010000', '0.012000', 3200, 1400
      )
    `;
  }
}

describe.skipIf(!hasDb)("AI 모델 카나리 (인수 36)", () => {
  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug)
      values (${ORG}, '카나리 테스트', ${`canary-${ORG.slice(0, 8)}`})
      on conflict (id) do nothing
    `;
    await sql`
      insert into users (id, email, display_name)
      values (${OWNER}, 'canary-owner@test.local', '카나리 소유자')
      on conflict (id) do nothing
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values (${uuidv7()}, ${ORG}, ${OWNER}, 'owner', 'active')
      on conflict do nothing
    `;
    await cleanupOperationalRows();
  });

  afterAll(async () => {
    await cleanupOperationalRows();
    await sql.end({ timeout: 5 });
  });

  it("레지스트리가 비어 있으면 예전과 똑같이 돈다 — 섀도 0건 (대조군)", async () => {
    const { fileId } = await ingestOnce();
    expect(await storedModels(fileId)).toEqual([DEFAULT_MOCK_MODEL]);
    expect(await shadowRows()).toHaveLength(0);
  });

  it("카나리를 등록하면 섀도 표본이 쌓인다", async () => {
    expect(
      (
        await registerModelVersion({
          organizationId: ORG,
          operation: EXTRACT_QUESTIONS_OPERATION,
          provider: "mock",
          model: DEFAULT_MOCK_MODEL,
          role: "active",
          actorUserId: OWNER,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await registerModelVersion({
          organizationId: ORG,
          operation: EXTRACT_QUESTIONS_OPERATION,
          provider: "mock",
          model: CANARY_MODEL,
          role: "canary",
          actorUserId: OWNER,
        })
      ).ok,
    ).toBe(true);

    await ingestOnce();

    const rows = await shadowRows(CANARY_MODEL);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ok).toBe(true);
    expect(rows[0]?.baseline_model).toBe(DEFAULT_MOCK_MODEL);
    expect(Number(rows[0]?.agreement)).toBeGreaterThanOrEqual(0);
  });

  it("저장된 문항은 실사용 모델의 것이다 — 카나리 산출물은 들어가지 않는다", async () => {
    /* 고정 checksum을 쓴다 — 목 공급자가 결정론적이므로 두 모델의 산출물이
     * 확실히 다른 입력을 골라 두어야 아래 대조가 우연에 기대지 않는다.
     * (이 checksum에서 v1은 5문항, v2는 3문항을 낸다.) */
    const FIXED = "sha256:canary-fixed-0001";
    const { fileId, checksum } = await ingestOnce(FIXED);

    // 1) 문항에 박힌 모델 이름이 카나리가 아니다
    expect(await storedModels(fileId)).toEqual([DEFAULT_MOCK_MODEL]);

    // 2) 이름만이 아니라 **내용**도 실사용 모델의 것이다.
    const extract = async (model?: string) =>
      (
        await new MockAiProvider(model ? { model } : {}).extractQuestions({
          fileName: "단원평가.pdf",
          checksum,
          pageCount: 2,
        })
      ).questions.map((q) => normalizeMixedText(q.bodyText).normalized);

    const baselineBodies = await extract();
    const canaryBodies = await extract(CANARY_MODEL);
    // 대조군: 카나리는 실제로 다른 것을 내놓았다 (아니면 이 검사가 무의미하다)
    expect(canaryBodies).not.toEqual(baselineBodies);

    expect(await storedBodies(fileId)).toEqual(baselineBodies);
  });

  it("kill switch로 섀도만 멈춘다 — 반입은 계속된다", async () => {
    const before = (await shadowRows(CANARY_MODEL)).length;
    await sql`
      insert into kill_switches (id, organization_id, key, enabled, reason)
      values (${uuidv7()}, ${ORG}, 'ai_model_canary', false, '카나리 점검')
    `;
    const { fileId } = await ingestOnce();
    // 반입은 그대로 됐다
    expect((await storedModels(fileId)).length).toBeGreaterThan(0);
    // 섀도는 늘지 않았다
    expect((await shadowRows(CANARY_MODEL)).length).toBe(before);

    await sql`delete from kill_switches where organization_id = ${ORG}`;
    await ingestOnce();
    expect((await shadowRows(CANARY_MODEL)).length).toBe(before + 1);
  });

  it("실제 표본으로는 승격이 막힌다 — 목 v2는 일치도가 낮다", async () => {
    const evaluation = await evaluateCanaryPromotion({
      organizationId: ORG,
      operation: EXTRACT_QUESTIONS_OPERATION,
    });
    expect(evaluation.canary?.model).toBe(CANARY_MODEL);
    expect(evaluation.decision?.promotable).toBe(false);

    const result = await promoteCanary({
      organizationId: ORG,
      operation: EXTRACT_QUESTIONS_OPERATION,
      actorUserId: OWNER,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("차단");
    // 막혔으면 역할이 그대로여야 한다
    expect(await roleOf(CANARY_MODEL)).toBe("canary");
    expect(await roleOf(DEFAULT_MOCK_MODEL)).toBe("active");
  });

  it("기준을 넘으면 승격되고, 다음 반입이 실제로 새 모델을 쓴다", async () => {
    /* 표본 20건을 실제 반입 20회로 채우지 않는다 — 여기서 확인하려는 것은
     * "게이트가 집계를 읽고 승격을 집행하는가"이고, 섀도 기록이 실제 반입에서
     * 만들어진다는 것은 위 테스트들이 이미 보였다. 앞선 실제 표본(일치도가
     * 낮다)은 지우고 기준을 넘는 표본만 남긴다. */
    await sql`delete from ai_shadow_evaluations where organization_id = ${ORG}`;
    await seedGoodSamples(25);

    const result = await promoteCanary({
      organizationId: ORG,
      operation: EXTRACT_QUESTIONS_OPERATION,
      actorUserId: OWNER,
    });
    expect(result.ok).toBe(true);
    expect(await roleOf(CANARY_MODEL)).toBe("active");
    expect(await roleOf(DEFAULT_MOCK_MODEL)).toBe("retired");

    const [audit] = await sql<{ action: string; reason: string | null }[]>`
      select action, reason from audit_events
      where organization_id = ${ORG} and action = 'ai.model-promote'
      order by created_at desc limit 1
    `;
    expect(audit?.action).toBe("ai.model-promote");
    // 승격 사유에 판정 요약이 남는다 — "왜 이 모델이 올라갔나"의 답
    expect(audit?.reason).toContain("승격 가능");

    // 승격이 실사용에 반영된다 — 이것이 안 되면 레지스트리는 장식이다
    const { fileId } = await ingestOnce();
    expect(await storedModels(fileId)).toEqual([CANARY_MODEL]);
  });

  it("카나리가 죽어도 반입은 성공하고, 표본이 쌓이면 자동 중단된다", async () => {
    expect(
      (
        await registerModelVersion({
          organizationId: ORG,
          operation: EXTRACT_QUESTIONS_OPERATION,
          provider: "mock",
          model: FAILING_MODEL_NAME,
          role: "canary",
          actorUserId: OWNER,
        })
      ).ok,
    ).toBe(true);

    // 중단 임계(표본 5건·실패율 25%)까지 실제 반입을 돌린다.
    for (let i = 0; i < 5; i++) {
      const { fileId } = await ingestOnce(); // 반입 자체는 성공해야 한다
      expect((await storedModels(fileId))[0]).toBe(CANARY_MODEL); // 실사용 모델
    }

    const rows = await shadowRows(FAILING_MODEL_NAME);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.every((r) => !r.ok)).toBe(true);
    expect(rows[0]?.error_kind).toBe("unavailable");

    /* 카나리 장애가 **실사용 공급자의 회로를 열지 않았다.** 같은 차단기를
     * 공유하면 섀도가 사용자 경로를 망가뜨린다 — 결과를 안 쓴다는 말이
     * 무의미해지는 지점이다. */
    expect(
      getSharedBreaker(`shadow:mock:${FAILING_MODEL_NAME}`).currentState(),
    ).toBe("open");
    expect(getSharedBreaker("mock").currentState()).toBe("closed");

    expect(await roleOf(FAILING_MODEL_NAME)).toBe("halted");
    const [halted] = await sql<{ halt_reason: string }[]>`
      select halt_reason from ai_model_versions
      where organization_id = ${ORG} and model = ${FAILING_MODEL_NAME}
    `;
    expect(halted?.halt_reason).toContain("자동 중단");

    // 소유자에게 고지가 갔다
    const [notice] = await sql<{ title: string }[]>`
      select title from notifications
      where organization_id = ${ORG} and related_type = 'ai_model_version'
    `;
    expect(notice?.title).toContain("카나리");
  });

  it("중단된 카나리에는 더 이상 섀도가 붙지 않는다", async () => {
    const before = (await shadowRows(FAILING_MODEL_NAME)).length;
    await ingestOnce();
    expect((await shadowRows(FAILING_MODEL_NAME)).length).toBe(before);
  });

  it("중단은 사유 없이 할 수 없다", async () => {
    const result = await haltCanary({
      organizationId: ORG,
      operation: EXTRACT_QUESTIONS_OPERATION,
      reason: "   ",
    });
    expect(result.ok).toBe(false);
  });
});
