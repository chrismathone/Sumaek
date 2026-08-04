import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../src/client";
import {
  ASSESSMENT_GENERATE_TOPIC,
  ASSESSMENT_GENERATION_SWITCH,
  assessmentJobKey,
  findDueAssessmentSessions,
  produceAssessmentJobs,
} from "../src/domain/assessment-schedule";

/* ─────────────────────────────────────────────────────────────
 * due 수업 발견 쿼리 (T3.2) — 라이브 DB.
 *
 * 워커 쪽 테스트(apps/worker/test/handlers/assessment-generation.test.ts)는
 * 「제때 만들어져 실행되는가」를 끝에서 끝까지 본다. 여기서 보는 것은 그
 * 앞의 **선별**이다 — 무엇이 대상이고 무엇이 아닌가.
 *
 * 이 구분이 따로 필요한 이유: 아래 다섯 가지는 전부 「조용히 아무 일도
 * 안 일어남」이나 「전부 멈춤」으로 끝나는 결손이라, 정상 경로 테스트로는
 * 절대 드러나지 않는다.
 *
 *   1) `confirmed` 수업 — ADR 원안은 `planned`만 봤다. 그러면 교사가
 *      확정할수록 평가가 안 생긴다.
 *   2) `planned_node_ids`의 UUID 아닌 항목 — 학습자 오버라이드 자리표시자
 *      (`override:{id}:0`)를 그대로 캐스팅하면 쿼리 전체가 터진다. 한
 *      학원의 오버라이드 하나가 **모든 조직의** 생성을 멈춘다.
 *   3) 이미 평가가 있는 수업 — 빼지 않으면 스캔이 학기 내내 줄지 않는다.
 *   4) 취소·완료된 수업 — 할 일이 없다.
 *   5) 평가 노드가 없는 수업 — 대상이 아니다.
 *
 * 시각은 전부 DB의 now() 기준 상대값으로 만든다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000033001";
/** 스위치가 걸리지 않은 이웃 조직 — 남의 스위치가 내 생성을 멈추지 않는다 */
const OTHER_ORG = "ffffffff-0000-7000-8000-000000033002";

const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const NODE_CONCEPT = uuidv7();
const NODE_DAILY = uuidv7();

const OTHER_PERIOD = uuidv7();
const OTHER_GROUP = uuidv7();
const OTHER_PLAN = uuidv7();
const OTHER_VERSION = uuidv7();
const OTHER_NODE_DAILY = uuidv7();

const S_PLANNED = uuidv7();
const S_CONFIRMED = uuidv7();
const S_OVERRIDE_IDS = uuidv7();
const S_CANCELLED = uuidv7();
const S_NO_TEST_NODE = uuidv7();
const S_OTHER_ORG = uuidv7();

const EXISTING_ASSESSMENT = uuidv7();

/** 창을 넉넉히 잡는다 — 여기서 가르는 것은 시각이 아니라 종류다 */
const OPTIONS = { lookaheadDays: 7, generateBeforeHours: 24 } as const;

async function cleanup(): Promise<void> {
  for (const org of [ORG, OTHER_ORG]) {
    await sql`delete from jobs where organization_id = ${org}`;
    await sql`delete from kill_switches where organization_id = ${org}`;
    await sql`delete from assessment_instances where organization_id = ${org}`;
    await sql`delete from sessions where organization_id = ${org}`;
    await sql`
      delete from route_nodes where route_version_id in (
        select id from route_versions where organization_id = ${org})
    `;
    await sql`update route_plans set active_version_id = null where organization_id = ${org}`;
    await sql`delete from route_versions where organization_id = ${org}`;
    await sql`delete from route_plans where organization_id = ${org}`;
    await sql`delete from learning_groups where organization_id = ${org}`;
    await sql`delete from course_periods where organization_id = ${org}`;
  }
  await sql`delete from kill_switches where organization_id is null and key = ${ASSESSMENT_GENERATION_SWITCH}`;
}

