import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../src/client";
import { materializeGroupSchedule } from "../src/domain/schedule";
import {
  materializeLearnerSchedule,
  type MaterializeLearnerResult,
} from "../src/domain/learner-schedule";
import { zonedTimeToUtc, type IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 학습자 스코프 실체화 (인수 4) — 라이브 DB 통합 테스트.
 *
 * 검증하는 것:
 *  1. 오버라이드가 없으면 학생 경로 = 반 경로 (병합의 항등원)
 *  2. 보충 삽입 + 재합류 → 학생만 갈라지고 지정한 차시에서 반 진도로 복귀
 *  3. 반 공통 일정 비영향 — 학생 일정을 몇 번 계산해도 sessions는 그대로
 *  4. 학생 불참 이벤트가 학생 경로에만 반영된다
 *  5. 과거·완료 차시 보존
 *
 * 조직만 고정 ID로 재사용한다 — audit_events는 before delete 트리거로 지울 수
 * 없어서, 실행마다 새 조직을 만들면 사라진 조직을 가리키는 감사 행이 쌓인다
 * (schedule-history-preservation.test.ts와 같은 이유·같은 방식).
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
/* 연결은 beforeAll에서 만든다 — 모듈 최상단에서 createSql()을 부르면
 * DATABASE_URL이 없을 때 skipIf 판정 전에 던져 skip이 아니라 FAIL이 된다. */
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000050002";

const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
/** 반 공통 루트 노드 6개 — 하루 120분 상한에 60분 노드 2개씩 = 3 수업일 */
const NODES = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const RULE = uuidv7();

/** 오버라이드 있는 학생 / 없는 학생 (격리 확인용) */
const LEARNER_A = uuidv7();
const LEARNER_B = uuidv7();

function todayIso(): IsoDate {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }) as IsoDate;
}

function addDaysIso(iso: string, days: number): IsoDate {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10) as IsoDate;
}

