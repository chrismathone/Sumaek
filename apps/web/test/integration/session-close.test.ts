import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 반 수업 마감 — **액션 층** (T4.2).
 *
 * 마감 규칙 자체(계획 노드 대조·재마감 거부·조직 격리·I-21 기록)는
 * `packages/db/test/session-close.test.ts`가 도메인에서 직접 본다. 여기서
 * 보는 것은 그 앞의 한 겹이다: 누가 부를 수 있고, 폼이 넘긴 값이 어떻게
 * 도메인 입력이 되는가.
 *
 * 이 겹을 따로 두는 이유: 권한 검사와 폼 파싱은 도메인 함수가 하지 않는다.
 * 도메인만 테스트하면 「권한 없는 사람이 마감할 수 있다」가 통과한다.
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
const { closeSessionAction } = await import("@/app/app/classes/[id]/actions");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";
const TZ = "Asia/Seoul";

let sql: ReturnType<typeof getSharedSql>;
const TEACHER_USER = uuidv7();
/** `groups` 쓰기가 없는 역할 — 콘텐츠 담당자 */
const OUTSIDER_USER = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const NODE_A = uuidv7();
const SESSION = uuidv7();

function isoAddDays(days: number): string {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
const YESTERDAY = isoAddDays(-1);

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.set("sessionId", SESSION);
  f.set("learningGroupId", GROUP);
  f.set(`node:${NODE_A}`, "completed");
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

async function sessionStatus(): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    select status::text as status from sessions where id = ${SESSION}
  `;
  return row!.status;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();

  for (const [user, name, role] of [
    [TEACHER_USER, "마감 액션 교사", "teacher"],
    [OUTSIDER_USER, "마감 액션 콘텐츠담당", "content_manager"],
  ] as const) {
    await sql`
      insert into users (id, email, display_name, default_organization_id)
      values (${user}, ${`ca-${user}@su-maek.test`}, ${name}, ${ORG})
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values (${uuidv7()}, ${ORG}, ${user}, ${role}, 'active')
    `;
  }
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '마감 액션 기간', 2026, ${isoAddDays(-30)},
            ${isoAddDays(30)}, 'active')
  `;
  /* 담임을 지정한다 — T5.3 이후 담당 밖 반은 액션에서도 거부되므로,
   * 「교사가 자기 반을 마감한다」가 정확한 상황이다. */
  await sql`
    insert into learning_groups
      (id, organization_id, course_period_id, name, status, home_teacher_user_id)
    values (${GROUP}, ${ORG}, ${PERIOD}, '마감 액션반', 'operating', ${TEACHER_USER})
  `;
  await sql`
    insert into sessions (
      id, organization_id, learning_group_id, session_date, timezone,
      starts_at, ends_at, status, planned_node_ids)
    values (${SESSION}, ${ORG}, ${GROUP}, ${YESTERDAY}::date, ${TZ},
            ${`${YESTERDAY}T07:00:00Z`}, ${`${YESTERDAY}T07:50:00Z`},
            'planned', ${sql.json([NODE_A])})
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`delete from outbox_events where aggregate_id = ${SESSION}`;
  await sql`alter table progress_events disable trigger progress_events_immutable`;
  await sql`delete from progress_events where session_id = ${SESSION}`;
  await sql`alter table progress_events enable trigger progress_events_immutable`;
  await sql`delete from sessions where id = ${SESSION}`;
  await sql`delete from learning_groups where id = ${GROUP}`;
  await sql`delete from course_periods where id = ${PERIOD}`;
  await sql`delete from memberships where user_id in (${TEACHER_USER}, ${OUTSIDER_USER})`;
  await sql`delete from users where id in (${TEACHER_USER}, ${OUTSIDER_USER})`;
});

describe.skipIf(!hasDb)("마감 액션의 권한과 입력", () => {
  it("로그인하지 않으면 마감하지 못한다", async () => {
    claims.sub = null;
    const r = await closeSessionAction(null, form());
    expect(r.ok).toBe(false);
    expect(await sessionStatus()).toBe("planned");
  });

  it("반 쓰기 권한이 없는 역할은 마감하지 못한다", async () => {
    /* 도메인 함수는 권한을 모른다 — 이 한 겹이 없으면 콘텐츠 담당자가
     * 남의 반 수업을 마감할 수 있다. */
    claims.sub = OUTSIDER_USER;
    const r = await closeSessionAction(null, form());
    expect(r.ok).toBe(false);
    expect(r.message).toContain("권한");
    expect(await sessionStatus()).toBe("planned");
    claims.sub = null;
  });

  it("진행 상태 값이 목록 밖이면 거부한다", async () => {
    claims.sub = TEACHER_USER;
    const r = await closeSessionAction(null, form({ [`node:${NODE_A}`]: "done" }));
    expect(r.ok).toBe(false);
    expect(await sessionStatus()).toBe("planned");
    claims.sub = null;
  });

  it("교사가 마감하면 폼의 노드별 값이 그대로 진도가 된다", async () => {
    claims.sub = TEACHER_USER;
    const r = await closeSessionAction(
      null,
      form({ [`node:${NODE_A}`]: "partial", note: "예제 15번까지만" }),
    );

    expect(r.ok).toBe(true);
    expect(await sessionStatus()).toBe("completed");

    const [event] = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from outbox_events
      where event_type = 'SessionCompleted' and aggregate_id = ${SESSION}
    `;
    const p = event!.payload as {
      coverage: string;
      note: string | null;
      progressSummary: { partialNodeIds: string[] };
    };
    expect(p.coverage).toBe("partial");
    expect(p.note).toBe("예제 15번까지만");
    expect(p.progressSummary.partialNodeIds).toEqual([NODE_A]);
    claims.sub = null;
  });
});

describe.skipIf(!hasDb)("담당 밖 반은 마감할 수 없다 (T5.3)", () => {
  it("담임이 아닌 교사의 마감은 거부된다", async () => {
    /* URL을 막아도 폼 POST는 직접 올 수 있다. 액션이 조용히 통과하면
     * 남의 반 진도가 남의 손으로 확정된다. */
    const otherTeacher = uuidv7();
    await sql`
      insert into users (id, email, display_name, default_organization_id)
      values (${otherTeacher}, ${`ot-${otherTeacher}@su-maek.test`}, '남의 교사', ${ORG})
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values (${uuidv7()}, ${ORG}, ${otherTeacher}, 'teacher', 'active')
    `;

    claims.sub = otherTeacher;
    const r = await closeSessionAction(null, form());
    expect(r.ok).toBe(false);
    expect(r.message).toContain("담당");
    claims.sub = null;

    await sql`delete from memberships where user_id = ${otherTeacher}`;
    await sql`delete from users where id = ${otherTeacher}`;
  });
});
