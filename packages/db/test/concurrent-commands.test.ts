import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 같은 명령이 겹쳐 들어와도 한 번만 반영된다 (T6.3).
 *
 * 하루 완료·평가 생성·수업 마감은 셋 다 **다시 부를 수 있는** 명령이다.
 * 학생이 새로 고침을 연타하고, 워커가 재시작하며 클레임된 작업을 다시
 * 돌리고, 교사가 마감 버튼을 두 번 누른다. 그때 두 번 반영되면 각각
 * 이렇게 망가진다.
 *
 *   하루 완료 두 번 → E-16이 둘. 「하루 완료 수」가 학생 수보다 커진다
 *   평가 생성 두 번 → 같은 날 같은 반에 시험이 둘. 학생 화면에 둘 다 뜬다
 *   수업 마감 두 번 → 진도 기록이 겹쳐 쌓이고 일정 재계산 입력이 오염된다
 *
 * 멱등은 「같은 요청을 두 번 보내도 괜찮다」가 아니라 **「동시에 보내도
 * 괜찮다」**여야 한다. 순차 재시도만 확인하면 잠금 없이 select→insert 하는
 * 코드도 전부 통과한다 — T6.2에서 하루 첫 투영이 정확히 그렇게 깨졌다.
 * 그래서 여기서는 전부 `Promise.all`로 **겹쳐서** 부른다.
 *
 * 조직은 고정 ID로 재사용한다 — 실행마다 새 조직을 만들면 지울 수 없는
 * 감사 행이 사라진 조직을 가리키며 쌓인다.
 * ───────────────────────────────────────────────────────────── */

import { createSql } from "../src/client";
import { completeLearnerDay, projectLearnerDayPlan } from "../src/domain/learner-day-plan";
import { generateDailyTest } from "../src/domain/assessment-generation";
import { closeSession } from "../src/domain/session-execution";
import type { IsoDate } from "@su-maek/core/shared";

const hasDb = Boolean(process.env.DATABASE_URL);
const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000063001";

let sql: ReturnType<typeof createSql>;

const TEACHER = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const LEARNER = uuidv7();
const CONCEPT = uuidv7();
const RIGHT = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const NODE_LESSON = uuidv7();
const NODE_TEST = uuidv7();
const SESSION_GEN = uuidv7();
const SESSION_CLOSE = uuidv7();
const POLICY = uuidv7();

/** 문항 여섯 — 생성기의 개념당 상한(3)보다 넉넉하게 */
const QUESTIONS = Array.from({ length: 6 }, () => ({
  id: uuidv7(),
  version: uuidv7(),
}));

/** 겹치는 정도. 둘로는 앞엣것이 먼저 커밋해 경합이 안 나는 실행이 섞인다. */
const RACERS = 10;

function isoAddDays(days: number): IsoDate {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10) as IsoDate;
}
const TODAY = isoAddDays(0);
/** 마감 대상 수업의 날짜 — 오늘까지의 수업만 마감할 수 있다 */
const YESTERDAY = isoAddDays(-1);
/** 완료 검사용 날짜. 다른 테스트의 계획과 섞이지 않게 따로 쓴다. */
const COMPLETE_DATE = isoAddDays(-3);

