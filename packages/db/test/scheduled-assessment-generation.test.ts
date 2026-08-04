import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql, getSharedSql } from "../src/client";
import {
  ensureDefaultAssessmentPolicies,
  generateConfirmationTest,
  generateDailyTest,
  resolveAssessmentPolicy,
} from "../src/domain";

/* ─────────────────────────────────────────────────────────────
 * 평가 노드가 실제 평가가 되기까지 (T3.3) — 라이브 DB.
 *
 * T3.2가 「제때 부른다」를 세웠다. 여기서 보는 것은 그 호출이 **무엇으로
 * 부는가**다. 실측으로 확인한 결손 셋이 그 사이에 있었다.
 *
 *  ① 평가 정책을 만드는 곳이 시드의 데모 학원 하나뿐이었다. 새 학원은
 *     정책이 0건이라 자동 생성이 **무조건** 실패한다("활성 일일테스트
 *     정책이 없습니다. 설정에서 평가 정책을 만드세요" — 그 설정 화면은
 *     정책을 만들지 않는다. 목록만 보여 준다).
 *  ② `learning_groups.assessment_policy_id`를 **준비도 게이트만 읽고
 *     생성은 읽지 않았다.** 실측: 모든 조직에서 이 컬럼이 100% NULL이라
 *     게이트의 `no_assessment_policy`가 평가 노드마다 무조건 걸렸다.
 *  ③ 평가 노드가 `blueprint_id`를 **필수로** 요구했는데(T2.1 파서·T2.4
 *     게이트), 블루프린트를 만드는 곳은 생성기뿐이다 — 즉 생성 결과물이다.
 *     교사가 고를 목록도, 만들 화면도 없다. 실측: DB의 평가 노드 1건은
 *     blueprint_id가 NULL이고, 블루프린트 283건은 전부 생성 산출물이다.
 *     넣어도 생성기는 그 값을 읽지 않았다.
 *
 * 셋을 합치면 **평가 노드가 든 루트는 게시할 수 없고, 게시해도 생성이
 * 실패한다.** T3.2의 자동화가 닿을 수 없는 자리에 있었다.
 *
 * 그래서 이 스펙이 겨누는 것:
 *   1) 정책 해석이 **한 곳**이고 게이트와 생성이 같은 답을 본다 (반 → 조직)
 *   2) 새 조직에 기본 정책을 넣을 수 있다 (멱등)
 *   3) 노드 종류가 목적을 가르고, 각각 제 방식으로 출제된다
 *   4) 생성 시점의 숙련도·복습을 쓴다 — 미리 계산해 둔 것이 아니다
 *   5) 무엇이 이 평가를 만들었는지가 남는다 (세션·노드·계획일·정책 출처)
 *   6) 낼 것이 없으면 **아무 행도 쓰지 않는다** — 빈 평가를 게시하지 않는다
 *
 * 덮지 못하는 것 — 정직하게 적는다:
 *  - 미래 평가의 응시 거부는 `startAttempt`(웹 도메인)의 몫이라 여기서
 *    돌릴 수 없다. `apps/web/test/integration/attempt-date-gate.test.ts`.
 *  - 문항 선정의 품질(버킷 비율·난이도 분포)은 review-selection·
 *    blueprint-chain이 덮는다. 여기서는 **무엇을 입력으로 삼았는지**만 본다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000034001";
/** 정책이 하나도 없는 조직 — 새 학원의 상태 그대로 */
const BARE_ORG = "ffffffff-0000-7000-8000-000000034002";

const PERIOD = uuidv7();
const GROUP = uuidv7();
const LEARNER = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();

/** 단원 개념 셋 — 확인테스트는 전부를, 일일테스트는 그날 것만 본다 */
const CONCEPT_D1 = uuidv7();
const CONCEPT_D2 = uuidv7();
const CONCEPT_OTHER = uuidv7();

const NODE_D1 = uuidv7();
const NODE_D2 = uuidv7();
const NODE_DAILY = uuidv7();
const NODE_CONFIRM = uuidv7();

const SESSION_D1 = uuidv7();
const SESSION_D2 = uuidv7();

const RIGHT = uuidv7();
/** 개념마다 문항 3개 — 버킷이 굶지 않을 만큼만 */
const QUESTIONS: Array<{ id: string; version: string; concept: string }> = [];
for (const concept of [CONCEPT_D1, CONCEPT_D2, CONCEPT_OTHER]) {
  for (let i = 0; i < 3; i += 1) {
    QUESTIONS.push({ id: uuidv7(), version: uuidv7(), concept });
  }
}

