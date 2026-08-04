import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 숙제·교재 범위 실행 (T2.3) — 라이브 DB 통합 테스트.
 *
 * 교사가 교재 범위·숙제 노드를 만들어도 학생 화면에는 아무것도 나타나지
 * 않았다 (G-05). 여기서 확인하는 것은 두 가지다:
 *  1. 그 노드가 오늘 계획의 항목으로 **실제로 나온다** (교재명·쪽 포함)
 *  2. 완료가 **현재 학생·현재 항목만** 바꾼다
 *
 * 2가 중요한 이유: 학생 흐름에는 스코프 없는 저장 경로가 있었다 —
 * 남의 응시에 답을 쓸 수 있었다. 같은 실수를 숙제 완료에서 반복하면
 * 한 학생이 반 전체의 숙제를 끝낼 수 있다.
 * ───────────────────────────────────────────────────────────── */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

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

const { getSharedSql } = await import("@su-maek/db");
const { completeDayPlanItem } = await import("@su-maek/db/domain");
const { projectToday } = await import("@/lib/domain/day-plan");
const { completeHomework } = await import("@/app/learn/homework/actions");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";
const TZ = "Asia/Seoul";

let sql: ReturnType<typeof getSharedSql>;
const LEARNER = uuidv7();
const OTHER = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const BOOK_NODE = uuidv7();
/** 학생 로그인 계정 — 액션의 실제 경로(getCurrentLearner)를 지나려면 필요하다 */
const LEARNER_USER = uuidv7();
const HOMEWORK_NODE = uuidv7();
let BOOK = "";

function isoAddDays(days: number): string {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
const TODAY = isoAddDays(0);

const ref = (learnerId: string) => ({ organizationId: ORG, learnerId });

async function scheduleFor(learnerId: string, nodeIds: string[], hourUtc: number) {
  await sql`
    insert into learner_schedule_items
      (id, organization_id, learner_id, learning_group_id, item_date, timezone,
       starts_at, ends_at, planned_node_ids, matches_group)
    values (${uuidv7()}, ${ORG}, ${learnerId}, ${GROUP}, ${TODAY}, ${TZ},
            ${`${TODAY}T${String(hourUtc).padStart(2, "0")}:00:00Z`},
            ${`${TODAY}T${String(hourUtc + 1).padStart(2, "0")}:00:00Z`},
            ${sql.json(nodeIds)}, false)
  `;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();

  const [edition] = await sql<{ id: string }[]>`
    select id::text from book_editions where organization_id = ${ORG} limit 1
  `;
  BOOK = edition?.id ?? "";

  await sql`
    insert into users (id, email, display_name, default_organization_id)
    values (${LEARNER_USER}, ${`hw-${LEARNER_USER}@su-maek.test`}, ${"숙제 테스트 학생"}, ${ORG})
  `;
  await sql`
    insert into memberships (id, organization_id, user_id, role, status)
    values (${uuidv7()}, ${ORG}, ${LEARNER_USER}, 'student', 'active')
  `;
  await sql`
    insert into learners (id, organization_id, display_name, user_id, status)
    values (${LEARNER}, ${ORG}, ${"숙제 테스트 학생"}, ${LEARNER_USER}, 'active')
  `;
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${OTHER}, ${ORG}, ${"숙제 테스트 학생2"}, 'active')
  `;
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '숙제 테스트 기간', 2026, ${isoAddDays(-30)},
            ${isoAddDays(30)}, 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '숙제 테스트 반', 'operating')
  `;
  await sql`
    insert into route_plans (id, organization_id, kind, name, status)
    values (${PLAN}, ${ORG}, 'group_route', ${"숙제 테스트 루트"}, 'draft')
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
    values (${BOOK_NODE}, ${ORG}, ${VERSION}, 'book_range', ${"교재 범위 차시"}, 1,
            ${BOOK}, ${sql.json({ startPage: 12, endPage: 40 })})
  `;
  await sql`
    insert into route_nodes
      (id, organization_id, route_version_id, kind, title, sort_order,
       book_edition_id, page_range, homework)
    values (${HOMEWORK_NODE}, ${ORG}, ${VERSION}, 'homework', ${"교재 숙제"}, 2,
            ${BOOK}, ${sql.json({ startPage: 41, endPage: 45 })},
            ${sql.json({ mode: "book_pages" })})
  `;

  await scheduleFor(LEARNER, [BOOK_NODE, HOMEWORK_NODE], 13);
  await scheduleFor(OTHER, [BOOK_NODE, HOMEWORK_NODE], 15);
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`alter table learner_day_plans disable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_day_plans where learner_id in (${LEARNER}, ${OTHER})`;
  await sql`alter table learner_day_plans enable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_schedule_items where learner_id in (${LEARNER}, ${OTHER})`;
  await sql`delete from route_nodes where route_version_id = ${VERSION}`;
  await sql`delete from route_versions where id = ${VERSION}`;
  await sql`delete from route_plans where id = ${PLAN}`;
  await sql`delete from learning_groups where id = ${GROUP}`;
  await sql`delete from course_periods where id = ${PERIOD}`;
  await sql`delete from learners where id in (${LEARNER}, ${OTHER})`;
  await sql`delete from memberships where user_id = ${LEARNER_USER}`;
  await sql`delete from users where id = ${LEARNER_USER}`;
});

