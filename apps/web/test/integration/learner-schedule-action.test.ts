import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 학습자 스코프 일정의 **제품 도달 경로** (인수 4) — 라이브 DB 통합 테스트.
 *
 * 계산·저장 자체는 packages/db/test/learner-scope-schedule.test.ts가 덮는다.
 * 여기서 붙잡는 것은 그 계산에 **제품 안에서 도달할 수 있는가**다:
 *   1) 학생 상세의 쓰기 액션이 실제로 학습자 일정을 만든다
 *   2) 쓰기 게이트가 진짜다 — learners 쓰기 권한이 없으면 아무것도 안 만든다
 *   3) 감사에 사람이 남는다 (actor_type='user' + 그 사용자 ID)
 *   4) 반 공통 일정은 한 줄도 바뀌지 않는다 (불변 조건 4)
 *   5) 오버라이드 생성·취소가 **같은 트랜잭션에서** 재계산 이벤트를 발행한다
 *   6) 화면에서 재합류 지점을 지정할 수 있고 그것이 실체화에 반영된다
 *
 * Supabase 인증과 Next 캐시만 대역이고 나머지(권한·DB·엔진)는 진짜다.
 * 조직만 고정 ID다 — 실체화가 남기는 감사 행은 지울 수 없다(before delete
 * 트리거). 실행마다 새 조직을 만들면 사라진 조직을 가리키는 행이 쌓인다.
 * ───────────────────────────────────────────────────────────── */

const claims: { sub: string | null } = { sub: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: claims.sub ? { claims: { sub: claims.sub } } : null,
      }),
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { getSharedSql, EVENT_CONSUMERS } = await import("@su-maek/db");
const { materializeGroupSchedule } = await import("@su-maek/db/domain");
const {
  cancelOverride,
  createOverride,
  materializeLearnerScheduleAction,
} = await import("@/app/app/students/[id]/actions");

const hasDb = Boolean(process.env.DATABASE_URL);

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000040101";
const TEACHER = "ffffffff-0000-7000-8000-000000040102";
/** learners 쓰기가 닫힌 역할 (DEFAULT_MATRIX: content_manager → none) */
const CONTENT_MANAGER = "ffffffff-0000-7000-8000-000000040103";

const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const NODES = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const RULE = uuidv7();
const LEARNER = uuidv7();

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOfIso(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else fd.set(k, v);
  }
  return fd;
}

interface ItemRow {
  item_date: string;
  planned_node_ids: string[];
  matches_group: boolean;
  is_rejoin: boolean;
}

interface SessionSnapshot {
  id: string;
  session_date: string;
  planned_node_ids: string[];
}

interface OutboxRow {
  event_type: string;
  status: string;
  payload: {
    learnerId?: string;
    overrideId?: string;
    changedTo?: string;
  };
}