function weekdayOfIso(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

interface ItemRow {
  id: string;
  item_date: string;
  session_id: string | null;
  planned_node_ids: string[];
  matches_group: boolean;
  is_rejoin: boolean;
}

async function learnerItems(learnerId: string): Promise<ItemRow[]> {
  return sql<ItemRow[]>`
    select id, item_date::text as item_date, session_id::text as session_id,
           planned_node_ids, matches_group, is_rejoin
    from learner_schedule_items
    where organization_id = ${ORG} and learner_id = ${learnerId}
    order by item_date, starts_at
  `;
}

interface SessionSnapshot {
  id: string;
  session_date: string;
  starts_at: string;
  planned_node_ids: string[];
}

async function groupSessions(): Promise<SessionSnapshot[]> {
  return sql<SessionSnapshot[]>`
    select id, session_date::text as session_date, starts_at::text as starts_at,
           planned_node_ids
    from sessions
    where organization_id = ${ORG} and learning_group_id = ${GROUP}
    order by session_date, starts_at
  `;
}

/** 이 조직에 남은 모든 행 제거 — 조직은 전용이라 통째로 지워도 안전하다.
 *  중단된 이전 실행의 잔재도 여기서 함께 정리된다 (self-healing). */
async function cleanupFixtures(): Promise<void> {
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

describe.skipIf(!hasDb)("학습자 스코프 실체화 (인수 4)", () => {
  const today = todayIso();
  const periodStart = addDaysIso(today, -14);
  const periodEnd = addDaysIso(today, 60);
  /* 수업 요일 하나 — 주 1회 16:00~18:00. 노드 6개 / 하루 2개 = 3주.
   * 날짜를 못 박아 두면 비교가 흔들리지 않는다. */
  const lessonWeekday = weekdayOfIso(addDaysIso(today, 1));
  const D1 = addDaysIso(today, 1);
  const D2 = addDaysIso(today, 8);
  const D3 = addDaysIso(today, 15);

  let baselineSessions: SessionSnapshot[];

  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 학습자 스코프', 'itest-learner-scope', ${TZ})
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
      values (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 학습자스코프반', 'operating')
    `;
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${LEARNER_A}, ${ORG}, 'ITEST 보충학생', 'active'),
             (${LEARNER_B}, ${ORG}, 'ITEST 반진도학생', 'active')
    `;
    await sql`
      insert into learning_group_memberships (
        id, organization_id, learning_group_id, learner_id, status, joined_on)
      values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER_A}, 'active', ${periodStart}),
             (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER_B}, 'active', ${periodStart})
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

    // 반 공통 일정을 먼저 실체화한다 — 학생 경로는 그 위의 차이다.
    const groupRun = await materializeGroupSchedule({
      organizationId: ORG,
      learningGroupId: GROUP,
      actorUserId: null,
      timezone: TZ,
      today,
    });
    expect(groupRun.ok).toBe(true);
    baselineSessions = await groupSessions();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await sql.end({ timeout: 5 });
  });

  it("전제: 반 공통 일정이 3차시로 만들어졌다", () => {
    expect(baselineSessions.map((s) => s.session_date)).toEqual([D1, D2, D3]);
    expect(baselineSessions.map((s) => s.planned_node_ids)).toEqual([
      [NODES[0], NODES[1]],
      [NODES[2], NODES[3]],
      [NODES[4], NODES[5]],
    ]);
  });

  describe("오버라이드가 없으면 학생 경로 = 반 경로", () => {
    let run: MaterializeLearnerResult;

    beforeAll(async () => {
      run = await materializeLearnerSchedule({
        organizationId: ORG,
        learnerId: LEARNER_B,
        actorUserId: null,
        timezone: TZ,
        today,
      });
    });

    it("차시 수·날짜·노드가 반 공통과 같다", async () => {
      expect(run.ok).toBe(true);
      const items = await learnerItems(LEARNER_B);
      expect(items.map((i) => i.item_date)).toEqual([D1, D2, D3]);
      expect(items.map((i) => i.planned_node_ids)).toEqual(
        baselineSessions.map((s) => s.planned_node_ids),
      );
    });

    it("모든 차시가 반 공통과 일치로 표시되고 갈라짐이 0이다", async () => {
      const items = await learnerItems(LEARNER_B);
      expect(items.every((i) => i.matches_group)).toBe(true);
      expect(items.every((i) => i.is_rejoin)).toBe(false);
      expect(run.divergingItems).toBe(0);
      expect(run.rejoinDate).toBeNull();
    });

    it("모든 차시가 실제 반 수업에 이어진다", async () => {
      const items = await learnerItems(LEARNER_B);
      expect(items.map((i) => i.session_id)).toEqual(
        baselineSessions.map((s) => s.id),
      );
    });
  });

  describe("보충 삽입 + 재합류", () => {
    let run: MaterializeLearnerResult;
    const OVERRIDE = uuidv7();

    beforeAll(async () => {
      /* 학생 A: 앞에 보충 2차시를 넣고, 5번째 노드에서 반 진도로 재합류.
       * 반이 노드 1~4를 지나가는 동안 학생은 보충을 하고, 노드 5에서 합류한다. */
      await sql`
        insert into student_route_overrides (
          id, organization_id, learner_id, base_route_version_id, kind, version,
          status, reason, rejoin_node_id, delta
        ) values (
          ${OVERRIDE}, ${ORG}, ${LEARNER_A}, ${VERSION}, 'remediation', 1,
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
      run = await materializeLearnerSchedule({
        organizationId: ORG,
        learnerId: LEARNER_A,
        actorUserId: null,
        timezone: TZ,
        today,
      });
    });

    it("보충 → 재합류 → 반 진도 순서로 학생 경로가 만들어진다", async () => {
      expect(run.ok).toBe(true);
      const items = await learnerItems(LEARNER_A);
      expect(items.map((i) => i.item_date)).toEqual([D1, D2]);
      // 1차시: 보충 2개 (합성 ID) / 2차시: 재합류 노드 5·6
      expect(items[0]!.planned_node_ids).toEqual([
        `override:${OVERRIDE}:0`,
        `override:${OVERRIDE}:1`,
      ]);
      expect(items[1]!.planned_node_ids).toEqual([NODES[4], NODES[5]]);
    });

    it("재합류 앞의 반 공통 노드는 학생 경로에서 빠진다", async () => {
      const items = await learnerItems(LEARNER_A);
      const placed = items.flatMap((i) => i.planned_node_ids);
      for (const skipped of [NODES[0], NODES[1], NODES[2], NODES[3]]) {
        expect(placed).not.toContain(skipped);
      }
      expect(run.skippedNodes).toBe(4);
    });

    it("재합류 차시를 지목한다 — 어느 차시에서 반 진도로 돌아오는가", async () => {
      const items = await learnerItems(LEARNER_A);
      expect(items.map((i) => i.is_rejoin)).toEqual([false, true]);
      expect(run.rejoinDate).toBe(D2);
    });

    it("보충 차시는 반 공통과 다름으로, 재합류 후는 무관하게 표시된다", async () => {
      const items = await learnerItems(LEARNER_A);
      // D1: 반은 노드 1·2, 학생은 보충 → 갈라짐
      expect(items[0]!.matches_group).toBe(false);
      // D2: 반은 노드 3·4, 학생은 노드 5·6 → 아직 진도가 어긋나 있다
      expect(items[1]!.matches_group).toBe(false);
      expect(run.divergingItems).toBe(2);
    });

    it("학생 항목은 실재하는 반 수업에 이어진다 (같은 날짜·시각)", async () => {
      const items = await learnerItems(LEARNER_A);
      expect(items[0]!.session_id).toBe(baselineSessions[0]!.id);
      expect(items[1]!.session_id).toBe(baselineSessions[1]!.id);
    });

    it("반 공통 일정은 한 줄도 바뀌지 않는다 (불변 조건 4)", async () => {
      expect(await groupSessions()).toEqual(baselineSessions);
    });

    it("다른 학생의 일정은 영향받지 않는다 (오버라이드 격리)", async () => {
      const items = await learnerItems(LEARNER_B);
      expect(items.map((i) => i.planned_node_ids)).toEqual(
        baselineSessions.map((s) => s.planned_node_ids),
      );
    });

    it("학습자 스코프 리비전·변경안이 남고 활성은 하나다", async () => {
      const revisions = await sql<{ is_active: boolean }[]>`
        select is_active from schedule_revisions
        where organization_id = ${ORG} and scope_type = 'learner'
          and scope_id = ${LEARNER_A}
      `;
      expect(revisions.length).toBeGreaterThan(0);
      expect(revisions.filter((r) => r.is_active)).toHaveLength(1);

      const [proposal] = await sql<{ status: string; scope_type: string }[]>`
        select status::text as status, scope_type from schedule_change_proposals
        where organization_id = ${ORG} and scope_id = ${LEARNER_A}
        order by created_at desc limit 1
      `;
      expect(proposal?.scope_type).toBe("learner");
      expect(proposal?.status).toBe("applied");
    });

    it("다시 계산해도 결과가 같고 반 수업도 그대로다 (멱등)", async () => {
      const before = await learnerItems(LEARNER_A);
      const second = await materializeLearnerSchedule({
        organizationId: ORG,
        learnerId: LEARNER_A,
        actorUserId: null,
        timezone: TZ,
        today,
      });
      expect(second.ok).toBe(true);
      const after = await learnerItems(LEARNER_A);
      expect(after.map((i) => i.item_date)).toEqual(
        before.map((i) => i.item_date),
      );
      expect(after.map((i) => i.planned_node_ids)).toEqual(
        before.map((i) => i.planned_node_ids),
      );
      expect(await groupSessions()).toEqual(baselineSessions);
    });
  });

  describe("학생 불참은 학생 경로만 움직인다", () => {
    beforeAll(async () => {
      /* 첫 수업일에 학생 A 불참. 반 일정은 그대로여야 하고,
       * 학생 경로만 그날을 비켜 가야 한다. */
      await sql`
        insert into learning_availability_events (
          id, organization_id, kind, learner_id, learning_group_id,
          starts_on, ends_on, source, reason, status
        ) values (
          ${uuidv7()}, ${ORG}, 'learner_absence', ${LEARNER_A}, ${GROUP},
          ${D1}, ${D1}, 'manual', 'ITEST 불참', 'received'
        )
      `;
      const run = await materializeLearnerSchedule({
        organizationId: ORG,
        learnerId: LEARNER_A,
        actorUserId: null,
        timezone: TZ,
        today,
      });
      expect(run.ok).toBe(true);
    });

    it("불참일에는 학생 항목이 없다", async () => {
      const items = await learnerItems(LEARNER_A);
      expect(items.map((i) => i.item_date)).not.toContain(D1);
      expect(items.map((i) => i.item_date)).toEqual([D2, D3]);
    });

    it("반 공통 일정은 그대로다 — 학생 불참이 반을 바꾸지 않는다", async () => {
      expect(await groupSessions()).toEqual(baselineSessions);
    });

    it("소비한 불참 이벤트가 applied로 전이된다", async () => {
      const [event] = await sql<{ status: string; schedule_proposal_id: string | null }[]>`
        select status::text as status, schedule_proposal_id::text as schedule_proposal_id
        from learning_availability_events
        where organization_id = ${ORG} and kind = 'learner_absence'
      `;
      expect(event?.status).toBe("applied");
      expect(event?.schedule_proposal_id).not.toBeNull();
    });
  });

  describe("완료된 반 수업에 매인 학생 항목은 보존된다", () => {
    let preservedItemId: string;

    beforeAll(async () => {
      /* D2 수업을 완료 처리한다. 그 수업에 매인 학생 항목은 재계산이
       * 건드리면 안 된다 (불변 조건 5 — 과거·완료 보존). */
      const [item] = await learnerItems(LEARNER_A);
      preservedItemId = item!.id;
      await sql`
        update sessions set status = 'completed', completed_at = now()
        where id = ${item!.session_id}
      `;
      const run = await materializeLearnerSchedule({
        organizationId: ORG,
        learnerId: LEARNER_A,
        actorUserId: null,
        timezone: TZ,
        today,
      });
      expect(run.ok).toBe(true);
    });

    it("완료 수업에 매인 항목은 같은 id로 남는다", async () => {
      const [row] = await sql<{ id: string }[]>`
        select id from learner_schedule_items where id = ${preservedItemId}
      `;
      expect(row?.id).toBe(preservedItemId);
    });

    it("같은 시각에 항목이 둘로 늘지 않는다 (재삽입 없음)", async () => {
      const items = await learnerItems(LEARNER_A);
      const dates = items.map((i) => i.item_date);
      expect(new Set(dates).size).toBe(dates.length);
    });

    it("완료 처리는 반 수업 수를 바꾸지 않았다", async () => {
      const sessions = await groupSessions();
      expect(sessions.map((s) => s.id)).toEqual(
        baselineSessions.map((s) => s.id),
      );
    });
  });

  describe("반 공통 재실체화가 학생 항목 때문에 막히지 않는다", () => {
    it("학생 항목이 매달린 채로도 반 일정을 다시 만들 수 있다", async () => {
      const linked = await sql<{ cnt: number }[]>`
        select count(*)::int as cnt from learner_schedule_items
        where organization_id = ${ORG} and session_id is not null
      `;
      expect(linked[0]!.cnt).toBeGreaterThan(0);

      const rerun = await materializeGroupSchedule({
        organizationId: ORG,
        learningGroupId: GROUP,
        actorUserId: null,
        timezone: TZ,
        today,
      });
      expect(rerun.ok).toBe(true);
    });
  });

  describe("과거의 노드가 달린 planned 수업이 있어도 반 재실체화가 성공한다", () => {
    /* 회귀 — 보존 항목을 completed·locked로만 걸러내면 과거 날짜의 planned
     * 수업(노드가 달린)이 다시 삽입되어 sessions_group_no_overlap에 걸린다. */
    const PAST_SESSION = uuidv7();
    const PAST_DATE = addDaysIso(today, -7);

    beforeAll(async () => {
      await sql`
        insert into sessions (
          id, organization_id, learning_group_id, session_date, timezone,
          starts_at, ends_at, status, planned_node_ids
        ) values (
          ${PAST_SESSION}, ${ORG}, ${GROUP}, ${PAST_DATE}, ${TZ},
          ${zonedTimeToUtc(PAST_DATE, "16:00", TZ)},
          ${zonedTimeToUtc(PAST_DATE, "18:00", TZ)},
          'planned', ${sql.json([NODES[0], NODES[1]] as never)}
        )
      `;
    });

    it("재실체화가 성공하고 그 과거 수업이 그대로 하나로 남는다", async () => {
      const rerun = await materializeGroupSchedule({
        organizationId: ORG,
        learningGroupId: GROUP,
        actorUserId: null,
        timezone: TZ,
        today,
      });
      expect(rerun.ok).toBe(true);

      const past = await sql<{ id: string }[]>`
        select id from sessions
        where organization_id = ${ORG} and learning_group_id = ${GROUP}
          and session_date = ${PAST_DATE}
      `;
      expect(past).toHaveLength(1);
      expect(past[0]!.id).toBe(PAST_SESSION);
    });
  });
});
