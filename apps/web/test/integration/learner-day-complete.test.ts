import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 하루 완료가 실제 학생 흐름에서 기록되는가 (T4.1 · G-02) — 라이브 DB.
 *
 * 저장소 단위 테스트(packages/db/test/learner-day-completion.test.ts)는
 * 명령 자체를 본다. 여기서 보는 것은 **누가 그 명령을 부르는가**이다.
 *
 * 완료를 화면마다 부르면 부르는 곳이 여섯이 되고, 한 곳을 빠뜨리면 그
 * 경로로 하루를 끝낸 학생만 영영 미완료로 남는다 — 그리고 그 학생은
 * 화면에 「다 마쳤습니다」가 떠 있으므로 아무도 눈치채지 못한다. 그래서
 * 재투영 한 곳에서만 부른다. 항목 상태를 바꿀 수 있는 경로는 결국 전부
 * 그 재투영을 지나기 때문이다.
 *
 * 겨누는 것:
 *   1) 마지막 필수를 끝내는 **액션 안에서** 기록이 남는다 — 학생이 오늘
 *      화면으로 돌아오지 않아도 된다
 *   2) 새로 고침을 반복해도 이벤트는 하나다 (I-22)
 *   3) 필수가 남았으면 기록되지 않는다
 *   4) payload가 진짜 오늘 노드를 담는다 — 단위 테스트의 fixture가 아니라
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
const { reopenLearnerDayAction } = await import(
  "@/app/app/students/[id]/actions"
);

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";
const TZ = "Asia/Seoul";

let sql: ReturnType<typeof getSharedSql>;
/** 하루를 끝낼 학생 */
const FINISHER = uuidv7();
const FINISHER_USER = uuidv7();
/** 완료를 취소하는 교사 */
const TEACHER_USER = uuidv7();
/** 하나를 남기는 학생 */
const HALFWAY = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const BOOK_NODE = uuidv7();
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
const BOOK_KEY = () => `book_range:${BOOK_NODE}`;
const HOMEWORK_KEY = () => `homework:${HOMEWORK_NODE}`;

async function scheduleFor(learnerId: string, hourUtc: number) {
  await sql`
    insert into learner_schedule_items
      (id, organization_id, learner_id, learning_group_id, item_date, timezone,
       starts_at, ends_at, planned_node_ids, matches_group)
    values (${uuidv7()}, ${ORG}, ${learnerId}, ${GROUP}, ${TODAY}, ${TZ},
            ${`${TODAY}T${String(hourUtc).padStart(2, "0")}:00:00Z`},
            ${`${TODAY}T${String(hourUtc + 1).padStart(2, "0")}:00:00Z`},
            ${sql.json([BOOK_NODE, HOMEWORK_NODE])}, false)
  `;
}

async function completionEvents(learnerId: string) {
  return sql<{ payload: Record<string, unknown> }[]>`
    select e.payload
    from outbox_events e
    join learner_day_plans p on p.id = e.aggregate_id
    where e.event_type = 'LearnerDayCompleted' and p.learner_id = ${learnerId}
  `;
}