const ORG_POLICY = uuidv7();
const GROUP_POLICY = uuidv7();
const CONFIRM_POLICY = uuidv7();

const D1 = "2026-09-10";
const D2 = "2026-09-11";

async function cleanup(): Promise<void> {
  for (const org of [ORG, BARE_ORG]) {
    await sql`
      delete from assignments where assessment_id in (
        select id from assessment_instances where organization_id = ${org})
    `;
    await sql`delete from assessment_questions where organization_id = ${org}`;
    await sql`delete from assessment_instances where organization_id = ${org}`;
    await sql`delete from assessment_blueprints where organization_id = ${org}`;
    await sql`delete from assessment_policies where organization_id = ${org}`;
    await sql`delete from outbox_events where organization_id = ${org}`;
    await sql`delete from review_items where organization_id = ${org}`;
    await sql`delete from concept_masteries where organization_id = ${org}`;
    await sql`delete from sessions where organization_id = ${org}`;
    await sql`delete from learning_group_memberships where organization_id = ${org}`;
    await sql`
      delete from route_nodes where route_version_id in (
        select id from route_versions where organization_id = ${org})
    `;
    await sql`update route_plans set active_version_id = null where organization_id = ${org}`;
    await sql`delete from route_versions where organization_id = ${org}`;
    await sql`delete from route_plans where organization_id = ${org}`;
    await sql`delete from question_alignments where organization_id = ${org}`;
    await sql`delete from question_versions where organization_id = ${org}`;
    await sql`delete from questions where organization_id = ${org}`;
    await sql`delete from content_rights where organization_id = ${org}`;
    await sql`delete from learners where organization_id = ${org}`;
    await sql`delete from learning_groups where organization_id = ${org}`;
    await sql`delete from course_periods where organization_id = ${org}`;
  }
  await sql`
    delete from canonical_concepts
    where id in (${CONCEPT_D1}, ${CONCEPT_D2}, ${CONCEPT_OTHER})
  `;
}

interface Generated {
  id: string;
  purpose: string;
  scheduled_date: string;
  policy_id: string;
  route_node_id: string | null;
  generation_context: {
    planDate?: string;
    sessionId?: string | null;
    routeNodeId?: string | null;
    policySource?: string;
    todayConceptIds?: string[];
  };
  concept_ids: string[];
  question_count: number;
}

async function generated(purpose: string, date: string): Promise<Generated | null> {
  const [row] = await sql<Generated[]>`
    select a.id, a.purpose::text as purpose, a.scheduled_date::text as scheduled_date,
           a.policy_id::text as policy_id, a.route_node_id::text as route_node_id,
           a.generation_context,
           coalesce(
             (select array_agg(distinct k.concept_id::text)
              from assessment_questions q
              join question_alignments k on k.question_id = q.question_id
              where q.assessment_id = a.id),
             '{}') as concept_ids,
           (select count(*)::int from assessment_questions q where q.assessment_id = a.id)
             as question_count
    from assessment_instances a
    where a.organization_id = ${ORG} and a.purpose::text = ${purpose}
      and a.scheduled_date = ${date}::date and a.status <> 'cancelled'
  `;
  return row ?? null;
}

/* ── 1) 정책 해석 — 게이트와 생성이 같은 답을 본다 ──────────── */

