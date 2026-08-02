import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  EVENT_CONSUMERS,
  createSql,
  getSharedSql,
  isDeferSignal,
  type ClaimedJob,
} from "@su-maek/db";
import { materializeGroupSchedule } from "@su-maek/db/domain";
import { handleLearnerScheduleMaterialize } from "../../src/handlers/schedule";
import { createHandlerRegistry } from "../../src/registry";

/* ─────────────────────────────────────────────────────────────
 * 학습자 스코프 자동 재계산 (인수 4) — 라이브 DB 통합 테스트.
 *
 * 오버라이드 생성·취소가 발행한 LearnerRouteOverrideChanged를 워커가 소비해
 * 그 학습자의 개별 일정을 다시 만든다. 여기서 겨누는 것:
 *   1) 배선의 **짝** — EVENT_CONSUMERS 등록과 main.ts의 register가 함께 있다
 *      (한쪽만 있으면 디스패처가 작업 0건을 만들고도 outbox를 delivered로
 *       표시해 이벤트가 영구 유실된다 — queue.ts 340-344)
 *   2) 핸들러가 실제로 오버라이드를 반영한 학생 차시를 만든다
 *   3) 반 공통 일정(sessions)은 한 줄도 바뀌지 않는다 (불변 조건 4)
 *   4) 중복 전달은 Inbox로 걸러진다 (at-least-once 방어)
 *   5) kill switch(auto_reschedule)가 꺼지면 연기하고 아무것도 쓰지 않는다
 *   6) 취소 이벤트는 학생을 반 공통 경로로 되돌린다
 *
 * 덮지 못하는 것 — 정직하게 적는다:
 *  - Outbox 디스패처 실행(dispatchOutbox)은 여기서 부르지 않는다. 라우팅
 *    테이블과 등록을 직접 단언한다(테스트 1). outbox→작업→핸들러 왕복 자체는
 *    조직 스코프 디스패처로 test/wiring/outbox-roundtrip.test.ts가 덮는다.
 *
 * 픽스처 규약: 조직만 고정 ID(감사 행은 지울 수 없다), 이벤트 ID도 고정
 * (inbox_events에는 organization_id가 없어 실행마다 새 ID면 정리할 수 없다).
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000040001";
const CONSUMER = "schedule.materialize-learner";
const EVENT_SWITCH = "ffffffff-0000-7000-8000-0000000400e1";
const EVENT_CREATE = "ffffffff-0000-7000-8000-0000000400e2";
const EVENT_CANCEL = "ffffffff-0000-7000-8000-0000000400e3";

const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
/** 노드 6개 — 하루 120분 상한에 60분 노드 2개씩 = 3 수업일 */
const NODES = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const RULE = uuidv7();
const LEARNER = uuidv7();
const OVERRIDE = uuidv7();

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

/**
 * 디스패처가 만드는 것과 같은 모양의 작업.
 * queue.ts dispatchOutbox가 jobs.payload에 넣는 봉투 그대로다
 * (eventId·eventType·payload). 큐의 클레임·리스 동작은 이 핸들러와 무관하고
 * schedule-resume.test.ts가 이미 덮는다.
 */
function eventJob(eventId: string, changedTo: "active" | "cancelled"): ClaimedJob {
  return {
    id: uuidv7(),
    organization_id: ORG,
    topic: CONSUMER,
    payload: {
      eventId,
      eventType: "LearnerRouteOverrideChanged",
      aggregateType: "student_route_override",
      aggregateId: OVERRIDE,
      aggregateVersion: changedTo === "active" ? 1 : 2,
      payload: {
        overrideId: OVERRIDE,
        learnerId: LEARNER,
        kind: "remediation",
        changedTo,
        changedBy: null,
      },
    },
    attempts: 1,
    max_attempts: 5,
    checkpoint: null,
    meta: null,
  };
}

interface ItemRow {
  item_date: string;
  planned_node_ids: string[];
  matches_group: boolean;
  is_rejoin: boolean;
}

async function learnerItems(): Promise<ItemRow[]> {
  return sql<ItemRow[]>`
    select item_date::text as item_date, planned_node_ids, matches_group, is_rejoin
    from learner_schedule_items
    where organization_id = ${ORG} and learner_id = ${LEARNER}
    order by item_date, starts_at
  `;
}

interface SessionSnapshot {
  id: string;
  session_date: string;
  planned_node_ids: string[];
}

async function groupSessions(): Promise<SessionSnapshot[]> {
  return sql<SessionSnapshot[]>`
    select id, session_date::text as session_date, planned_node_ids
    from sessions
    where organization_id = ${ORG} and learning_group_id = ${GROUP}
    order by session_date, starts_at
  `;
}

