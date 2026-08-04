import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../src/client";
import { closeSession } from "../src/domain/session-execution";
import { materializeGroupSchedule } from "../src/domain/schedule";
import type { IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 못 나간 진도가 다시 잡히는가 (T4.3) — 라이브 DB.
 *
 * 순수 판정은 `packages/core/test/scheduling/adaptive-plan.test.ts`가 본다.
 * 여기서 보는 것은 그 판정이 **실제 일정까지 닿는가**이다.
 *
 * 예전 파생은 수업 단위였다: 수업이 completed면 planned 노드를 전부 완료로
 * 셌다. 그래서 교사가 「못 나감」이라고 적어도 그 노드는 완료로 굳어 다시는
 * 배치되지 않는다 — 마감을 정직하게 적을수록 진도가 사라진다. 그 한 줄을
 * 여기서 잡는다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000043001";
const TEACHER = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const NODE_A = uuidv7();
const NODE_B = uuidv7();
const PAST_SESSION = uuidv7();

function isoAddDays(days: number): string {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
const TODAY = isoAddDays(0) as IsoDate;
const YESTERDAY = isoAddDays(-1);

async function futureNodeIds(): Promise<string[]> {
  const rows = await sql<{ planned_node_ids: unknown }[]>`
    select planned_node_ids from sessions
    where learning_group_id = ${GROUP} and session_date >= ${TODAY}::date
      and status <> 'cancelled'
  `;
  return rows.flatMap((r) =>
    Array.isArray(r.planned_node_ids) ? (r.planned_node_ids as string[]) : [],
  );
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = createSql();
  await sql`
    insert into organizations (id, name, slug, timezone)
    values (${ORG}, 'ITEST 재계획', 'itest-adaptive', ${TZ})
    on conflict (id) do nothing
  `;
  await sql`
    insert into users (id, email, display_name, default_organization_id)
    values (${TEACHER}, ${`ad-${TEACHER}@su-maek.test`}, '재계획 교사', ${ORG})
    on conflict (id) do nothing
  `;
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '재계획 기간', 2026, ${isoAddDays(-30)},
            ${isoAddDays(60)}, 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '재계획 테스트반', 'operating')
  `;
  /* 수업 슬롯 — 매일 잡아 둔다. 요일에 걸려 배치가 안 되면 이 테스트가
   * 「진도가 안 잡힌다」를 잘못된 이유로 통과시킨다. */
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await sql`
      insert into calendar_rules
        (id, organization_id, subject_type, subject_id, weekday, start_time,
         end_time, effective_from)
      values (${uuidv7()}, ${ORG}, 'learning_group', ${GROUP}, ${weekday},
              '16:00', '18:00', ${isoAddDays(-30)})
    `;
  }
  await sql`
    insert into route_plans (id, organization_id, kind, name, status, learning_group_id,
                             active_version_id)
    values (${PLAN}, ${ORG}, 'group_route', '재계획 루트', 'published', ${GROUP},
            ${VERSION})
  `;
  await sql`
    insert into route_versions
      (id, organization_id, route_plan_id, version_number, status, published_at)
    values (${VERSION}, ${ORG}, ${PLAN}, 1, 'published', now())
  `;
  for (const [id, order, title] of [
    [NODE_A, 1, "1강 소인수분해"],
    [NODE_B, 2, "2강 최대공약수"],
  ] as const) {
    await sql`
      insert into route_nodes
        (id, organization_id, route_version_id, kind, title, sort_order,
         expected_minutes)
      values (${id}, ${ORG}, ${VERSION}, 'concept_lesson', ${title}, ${order}, 60)
    `;
  }
  /* 어제 수업에서 A·B를 다루기로 했다 */
  await sql`
    insert into sessions (
      id, organization_id, learning_group_id, session_date, timezone,
      starts_at, ends_at, status, planned_node_ids)
    values (${PAST_SESSION}, ${ORG}, ${GROUP}, ${YESTERDAY}::date, ${TZ},
            ${`${YESTERDAY}T07:00:00Z`}, ${`${YESTERDAY}T09:00:00Z`},
            'planned', ${sql.json([NODE_A, NODE_B])})
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`delete from outbox_events where organization_id = ${ORG}`;
  await sql`alter table progress_events disable trigger progress_events_immutable`;
  await sql`delete from progress_events where organization_id = ${ORG}`;
  await sql`alter table progress_events enable trigger progress_events_immutable`;
  await sql`delete from sessions where learning_group_id = ${GROUP}`;
  await sql`delete from schedule_revisions where scope_id = ${GROUP}`;
  await sql`delete from schedule_change_proposals where scope_id = ${GROUP}`;
  await sql`delete from calendar_rules where subject_id = ${GROUP}`;
  await sql`delete from route_nodes where route_version_id = ${VERSION}`;
  await sql`update route_plans set active_version_id = null where id = ${PLAN}`;
  await sql`delete from route_versions where id = ${VERSION}`;
  await sql`delete from route_plans where id = ${PLAN}`;
  await sql`delete from learning_groups where id = ${GROUP}`;
  await sql`delete from course_periods where id = ${PERIOD}`;
  await sql`delete from users where id = ${TEACHER}`;
  await sql.end();
});