describe.skipIf(!hasDb)("학습자 일정 실체화의 제품 배선 (인수 4)", () => {
  let sql: ReturnType<typeof getSharedSql>;

  const today = todayIso();
  const periodStart = addDaysIso(today, -14);
  const periodEnd = addDaysIso(today, 60);
  const lessonWeekday = weekdayOfIso(addDaysIso(today, 1));
  const D1 = addDaysIso(today, 1);
  const D2 = addDaysIso(today, 8);
  const D3 = addDaysIso(today, 15);

  let baselineSessions: SessionSnapshot[];

  const learnerItems = async (): Promise<ItemRow[]> =>
    await sql<ItemRow[]>`
      select item_date::text as item_date, planned_node_ids,
             matches_group, is_rejoin
      from learner_schedule_items
      where organization_id = ${ORG} and learner_id = ${LEARNER}
      order by item_date, starts_at
    `;

  const groupSessions = async (): Promise<SessionSnapshot[]> =>
    await sql<SessionSnapshot[]>`
      select id, session_date::text as session_date, planned_node_ids
      from sessions
      where organization_id = ${ORG} and learning_group_id = ${GROUP}
      order by session_date, starts_at
    `;

  const overrideEvents = async (): Promise<OutboxRow[]> =>
    await sql<OutboxRow[]>`
      select event_type, status::text as status, payload
      from outbox_events
      where organization_id = ${ORG}
        and event_type = 'LearnerRouteOverrideChanged'
      order by id
    `;

  const activeOverrideId = async (): Promise<string | null> => {
    const [row] = await sql<{ id: string }[]>`
      select id from student_route_overrides
      where organization_id = ${ORG} and learner_id = ${LEARNER}
        and status = 'active'
      order by created_at desc limit 1
    `;
    return row?.id ?? null;
  };

  const cleanup = async (): Promise<void> => {
    await sql`delete from learner_schedule_items where organization_id = ${ORG}`;
    await sql`delete from sessions where organization_id = ${ORG}`;
    await sql`delete from schedule_revisions where organization_id = ${ORG}`;
    await sql`delete from schedule_change_proposals where organization_id = ${ORG}`;
    await sql`delete from outbox_events where organization_id = ${ORG}`;
    await sql`delete from calendar_rules where organization_id = ${ORG}`;
    await sql`
      delete from student_route_overrides where base_route_version_id in (
        select id from route_versions where organization_id = ${ORG})
    `;
    await sql`delete from learning_group_memberships where organization_id = ${ORG}`;
    await sql`
      delete from route_nodes where route_version_id in (
        select id from route_versions where organization_id = ${ORG})
    `;
    await sql`delete from route_versions where organization_id = ${ORG}`;
    await sql`delete from route_plans where organization_id = ${ORG}`;
    await sql`delete from learners where organization_id = ${ORG}`;
    await sql`delete from learning_groups where organization_id = ${ORG}`;
    await sql`delete from course_periods where organization_id = ${ORG}`;
  };

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 학습자 일정 배선', 'itest-learner-wiring', ${TZ})
      on conflict (id) do nothing
    `;
    await sql`
      insert into users (id, email, display_name)
      values (${TEACHER}, 'itest-learner-teacher@example.test', 'ITEST 배선 교사'),
             (${CONTENT_MANAGER}, 'itest-learner-cm@example.test', 'ITEST 콘텐츠 담당')
      on conflict (id) do nothing
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values (${uuidv7()}, ${ORG}, ${TEACHER}, 'teacher', 'active'),
             (${uuidv7()}, ${ORG}, ${CONTENT_MANAGER}, 'content_manager', 'active')
      on conflict (organization_id, user_id) do nothing
    `;
    await cleanup();

    await sql`
      insert into course_periods (
        id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026, ${periodStart}, ${periodEnd}, 'active')
    `;
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 배선반', 'operating')
    `;
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${LEARNER}, ${ORG}, 'ITEST 배선학생', 'active')
    `;
    await sql`
      insert into learning_group_memberships (
        id, organization_id, learning_group_id, learner_id, status, joined_on)
      values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER}, 'active', ${periodStart})
    `;
    await sql`
      insert into calendar_rules (
        id, organization_id, subject_type, subject_id,
        weekday, start_time, end_time, effective_from)
      values (${RULE}, ${ORG}, 'learning_group', ${GROUP},
              ${lessonWeekday}, '16:00', '18:00', ${today})
    `;
    await sql`
      insert into route_plans (
        id, organization_id, kind, name, learning_group_id,
        course_period_id, status, active_version_id)
      values (${PLAN}, ${ORG}, 'group_route', 'ITEST 루트', ${GROUP},
              ${PERIOD}, 'published', ${VERSION})
    `;
    await sql`
      insert into route_versions (id, organization_id, route_plan_id, version_number, status)
      values (${VERSION}, ${ORG}, ${PLAN}, 1, 'published')
    `;
    for (const [i, nodeId] of NODES.entries()) {
      await sql`
        insert into route_nodes (
          id, organization_id, route_version_id, kind, title, sort_order, expected_minutes)
        values (${nodeId}, ${ORG}, ${VERSION}, 'concept_lesson',
                ${`ITEST 노드 ${i + 1}`}, ${i + 1}, 60)
      `;
    }

    const groupRun = await materializeGroupSchedule({
      organizationId: ORG,
      learningGroupId: GROUP,
      actorUserId: null,
      today,
    });
    expect(groupRun.ok).toBe(true);
    baselineSessions = await groupSessions();
    claims.sub = TEACHER;
  });

  afterAll(async () => {
    await cleanup();
    claims.sub = null;
  });

  it("전제: 반 공통 일정이 3차시로 먼저 만들어져 있다", () => {
    expect(baselineSessions.map((s) => s.session_date)).toEqual([D1, D2, D3]);
  });

  it("learners 쓰기 권한이 없으면 거부하고 한 줄도 만들지 않는다", async () => {
    claims.sub = CONTENT_MANAGER;
    const result = await materializeLearnerScheduleAction(
      null,
      form({ learnerId: LEARNER }),
    );
    claims.sub = TEACHER;

    expect(result.ok).toBe(false);
    expect(result.message).toContain("권한이 없습니다");
    expect(result.createdItems).toBe(0);
    expect(await learnerItems()).toEqual([]);
  });

  it("로그인하지 않으면 거부한다", async () => {
    claims.sub = null;
    const result = await materializeLearnerScheduleAction(
      null,
      form({ learnerId: LEARNER }),
    );
    claims.sub = TEACHER;
    expect(result.ok).toBe(false);
    expect(await learnerItems()).toEqual([]);
  });

  it("오버라이드가 없어도 실행되고 학생 경로 = 반 경로가 된다", async () => {
    const result = await materializeLearnerScheduleAction(
      null,
      form({ learnerId: LEARNER }),
    );
    expect(result.ok).toBe(true);
    expect(result.createdItems).toBe(3);
    expect(result.divergingItems).toBe(0);
    expect(result.rejoinDate).toBeNull();

    const items = await learnerItems();
    expect(items.map((i) => i.item_date)).toEqual([D1, D2, D3]);
    expect(items.every((i) => i.matches_group)).toBe(true);
  });

  it("실행한 사람이 감사에 남는다 (자동화가 아니라 user)", async () => {
    const [row] = await sql<
      { actor_type: string; actor_id: string | null; action: string }[]
    >`
      select actor_type::text as actor_type, actor_id::text as actor_id, action
      from audit_events
      where organization_id = ${ORG}
        and action = 'schedule.materialize-learner'
      order by id desc limit 1
    `;
    expect(row?.actor_type).toBe("user");
    expect(row?.actor_id).toBe(TEACHER);
  });

  it("화면에서 만든 오버라이드가 재계산 이벤트를 함께 발행한다", async () => {
    const created = await createOverride(
      null,
      form({
        learnerId: LEARNER,
        kind: "remediation",
        reason: "ITEST 선수 개념 결손",
        insertTitle: "ITEST 보충 강의",
        insertMinutes: "60",
        rejoinNodeId: NODES[4]!,
      }),
    );
    expect(created.ok).toBe(true);

    const events = await overrideEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("LearnerRouteOverrideChanged");
    expect(events[0]!.status).toBe("pending");
    expect(events[0]!.payload.learnerId).toBe(LEARNER);
    expect(events[0]!.payload.changedTo).toBe("active");
  });

  it("그 이벤트에는 실제 소비자가 있다 — 발행만 하고 아무도 안 듣는 이벤트가 아니다", () => {
    /* 라우팅 표에 없는 event_type은 디스패처가 작업 0건을 만들고도
     * outbox를 delivered로 표시해 영구 유실된다 (queue.ts 340-344). */
    expect(EVENT_CONSUMERS.LearnerRouteOverrideChanged).toEqual([
      "schedule.materialize-learner",
    ]);
  });

  it("화면에서 지정한 재합류 지점이 실체화에 반영된다", async () => {
    const result = await materializeLearnerScheduleAction(
      null,
      form({ learnerId: LEARNER }),
    );
    expect(result.ok).toBe(true);

    /* 이미 배치된 노드는 움직이지 않는다(안정성) — 노드 5·6은 앞선 계산에서
     * 놓인 D3에 그대로 남고, 보충만 가장 이른 슬롯 D1에 들어간다. 그래서
     * 재합류 차시는 D3이고, 그날은 반 공통도 노드 5·6이라 계획이 다시
     * 같아진다(matches_group=true) — "반 진도로 돌아온다"의 실물이다. */
    const items = await learnerItems();
    expect(items.map((i) => i.item_date)).toEqual([D1, D3]);
    expect(result.rejoinDate).toBe(D3);

    // D1: 보충만 — 반이 그날 하는 노드 1·2와 다르다
    expect(items[0]!.planned_node_ids).toHaveLength(1);
    expect(items[0]!.planned_node_ids[0]).toMatch(/^override:/);
    expect(items[0]!.matches_group).toBe(false);
    expect(items[0]!.is_rejoin).toBe(false);
    expect(result.divergingItems).toBe(1);

    // D3: 재합류 차시 — 반 공통과 같은 노드로 돌아온다
    expect(items[1]!.planned_node_ids).toEqual([NODES[4], NODES[5]]);
    expect(items[1]!.is_rejoin).toBe(true);
    expect(items[1]!.matches_group).toBe(true);

    // 재합류 앞의 반 공통 노드는 학생 경로에서 빠진다 (따라잡지 않는다)
    const placed = items.flatMap((i) => i.planned_node_ids);
    for (const skipped of [NODES[0], NODES[1], NODES[2], NODES[3]]) {
      expect(placed).not.toContain(skipped);
    }
    // D2에는 학생 항목이 없다 — 반은 노드 3·4를 하지만 학생은 건너뛴다
    expect(items.map((i) => i.item_date)).not.toContain(D2);
  });

  it("학생 일정을 만들어도 반 공통 수업은 한 줄도 바뀌지 않는다", async () => {
    expect(await groupSessions()).toEqual(baselineSessions);
  });

  it("오버라이드 취소도 재계산 이벤트를 함께 발행한다", async () => {
    const overrideId = await activeOverrideId();
    expect(overrideId).not.toBeNull();

    const cancelled = await cancelOverride(
      null,
      form({ overrideId: overrideId!, learnerId: LEARNER }),
    );
    expect(cancelled.ok).toBe(true);

    const events = await overrideEvents();
    expect(events.map((e) => e.payload.changedTo)).toEqual([
      "active",
      "cancelled",
    ]);
    expect(events[1]!.payload.overrideId).toBe(overrideId);
    expect(events[1]!.status).toBe("pending");
  });

  it("취소 뒤 다시 계산하면 학생이 반 공통 경로로 돌아온다", async () => {
    const result = await materializeLearnerScheduleAction(
      null,
      form({ learnerId: LEARNER }),
    );
    expect(result.ok).toBe(true);
    expect(result.divergingItems).toBe(0);
    expect(result.rejoinDate).toBeNull();

    const items = await learnerItems();
    expect(items.map((i) => i.planned_node_ids)).toEqual(
      baselineSessions.map((s) => s.planned_node_ids),
    );
    expect(await groupSessions()).toEqual(baselineSessions);
  });

  it("이미 취소된 오버라이드를 다시 취소해도 이벤트가 늘지 않는다", async () => {
    const [cancelledId] = await sql<{ id: string }[]>`
      select id from student_route_overrides
      where organization_id = ${ORG} and learner_id = ${LEARNER}
        and status = 'cancelled'
      order by created_at desc limit 1
    `;
    const before = (await overrideEvents()).length;
    const again = await cancelOverride(
      null,
      form({ overrideId: cancelledId!.id, learnerId: LEARNER }),
    );
    expect(again.ok).toBe(false);
    expect((await overrideEvents()).length).toBe(before);
  });
});