async function inboxCount(eventId: string): Promise<number> {
  const [row] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from inbox_events
    where consumer_name = ${CONSUMER} and event_id = ${eventId}
  `;
  return row?.cnt ?? 0;
}

async function cleanupFixtures(): Promise<void> {
  await sql`
    delete from inbox_events
    where consumer_name = ${CONSUMER}
      and event_id in (${EVENT_SWITCH}, ${EVENT_CREATE}, ${EVENT_CANCEL})
  `;
  await sql`delete from kill_switches where organization_id = ${ORG}`;
  await sql`delete from learner_schedule_items where organization_id = ${ORG}`;
  await sql`delete from sessions where organization_id = ${ORG}`;
  await sql`delete from schedule_revisions where organization_id = ${ORG}`;
  await sql`delete from schedule_change_proposals where organization_id = ${ORG}`;
  await sql`delete from outbox_events where organization_id = ${ORG}`;
  await sql`delete from learning_availability_events where organization_id = ${ORG}`;
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
}

/* ── 1) 배선의 짝 — DB 없이도 도는 회귀 검사 ────────────────── */

describe("오버라이드 → 학습자 재계산 배선 (인수 4)", () => {
  it("오버라이드 변경 이벤트가 학습자 실체화 토픽으로 라우팅된다", () => {
    expect(EVENT_CONSUMERS.LearnerRouteOverrideChanged).toEqual([
      "schedule.materialize-learner",
    ]);
    // 반 공통 실체화를 부르지 않는다 — 학생 오버라이드는 반을 바꾸지 않는다
    expect(EVENT_CONSUMERS.LearnerRouteOverrideChanged).not.toContain(
      "schedule.materialize",
    );
  });

  it("학습자 실체화 토픽에 워커 핸들러가 등록되어 있다", () => {
    /* EVENT_CONSUMERS 등록의 짝. 이 등록이 빠지면 작업이 큐에 쌓이기만
     * 하고 아무도 처리하지 않는다 — 화면은 "자동 재계산됨"이라 믿는데
     * 학생 일정은 영원히 옛것이다.
     *
     * 레지스트리 전반의 짝 검사는 test/wiring/event-wiring.test.ts가 한다. */
    expect(createHandlerRegistry().has("schedule.materialize-learner")).toBe(
      true,
    );
  });
});

/* ── 2) 실제 소비 경로 ──────────────────────────────────────── */

describe.skipIf(!hasDb)("학습자 스코프 자동 재계산 핸들러 (인수 4)", () => {
  const today = todayIso();
  const periodStart = addDaysIso(today, -14);
  const periodEnd = addDaysIso(today, 60);
  const lessonWeekday = weekdayOfIso(addDaysIso(today, 1));
  const D1 = addDaysIso(today, 1);
  const D2 = addDaysIso(today, 8);
  const D3 = addDaysIso(today, 15);

  let baselineSessions: SessionSnapshot[];
  let switchResult: unknown;
  let itemsDuringSwitch: ItemRow[];
  let inboxDuringSwitch: number;
  let createResult: { ok?: boolean; created?: number; diverging?: number };
  let itemsAfterCreate: ItemRow[];
  let sessionsAfterCreate: SessionSnapshot[];
  let duplicateResult: unknown;
  let itemsAfterDuplicate: ItemRow[];
  let cancelResult: { ok?: boolean };
  let itemsAfterCancel: ItemRow[];

  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 학습자 자동재계산', 'itest-learner-auto', ${TZ})
      on conflict (id) do nothing
    `;
    await cleanupFixtures();

    await sql`
      insert into course_periods (
        id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026, ${periodStart}, ${periodEnd}, 'active')
    `;
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 자동재계산반', 'operating')
    `;
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${LEARNER}, ${ORG}, 'ITEST 자동재계산학생', 'active')
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
      timezone: TZ,
      today,
    });
    expect(groupRun.ok).toBe(true);
    baselineSessions = await groupSessions();

    /* 오버라이드 — 화면의 createOverride가 저장하는 것과 같은 모양.
     * 앞에 보충 2차시를 넣고 5번째 노드에서 반 진도로 재합류한다. */
    await sql`
      insert into student_route_overrides (
        id, organization_id, learner_id, base_route_version_id, kind, version,
        status, reason, rejoin_node_id, delta
      ) values (
        ${OVERRIDE}, ${ORG}, ${LEARNER}, ${VERSION}, 'remediation', 1,
        'active', 'ITEST 선수 개념 결손', ${NODES[4]!},
        ${sql.json({
          skipNodeIds: [],
          insertBefore: {
            anchorNodeId: null,
            nodes: [
              { title: "ITEST 보충 1", kind: "remediation", expectedMinutes: 60 },
              { title: "ITEST 보충 2", kind: "remediation", expectedMinutes: 60 },
            ],
          },
        } as never)}
      )
    `;

    /* ── kill switch가 켜져 있는 동안의 소비 (아무것도 쓰지 않아야 한다) ── */
    await sql`
      insert into kill_switches (id, organization_id, key, enabled, reason)
      values (${uuidv7()}, ${ORG}, 'auto_reschedule', false, 'ITEST 자동재계산 중지')
    `;
    switchResult = await handleLearnerScheduleMaterialize(
      eventJob(EVENT_SWITCH, "active"),
    );
    itemsDuringSwitch = await learnerItems();
    inboxDuringSwitch = await inboxCount(EVENT_SWITCH);
    await sql`delete from kill_switches where organization_id = ${ORG}`;

    /* ── 생성 이벤트 소비 ── */
    createResult = (await handleLearnerScheduleMaterialize(
      eventJob(EVENT_CREATE, "active"),
    )) as typeof createResult;
    itemsAfterCreate = await learnerItems();
    sessionsAfterCreate = await groupSessions();

    /* ── 같은 이벤트의 재전달 (at-least-once) ── */
    duplicateResult = await handleLearnerScheduleMaterialize(
      eventJob(EVENT_CREATE, "active"),
    );
    itemsAfterDuplicate = await learnerItems();

    /* ── 취소 이벤트 소비 — 화면의 cancelOverride가 발행하는 것 ── */
    await sql`
      update student_route_overrides set status = 'cancelled', updated_at = now()
      where id = ${OVERRIDE}
    `;
    cancelResult = (await handleLearnerScheduleMaterialize(
      eventJob(EVENT_CANCEL, "cancelled"),
    )) as typeof cancelResult;
    itemsAfterCancel = await learnerItems();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await sql.end({ timeout: 5 });
    // 핸들러·도메인이 쓰는 공유 풀도 닫아야 프로세스가 바로 끝난다
    await getSharedSql().end({ timeout: 5 });
  });

  it("전제: 반 공통 일정이 3차시로 먼저 만들어져 있다", () => {
    expect(baselineSessions.map((s) => s.session_date)).toEqual([D1, D2, D3]);
  });

  it("kill switch가 꺼져 있으면 연기하고 아무것도 쓰지 않는다", () => {
    expect(isDeferSignal(switchResult)).toBe(true);
    expect((switchResult as { reason: string }).reason).toContain(
      "auto_reschedule",
    );
    expect(itemsDuringSwitch).toEqual([]);
    // Inbox에 표시하지 않는다 — 표시했다면 복구 후 재개가 중복으로 걸러진다
    expect(inboxDuringSwitch).toBe(0);
  });

  it("생성 이벤트를 소비해 오버라이드가 반영된 학생 차시를 만든다", () => {
    expect(createResult.ok).toBe(true);
    expect(itemsAfterCreate.map((i) => i.item_date)).toEqual([D1, D2]);
    expect(itemsAfterCreate[0]!.planned_node_ids).toEqual([
      `override:${OVERRIDE}:0`,
      `override:${OVERRIDE}:1`,
    ]);
    expect(itemsAfterCreate[1]!.planned_node_ids).toEqual([NODES[4], NODES[5]]);
  });

  it("반 공통과 다른 차시와 재합류 차시가 표시된다", () => {
    expect(itemsAfterCreate.map((i) => i.matches_group)).toEqual([false, false]);
    expect(itemsAfterCreate.map((i) => i.is_rejoin)).toEqual([false, true]);
    expect(createResult.diverging).toBe(2);
  });

  it("반 공통 일정은 한 줄도 바뀌지 않는다 (불변 조건 4)", () => {
    expect(sessionsAfterCreate).toEqual(baselineSessions);
  });

  it("같은 이벤트의 재전달은 Inbox로 걸러지고 결과가 그대로다 (멱등)", () => {
    expect(duplicateResult).toEqual({ skipped: "중복 이벤트 (inbox)" });
    expect(itemsAfterDuplicate).toEqual(itemsAfterCreate);
  });

  it("취소 이벤트를 소비하면 학생 경로가 반 공통으로 되돌아온다", () => {
    expect(cancelResult.ok).toBe(true);
    expect(itemsAfterCancel.map((i) => i.item_date)).toEqual([D1, D2, D3]);
    expect(itemsAfterCancel.map((i) => i.planned_node_ids)).toEqual(
      baselineSessions.map((s) => s.planned_node_ids),
    );
    expect(itemsAfterCancel.every((i) => i.matches_group)).toBe(true);
    expect(itemsAfterCancel.some((i) => i.is_rejoin)).toBe(false);
  });
});