describe.skipIf(!hasDb)("due 수업 선별", () => {
  let dueDate: string;

  beforeAll(async () => {
    sql = createSql();
    for (const [org, name, slug] of [
      [ORG, "ITEST 생산자", "itest-producer"],
      [OTHER_ORG, "ITEST 생산자 이웃", "itest-producer-other"],
    ] as const) {
      await sql`
        insert into organizations (id, name, slug, timezone)
        values (${org}, ${name}, ${slug}, ${TZ})
        on conflict (id) do nothing
      `;
    }
    await cleanup();

    const [row] = await sql<{ due: string }[]>`
      select ((now() + interval '2 hours') at time zone ${TZ})::date::text as due
    `;
    dueDate = row!.due;

    for (const [org, period, group, plan, version, dailyNode] of [
      [ORG, PERIOD, GROUP, PLAN, VERSION, NODE_DAILY],
      [
        OTHER_ORG,
        OTHER_PERIOD,
        OTHER_GROUP,
        OTHER_PLAN,
        OTHER_VERSION,
        OTHER_NODE_DAILY,
      ],
    ] as const) {
      await sql`
        insert into course_periods (
          id, organization_id, name, academic_year, starts_on, ends_on, status)
        values (${period}, ${org}, 'ITEST 기간', 2026,
                ${dueDate}::date - 30, ${dueDate}::date + 90, 'active')
      `;
      await sql`
        insert into learning_groups (id, organization_id, course_period_id, name, status)
        values (${group}, ${org}, ${period}, 'ITEST 반', 'operating')
      `;
      await sql`
        insert into route_plans (
          id, organization_id, kind, name, learning_group_id, course_period_id,
          status, active_version_id)
        values (${plan}, ${org}, 'group_route', 'ITEST 루트', ${group}, ${period},
                'published', ${version})
      `;
      await sql`
        insert into route_versions (id, organization_id, route_plan_id, version_number, status)
        values (${version}, ${org}, ${plan}, 1, 'published')
      `;
      await sql`
        insert into route_nodes (
          id, organization_id, route_version_id, kind, title, sort_order)
        values (${dailyNode}, ${org}, ${version}, 'daily_test', 'ITEST 일일테스트', 2)
      `;
    }
    await sql`
      insert into route_nodes (
        id, organization_id, route_version_id, kind, title, sort_order)
      values (${NODE_CONCEPT}, ${ORG}, ${VERSION}, 'concept_lesson', 'ITEST 개념', 1)
    `;

    /* 같은 반의 살아 있는 수업끼리는 시간이 겹칠 수 없다
     * (`sessions_group_no_overlap` — planned·confirmed·in_progress에만 건다).
     * 그래서 시작 시각을 한 시간씩 벌린다. `session_date`는 따로 주므로
     * 셋 다 같은 날짜에 남는다 — 여기서 겨누는 것은 시각이 아니라 종류다. */
    const session = (
      id: string,
      org: string,
      group: string,
      status: string,
      offsetHours: number,
      nodes: unknown[],
    ) => sql`
      insert into sessions (
        id, organization_id, learning_group_id, session_date, timezone,
        starts_at, ends_at, status, planned_node_ids)
      values (${id}, ${org}, ${group}, ${dueDate}::date, ${TZ},
              now() + make_interval(hours => ${offsetHours}),
              now() + make_interval(hours => ${offsetHours}, mins => 30),
              ${status}::session_status, ${sql.json(nodes as never)})
    `;

    await session(S_PLANNED, ORG, GROUP, "planned", 2, [NODE_CONCEPT, NODE_DAILY]);
    await session(S_CONFIRMED, ORG, GROUP, "confirmed", 3, [NODE_DAILY]);
    /* 학습자 오버라이드 자리표시자가 섞인 계획 — 캐스팅이 터지는지 본다 */
    await session(S_OVERRIDE_IDS, ORG, GROUP, "planned", 4, [
      `override:${uuidv7()}:0`,
      "not-a-uuid",
      NODE_DAILY,
    ]);
    await session(S_NO_TEST_NODE, ORG, GROUP, "planned", 5, [NODE_CONCEPT]);
    // 취소된 수업은 겹침 제약에서 빠지므로 시각을 벌리지 않아도 된다
    await session(S_CANCELLED, ORG, GROUP, "cancelled", 2, [NODE_DAILY]);
    await session(S_OTHER_ORG, OTHER_ORG, OTHER_GROUP, "planned", 2, [
      OTHER_NODE_DAILY,
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 });
  });

  it("planned와 confirmed 수업을 모두 잡는다", async () => {
    const due = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    const sessionIds = due.map((d) => d.sessionId).sort();
    expect(sessionIds).toEqual(
      [S_PLANNED, S_CONFIRMED, S_OVERRIDE_IDS].sort(),
    );
    // 취소된 수업·평가 노드 없는 수업은 애초에 없다
    expect(sessionIds).not.toContain(S_CANCELLED);
    expect(sessionIds).not.toContain(S_NO_TEST_NODE);
  });

  it("UUID가 아닌 계획 노드가 섞여도 쿼리가 살아 있다", async () => {
    /* `override:{id}:0` 하나가 ::uuid 캐스팅을 터뜨리면 이 쿼리는 전역이라
     * **모든 조직의** 생성이 멈춘다. 그 수업의 정상 노드는 그대로 잡혀야 한다. */
    const due = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    const fromOverrideSession = due.filter(
      (d) => d.sessionId === S_OVERRIDE_IDS,
    );
    expect(fromOverrideSession).toHaveLength(1);
    expect(fromOverrideSession[0]!.routeNodeId).toBe(NODE_DAILY);
  });

  it("노드 종류가 목적으로 옮겨진다", async () => {
    const due = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    expect(due.every((d) => d.nodeKind === "daily_test")).toBe(true);
    expect(due.every((d) => d.purpose === "formative")).toBe(true);
    expect(due.every((d) => d.beforeHours === 24)).toBe(true);
  });

  it("조직 스코프를 주면 남의 수업을 보지 않는다", async () => {
    const due = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    expect(due.every((d) => d.organizationId === ORG)).toBe(true);
  });

  it("조직 kill switch는 그 조직만 막는다", async () => {
    await sql`
      insert into kill_switches (id, organization_id, key, enabled, reason)
      values (${uuidv7()}, ${ORG}, ${ASSESSMENT_GENERATION_SWITCH}, false, 'ITEST')
    `;
    const mine = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    const neighbour = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: OTHER_ORG,
    });
    expect(mine.every((d) => d.switchedOff)).toBe(true);
    expect(neighbour.every((d) => d.switchedOff)).toBe(false);

    /* 생산자는 막힌 것을 세어서 알려 준다 — 「돌고는 있는데 안 생긴다」에
     * 답이 있어야 한다. 이웃 조직 것은 그대로 만든다. */
    const run = await produceAssessmentJobs(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    expect(run.enqueued).toBe(0);
    expect(run.suppressed).toBe(mine.length);
    expect(run.suppressedOrganizationIds).toEqual([ORG]);

    const neighbourRun = await produceAssessmentJobs(sql, {
      ...OPTIONS,
      organizationId: OTHER_ORG,
    });
    expect(neighbourRun.enqueued).toBe(1);
    expect(neighbourRun.suppressed).toBe(0);

    await sql`delete from kill_switches where organization_id = ${ORG}`;
  });

  it("전역 kill switch는 모든 조직을 막는다", async () => {
    await sql`
      insert into kill_switches (id, organization_id, key, enabled, reason)
      values (${uuidv7()}, null, ${ASSESSMENT_GENERATION_SWITCH}, false, 'ITEST 전역')
    `;
    const neighbour = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: OTHER_ORG,
    });
    expect(neighbour.every((d) => d.switchedOff)).toBe(true);
    await sql`
      delete from kill_switches
      where organization_id is null and key = ${ASSESSMENT_GENERATION_SWITCH}
    `;
  });

  it("만료된 kill switch는 막지 않는다", async () => {
    await sql`
      insert into kill_switches (id, organization_id, key, enabled, reason, expires_at)
      values (${uuidv7()}, ${ORG}, ${ASSESSMENT_GENERATION_SWITCH}, false,
              'ITEST 만료', now() - interval '1 hour')
    `;
    const mine = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    expect(mine.every((d) => d.switchedOff)).toBe(false);
    await sql`delete from kill_switches where organization_id = ${ORG}`;
  });

  it("작업을 만들고, 만든 것은 키로 다시 만들지 않는다", async () => {
    const first = await produceAssessmentJobs(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    /* 같은 반·날짜·목적이므로 수업이 셋이어도 **작업은 하나다** —
     * 반 공통 평가는 수업 단위가 아니라 (반·날짜·목적) 단위다. */
    expect(first.scanned).toBe(3);
    expect(first.enqueued).toBe(1);
    expect(first.deduplicated).toBe(2);

    const second = await produceAssessmentJobs(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    expect(second.enqueued).toBe(0);
    expect(second.deduplicated).toBe(3);

    const rows = await sql<{ idempotency_key: string }[]>`
      select idempotency_key from jobs
      where organization_id = ${ORG} and topic = ${ASSESSMENT_GENERATE_TOPIC}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idempotency_key).toBe(
      assessmentJobKey({
        organizationId: ORG,
        learningGroupId: GROUP,
        learnerId: null,
        planDate: dueDate,
        purpose: "formative",
      }),
    );
  });

  it("이미 평가가 있는 (반·날짜·목적)은 더 이상 훑지 않는다", async () => {
    /* 이 조건이 없으면 생성이 끝난 뒤에도 매 회차 같은 행이 나오고,
     * 멱등은 걸리지만 스캔이 학기 내내 줄지 않는다. */
    await sql`
      insert into assessment_instances (
        id, organization_id, purpose, title, learning_group_id, learner_id,
        scheduled_date, status)
      values (${EXISTING_ASSESSMENT}, ${ORG}, 'formative', 'ITEST 기존 평가',
              ${GROUP}, null, ${dueDate}::date, 'published')
    `;
    const due = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    expect(due).toEqual([]);
  });

  it("취소된 평가는 자리를 비켜 준다", async () => {
    /* 잘못 만든 평가를 취소하면 다시 만들 수 있어야 한다 — 취소를
     * 「있음」으로 세면 복구 경로가 막힌다. */
    await sql`
      update assessment_instances set status = 'cancelled'
      where id = ${EXISTING_ASSESSMENT}
    `;
    const due = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: ORG,
    });
    expect(due.length).toBeGreaterThan(0);
  });

  it("한 회차에 만드는 수를 제한할 수 있다", async () => {
    const due = await findDueAssessmentSessions(sql, {
      ...OPTIONS,
      organizationId: ORG,
      limit: 1,
    });
    expect(due).toHaveLength(1);
  });
});