beforeAll(async () => {
  if (!hasDb) return;
  sql = createSql();

  await sql`
    insert into organizations (id, name, slug, timezone)
    values (${ORG}, 'ITEST 동시 명령', 'itest-concurrent-commands', ${TZ})
    on conflict (id) do nothing
  `;
  await cleanup();

  await sql`
    insert into users (id, email, display_name, default_organization_id)
    values (${TEACHER}, ${`t63-${TEACHER}@su-maek.test`}, 'ITEST 교사', ${ORG})
  `;
  await sql`
    insert into memberships (id, organization_id, user_id, role, status)
    values (${uuidv7()}, ${ORG}, ${TEACHER}, 'teacher', 'active')
  `;
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026, ${isoAddDays(-30)},
            ${isoAddDays(60)}, 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 동시반', 'operating')
  `;
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${LEARNER}, ${ORG}, 'ITEST 동시 학생', 'active')
  `;
  await sql`
    insert into learning_group_memberships
      (id, organization_id, learning_group_id, learner_id, status, joined_on)
    values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER}, 'active', ${isoAddDays(-30)})
  `;
  await sql`
    insert into assessment_policies (
      id, organization_id, name, purpose, version, pool_weights,
      question_count, constraints, is_active)
    values (${POLICY}, ${ORG}, 'ITEST 동시 일일', 'formative', 1,
            ${sql.json({ today_concept: 100, weakness: 0, review: 0 } as never)},
            3, ${sql.json({} as never)}, true)
  `;

  /* 문제은행 — 개념 하나에 문항 여섯 */
  await sql`
    insert into canonical_concepts (id, slug, name, status, evidence)
    values (${CONCEPT}, ${`itest-t63-${CONCEPT.slice(-12)}`}, 'ITEST 동시 개념',
            'active', '[]'::jsonb)
    on conflict (id) do nothing
  `;
  await sql`
    insert into content_rights (id, organization_id, rights_holder, status)
    values (${RIGHT}, ${ORG}, 'ITEST 통합테스트', 'usable')
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
              ${sql.json([{ type: "text", text: `ITEST 동시 문항 ${i + 1}` }] as never)},
              ${sql.json({ kind: "short_answer", accepted: [{ value: "1", form: "number" }] } as never)},
              '10', ${sql.json({ band: "mid" } as never)}, ${`itest-t63-${q.id}`})
    `;
    await sql`
      insert into question_alignments (id, organization_id, question_id, concept_id, weight)
      values (${uuidv7()}, ${ORG}, ${q.id}, ${CONCEPT}, 1)
    `;
  }

  /* 루트 — 개념 차시 하나와 일일테스트 하나 */
  await sql`
    insert into route_plans (
      id, organization_id, kind, name, learning_group_id, course_period_id,
      status, active_version_id)
    values (${PLAN}, ${ORG}, 'group_route', 'ITEST 동시 루트', ${GROUP}, ${PERIOD},
            'published', ${VERSION})
  `;
  await sql`
    insert into route_versions (id, organization_id, route_plan_id, version_number, status)
    values (${VERSION}, ${ORG}, ${PLAN}, 1, 'published')
  `;
  await sql`
    insert into route_nodes (
      id, organization_id, route_version_id, kind, title, sort_order, concept_ids)
    values
      (${NODE_LESSON}, ${ORG}, ${VERSION}, 'concept_lesson', 'ITEST 개념 차시', 1,
       ${sql.json([CONCEPT] as never)}),
      (${NODE_TEST}, ${ORG}, ${VERSION}, 'daily_test', 'ITEST 일일테스트', 2,
       '[]'::jsonb)
  `;

  /* 두 수업 — 생성 경합용(오늘)과 마감 경합용(어제). 시간대를 벌린다:
   * sessions_group_no_overlap이 같은 반의 겹치는 수업을 막는다. */
  await sql`
    insert into sessions (
      id, organization_id, learning_group_id, session_date, timezone,
      starts_at, ends_at, status, planned_node_ids)
    values
      (${SESSION_GEN}, ${ORG}, ${GROUP}, ${TODAY}::date, ${TZ},
       ${`${TODAY}T07:00:00Z`}, ${`${TODAY}T09:00:00Z`}, 'planned',
       ${sql.json([NODE_LESSON, NODE_TEST] as never)}),
      (${SESSION_CLOSE}, ${ORG}, ${GROUP}, ${YESTERDAY}::date, ${TZ},
       ${`${YESTERDAY}T07:00:00Z`}, ${`${YESTERDAY}T09:00:00Z`}, 'planned',
       ${sql.json([NODE_LESSON, NODE_TEST] as never)})
  `;
});

/** 앞선 실행의 잔재를 지운다 — 불변 표는 트리거를 잠시 내리고 이 조직 것만 */
async function cleanup(): Promise<void> {
  await sql`delete from responses where organization_id = ${ORG}`;
  await sql`delete from attempts where organization_id = ${ORG}`;
  await sql`delete from assignments where organization_id = ${ORG}`;
  await sql`delete from assessment_questions where organization_id = ${ORG}`;
  await sql`delete from assessment_instances where organization_id = ${ORG}`;
  await sql`delete from assessment_blueprints where organization_id = ${ORG}`;
  await sql`delete from assessment_policies where organization_id = ${ORG}`;
  await sql`delete from outbox_events where organization_id = ${ORG}`;
  await sql`delete from jobs where organization_id = ${ORG}`;
  /* 하루 계획은 완료가 굳으면 삭제가 막힌다 (I-22). 이 조직 것만 트리거를
   * 내리고 지운다 — 검사 대상이 그 트리거이므로 범위를 좁게 잡는다. */
  await sql`alter table learner_day_plans disable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_day_plan_items where learner_day_plan_id in (
    select id from learner_day_plans where organization_id = ${ORG})`;
  await sql`delete from learner_day_plans where organization_id = ${ORG}`;
  await sql`alter table learner_day_plans enable trigger learner_day_plans_completion_immutable`;
  await sql`alter table progress_events disable trigger progress_events_immutable`;
  await sql`delete from progress_events where organization_id = ${ORG}`;
  await sql`alter table progress_events enable trigger progress_events_immutable`;
  await sql`delete from sessions where organization_id = ${ORG}`;
  await sql`delete from route_nodes where organization_id = ${ORG}`;
  await sql`delete from route_versions where organization_id = ${ORG}`;
  await sql`delete from route_plans where organization_id = ${ORG}`;
  await sql`delete from question_alignments where organization_id = ${ORG}`;
  await sql`delete from question_versions where organization_id = ${ORG}`;
  await sql`delete from questions where organization_id = ${ORG}`;
  await sql`delete from content_rights where organization_id = ${ORG}`;
  await sql`delete from learning_group_memberships where organization_id = ${ORG}`;
  await sql`delete from learners where organization_id = ${ORG}`;
  await sql`delete from learning_groups where organization_id = ${ORG}`;
  await sql`delete from course_periods where organization_id = ${ORG}`;
  await sql`delete from memberships where organization_id = ${ORG}`;
  await sql`delete from users where default_organization_id = ${ORG}`;
}