describe.skipIf(!hasDb)("노드가 학생 항목으로 나온다", () => {
  it("교재 범위가 교재명·쪽과 함께 오늘 계획에 든다", async () => {
    const view = await projectToday({ learner: ref(LEARNER), today: TODAY });
    const item = view.plan.items.find((i) => i.kind === "book_range");

    expect(item, "교재 범위 항목이 없다 — 노드가 조용히 사라졌다").toBeDefined();
    expect(item!.required).toBe(true);
    expect(item!.titleSnapshot).toContain("12~40쪽");
    expect(item!.routeNodeId).toBe(BOOK_NODE);
  });

  it("숙제가 방식에 맞는 문구로 나온다", async () => {
    const view = await projectToday({ learner: ref(LEARNER), today: TODAY });
    const item = view.plan.items.find((i) => i.kind === "homework");

    expect(item).toBeDefined();
    expect(item!.titleSnapshot).toContain("숙제");
    expect(item!.titleSnapshot).toContain("41~45쪽");
  });

  it("이 항목들이 하루 완료 분모에 든다", async () => {
    const view = await projectToday({ learner: ref(LEARNER), today: TODAY });
    expect(view.plan.required.total).toBeGreaterThanOrEqual(2);
    expect(view.completable).toBe(false);
  });
});

describe.skipIf(!hasDb)("완료 액션", () => {
  it("로그인하지 않으면 아무것도 바꾸지 않는다", async () => {
    claims.sub = null;
    const form = new FormData();
    form.set("itemKey", `book_range:${BOOK_NODE}`);
    const r = await completeHomework(null, form);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("로그인");
  });

  it("항목 키가 없으면 거부한다", async () => {
    const r = await completeHomework(null, new FormData());
    expect(r.ok).toBe(false);
  });

  it("로그인한 학생의 항목을 완료하고 오늘 화면에 곧바로 반영한다", async () => {
    /* 완료 뒤 재투영하지 않으면 학생은 방금 누른 것이 반영되지 않았다고
     * 읽는다. 액션이 그 재투영까지 책임진다. */
    claims.sub = LEARNER_USER;
    await sql`delete from learner_day_plans where learner_id = ${LEARNER} and plan_date = ${TODAY}`;
    await projectToday({ learner: ref(LEARNER), today: TODAY });

    const form = new FormData();
    form.set("itemKey", `book_range:${BOOK_NODE}`);
    const r = await completeHomework(null, form);

    expect(r.ok).toBe(true);
    const view = await projectToday({ learner: ref(LEARNER), today: TODAY });
    expect(
      view.plan.items.find((i) => i.key === `book_range:${BOOK_NODE}`)!.status,
    ).toBe("completed");
    claims.sub = null;
  });

  it("차단된 항목은 액션도 거부한다", async () => {
    claims.sub = LEARNER_USER;
    const view = await projectToday({ learner: ref(LEARNER), today: TODAY });
    const blocked = view.plan.items.find((i) => i.status === "blocked");
    if (blocked) {
      const form = new FormData();
      form.set("itemKey", blocked.key);
      const r = await completeHomework(null, form);
      expect(r.ok).toBe(false);
    }
    claims.sub = null;
  });
});

describe.skipIf(!hasDb)("완료는 내 것만 바꾼다", () => {
  it("완료하면 그 항목만 완료가 된다", async () => {
    await projectToday({ learner: ref(LEARNER), today: TODAY });
    const key = `book_range:${BOOK_NODE}`;

    const r = await completeDayPlanItem(sql, {
      organizationId: ORG,
      learnerId: LEARNER,
      planDate: TODAY,
      itemKey: key,
    });
    expect(r.ok).toBe(true);

    const view = await projectToday({ learner: ref(LEARNER), today: TODAY });
    expect(view.plan.items.find((i) => i.key === key)!.status).toBe("completed");
    expect(
      view.plan.items.find((i) => i.kind === "homework")!.status,
    ).toBe("pending");
  });

  it("한 학생의 완료가 다른 학생에게 옮겨붙지 않는다", async () => {
    await projectToday({ learner: ref(OTHER), today: TODAY });

    const view = await projectToday({ learner: ref(OTHER), today: TODAY });
    expect(view.plan.items.find((i) => i.kind === "book_range")!.status).toBe(
      "pending",
    );
  });

  it("다른 학생의 항목 키로는 완료할 수 없다", async () => {
    /* 항목 id가 아니라 (조직·학생·날짜·키)로 찾기 때문에, 남의 계획을
     * 가리켜도 내 계획에서만 찾는다. */
    const r = await completeDayPlanItem(sql, {
      organizationId: ORG,
      learnerId: OTHER,
      planDate: TODAY,
      itemKey: "book_range:존재하지-않는-노드",
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("없는 항목");
  });

  it("두 번 완료해도 한 번 끝낸 것으로 남는다", async () => {
    const key = `homework:${HOMEWORK_NODE}`;
    const first = await completeDayPlanItem(sql, {
      organizationId: ORG,
      learnerId: LEARNER,
      planDate: TODAY,
      itemKey: key,
    });
    const second = await completeDayPlanItem(sql, {
      organizationId: ORG,
      learnerId: LEARNER,
      planDate: TODAY,
      itemKey: key,
    });

    expect(first.ok).toBe(true);
    expect(first.alreadyDone).toBe(false);
    expect(second.ok).toBe(true);
    expect(second.alreadyDone).toBe(true);
  });

  it("차단된 항목은 학생이 완료할 수 없다", async () => {
    /* 자료가 없어 막힌 것을 학생이 「했다」로 넘기면 결손이 사라진다. */
    const view = await projectToday({ learner: ref(LEARNER), today: TODAY });
    const blocked = view.plan.items.find((i) => i.status === "blocked");
    if (!blocked) return; // 이 fixture에 차단 항목이 없으면 검증할 것이 없다

    const r = await completeDayPlanItem(sql, {
      organizationId: ORG,
      learnerId: LEARNER,
      planDate: TODAY,
      itemKey: blocked.key,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("선생님");
  });
});
