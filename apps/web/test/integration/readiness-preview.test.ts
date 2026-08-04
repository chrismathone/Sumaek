import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 미리보기가 진짜 미리보기인가 (T5.4) — 라이브 DB.
 *
 * 인수 조건 둘은 말로 보장할 수 없다:
 *   「preview가 학생 진도나 응시를 생성하지 않음」
 *   「실제 학생 화면과 항목 순서·문구가 동일함」
 *
 * 전자는 계획 행이 생기지 않는지 세어 보면 되고, 후자는 **같은 학생·같은
 * 날짜를 두 번 투영해** 항목이 글자까지 같은지 보면 된다. 두 벌의 렌더러가
 * 각자 문구를 만들면 그 순간 「미리 본 화면」과 「학생이 보는 화면」이
 * 갈리고, 교사는 자기가 확인한 것과 다른 화면을 학생이 본다.
 * ───────────────────────────────────────────────────────────── */

const { getSharedSql } = await import("@su-maek/db");
const { projectToday } = await import("@/lib/domain/day-plan");
const { buildPreviewRow } = await import("@/lib/domain/readiness-preview");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";
const TZ = "Asia/Seoul";

let sql: ReturnType<typeof getSharedSql>;
const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const BOOK_NODE = uuidv7();
const LEARNER = uuidv7();
let BOOK = "";

function isoAddDays(days: number): string {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
const TODAY = isoAddDays(0);

async function planRowCount(): Promise<number> {
  const [row] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from learner_day_plans
    where learner_id = ${LEARNER} and plan_date = ${TODAY}::date
  `;
  return row!.cnt;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();
  const [edition] = await sql<{ id: string }[]>`
    select id::text from book_editions where organization_id = ${ORG} limit 1
  `;
  BOOK = edition?.id ?? "";

  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '미리보기 기간', 2026, ${isoAddDays(-30)},
            ${isoAddDays(30)}, 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '미리보기 반', 'operating')
  `;
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${LEARNER}, ${ORG}, '미리보기 학생', 'active')
  `;
  await sql`
    insert into learning_group_memberships
      (id, organization_id, learning_group_id, learner_id, status, joined_on)
    values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER}, 'active', ${isoAddDays(-30)})
  `;
  await sql`
    insert into route_plans (id, organization_id, kind, name, status)
    values (${PLAN}, ${ORG}, 'group_route', '미리보기 루트', 'draft')
  `;
  await sql`
    insert into route_versions
      (id, organization_id, route_plan_id, version_number, status)
    values (${VERSION}, ${ORG}, ${PLAN}, 1, 'draft')
  `;
  await sql`
    insert into route_nodes
      (id, organization_id, route_version_id, kind, title, sort_order,
       book_edition_id, page_range)
    values (${BOOK_NODE}, ${ORG}, ${VERSION}, 'book_range', '미리보기 교재 범위', 1,
            ${BOOK}, ${sql.json({ startPage: 10, endPage: 20 })})
  `;
  await sql`
    insert into learner_schedule_items
      (id, organization_id, learner_id, learning_group_id, item_date, timezone,
       starts_at, ends_at, planned_node_ids, matches_group)
    values (${uuidv7()}, ${ORG}, ${LEARNER}, ${GROUP}, ${TODAY}, ${TZ},
            ${`${TODAY}T13:00:00Z`}, ${`${TODAY}T14:00:00Z`},
            ${sql.json([BOOK_NODE])}, false)
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`alter table learner_day_plans disable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_day_plans where learner_id = ${LEARNER}`;
  await sql`alter table learner_day_plans enable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_schedule_items where learner_id = ${LEARNER}`;
  await sql`delete from learning_group_memberships where learner_id = ${LEARNER}`;
  await sql`delete from learners where id = ${LEARNER}`;
  await sql`delete from route_nodes where route_version_id = ${VERSION}`;
  await sql`delete from route_versions where id = ${VERSION}`;
  await sql`delete from route_plans where id = ${PLAN}`;
  await sql`delete from learning_groups where id = ${GROUP}`;
  await sql`delete from course_periods where id = ${PERIOD}`;
});

describe.skipIf(!hasDb)("미리보기는 아무것도 만들지 않는다", () => {
  it("계획 행이 생기지 않는다", async () => {
    expect(await planRowCount()).toBe(0);

    const preview = await projectToday({
      learner: { organizationId: ORG, learnerId: LEARNER },
      today: TODAY,
      persist: false,
    });

    expect(preview.planId).toBeNull();
    expect(preview.completedAt).toBeNull();
    /* 여기서 계획이 생기면 확정 시점이 **교사가 미리 본 순간**이 된다.
     * 그 순간의 자료 상태로 필수 분모가 굳고, 학생이 접속하기 전에 하루가
     * 확정된다 (ADR-0017 §4의 스냅샷 시점이 어긋난다). */
    expect(await planRowCount()).toBe(0);
  });

  it("여러 번 미리 봐도 그대로다", async () => {
    for (let i = 0; i < 3; i += 1) {
      await projectToday({
        learner: { organizationId: ORG, learnerId: LEARNER },
        today: TODAY,
        persist: false,
      });
    }
    expect(await planRowCount()).toBe(0);
  });
});

describe.skipIf(!hasDb)("미리보기와 실제 화면이 같은 것을 낸다", () => {
  it("항목 키·제목·순서가 글자까지 같다", async () => {
    /* 두 벌의 렌더러가 각자 문구를 만들면 교사가 확인한 화면과 학생이 보는
     * 화면이 갈린다. 같은 투영기를 쓰는지 여기서 못 박는다. */
    const preview = await projectToday({
      learner: { organizationId: ORG, learnerId: LEARNER },
      today: TODAY,
      persist: false,
    });
    const real = await projectToday({
      learner: { organizationId: ORG, learnerId: LEARNER },
      today: TODAY,
    });

    const shape = (p: typeof preview) =>
      p.plan.items.map((i) => `${i.ordinal}|${i.key}|${i.titleSnapshot}|${i.required}`);

    expect(shape(preview)).toEqual(shape(real));
    expect(preview.plan.status).toBe(real.plan.status);
    expect(preview.plan.required.total).toBe(real.plan.required.total);
    /* 실제 경로는 계획을 남긴다 — 그 차이가 유일한 차이여야 한다 */
    expect(real.planId).not.toBeNull();
  });

  it("미리보기 판정이 그 계획을 그대로 읽는다", async () => {
    const preview = await projectToday({
      learner: { organizationId: ORG, learnerId: LEARNER },
      today: TODAY,
      persist: false,
    });

    const row = buildPreviewRow({
      learnerId: LEARNER,
      displayName: "미리보기 학생",
      hasAccount: false,
      plan: {
        status: preview.plan.status,
        requiredTotal: preview.plan.required.total,
        requiredSatisfied: preview.plan.required.satisfied,
        blockedReasons: preview.plan.blockedReasons,
        itemCount: preview.plan.items.length,
      },
    });

    /* 계정이 없는 학생이다 — 자료가 다 있어도 로그인할 수 없다 */
    expect(row.status).toBe("no_account");
    expect(row.ready).toBe(false);
    expect(row.blockers.map((b) => b.code)).toContain("account_unlinked");
  });
});