async function completedAtOf(learnerId: string): Promise<string | null> {
  const [row] = await sql<{ completed_at: string | null }[]>`
    select completed_at::text from learner_day_plans
    where learner_id = ${learnerId} and plan_date = ${TODAY}::date
  `;
  return row?.completed_at ?? null;
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
    values (${FINISHER_USER}, ${`done-${FINISHER_USER}@su-maek.test`},
            ${"완주 테스트 학생"}, ${ORG})
  `;
  await sql`
    insert into memberships (id, organization_id, user_id, role, status)
    values (${uuidv7()}, ${ORG}, ${FINISHER_USER}, 'student', 'active')
  `;
  await sql`
    insert into learners (id, organization_id, display_name, user_id, status)
    values (${FINISHER}, ${ORG}, ${"완주 테스트 학생"}, ${FINISHER_USER}, 'active')
  `;
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${HALFWAY}, ${ORG}, ${"완주 테스트 학생2"}, 'active')
  `;
  await sql`
    insert into users (id, email, display_name, default_organization_id)
    values (${TEACHER_USER}, ${`t-${TEACHER_USER}@su-maek.test`},
            ${"완주 테스트 교사"}, ${ORG})
  `;
  await sql`
    insert into memberships (id, organization_id, user_id, role, status)
    values (${uuidv7()}, ${ORG}, ${TEACHER_USER}, 'teacher', 'active')
  `;
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '완주 테스트 기간', 2026, ${isoAddDays(-30)},
            ${isoAddDays(30)}, 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '완주 테스트 반', 'operating')
  `;
  await sql`
    insert into route_plans (id, organization_id, kind, name, status)
    values (${PLAN}, ${ORG}, 'group_route', ${"완주 테스트 루트"}, 'draft')
  `;
  await sql`
    insert into route_versions
      (id, organization_id, route_plan_id, version_number, status)
    values (${VERSION}, ${ORG}, ${PLAN}, 1, 'draft')
  `;
  /* 교재 범위·숙제만 쓴다 — 이 둘은 계획 자체가 유일한 진실이라 테스트가
   * 응시·자료 진도 테이블을 흉내 내지 않고도 하루를 끝낼 수 있다. */
  await sql`
    insert into route_nodes
      (id, organization_id, route_version_id, kind, title, sort_order,
       book_edition_id, page_range)
    values (${BOOK_NODE}, ${ORG}, ${VERSION}, 'book_range', ${"완주 교재 범위"}, 1,
            ${BOOK}, ${sql.json({ startPage: 12, endPage: 40 })})
  `;
  await sql`
    insert into route_nodes
      (id, organization_id, route_version_id, kind, title, sort_order,
       book_edition_id, page_range, homework)
    values (${HOMEWORK_NODE}, ${ORG}, ${VERSION}, 'homework', ${"완주 숙제"}, 2,
            ${BOOK}, ${sql.json({ startPage: 41, endPage: 45 })},
            ${sql.json({ mode: "book_pages" })})
  `;

  await scheduleFor(FINISHER, 13);
  await scheduleFor(HALFWAY, 15);
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`
    delete from outbox_events
    where event_type = 'LearnerDayCompleted'
      and aggregate_id in (
        select id from learner_day_plans where learner_id in (${FINISHER}, ${HALFWAY})
      )
  `;
  await sql`alter table learner_day_plans disable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_day_plans where learner_id in (${FINISHER}, ${HALFWAY})`;
  await sql`alter table learner_day_plans enable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_schedule_items where learner_id in (${FINISHER}, ${HALFWAY})`;
  await sql`delete from route_nodes where route_version_id = ${VERSION}`;
  await sql`delete from route_versions where id = ${VERSION}`;
  await sql`delete from route_plans where id = ${PLAN}`;
  await sql`delete from learning_groups where id = ${GROUP}`;
  await sql`delete from course_periods where id = ${PERIOD}`;
  await sql`delete from learners where id in (${FINISHER}, ${HALFWAY})`;
  await sql`delete from memberships where user_id in (${FINISHER_USER}, ${TEACHER_USER})`;
  await sql`delete from users where id in (${FINISHER_USER}, ${TEACHER_USER})`;
});

describe.skipIf(!hasDb)("하루 완료가 학생 흐름에서 기록된다", () => {
  it("마지막 필수를 끝내는 액션 안에서 기록이 남는다", async () => {
    claims.sub = FINISHER_USER;
    await projectToday({ learner: ref(FINISHER), today: TODAY });
    expect(await completedAtOf(FINISHER)).toBeNull();

    const first = new FormData();
    first.set("itemKey", BOOK_KEY());
    expect((await completeHomework(null, first)).ok).toBe(true);
    /* 아직 하나 남았다 — 여기서 기록되면 「전부 마쳤다」의 뜻이 무너진다 */
    expect(await completedAtOf(FINISHER)).toBeNull();

    const second = new FormData();
    second.set("itemKey", HOMEWORK_KEY());
    expect((await completeHomework(null, second)).ok).toBe(true);

    /* 학생이 오늘 화면으로 돌아오지 않아도 이미 기록돼 있어야 한다.
     * 돌아와야 기록된다면, 숙제만 하고 브라우저를 닫은 학생의 하루는
     * 교사 현황판에서 영영 미완료다. */
    expect(await completedAtOf(FINISHER)).not.toBeNull();
    claims.sub = null;
  });

  it("새로 고침을 반복해도 이벤트는 하나다", async () => {
    const view = await projectToday({ learner: ref(FINISHER), today: TODAY });
    await projectToday({ learner: ref(FINISHER), today: TODAY });
    await projectToday({ learner: ref(FINISHER), today: TODAY });

    expect(view.completedAt).not.toBeNull();
    expect(await completionEvents(FINISHER)).toHaveLength(1);
  });

  it("완료 시각은 재투영해도 흔들리지 않는다", async () => {
    const before = await completedAtOf(FINISHER);
    await projectToday({ learner: ref(FINISHER), today: TODAY });
    expect(await completedAtOf(FINISHER)).toBe(before);
  });

  it("payload가 진짜 오늘 노드를 담는다", async () => {
    const [event] = await completionEvents(FINISHER);
    const p = event!.payload as Record<string, unknown>;

    expect(p.learnerId).toBe(FINISHER);
    expect(p.learningGroupId).toBe(GROUP);
    /* 개별 일정에서 나온 하루다 — 반 공통으로 물러서지 않았다 */
    expect(p.source).toBe("learner_schedule");
    expect(p.planDate).toBe(TODAY);
    expect(p.items).toMatchObject({ requiredTotal: 2, requiredCompleted: 2 });
    expect((p.routeNodeIds as string[]).sort()).toEqual(
      [BOOK_NODE, HOMEWORK_NODE].sort(),
    );
  });

  it("필수가 남은 학생은 기록되지 않는다", async () => {
    await projectToday({ learner: ref(HALFWAY), today: TODAY });
    await completeDayPlanItem(sql, {
      organizationId: ORG,
      learnerId: HALFWAY,
      planDate: TODAY,
      itemKey: BOOK_KEY(),
    });
    const view = await projectToday({ learner: ref(HALFWAY), today: TODAY });

    expect(view.completable).toBe(false);
    expect(view.completedAt).toBeNull();
    expect(await completionEvents(HALFWAY)).toHaveLength(0);
  });
});

describe.skipIf(!hasDb)("교사의 하루 완료 취소", () => {
  function reopenForm(reason: string): FormData {
    const form = new FormData();
    form.set("learnerId", FINISHER);
    form.set("planDate", TODAY);
    form.set("reason", reason);
    return form;
  }

  it("로그인하지 않으면 아무것도 바꾸지 않는다", async () => {
    claims.sub = null;
    const before = await completedAtOf(FINISHER);

    const r = await reopenLearnerDayAction(null, reopenForm("권한 없음 확인"));

    expect(r.ok).toBe(false);
    expect(await completedAtOf(FINISHER)).toBe(before);
  });

  it("사유가 없으면 거부한다", async () => {
    /* 완료 기록을 되돌리는 유일한 조작이라 그 한 줄이 유일한 근거가 된다. */
    claims.sub = TEACHER_USER;
    const r = await reopenLearnerDayAction(null, reopenForm("   "));

    expect(r.ok).toBe(false);
    expect(r.message).toContain("사유");
    claims.sub = null;
  });

  it("취소해도 완료 시각은 남고 취소 사실이 더해진다", async () => {
    claims.sub = TEACHER_USER;
    const before = await completedAtOf(FINISHER);
    expect(before).not.toBeNull();

    const r = await reopenLearnerDayAction(
      null,
      reopenForm("시험 채점이 잘못돼 다시 보게 함"),
    );

    expect(r.ok).toBe(true);
    const [row] = await sql<
      { status: string; completed_at: string | null; reopened_at: string | null }[]
    >`
      select status::text as status, completed_at::text, reopened_at::text
      from learner_day_plans
      where learner_id = ${FINISHER} and plan_date = ${TODAY}::date
    `;
    /* 지우고 다시 채우면 숙련도·일정 엔진에 같은 날이 두 번 들어간다 */
    expect(row!.completed_at).toBe(before);
    expect(row!.reopened_at).not.toBeNull();
    expect(row!.status).not.toBe("completed");
    claims.sub = null;
  });

  it("취소 뒤 학생이 오늘 화면을 열면 다시 완료로 돌아가고 이벤트는 그대로 하나다", async () => {
    /* 되돌리지 않으면 그 하루는 학생이 무엇을 더 해도 영영 미완료다 —
     * 필수가 전부 충족돼 있는데 화면만 아니라고 하면 그것이 거짓말이다.
     * 완료 시각이 그대로이므로 이벤트는 여전히 하나다 (I-22). */
    const view = await projectToday({ learner: ref(FINISHER), today: TODAY });

    expect(view.completedAt).not.toBeNull();
    const [row] = await sql<{ status: string; reopened_at: string | null }[]>`
      select status::text as status, reopened_at::text
      from learner_day_plans
      where learner_id = ${FINISHER} and plan_date = ${TODAY}::date
    `;
    expect(row!.status).toBe("completed");
    /* 취소가 있었다는 사실은 지워지지 않는다 */
    expect(row!.reopened_at).not.toBeNull();
    expect(await completionEvents(FINISHER)).toHaveLength(1);
  });
});
