import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  ASSESSMENT_GENERATE_TOPIC,
  EVENT_CONSUMERS,
  createSql,
  getSharedSql,
  type ClaimedJob,
} from "@su-maek/db";
import { assessmentJobKey } from "@su-maek/db/domain";
import { handleAssessmentGenerate } from "../../src/handlers/assessment";
import { handleNotificationDispatch } from "../../src/handlers/schedule";

/* ─────────────────────────────────────────────────────────────
 * 자동 평가 생성 실패의 알림·복구 (T3.4 · E-17) — 라이브 DB.
 *
 * T3.2·T3.3이 세운 자동 생성에는 마지막 고리가 없었다. 생성이 실패하면
 * 작업이 `failed_final`로 **큐에만** 남는다. 교사는 큐를 보지 않는다 —
 * 수업 당일 아침에 학생 화면의 빈 시험 칸으로 알게 된다.
 *
 * 그 시점에는 이미 늦다. 문항이 모자라거나 정책이 없는 것은 **미리 알면
 * 고칠 수 있는 문제**인데, 알림이 없으면 고칠 기회 자체가 없다.
 *
 * 겨누는 것:
 *   1) 재시도 불가 실패는 E-17을 발행한다 — 사유 코드와 복구 링크를 담아서
 *   2) 사유가 **코드**다. 문구를 문자열로 비교하지 않는다 (알림·화면·분석이
 *      같은 코드를 본다)
 *   3) 일시 실패는 **백오프 중에 발행하지 않는다** — DB가 1초 끊겼다고
 *      교사에게 알림을 쏘지 않는다. 재시도가 다 소진된 뒤에만 발행한다
 *   4) 같은 작업이 여러 번 실패해도 알림은 하나다 (멱등)
 *   5) 그 이벤트가 교사 업무함에 원인과 복구 링크로 도착한다
 *   6) 실패한 평가는 게시·배정되지 않는다 — 실패가 성공처럼 보이지 않는다
 *
 * 덮지 못하는 것 — 정직하게 적는다:
 *  - `/app/tests`의 재실행 버튼과 목록은 웹 통합 테스트의 몫이다
 *    (apps/web/test/integration/assessment-recovery.test.ts).
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000036001";
const TEACHER = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const SESSION = uuidv7();
const NODE = uuidv7();
const PLAN_DATE = "2026-10-15";
const RIGHT = uuidv7();
const CONCEPT = uuidv7();
const QUESTION = uuidv7();
const QVERSION = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();

/** 정책이 없어 반드시 실패하는 작업 — 재시도해도 낫지 않는다 */
function failingJob(over: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: uuidv7(),
    organization_id: ORG,
    topic: ASSESSMENT_GENERATE_TOPIC,
    payload: {
      organizationId: ORG,
      learningGroupId: GROUP,
      learnerId: null,
      planDate: PLAN_DATE,
      purpose: "formative",
      sessionId: SESSION,
      routeNodeId: NODE,
    },
    attempts: 1,
    max_attempts: 5,
    checkpoint: null,
    meta: null,
    ...over,
  };
}

interface FailureEvent {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: {
    sessionId?: string;
    learningGroupId?: string;
    routeNodeId?: string;
    planDate?: string;
    purpose?: string;
    jobId?: string;
    idempotencyKey?: string;
    reason?: string;
    retryable?: boolean;
    attemptCount?: number;
    recoveryHref?: string;
    message?: string;
  };
}

async function failureEvents(): Promise<FailureEvent[]> {
  return sql<FailureEvent[]>`
    select id, event_type, aggregate_type, aggregate_id::text as aggregate_id, payload
    from outbox_events
    where organization_id = ${ORG}
      and event_type = 'DailyAssessmentGenerationFailed'
    order by id
  `;
}