afterAll(async () => {
  if (!hasDb) return;
  await cleanup();
  await sql.end({ timeout: 5 });
});

/* ── 1) 하루 완료 ─────────────────────────────────────────────── */

describe.skipIf(!hasDb)("같은 하루를 열 번 동시에 완료해도 한 번만 기록된다", () => {
  let outcomes: string[];

  beforeAll(async () => {
    await projectLearnerDayPlan(sql, {
      organizationId: ORG,
      learnerId: LEARNER,
      planDate: COMPLETE_DATE,
      timezone: TZ,
      learningGroupId: GROUP,
      source: "group_session",
      sourceRefId: null,
      items: [
        {
          key: "reading:one",
          kind: "reading",
          required: true,
          status: "completed",
          titleSnapshot: "다 읽은 자료",
          ordinal: 0,
        },
      ],
    });

    const results = await Promise.all(
      Array.from({ length: RACERS }, () =>
        completeLearnerDay(sql, {
          organizationId: ORG,
          learnerId: LEARNER,
          planDate: COMPLETE_DATE,
        }),
      ),
    );
    outcomes = results.map((r) => r.outcome);
  });

  it("완료를 「내가 했다」고 말하는 쪽은 하나뿐이다", () => {
    /* 나머지 아홉은 `already`다 — 실패가 아니라 「이미 되어 있다」이고,
     * 그래야 새로 고침 연타가 오류 화면이 되지 않는다. */
    expect(outcomes.filter((o) => o === "completed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "already")).toHaveLength(RACERS - 1);
  });

  it("완료 시각은 하나다 (I-22)", async () => {
    const rows = await sql<{ completed_at: string | null; status: string }[]>`
      select completed_at::text, status::text from learner_day_plans
      where organization_id = ${ORG} and learner_id = ${LEARNER}
        and plan_date = ${COMPLETE_DATE}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completed_at).not.toBeNull();
    expect(rows[0]!.status).toBe("completed");
  });

  it("E-16은 계획 하나당 한 번이다", async () => {
    /* 이벤트가 둘이면 교사 현황판의 「완료 N명」이 학생 수를 넘는다. */
    const events = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from outbox_events
      where organization_id = ${ORG} and event_type = 'LearnerDayCompleted'
    `;
    expect(events[0]!.cnt).toBe(1);
  });
});

/* ── 2) 평가 생성 ─────────────────────────────────────────────── */

describe.skipIf(!hasDb)("같은 반 평가를 열 번 동시에 만들어도 하나만 생긴다", () => {
  let results: Awaited<ReturnType<typeof generateDailyTest>>[];

  beforeAll(async () => {
    /* 워커가 재시작하면 클레임된 작업이 다시 돈다. 여러 워커가 함께 도는
     * 배포에서는 그것이 **동시에** 일어난다 — 멱등 키(jobs)와 유니크 인덱스
     * (assessments_idempotent_uq) 위에 생성기 자신의 「이미 있으면 그대로」가
     * 얹혀 있는지 본다. */
    results = await Promise.all(
      Array.from({ length: RACERS }, () =>
        generateDailyTest({
          organizationId: ORG,
          learningGroupId: GROUP,
          targetDate: TODAY,
          actorUserId: null,
          sessionId: SESSION_GEN,
          routeNodeId: NODE_TEST,
        }),
      ),
    );
  });

  it("전부 성공으로 끝난다 — 진 쪽이 오류가 되지 않는다", () => {
    /* 진 쪽이 실패로 끝나면 워커가 그것을 재시도하고, 다섯 번 실패한 뒤
     * DLQ로 간다. 교사 업무함에는 있지도 않은 「생성 실패」가 뜬다. */
    const failed = results.filter((r) => !r.ok);
    expect(failed.map((f) => f.message)).toEqual([]);
  });

  it("평가 인스턴스는 하나다", async () => {
    const rows = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from assessment_instances
      where organization_id = ${ORG} and learning_group_id = ${GROUP}
        and scheduled_date = ${TODAY}::date and purpose = 'formative'
        and status <> 'cancelled'
    `;
    expect(rows[0]!.cnt).toBe(1);
    expect(new Set(results.map((r) => r.assessmentId)).size).toBe(1);
  });

  it("배정도 학생당 하나다 — 같은 시험이 두 줄로 뜨지 않는다", async () => {
    const rows = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from assignments
      where organization_id = ${ORG} and learner_id = ${LEARNER}
    `;
    expect(rows[0]!.cnt).toBe(1);
  });

  it("문항도 한 벌만 붙는다", async () => {
    const [row] = await sql<{ total: number; distinct_q: number }[]>`
      select count(*)::int as total,
             count(distinct question_id)::int as distinct_q
      from assessment_questions
      where organization_id = ${ORG}
    `;
    /* 총 수와 서로 다른 문항 수가 같다 = 같은 문항이 두 번 실리지 않았다 */
    expect(row!.total).toBe(row!.distinct_q);
    expect(row!.total).toBeGreaterThan(0);
  });
});

/* ── 3) 수업 마감 ─────────────────────────────────────────────── */

describe.skipIf(!hasDb)("같은 수업을 여러 번 동시에 마감해도 기록은 한 벌이다", () => {
  let results: Array<{ ok: boolean; message: string }>;

  beforeAll(async () => {
    results = await Promise.all(
      Array.from({ length: RACERS }, () =>
        closeSession(sql, {
          organizationId: ORG,
          sessionId: SESSION_CLOSE,
          actorUserId: TEACHER,
          nodeProgress: {
            [NODE_LESSON]: "completed",
            [NODE_TEST]: "skipped",
          },
          note: "동시 마감 검사",
        }).catch((error: unknown) => ({
          ok: false as const,
          message: `던짐: ${(error as Error).message}`,
        })),
      ),
    );
  });

  it("마감을 「내가 했다」고 말하는 쪽은 하나뿐이다", () => {
    const closed = results.filter((r) => r.ok);
    expect(closed).toHaveLength(1);
  });

  it("진 쪽은 던지지 않고 「이미 마감」이라고 말한다", () => {
    /* 예외로 터지면 교사 화면에 빨간 오류가 뜬다 — 실제로는 마감이 된
     * 상태인데도. 두 번째 클릭이 만나는 화면이 이것이다. */
    const rejected = results.filter((r) => !r.ok);
    expect(rejected).toHaveLength(RACERS - 1);
    for (const r of rejected) {
      expect(r.message).not.toContain("던짐:");
    }
  });

  it("진도 기록이 노드당 한 줄이다", async () => {
    /* 겹쳐 쌓이면 일정 재계산의 입력이 오염된다 — 같은 노드가 완료이자
     * 미완료로 동시에 기록된 상태가 된다 (T4.3의 deriveProgress 입력). */
    const rows = await sql<{ kind: string; route_node_id: string | null }[]>`
      select kind, route_node_id::text from progress_events
      where session_id = ${SESSION_CLOSE} order by kind, route_node_id
    `;
    const nodeRows = rows.filter((r) => r.route_node_id !== null);
    expect(nodeRows).toHaveLength(2);
    expect(new Set(nodeRows.map((r) => r.route_node_id)).size).toBe(2);
    /* 마감 자체를 남기는 줄도 하나뿐이다 */
    expect(rows.filter((r) => r.kind === "session_closed")).toHaveLength(1);
  });

  it("SessionCompleted도 하나다", async () => {
    const rows = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from outbox_events
      where event_type = 'SessionCompleted' and aggregate_id = ${SESSION_CLOSE}
    `;
    expect(rows[0]!.cnt).toBe(1);
  });

  it("수업은 완료 상태로 한 번만 넘어간다", async () => {
    const [row] = await sql<{ status: string }[]>`
      select status::text as status from sessions where id = ${SESSION_CLOSE}
    `;
    expect(row!.status).toBe("completed");
  });
});