describe.skipIf(!hasDb)("평가 정책 해석", () => {
  beforeAll(async () => {
    sql = createSql();
    for (const [org, name, slug] of [
      [ORG, "ITEST 평가노드", "itest-assessment-nodes"],
      [BARE_ORG, "ITEST 정책없는학원", "itest-bare-org"],
    ] as const) {
      await sql`
        insert into organizations (id, name, slug, timezone)
        values (${org}, ${name}, ${slug}, ${TZ})
        on conflict (id) do nothing
      `;
    }
    await cleanup();

    await sql`
      insert into course_periods (
        id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026, '2026-08-01', '2026-12-31', 'active')
    `;
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 반', 'operating')
    `;
    await sql`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, constraints, is_active)
      values (${ORG_POLICY}, ${ORG}, 'ITEST 조직 일일', 'formative', 1,
              ${sql.json({ today_concept: 100, weakness: 0, review: 0 } as never)},
              2, ${sql.json({} as never)}, true)
    `;
  });

  afterAll(async () => {
    /* 뒷정리는 마지막 스위트가 한다 — 여기서 지우면 아래가 전제를 잃는다 */
  });

  it("조직 정책으로 내려간다 — 반이 지정하지 않았을 때", async () => {
    const resolved = await resolveAssessmentPolicy(sql, {
      organizationId: ORG,
      learningGroupId: GROUP,
      purpose: "formative",
    });
    expect(resolved?.policy.id).toBe(ORG_POLICY);
    expect(resolved?.source).toBe("organization");
  });

  it("반 정책이 조직 정책을 이긴다", async () => {
    await sql`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, constraints, is_active)
      values (${GROUP_POLICY}, ${ORG}, 'ITEST 반 일일', 'formative', 1,
              ${sql.json({ today_concept: 100, weakness: 0, review: 0 } as never)},
              3, ${sql.json({} as never)}, true)
    `;
    await sql`
      update learning_groups set assessment_policy_id = ${GROUP_POLICY}
      where id = ${GROUP}
    `;
    const resolved = await resolveAssessmentPolicy(sql, {
      organizationId: ORG,
      learningGroupId: GROUP,
      purpose: "formative",
    });
    expect(resolved?.policy.id).toBe(GROUP_POLICY);
    expect(resolved?.source).toBe("group");
    expect(resolved?.policy.questionCount).toBe(3);
  });

  it("반 정책의 목적이 다르면 무시하고 조직으로 내려간다", async () => {
    /* 반에 일일테스트 정책을 걸어 두고 확인테스트를 만들 수 있다 —
     * 목적이 다른 정책을 그대로 쓰면 확인테스트가 일일테스트 규칙으로 난다. */
    const resolved = await resolveAssessmentPolicy(sql, {
      organizationId: ORG,
      learningGroupId: GROUP,
      purpose: "confirmation",
    });
    expect(resolved).toBeNull(); // 아직 확인테스트 정책이 없다
  });

  it("비활성 정책은 후보가 아니다", async () => {
    await sql`update assessment_policies set is_active = false where id = ${GROUP_POLICY}`;
    const resolved = await resolveAssessmentPolicy(sql, {
      organizationId: ORG,
      learningGroupId: GROUP,
      purpose: "formative",
    });
    /* 반이 가리키는 정책이 꺼졌으면 그 반은 정책이 없는 것과 같다 —
     * 꺼진 정책으로 계속 내는 것보다 조직 기본으로 내려가는 편이 낫다. */
    expect(resolved?.policy.id).not.toBe(GROUP_POLICY);
    expect(resolved?.source).toBe("organization");
    await sql`update assessment_policies set is_active = true where id = ${GROUP_POLICY}`;
  });

  it("아무 정책도 없으면 null — 게이트가 이 답으로 막는다", async () => {
    const resolved = await resolveAssessmentPolicy(sql, {
      organizationId: BARE_ORG,
      learningGroupId: null,
      purpose: "formative",
    });
    expect(resolved).toBeNull();
  });

  it("새 조직에 기본 정책을 넣을 수 있다 (멱등)", async () => {
    /* 실측: 정책을 만드는 곳이 데모 시드뿐이라 새 학원은 자동 생성이
     * 영원히 실패했다. 만드는 길이 코드에 있어야 온보딩이 그것을 부른다. */
    const first = await ensureDefaultAssessmentPolicies(sql, BARE_ORG);
    expect(first.created.sort()).toEqual(["confirmation", "formative"]);

    const daily = await resolveAssessmentPolicy(sql, {
      organizationId: BARE_ORG,
      learningGroupId: null,
      purpose: "formative",
    });
    const confirmation = await resolveAssessmentPolicy(sql, {
      organizationId: BARE_ORG,
      learningGroupId: null,
      purpose: "confirmation",
    });
    expect(daily?.policy.questionCount).toBeGreaterThan(0);
    expect(confirmation?.policy.questionCount).toBeGreaterThan(0);

    const second = await ensureDefaultAssessmentPolicies(sql, BARE_ORG);
    expect(second.created).toEqual([]);
    const [count] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from assessment_policies
      where organization_id = ${BARE_ORG}
    `;
    expect(count!.cnt).toBe(2);
  });
});

/* ── 2) 노드 → 평가 ─────────────────────────────────────────── */