describe.skipIf(!hasDb)("못 나간 진도가 다음 일정으로 이월된다", () => {
  it("교사가 「못 나감」이라 적은 노드는 다시 배치되고, 다 나간 노드는 아니다", async () => {
    const closed = await closeSession(sql, {
      organizationId: ORG,
      sessionId: PAST_SESSION,
      actorUserId: TEACHER,
      nodeProgress: { [NODE_A]: "completed", [NODE_B]: "skipped" },
      note: "시간이 모자랐다",
    });
    expect(closed.ok).toBe(true);
    expect(closed.coverage).toBe("partial");

    const run = await materializeGroupSchedule({
      organizationId: ORG,
      learningGroupId: GROUP,
      actorUserId: TEACHER,
      today: TODAY,
    });
    expect(run.ok, JSON.stringify(run)).toBe(true);

    const future = await futureNodeIds();
    /* B는 못 나갔으므로 다시 잡혀야 한다. 예전 파생이라면 어제 수업이
     * completed라는 이유로 B까지 완료로 세어 영영 사라졌다. */
    expect(future).toContain(NODE_B);
    /* A는 다 나갔으므로 다시 잡히지 않는다 — 반이 같은 곳을 맴돌지 않게 */
    expect(future).not.toContain(NODE_A);
  });

  it("지난 수업 기록은 재계산이 건드리지 않는다", async () => {
    const [past] = await sql<{ status: string; planned_node_ids: unknown }[]>`
      select status::text as status, planned_node_ids from sessions
      where id = ${PAST_SESSION}
    `;
    expect(past!.status).toBe("completed");
    expect(past!.planned_node_ids).toEqual([NODE_A, NODE_B]);
  });

  it("마감 기록이 없는 완료 수업은 예전 규칙을 그대로 쓴다", async () => {
    /* T4.2 이전에 만들어진 완료 수업에는 노드별 기록이 없다. 기록이 없다고
     * 이미 지나간 진도를 되돌리면 반이 지난 단원부터 다시 나간다. */
    const legacy = uuidv7();
    const legacyNode = uuidv7();
    await sql`
      insert into route_nodes
        (id, organization_id, route_version_id, kind, title, sort_order, expected_minutes)
      values (${legacyNode}, ${ORG}, ${VERSION}, 'concept_lesson', '0강 도입', 0, 60)
    `;
    await sql`
      insert into sessions (
        id, organization_id, learning_group_id, session_date, timezone,
        starts_at, ends_at, status, planned_node_ids)
      values (${legacy}, ${ORG}, ${GROUP}, ${isoAddDays(-3)}::date, ${TZ},
              ${`${isoAddDays(-3)}T07:00:00Z`}, ${`${isoAddDays(-3)}T09:00:00Z`},
              'completed', ${sql.json([legacyNode])})
    `;

    await materializeGroupSchedule({
      organizationId: ORG,
      learningGroupId: GROUP,
      actorUserId: TEACHER,
      today: TODAY,
    });

    expect(await futureNodeIds()).not.toContain(legacyNode);
  });
});
