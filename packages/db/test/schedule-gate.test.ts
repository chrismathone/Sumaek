import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../src/client";
import { materializeGroupSchedule } from "../src/domain/schedule";
import type { IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 일정 리비전 검증 게이트 (인수 22) — 라이브 DB 통합 테스트.
 *
 * 배치 불가 충돌이 생기면: 세션을 하나도 바꾸지 않고, 이전 활성
 * 리비전을 유지하며, 실패한 변경안만 기록한다.
 *
 * 고정 ID 픽스처로 멱등 — 조직·구조 행은 재사용하고 (audit_events가
 * append-only라 조직을 지울 수 없다), 운영 행만 실행마다 정리한다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
/* 연결은 beforeAll에서 만든다 — 모듈 최상단에서 createSql()을 부르면
 * DATABASE_URL이 없을 때 skipIf 판정 전에 던져 수집 단계가 통째로 깨진다
 * (skip이 아니라 FAIL로 보고된다). */
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000220001";
const PERIOD = "ffffffff-0000-7000-8000-000000220002";
const GROUP_BLOCKED = "ffffffff-0000-7000-8000-000000220003"; // 배치 불가 전용
const GROUP_OK = "ffffffff-0000-7000-8000-000000220004"; // 성공 후 실패 검증용
const PLAN_BLOCKED = "ffffffff-0000-7000-8000-000000220005";
const PLAN_OK = "ffffffff-0000-7000-8000-000000220006";
const VERSION_BLOCKED = "ffffffff-0000-7000-8000-000000220007";
const VERSION_OK = "ffffffff-0000-7000-8000-000000220008";
const NODE_BLOCKED = "ffffffff-0000-7000-8000-000000220009";
const NODE_OK_1 = "ffffffff-0000-7000-8000-00000022000a";
const RULE_BLOCKED = "ffffffff-0000-7000-8000-00000022000b";
const RULE_OK = "ffffffff-0000-7000-8000-00000022000c";
const EVENT_CANCEL_ALL = "ffffffff-0000-7000-8000-00000022000d";

function todayIso(): IsoDate {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }) as IsoDate;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOfIso(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

async function cleanupOperationalRows(): Promise<void> {
  await sql`delete from sessions where organization_id = ${ORG}`;
  await sql`delete from schedule_change_proposals where organization_id = ${ORG}`;
  await sql`delete from schedule_revisions where organization_id = ${ORG}`;
  await sql`delete from learning_availability_events where organization_id = ${ORG}`;
}

describe.skipIf(!hasDb)("일정 검증 게이트 (인수 22)", () => {
  const today = todayIso();
  // 기간: 오늘부터 12일 — 시야가 좁아 배치 실패를 만들기 쉽다
  const periodEnd = addDaysIso(today, 12);
  // 배치 불가 규칙: 기간 안에 존재하지 않는… 대신 "휴일이 전 기간을 덮는"
  // 방식이 아니라, effective_from을 기간 뒤로 두어 가용 슬롯 0을 만든다
  const blockedEffectiveFrom = addDaysIso(today, 30);
  // 성공 규칙: 내일 요일 — 기간 안에 최소 1~2회 발생
  const okWeekday = weekdayOfIso(addDaysIso(today, 1));

  beforeAll(async () => {
    sql = createSql();
    await cleanupOperationalRows();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 일정 게이트', 'itest-schedule-gate', ${TZ})
      on conflict (id) do nothing
    `;
    await sql`
      insert into course_periods (id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026, ${today}, ${periodEnd}, 'active')
      on conflict (id) do update set starts_on = ${today}, ends_on = ${periodEnd}
    `;
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values
        (${GROUP_BLOCKED}, ${ORG}, ${PERIOD}, 'ITEST 배치불가반', 'operating'),
        (${GROUP_OK}, ${ORG}, ${PERIOD}, 'ITEST 정상반', 'operating')
      on conflict (id) do nothing
    `;
    await sql`
      insert into calendar_rules (id, organization_id, subject_type, subject_id, weekday, start_time, end_time, effective_from)
      values
        (${RULE_BLOCKED}, ${ORG}, 'learning_group', ${GROUP_BLOCKED}, 1, '16:00', '18:00', ${blockedEffectiveFrom}),
        (${RULE_OK}, ${ORG}, 'learning_group', ${GROUP_OK}, ${okWeekday}, '16:00', '18:00', ${today})
      on conflict (id) do update set weekday = excluded.weekday, effective_from = excluded.effective_from
    `;
    await sql`
      insert into route_plans (id, organization_id, kind, name, learning_group_id, course_period_id, status, active_version_id)
      values
        (${PLAN_BLOCKED}, ${ORG}, 'group_route', 'ITEST 배치불가 루트', ${GROUP_BLOCKED}, ${PERIOD}, 'published', ${VERSION_BLOCKED}),
        (${PLAN_OK}, ${ORG}, 'group_route', 'ITEST 정상 루트', ${GROUP_OK}, ${PERIOD}, 'published', ${VERSION_OK})
      on conflict (id) do nothing
    `;
    await sql`
      insert into route_versions (id, organization_id, route_plan_id, version_number, status)
      values
        (${VERSION_BLOCKED}, ${ORG}, ${PLAN_BLOCKED}, 1, 'published'),
        (${VERSION_OK}, ${ORG}, ${PLAN_OK}, 1, 'published')
      on conflict (id) do nothing
    `;
    await sql`
      insert into route_nodes (id, organization_id, route_version_id, kind, title, sort_order, expected_minutes)
      values
        (${NODE_BLOCKED}, ${ORG}, ${VERSION_BLOCKED}, 'concept_lesson', 'ITEST 노드', 1, 60),
        (${NODE_OK_1}, ${ORG}, ${VERSION_OK}, 'concept_lesson', 'ITEST 노드 1', 1, 60)
      on conflict (id) do nothing
    `;
  });

  afterAll(async () => {
    await cleanupOperationalRows();
    await sql.end({ timeout: 5 });
  });

  it("가용 슬롯이 없으면 세션 0건·리비전 0건·실패 변경안만 기록한다", async () => {
    const result = await materializeGroupSchedule({
      organizationId: ORG,
      learningGroupId: GROUP_BLOCKED,
      actorUserId: null,
      timezone: TZ,
      today,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("배치 불가");
    expect(result.message).toContain("기존 일정을 유지");
    expect(result.createdSessions).toBe(0);

    const sessions = await sql<{ id: string }[]>`
      select id from sessions where learning_group_id = ${GROUP_BLOCKED}
    `;
    expect(sessions).toHaveLength(0);

    const revisions = await sql<{ id: string }[]>`
      select id from schedule_revisions
      where scope_type = 'learning_group' and scope_id = ${GROUP_BLOCKED}
    `;
    expect(revisions).toHaveLength(0);

    const proposals = await sql<{ status: string; failure_reason: string }[]>`
      select status, failure_reason from schedule_change_proposals
      where scope_type = 'learning_group' and scope_id = ${GROUP_BLOCKED}
    `;
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.status).toBe("failed");
    expect(proposals[0]!.failure_reason).toContain("이전 활성 리비전 유지");
  });

  it("성공한 일정 위에 검증 실패가 와도 이전 리비전·세션이 유지된다", async () => {
    // 1) 정상 실체화 — 활성 리비전 r1
    const first = await materializeGroupSchedule({
      organizationId: ORG,
      learningGroupId: GROUP_OK,
      actorUserId: null,
      timezone: TZ,
      today,
    });
    expect(first.ok).toBe(true);
    expect(first.createdSessions).toBeGreaterThan(0);

    const [activeBefore] = await sql<{ id: string }[]>`
      select id from schedule_revisions
      where scope_type = 'learning_group' and scope_id = ${GROUP_OK} and is_active = true
    `;
    expect(activeBefore).toBeDefined();
    const sessionsBefore = await sql<{ id: string; session_date: string }[]>`
      select id, session_date::text as session_date from sessions
      where learning_group_id = ${GROUP_OK} order by session_date
    `;

    // 2) 전 기간 휴강 — 모든 슬롯이 사라져 배치 불가
    await sql`
      insert into learning_availability_events (
        id, organization_id, kind, learning_group_id, starts_on, ends_on, source, status
      ) values (
        ${EVENT_CANCEL_ALL}, ${ORG}, 'group_cancelled', ${GROUP_OK},
        ${today}, ${periodEnd}, 'manual', 'received'
      )
      on conflict (id) do nothing
    `;

    const second = await materializeGroupSchedule({
      organizationId: ORG,
      learningGroupId: GROUP_OK,
      actorUserId: null,
      timezone: TZ,
      today,
    });
    expect(second.ok).toBe(false);
    expect(second.message).toContain("기존 일정을 유지");

    // 3) 이전 활성 리비전·세션 불변 (인수 22의 핵심)
    const [activeAfter] = await sql<{ id: string }[]>`
      select id from schedule_revisions
      where scope_type = 'learning_group' and scope_id = ${GROUP_OK} and is_active = true
    `;
    expect(activeAfter?.id).toBe(activeBefore!.id);

    const sessionsAfter = await sql<{ id: string; session_date: string }[]>`
      select id, session_date::text as session_date from sessions
      where learning_group_id = ${GROUP_OK} order by session_date
    `;
    expect(sessionsAfter).toEqual(sessionsBefore);

    // 휴강 이벤트는 소비되지 않은 채 남는다 (실패한 변경안에 매이지 않음)
    const [event] = await sql<{ status: string }[]>`
      select status from learning_availability_events where id = ${EVENT_CANCEL_ALL}
    `;
    expect(event!.status).toBe("received");
  });
});