describe.skipIf(!hasDb)("평가 노드가 실제 평가가 된다", () => {
  let dailyD1: Generated | null;
  let confirmation: Generated | null;
  let dailyD2: Generated | null;
  let emptyResult: Awaited<ReturnType<typeof generateDailyTest>>;
  let emptyRowCounts: { blueprints: number; instances: number };
  let barePolicyResult: Awaited<ReturnType<typeof generateDailyTest>>;

  beforeAll(async () => {
    await sql`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, constraints, passing_rules, is_active)
      values (${CONFIRM_POLICY}, ${ORG}, 'ITEST 확인', 'confirmation', 1,
              ${sql.json({ anchor: 100 } as never)}, 3, ${sql.json({} as never)},
              ${sql.json({ passRatio: 0.7 } as never)}, true)
    `;
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${LEARNER}, ${ORG}, 'ITEST 학생', 'active')
    `;
    await sql`
      insert into learning_group_memberships (
        id, organization_id, learning_group_id, learner_id, status, joined_on)
      values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER}, 'active', '2026-08-01')
    `;
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values
        (${CONCEPT_D1}, ${`itest-t33-d1-${CONCEPT_D1.slice(-12)}`}, 'ITEST 1일차 개념', 'active', '[]'::jsonb),
        (${CONCEPT_D2}, ${`itest-t33-d2-${CONCEPT_D2.slice(-12)}`}, 'ITEST 2일차 개념', 'active', '[]'::jsonb),
        (${CONCEPT_OTHER}, ${`itest-t33-ot-${CONCEPT_OTHER.slice(-12)}`}, 'ITEST 단원 밖 개념', 'active', '[]'::jsonb)
      on conflict (id) do update set status = 'active'
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${RIGHT}, ${ORG}, 'ITEST', 'usable')
    `;
    for (const [i, q] of QUESTIONS.entries()) {
      await sql`
        insert into questions (
          id, organization_id, kind, review_status, content_right_id,
          is_auto_assignable, current_version_id)
        values (${q.id}, ${ORG}, 'short_answer', 'published', ${RIGHT}, true, ${q.version})
      `;
      await sql`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, answer,
          points, difficulty, content_checksum)
        values (${q.version}, ${ORG}, ${q.id}, 1,
                ${sql.json([{ type: "text", text: `ITEST 문항 ${i + 1}` }] as never)},
                ${sql.json({ kind: "short_answer", accepted: [{ value: "1", form: "number" }] } as never)},
                '10', ${sql.json({ band: "mid" } as never)}, ${`itest-t33-${q.id}`})
      `;
      await sql`
        insert into question_alignments (id, organization_id, question_id, concept_id, weight)
        values (${uuidv7()}, ${ORG}, ${q.id}, ${q.concept}, 1)
      `;
    }

    await sql`
      insert into route_plans (
        id, organization_id, kind, name, learning_group_id, course_period_id,
        status, active_version_id)
      values (${PLAN}, ${ORG}, 'group_route', 'ITEST 루트', ${GROUP}, ${PERIOD},
              'published', ${VERSION})
    `;
    await sql`
      insert into route_versions (id, organization_id, route_plan_id, version_number, status)
      values (${VERSION}, ${ORG}, ${PLAN}, 1, 'published')
    `;
    /* 단원 = 이 버전의 노드 개념 전체. CONCEPT_OTHER는 일부러 뺀다 —
     * 확인테스트가 「단원 전체」를 본다는 것이 단순히 「전부」가 아님을 본다. */
    await sql`
      insert into route_nodes (
        id, organization_id, route_version_id, kind, title, sort_order, concept_ids)
      values
        (${NODE_D1}, ${ORG}, ${VERSION}, 'concept_lesson', 'ITEST 1일차', 1,
         ${sql.json([CONCEPT_D1] as never)}),
        (${NODE_DAILY}, ${ORG}, ${VERSION}, 'daily_test', 'ITEST 일일테스트', 2,
         ${sql.json([] as never)}),
        (${NODE_D2}, ${ORG}, ${VERSION}, 'concept_lesson', 'ITEST 2일차', 3,
         ${sql.json([CONCEPT_D2] as never)}),
        (${NODE_CONFIRM}, ${ORG}, ${VERSION}, 'confirmation_test', 'ITEST 확인테스트', 4,
         ${sql.json([] as never)})
    `;
    await sql`
      insert into sessions (
        id, organization_id, learning_group_id, session_date, timezone,
        starts_at, ends_at, status, planned_node_ids)
      values
        (${SESSION_D1}, ${ORG}, ${GROUP}, ${D1}::date, ${TZ},
         ${`${D1}T09:00:00+09:00`}, ${`${D1}T11:00:00+09:00`}, 'planned',
         ${sql.json([NODE_D1, NODE_DAILY] as never)}),
        (${SESSION_D2}, ${ORG}, ${GROUP}, ${D2}::date, ${TZ},
         ${`${D2}T09:00:00+09:00`}, ${`${D2}T11:00:00+09:00`}, 'planned',
         ${sql.json([NODE_D2, NODE_DAILY, NODE_CONFIRM] as never)})
    `;

    /* ── 1일차 일일테스트 ── */
    await generateDailyTest({
      organizationId: ORG,
      learningGroupId: GROUP,
      targetDate: D1,
      actorUserId: null,
      sessionId: SESSION_D1,
      routeNodeId: NODE_DAILY,
    });
    dailyD1 = await generated("formative", D1);

    /* ── 확인테스트 (2일차) ── */
    await generateConfirmationTest({
      organizationId: ORG,
      learningGroupId: GROUP,
      targetDate: D2,
      actorUserId: null,
      sessionId: SESSION_D2,
      routeNodeId: NODE_CONFIRM,
    });
    confirmation = await generated("confirmation", D2);

    /* ── 그 사이에 학습 상태가 바뀐다 ──
     * 1일차 개념이 약점이 되고, 그 개념 문항에 복습 기한이 온다. 2일차
     * 생성이 이것을 반영하면 「생성 시점의 상태」가 실재하는 것이다. */
    await sql`
      insert into concept_masteries (
        id, organization_id, learner_id, concept_id, state, point_estimate,
        evidence_count)
      values (${uuidv7()}, ${ORG}, ${LEARNER}, ${CONCEPT_D1}, 'partial', 0.4, 1)
    `;
    await sql`
      insert into review_items (
        id, organization_id, learner_id, concept_id, question_id, source_kind,
        status, due_on, interval_days, stability_days, last_reviewed_on)
      values (${uuidv7()}, ${ORG}, ${LEARNER}, ${CONCEPT_D1},
              ${QUESTIONS[0]!.id}, 'wrong_answer', 'scheduled', ${D2}::date,
              1, 1, ${D1}::date)
    `;
    await sql`
      update assessment_policies
      set pool_weights = ${sql.json({ today_concept: 34, weakness: 33, review: 33 } as never)},
          question_count = 3
      where id = ${GROUP_POLICY}
    `;

    await generateDailyTest({
      organizationId: ORG,
      learningGroupId: GROUP,
      targetDate: D2,
      actorUserId: null,
      sessionId: SESSION_D2,
      routeNodeId: NODE_DAILY,
    });
    dailyD2 = await generated("formative", D2);

    /* ── 낼 것이 없는 날 — 아무 행도 쓰지 않아야 한다 ── */
    const before = await sql<{ b: number; i: number }[]>`
      select (select count(*)::int from assessment_blueprints where organization_id = ${ORG}) as b,
             (select count(*)::int from assessment_instances where organization_id = ${ORG}) as i
    `;
    await sql`update questions set review_status = 'draft' where organization_id = ${ORG}`;
    emptyResult = await generateDailyTest({
      organizationId: ORG,
      learningGroupId: GROUP,
      targetDate: "2026-09-12",
      actorUserId: null,
    });
    const after = await sql<{ b: number; i: number }[]>`
      select (select count(*)::int from assessment_blueprints where organization_id = ${ORG}) as b,
             (select count(*)::int from assessment_instances where organization_id = ${ORG}) as i
    `;
    emptyRowCounts = {
      blueprints: after[0]!.b - before[0]!.b,
      instances: after[0]!.i - before[0]!.i,
    };
    await sql`update questions set review_status = 'published' where organization_id = ${ORG}`;

    /* ── 정책이 없는 조직 ── */
    await sql`delete from assessment_policies where organization_id = ${BARE_ORG}`;
    barePolicyResult = await generateDailyTest({
      organizationId: BARE_ORG,
      learningGroupId: uuidv7(),
      targetDate: D1,
      actorUserId: null,
    });
  });

  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 });
    await getSharedSql().end({ timeout: 5 });
  });

  it("일일테스트 노드는 formative를, 확인테스트 노드는 confirmation을 만든다", () => {
    expect(dailyD1?.purpose).toBe("formative");
    expect(confirmation?.purpose).toBe("confirmation");
    expect(dailyD1?.question_count).toBeGreaterThan(0);
    expect(confirmation?.question_count).toBeGreaterThan(0);
  });

  it("일일테스트는 그날 수업 개념에서 낸다", () => {
    expect(dailyD1?.generation_context.todayConceptIds).toEqual([CONCEPT_D1]);
    expect(dailyD1?.concept_ids).toEqual([CONCEPT_D1]);
  });

  it("확인테스트는 단원 개념 전체를 앵커로 덮는다", () => {
    /* 루트 버전의 노드 개념이 단원이다 — 문제은행 전체가 아니다.
     * CONCEPT_OTHER는 문항이 있어도 단원 밖이라 들어오면 안 된다. */
    expect(confirmation?.concept_ids.sort()).toEqual([CONCEPT_D1, CONCEPT_D2].sort());
    expect(confirmation?.concept_ids).not.toContain(CONCEPT_OTHER);
  });

  it("무엇이 이 평가를 만들었는지가 남는다", () => {
    /* 「이 시험은 왜 있나」에 답할 수 있어야 한다 — 어느 수업의 어느 노드가,
     * 어느 계획일에, 어느 정책으로 냈는가. 없으면 생성물만 남고 근거가 없다. */
    expect(dailyD1?.generation_context.planDate).toBe(D1);
    expect(dailyD1?.generation_context.sessionId).toBe(SESSION_D1);
    expect(dailyD1?.generation_context.routeNodeId).toBe(NODE_DAILY);
    expect(dailyD1?.generation_context.policySource).toBe("group");
    expect(dailyD1?.policy_id).toBe(GROUP_POLICY);

    expect(confirmation?.generation_context.routeNodeId).toBe(NODE_CONFIRM);
    expect(confirmation?.generation_context.policySource).toBe("organization");
  });

  it("부른 노드가 **컬럼**에도 남는다 — 학생 화면이 그것으로 잇는다", () => {
    /* generation_context에만 두면 근거는 남지만 **연결은 끊긴다.**
     *
     * 학생의 하루를 그리는 `listAssignments`는 `assessment_instances.
     * route_node_id` **컬럼**을 읽어 평가를 루트 노드에 붙인다. 컬럼이
     * 비어 있으면 그 노드는 실행기에서 「예정된 평가가 아직 생성되지
     * 않았습니다」로 막히고, 같은 시험이 노드 없는 항목으로 한 번 더 나온다.
     * 필수 항목 하나가 영원히 막혀 있으므로 그 학생의 하루는 **결코 완료될
     * 수 없다** — 교사 현황판에도 영영 「막힘」이다.
     *
     * 실측: 이 컬럼을 채우는 코드가 어디에도 없었고, 운영 DB의
     * assessment_instances 1884건 중 route_node_id가 있는 것은 0건이었다.
     * 시드된 평가로만 돌던 기존 E2E는 평가 노드가 든 루트를 한 번도 학생
     * 화면까지 끌고 가지 않아 드러나지 않았다 (T6.2 자율 E2E에서 발견). */
    expect(dailyD1?.route_node_id).toBe(NODE_DAILY);
    expect(confirmation?.route_node_id).toBe(NODE_CONFIRM);
  });

  it("생성 시점의 숙련도·복습을 쓴다 — 미리 계산해 둔 것이 아니다", () => {
    /* 1일차 생성 때는 숙련도도 복습도 없었다. 2일차 생성은 그 사이에
     * 생긴 약점·복습을 입력으로 삼는다. 학기 초에 한 번 계산해 두는
     * 구조였다면 둘의 선정 이유가 같아야 한다. */
    expect(dailyD1?.generation_context.todayConceptIds).toEqual([CONCEPT_D1]);
    expect(dailyD2?.generation_context.todayConceptIds).toEqual([CONCEPT_D2]);
    expect(dailyD2?.concept_ids).toContain(CONCEPT_D1); // 약점·복습으로 되돌아온다
  });

  it("낼 것이 없으면 아무 행도 쓰지 않는다 — 빈 평가를 게시하지 않는다", () => {
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.assessmentId).toBeNull();
    /* 인스턴스를 먼저 만들고 채우는 구조였다면 여기 고아 행이 남는다.
     * 블루프린트만 남는 것도 마찬가지로 쓰레기다. */
    expect(emptyRowCounts).toEqual({ blueprints: 0, instances: 0 });
  });

  it("정책이 없으면 만들 수 있는 곳을 가리킨다", () => {
    expect(barePolicyResult.ok).toBe(false);
    expect(barePolicyResult.message).toContain("정책");
  });
});