async function cleanup(): Promise<void> {
  await sql`delete from notifications where organization_id = ${ORG}`;
  await sql`
    delete from inbox_events where consumer_name = 'notification.dispatch'
      and event_id in (select id from outbox_events where organization_id = ${ORG})
  `;
  await sql`delete from outbox_events where organization_id = ${ORG}`;
  await sql`delete from jobs where organization_id = ${ORG}`;
  await sql`delete from assessment_questions where organization_id = ${ORG}`;
  await sql`delete from assessment_instances where organization_id = ${ORG}`;
  await sql`delete from assessment_blueprints where organization_id = ${ORG}`;
  await sql`delete from assessment_policies where organization_id = ${ORG}`;
  await sql`delete from question_alignments where organization_id = ${ORG}`;
  await sql`delete from question_versions where organization_id = ${ORG}`;
  await sql`delete from questions where organization_id = ${ORG}`;
  await sql`delete from content_rights where organization_id = ${ORG}`;
  await sql`delete from canonical_concepts where id = ${CONCEPT}`;
  await sql`
    delete from route_nodes where route_version_id in (
      select id from route_versions where organization_id = ${ORG})
  `;
  await sql`update route_plans set active_version_id = null where organization_id = ${ORG}`;
  await sql`delete from route_versions where organization_id = ${ORG}`;
  await sql`delete from route_plans where organization_id = ${ORG}`;
  await sql`delete from sessions where organization_id = ${ORG}`;
  await sql`delete from memberships where organization_id = ${ORG}`;
  await sql`delete from learning_groups where organization_id = ${ORG}`;
  await sql`delete from course_periods where organization_id = ${ORG}`;
  await sql`delete from users where id = ${TEACHER}`;
}

describe("실패 알림 배선", () => {
  it("실패 이벤트가 알림 토픽으로 라우팅된다", () => {
    /* 라우팅이 없으면 디스패처가 작업 0건을 만들고도 delivered로 표시해
     * 이벤트가 영구 유실된다 — 실패를 알리는 이벤트가 조용히 사라지는 것이
     * 가장 나쁘다. */
    expect(EVENT_CONSUMERS.DailyAssessmentGenerationFailed).toContain(
      "notification.dispatch",
    );
  });
});

