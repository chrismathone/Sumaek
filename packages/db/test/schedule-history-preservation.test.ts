import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../src/client";
import {
  materializeGroupSchedule,
  type MaterializeResult,
} from "../src/domain/schedule";
import { zonedTimeToUtc, type IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 과거 보존 (인수 5 / 불변 조건 5) — 라이브 DB 통합 테스트.
 *
 * 재실체화는 미래의 잠기지 않은 planned 수업만 교체한다. 실데이터를 지키는
 * 지점은 domain/schedule.ts의 DELETE 가드 네 조건이다:
 *   organization_id / learning_group_id / status='planned'
 *   / locked_at is null / session_date >= today
 *
 * 이 테스트는 그 가드를 조건별로 겨눈다. 조건 하나를 지우면 대응하는 픽스처
 * 수업이 지워져 반드시 실패한다 (조건 ↔ 픽스처 대응은 각 it 제목에 적었다).
 *
 * 픽스처 수업의 planned_node_ids를 비워 두는 이유: 노드를 달면 엔진
 * 입력(existingItems)에 섞여 들어가 배치 결과가 픽스처에 따라 흔들린다.
 * 여기서 검증할 것은 엔진의 보존 로직이 아니라 DB 가드이므로, 엔진에는
 * 보이지 않고 sessions 테이블에만 존재하는 행으로 가드를 격리한다.
 * (엔진 쪽 보존은 packages/core의 결정론 테스트가 덮는다.)
 *
 * 조직만 고정 ID로 재사용한다 — materializeGroupSchedule은 audit_events에
 * 감사 행을 남기는데 그 테이블은 before delete 트리거로 지울 수 없다.
 * 실행마다 새 조직을 만들면 사라진 조직을 가리키는 감사 행이 계속 쌓인다.
 * 나머지 픽스처(기간·반·루트·규칙·수업)는 실행마다 uuidv7로 만들고 전부 지운다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
/* 연결은 beforeAll에서 만든다 — 모듈 최상단에서 createSql()을 부르면
 * DATABASE_URL이 없을 때 skipIf 판정 전에 던져 skip이 아니라 FAIL이 된다. */
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000050001";

const PERIOD = uuidv7();
const GROUP = uuidv7();
const OTHER_GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const NODE_1 = uuidv7();
const NODE_2 = uuidv7();
const RULE = uuidv7();

const S_PAST_PLANNED = uuidv7();
const S_FUTURE_COMPLETED = uuidv7();
const S_FUTURE_LOCKED = uuidv7();
const S_FUTURE_CANCELLED = uuidv7();
const S_FUTURE_PLANNED = uuidv7();
const S_OTHER_GROUP = uuidv7();

/** 픽스처 수업 시간 — 수업 슬롯(16:00~18:00)과 겹치지 않게 둔다 */
const FIXTURE_START = "10:00";
const FIXTURE_END = "11:00";

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

interface SessionRow {
  id: string;
  status: string;
  locked_at: Date | null;
  session_date: string;
}

async function sessionRow(id: string): Promise<SessionRow | null> {
  const [row] = await sql<SessionRow[]>`
    select id, status, locked_at, session_date::text as session_date
    from sessions where id = ${id}
  `;
  return row ?? null;
}

/** 이 조직에 남은 모든 행 제거 — 조직은 전용이라 통째로 지워도 안전하다.
 *  중단된 이전 실행의 잔재도 여기서 함께 정리된다 (self-healing). */
async function cleanupFixtures(): Promise<void> {
  await sql`delete from sessions where organization_id = ${ORG}`;
  await sql`delete from schedule_revisions where organization_id = ${ORG}`;
  await sql`delete from schedule_change_proposals where organization_id = ${ORG}`;
  await sql`delete from outbox_events where organization_id = ${ORG}`;
  await sql`delete from learning_availability_events where organization_id = ${ORG}`;
  await sql`delete from calendar_rules where organization_id = ${ORG}`;
  await sql`
    delete from route_nodes where route_version_id in (
      select id from route_versions where organization_id = ${ORG})
  `;
  await sql`delete from route_versions where organization_id = ${ORG}`;
  await sql`delete from route_plans where organization_id = ${ORG}`;
  await sql`delete from learning_groups where organization_id = ${ORG}`;
  await sql`delete from course_periods where organization_id = ${ORG}`;
}

describe.skipIf(!hasDb)("재실체화 과거 보존 (인수 5)", () => {
  const today = todayIso();
  const periodStart = addDaysIso(today, -14);
  const periodEnd = addDaysIso(today, 30);
  /* 수업 요일은 내일 하나뿐 — 엔진이 만드는 날짜를 today+1, +8, …로 못 박아
   * 픽스처 날짜(today+2 ~ +6)와 절대 겹치지 않게 한다. 겹치면 세션 시간
   * 중복 EXCLUDE 제약(sessions_group_no_overlap)에 걸려 가드와 무관한
   * 이유로 실패한다. */
  const lessonWeekday = weekdayOfIso(addDaysIso(today, 1));

  const DATE_PAST = addDaysIso(today, -7);
  const DATE_COMPLETED = addDaysIso(today, 2);
  const DATE_LOCKED = addDaysIso(today, 3);
  const DATE_CANCELLED = addDaysIso(today, 4);
  const DATE_FUTURE_PLANNED = addDaysIso(today, 5);
  const DATE_OTHER_GROUP = addDaysIso(today, 6);

  let firstRun: MaterializeResult;
  let secondRun: MaterializeResult;

  async function insertFixtureSession(row: {
    id: string;
    groupId: string;
    date: IsoDate;
    status: "planned" | "completed" | "cancelled";
    locked?: boolean;
  }): Promise<void> {
    await sql`
      insert into sessions (
        id, organization_id, learning_group_id, session_date, timezone,
        starts_at, ends_at, status, locked_at, completed_at,
        cancelled_reason, planned_node_ids
      ) values (
        ${row.id}, ${ORG}, ${row.groupId}, ${row.date}, ${TZ},
        ${zonedTimeToUtc(row.date, FIXTURE_START, TZ)},
        ${zonedTimeToUtc(row.date, FIXTURE_END, TZ)},
        ${row.status}::session_status,
        ${row.locked ? new Date() : null},
        ${row.status === "completed" ? new Date() : null},
        ${row.status === "cancelled" ? "ITEST 취소" : null},
        '[]'::jsonb
      )
    `;
  }

  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 과거 보존', 'itest-history-preservation', ${TZ})
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
      values
        (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 보존반', 'operating'),
        (${OTHER_GROUP}, ${ORG}, ${PERIOD}, 'ITEST 이웃반', 'operating')
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
    await sql`
      insert into route_nodes (
        id, organization_id, route_version_id, kind, title, sort_order, expected_minutes)
      values
        (${NODE_1}, ${ORG}, ${VERSION}, 'concept_lesson', 'ITEST 노드 1', 1, 60),
        (${NODE_2}, ${ORG}, ${VERSION}, 'concept_lesson', 'ITEST 노드 2', 2, 60)
    `;

    /* 가드 조건별 픽스처 — 앞의 넷은 살아남고, 다섯째만 교체된다 */
    await insertFixtureSession({
      id: S_PAST_PLANNED,
      groupId: GROUP,
      date: DATE_PAST,
      status: "planned",
    });
    await insertFixtureSession({
      id: S_FUTURE_COMPLETED,
      groupId: GROUP,
      date: DATE_COMPLETED,
      status: "completed",
    });
    await insertFixtureSession({
      id: S_FUTURE_LOCKED,
      groupId: GROUP,
      date: DATE_LOCKED,
      status: "planned",
      locked: true,
    });
    await insertFixtureSession({
      id: S_FUTURE_CANCELLED,
      groupId: GROUP,
      date: DATE_CANCELLED,
      status: "cancelled",
    });
    await insertFixtureSession({
      id: S_FUTURE_PLANNED,
      groupId: GROUP,
      date: DATE_FUTURE_PLANNED,
      status: "planned",
    });
    await insertFixtureSession({
      id: S_OTHER_GROUP,
      groupId: OTHER_GROUP,
      date: DATE_OTHER_GROUP,
      status: "planned",
    });

    /* 두 번 실체화한다 — 1회차는 픽스처 위에서, 2회차는 1회차가 만든
     * 세션 위에서 돈다. "재실체화 후에도 살아남는다"를 실제로 반복 검증. */
    const options = {
      organizationId: ORG,
      learningGroupId: GROUP,
      actorUserId: null,
      timezone: TZ,
      today,
    };
    firstRun = await materializeGroupSchedule(options);
    secondRun = await materializeGroupSchedule(options);
  });

  afterAll(async () => {
    await cleanupFixtures();
    await sql.end({ timeout: 5 });
  });

  it("실체화가 성공하고 미래 수업을 만든다 (전제)", () => {
    expect(firstRun.ok).toBe(true);
    expect(firstRun.createdSessions).toBeGreaterThan(0);
    expect(secondRun.ok).toBe(true);
    expect(secondRun.createdSessions).toBeGreaterThan(0);
  });

  it("과거 날짜의 planned 수업은 남는다 (가드: session_date >= today)", async () => {
    const row = await sessionRow(S_PAST_PLANNED);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("planned");
    expect(row!.locked_at).toBeNull();
    // 픽스처가 실제로 과거인지 — 조건을 겨누고 있음을 스스로 증명
    expect(row!.session_date < today).toBe(true);
  });

  it("완료된 미래 수업은 남는다 (가드: status = 'planned')", async () => {
    const row = await sessionRow(S_FUTURE_COMPLETED);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("completed");
    expect(row!.session_date >= today).toBe(true);
  });

  it("잠긴 미래 planned 수업은 남는다 (가드: locked_at is null)", async () => {
    const row = await sessionRow(S_FUTURE_LOCKED);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("planned");
    expect(row!.locked_at).not.toBeNull();
    expect(row!.session_date >= today).toBe(true);
  });

  it("취소된 미래 수업은 남는다 (가드: status = 'planned')", async () => {
    const row = await sessionRow(S_FUTURE_CANCELLED);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("cancelled");
    expect(row!.session_date >= today).toBe(true);
  });

  it("다른 반의 미래 planned 수업은 남는다 (가드: learning_group_id)", async () => {
    const row = await sessionRow(S_OTHER_GROUP);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("planned");
    expect(row!.session_date >= today).toBe(true);
  });

  it("미래의 잠기지 않은 planned 수업은 교체된다", async () => {
    expect(await sessionRow(S_FUTURE_PLANNED)).toBeNull();

    const rows = await sql<{ id: string; session_date: string }[]>`
      select id, session_date::text as session_date from sessions
      where organization_id = ${ORG} and learning_group_id = ${GROUP}
      order by session_date
    `;
    // 보존 4건 + 마지막 실행이 만든 수업
    expect(rows).toHaveLength(4 + secondRun.createdSessions);

    const preserved = new Set([
      S_PAST_PLANNED,
      S_FUTURE_COMPLETED,
      S_FUTURE_LOCKED,
      S_FUTURE_CANCELLED,
    ]);
    const created = rows.filter((r) => !preserved.has(r.id));
    expect(created).toHaveLength(secondRun.createdSessions);
    // 새로 만든 수업은 전부 오늘 이후 — 과거를 다시 쓰지 않는다
    for (const r of created) expect(r.session_date >= today).toBe(true);
  });
});