describe.skipIf(!hasDb)("생성 실패가 교사에게 닿는다 (E-17)", () => {
  let permanentThrow: unknown;
  let eventsAfterPermanent: FailureEvent[];
  let eventsAfterRepeat: FailureEvent[];
  let eventsDuringBackoff: FailureEvent[];
  let eventsAfterExhausted: FailureEvent[];
  let notifications: Array<{
    kind: string;
    title: string;
    link_path: string;
    body: { what?: string; why?: string; action?: string };
  }>;
  let publishedCount: number;

  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 생성실패 알림', 'itest-gen-failure', ${TZ})
      on conflict (id) do nothing
    `;
    await cleanup();

    await sql`
      insert into users (id, email, display_name)
      values (${TEACHER}, ${`itest-fail-${TEACHER.slice(-12)}@su-maek.example`}, 'ITEST 선생님')
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values (${uuidv7()}, ${ORG}, ${TEACHER}, 'teacher', 'active')
    `;
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
    await sql`
      insert into route_nodes (
        id, organization_id, route_version_id, kind, title, sort_order)
      values (${NODE}, ${ORG}, ${VERSION}, 'daily_test', 'ITEST 일일테스트', 1)
    `;
    await sql`
      insert into sessions (
        id, organization_id, learning_group_id, session_date, timezone,
        starts_at, ends_at, status, planned_node_ids)
      values (${SESSION}, ${ORG}, ${GROUP}, ${PLAN_DATE}::date, ${TZ},
              ${`${PLAN_DATE}T09:00:00+09:00`}, ${`${PLAN_DATE}T11:00:00+09:00`},
              'planned', ${sql.json([NODE] as never)})
    `;

    /* ── 1) 재시도 불가 실패 (정책이 없다) ── */
    const job = failingJob();
    permanentThrow = await handleAssessmentGenerate(job).catch((e) => e);
    eventsAfterPermanent = await failureEvents();

    /* ── 2) 같은 작업이 또 실패해도 알림은 하나 ── */
    await handleAssessmentGenerate({ ...job, attempts: 2 }).catch(() => {});
    eventsAfterRepeat = await failureEvents();

    /* ── 3) 일시 실패는 백오프 중에 발행하지 않는다 ──
     *
     * 여기서 겨누는 것은 **진짜 DB 장애**다. 대역 함수나 payload 주입으로
     * 흉내 내면 핸들러의 분류 로직을 검사하지 못한다(그건 자기 자신을
     * 검사하는 셈이다). 그래서 생성이 실제로 INSERT까지 간 뒤에 터지는
     * 고장을 DB에 심는다 — outbox-roundtrip이 쓰는 것과 같은 수법이다.
     *
     * 덤으로 「실패한 평가가 게시되지 않는다」가 훨씬 강한 주장이 된다:
     * 트랜잭션 한가운데서 터져도 반쪽 평가가 남지 않아야 한다. */
    await sql`delete from outbox_events where organization_id = ${ORG}`;
    await sql`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, constraints, is_active)
      values (${uuidv7()}, ${ORG}, 'ITEST 일일', 'formative', 1,
              ${sql.json({ today_concept: 100, weakness: 0, review: 0 } as never)},
              1, ${sql.json({} as never)}, true)
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${RIGHT}, ${ORG}, 'ITEST', 'usable')
    `;
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values (${CONCEPT}, ${`itest-fail-${CONCEPT.slice(-12)}`}, 'ITEST 개념', 'active', '[]'::jsonb)
      on conflict (id) do update set status = 'active'
    `;
    await sql`
      update route_nodes set concept_ids = ${sql.json([CONCEPT] as never)}
      where id = ${NODE}
    `;
    await sql`
      insert into questions (
        id, organization_id, kind, review_status, content_right_id,
        is_auto_assignable, current_version_id)
      values (${QUESTION}, ${ORG}, 'short_answer', 'published', ${RIGHT}, true, ${QVERSION})
    `;
    await sql`
      insert into question_versions (
        id, organization_id, question_id, version_number, body, answer,
        points, difficulty, content_checksum)
      values (${QVERSION}, ${ORG}, ${QUESTION}, 1,
              ${sql.json([{ type: "text", text: "ITEST 문항" }] as never)},
              ${sql.json({ kind: "short_answer", accepted: [{ value: "1", form: "number" }] } as never)},
              '10', ${sql.json({ band: "mid" } as never)}, ${`itest-fail-${QUESTION}`})
    `;
    await sql`
      insert into question_alignments (id, organization_id, question_id, concept_id, weight)
      values (${uuidv7()}, ${ORG}, ${QUESTION}, ${CONCEPT}, 1)
    `;
    await sql.unsafe(`
      create or replace function itest_assessment_poison() returns trigger
      language plpgsql as $$
      begin
        if new.organization_id = '${ORG}'::uuid then
          raise exception 'ITEST 주입 고장: 평가 저장 실패';
        end if;
        return new;
      end $$;
      drop trigger if exists itest_assessment_poison_trg on assessment_instances;
      create trigger itest_assessment_poison_trg
        before insert on assessment_instances
        for each row execute function itest_assessment_poison();
    `);

    const transientJob = failingJob({ attempts: 1, max_attempts: 5 });
    await handleAssessmentGenerate(transientJob).catch(() => {});
    eventsDuringBackoff = await failureEvents();

    /* ── 4) 재시도가 소진되면 발행한다 ── */
    await handleAssessmentGenerate({
      ...transientJob,
      id: uuidv7(),
      attempts: 5,
      max_attempts: 5,
    }).catch(() => {});
    eventsAfterExhausted = await failureEvents();
    await sql.unsafe(`
      drop trigger if exists itest_assessment_poison_trg on assessment_instances;
      drop function if exists itest_assessment_poison();
    `);

    /* ── 5) 알림 소비자가 교사 업무함에 넣는다 ── */
    await sql`delete from outbox_events where organization_id = ${ORG}`;
    // 3)에서 정책을 넣었으므로 다시 no_policy 상태로 되돌린다
    await sql`update assessment_policies set is_active = false where organization_id = ${ORG}`;
    await handleAssessmentGenerate(failingJob({ id: uuidv7() })).catch(() => {});
    const [event] = await failureEvents();
    await handleNotificationDispatch({
      id: uuidv7(),
      organization_id: ORG,
      topic: "notification.dispatch",
      payload: {
        eventId: event!.id,
        eventType: "DailyAssessmentGenerationFailed",
        payload: event!.payload,
      },
      attempts: 1,
      max_attempts: 5,
      checkpoint: null,
      meta: null,
    });
    notifications = await sql`
      select kind, title, link_path, body from notifications
      where organization_id = ${ORG}
    `;

    const [published] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from assessment_instances
      where organization_id = ${ORG}
    `;
    publishedCount = published!.cnt;
  });

  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 });
    await getSharedSql().end({ timeout: 5 });
  });

  it("재시도 불가 실패는 사유 코드와 함께 E-17을 발행한다", () => {
    expect(eventsAfterPermanent).toHaveLength(1);
    const e = eventsAfterPermanent[0]!;
    expect(e.aggregate_type).toBe("session");
    expect(e.aggregate_id).toBe(SESSION);
    /* 사유는 **코드**다. 알림·화면·분석이 같은 값을 본다 — 한국어 문구를
     * 비교하면 문구를 다듬는 순간 소비자가 조용히 깨진다. */
    expect(e.payload.reason).toBe("no_policy");
    expect(e.payload.retryable).toBe(false);
    expect(e.payload.purpose).toBe("formative");
    expect(e.payload.planDate).toBe(PLAN_DATE);
    expect(e.payload.routeNodeId).toBe(NODE);
    expect(e.payload.learningGroupId).toBe(GROUP);
  });

  it("작업의 멱등 키와 복구 링크를 함께 담는다", () => {
    const e = eventsAfterPermanent[0]!;
    expect(e.payload.idempotencyKey).toBe(
      assessmentJobKey({
        organizationId: ORG,
        learningGroupId: GROUP,
        learnerId: null,
        planDate: PLAN_DATE,
        purpose: "formative",
      }),
    );
    /* 「무엇이 잘못됐다」만으로는 아무것도 못 한다. 어디로 가면 고칠 수
     * 있는지가 같이 있어야 한다. */
    expect(e.payload.recoveryHref).toContain("/app/tests");
  });

  it("핸들러는 여전히 재시도 불가로 던진다 — 알림이 실패를 삼키지 않는다", () => {
    expect(permanentThrow).toBeInstanceOf(Error);
    expect((permanentThrow as { retryable?: boolean }).retryable).toBe(false);
  });

  it("같은 작업이 또 실패해도 알림은 하나다 (멱등)", () => {
    /* 재시도·재시작으로 같은 실패가 여러 번 도착한다. 그때마다 알림을
     * 만들면 교사 업무함이 같은 말로 가득 찬다 — 그러면 아무도 안 읽는다. */
    expect(eventsAfterRepeat).toHaveLength(1);
  });

  it("일시 실패는 백오프 중에 발행하지 않는다", () => {
    /* DB가 1초 끊겼다고 교사에게 알림을 쏘면, 알림이 신호가 아니라
     * 소음이 된다. 재시도가 살아 있는 동안은 조용히 다시 시도한다. */
    expect(eventsDuringBackoff).toEqual([]);
  });

  it("재시도가 소진되면 그때 발행한다", () => {
    expect(eventsAfterExhausted).toHaveLength(1);
    const e = eventsAfterExhausted[0]!;
    expect(e.payload.reason).toBe("transient_db");
    expect(e.payload.retryable).toBe(true);
    expect(e.payload.attemptCount).toBe(5);
  });

  it("교사 업무함에 원인과 복구 링크로 도착한다", () => {
    expect(notifications).toHaveLength(1);
    const n = notifications[0]!;
    expect(n.kind).toBe("today_task");
    expect(n.title).toContain("테스트");
    expect(n.link_path).toContain("/app/tests");
    /* 무엇이·왜·무엇을 하면 되는지 — 세 가지가 다 있어야 행동으로 이어진다 */
    expect(n.body.why).toBeTruthy();
    expect(n.body.action).toBeTruthy();
  });

  it("실패한 평가는 게시·배정되지 않는다", () => {
    /* 가장 나쁜 실패는 「실패했는데 성공처럼 보이는 것」이다. 빈 평가가
     * 게시되면 학생은 0문항 시험을 열고 자기가 잘못한 줄 안다. */
    expect(publishedCount).toBe(0);
  });
});
