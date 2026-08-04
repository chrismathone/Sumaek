import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 학생 계정 위임과 일괄 발급 (T5.2 · G-07) — 라이브 DB.
 *
 * 계정 발급이 `settings` 쓰기에 묶여 있어 owner만 할 수 있었다. 담당 교사가
 * 자기 반 학생에게 로그인을 만들어 줄 수 없다는 뜻이고, 반이 여럿이면
 * 원장 한 사람이 전부 발급해야 한다.
 *
 * 여기서 확인하는 것:
 *   1) 교사가 settings 없이 **담당 학생만** 다룬다
 *   2) 담당 밖 학생은 목록에도 없고 액션으로도 안 된다 — 같은 조건이다
 *   3) 한 명이 실패해도 나머지는 진행되고 학생별로 보고된다
 *   4) 초기 비밀번호는 새로 만든 건에만, 한 번만 나온다
 *
 * 인증 관리자 API는 대역이다 — 실제 Supabase 계정을 만들지 않는다.
 * ───────────────────────────────────────────────────────────── */

const created: string[] = [];
/** 인증 공급자가 거절하는 상황을 재현하려고 둔 손잡이 */
const authFailure: { message: string | null } = { message: null };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => {
          if (authFailure.message !== null) {
            return { data: { user: null }, error: { message: authFailure.message } };
          }
          created.push(email);
          return { data: { user: { id: uuidv7() } }, error: null };
        },
      },
    },
  }),
}));

const { getSharedSql } = await import("@su-maek/db");
const { hasCapability, capabilityScope } = await import("@su-maek/core/authz");
const { issueLearnerAccounts, listManageableLearners, unlinkLearnerAccount } =
  await import("@/lib/domain/learner-account");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "ffffffff-0000-7000-8000-000000052001";
const TZ = "Asia/Seoul";

let sql: ReturnType<typeof getSharedSql>;
const TEACHER = uuidv7();
const PERIOD = uuidv7();
/** 담당 반 · 남의 반 */
const MINE = uuidv7();
const THEIRS = uuidv7();
const A = uuidv7();
const B = uuidv7();
const OUTSIDER = uuidv7();

async function addLearner(id: string, name: string, group: string) {
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${id}, ${ORG}, ${name}, 'active')
  `;
  await sql`
    insert into learning_group_memberships
      (id, organization_id, learning_group_id, learner_id, status, joined_on)
    values (${uuidv7()}, ${ORG}, ${group}, ${id}, 'active', '2026-08-01')
  `;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();
  await sql`
    insert into organizations (id, name, slug, timezone)
    values (${ORG}, 'ITEST 계정위임', 'itest-accounts', ${TZ})
    on conflict (id) do nothing
  `;
  await sql`
    insert into users (id, email, display_name, default_organization_id)
    values (${TEACHER}, ${`t5-${TEACHER}@su-maek.test`}, '위임 교사', ${ORG})
  `;
  await sql`
    insert into memberships (id, organization_id, user_id, role, status)
    values (${uuidv7()}, ${ORG}, ${TEACHER}, 'teacher', 'active')
  `;
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '위임 기간', 2026, '2026-08-01', '2026-12-31', 'active')
  `;
  /* 담당 반에만 home_teacher_user_id가 붙는다 — 이것이 「담당」의 정의다 */
  await sql`
    insert into learning_groups
      (id, organization_id, course_period_id, name, status, home_teacher_user_id)
    values (${MINE}, ${ORG}, ${PERIOD}, '내 반', 'operating', ${TEACHER})
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${THEIRS}, ${ORG}, ${PERIOD}, '남의 반', 'operating')
  `;
  await addLearner(A, "가학생", MINE);
  await addLearner(B, "나학생", MINE);
  await addLearner(OUTSIDER, "다학생", THEIRS);
});

afterAll(async () => {
  if (!hasDb) return;
  const learners = [A, B, OUTSIDER];
  const [linked] = await sql<{ ids: string[] | null }[]>`
    select array_remove(array_agg(user_id::text), null) as ids
    from learners where id = any(${learners}::uuid[])
  `;
  await sql`delete from learning_group_memberships where learner_id = any(${learners}::uuid[])`;
  await sql`delete from learners where id = any(${learners}::uuid[])`;
  for (const id of linked?.ids ?? []) {
    await sql`delete from memberships where user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await sql`delete from learning_groups where id in (${MINE}, ${THEIRS})`;
  await sql`delete from course_periods where id = ${PERIOD}`;
  await sql`delete from memberships where user_id = ${TEACHER}`;
  await sql`delete from users where id = ${TEACHER}`;
});

describe.skipIf(!hasDb)("담당 범위", () => {
  it("교사는 settings 없이 계정 능력을 갖는다", () => {
    /* 메뉴를 넓히지 않았다는 것이 요점이다 — settings 쓰기는 여전히 없다. */
    expect(hasCapability("teacher", "student_account.manage")).toBe(true);
    expect(capabilityScope("teacher", "student_account.manage")).toBe("assigned");
  });

  it("담당 반 학생만 목록에 온다", async () => {
    const list = await listManageableLearners({
      organizationId: ORG,
      actorUserId: TEACHER,
      scope: "assigned",
    });
    const ids = list.map((l) => l.learnerId);
    expect(ids).toContain(A);
    expect(ids).toContain(B);
    expect(ids).not.toContain(OUTSIDER);
  });

  it("조직 범위면 남의 반 학생도 온다", async () => {
    const list = await listManageableLearners({
      organizationId: ORG,
      actorUserId: TEACHER,
      scope: "organization",
    });
    expect(list.map((l) => l.learnerId)).toContain(OUTSIDER);
  });

  it("범위가 없으면 목록이 비어 있다 — 질의조차 하지 않는다", async () => {
    const list = await listManageableLearners({
      organizationId: ORG,
      actorUserId: TEACHER,
      scope: "none",
    });
    expect(list).toEqual([]);
  });
});

describe.skipIf(!hasDb)("일괄 발급", () => {
  it("담당 학생에게 발급하고 초기 비밀번호를 한 번 낸다", async () => {
    const result = await issueLearnerAccounts({
      organizationId: ORG,
      actorUserId: TEACHER,
      scope: "assigned",
      targets: [
        { learnerId: A, email: `a-${A}@su-maek.test` },
        { learnerId: B, email: `b-${B}@su-maek.test` },
      ],
    });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    for (const o of result.outcomes) {
      expect(o.temporaryPassword).toBeTruthy();
      /* 저장하지 않는다 — 행 어디에도 남지 않아야 다시 볼 수 없다.
       * 행 전체를 문자열로 훑는다: 나중에 컬럼이 늘어도 이 검사는 그대로
       * 맞다(특정 컬럼만 보면 새 컬럼에 새는 것을 놓친다). */
      const [row] = await sql<{ cnt: number }[]>`
        select count(*)::int as cnt from users u
        where u.id = (select user_id from learners where id = ${o.learnerId})
          and u::text ilike ${"%" + o.temporaryPassword! + "%"}
      `;
      expect(row!.cnt).toBe(0);
      const [lrow] = await sql<{ cnt: number }[]>`
        select count(*)::int as cnt from learners l
        where l.id = ${o.learnerId}
          and l::text ilike ${"%" + o.temporaryPassword! + "%"}
      `;
      expect(lrow!.cnt).toBe(0);
    }
  });

  it("담당 밖 학생은 거부하고 나머지는 진행한다", async () => {
    /* 전부 되돌리면 이미 받은 비밀번호가 무효가 되고, 그것은 다시 볼 수
     * 없으므로 교사가 처음부터 다시 나눠 줘야 한다. */
    const third = uuidv7();
    await addLearner(third, "라학생", MINE);

    const result = await issueLearnerAccounts({
      organizationId: ORG,
      actorUserId: TEACHER,
      scope: "assigned",
      targets: [
        { learnerId: OUTSIDER, email: `x-${OUTSIDER}@su-maek.test` },
        { learnerId: third, email: `d-${third}@su-maek.test` },
      ],
    });

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    const denied = result.outcomes.find((o) => o.learnerId === OUTSIDER)!;
    expect(denied.ok).toBe(false);
    /* 어느 쪽인지 알려 주면 담당 아닌 반의 학생 존재 여부가 새어 나간다 */
    expect(denied.message).toContain("담당");

    const [row] = await sql<{ user_id: string | null }[]>`
      select user_id::text from learners where id = ${OUTSIDER}
    `;
    expect(row!.user_id).toBeNull();

    await sql`delete from learning_group_memberships where learner_id = ${third}`;
    const [t] = await sql<{ user_id: string | null }[]>`
      select user_id::text from learners where id = ${third}
    `;
    await sql`delete from learners where id = ${third}`;
    if (t?.user_id) {
      await sql`delete from memberships where user_id = ${t.user_id}`;
      await sql`delete from users where id = ${t.user_id}`;
    }
  });

  it("이미 계정이 있으면 실패로 보고하고 덮어쓰지 않는다", async () => {
    const result = await issueLearnerAccounts({
      organizationId: ORG,
      actorUserId: TEACHER,
      scope: "assigned",
      targets: [{ learnerId: A, email: `again-${A}@su-maek.test` }],
    });
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]!.message).toContain("이미");
    expect(result.outcomes[0]!.temporaryPassword).toBeUndefined();
  });

  it("범위가 없으면 아무에게도 발급되지 않는다", async () => {
    const result = await issueLearnerAccounts({
      organizationId: ORG,
      actorUserId: TEACHER,
      scope: "none",
      targets: [{ learnerId: B, email: `no-${B}@su-maek.test` }],
    });
    expect(result.succeeded).toBe(0);
    expect(result.outcomes[0]!.ok).toBe(false);
  });
});

describe.skipIf(!hasDb)("연결 해제", () => {
  /* 발급의 반대편이다. 지금까지 테스트가 하나도 없었는데, 학생에게서
   * 로그인을 빼앗는 조작이라 조용히 틀리면 그 학생이 개학일 아침에
   * 못 들어온다. */
  it("연결된 학생의 계정을 끊는다 — 학습자 기록은 남는다", async () => {
    const before = await sql<{ user_id: string | null }[]>`
      select user_id::text from learners where id = ${B}
    `;
    expect(before[0]!.user_id).not.toBeNull();

    const r = await unlinkLearnerAccount({
      organizationId: ORG,
      learnerId: B,
      actorUserId: TEACHER,
    });

    expect(r.ok).toBe(true);
    const [after] = await sql<{ user_id: string | null; status: string }[]>`
      select user_id::text, status::text as status from learners where id = ${B}
    `;
    expect(after!.user_id).toBeNull();
    /* 학습자 자체는 지우지 않는다 — 응시·진도 기록이 매달려 있다 */
    expect(after!.status).toBe("active");
  });

  it("연결이 없으면 거절한다", async () => {
    const r = await unlinkLearnerAccount({
      organizationId: ORG,
      learnerId: B,
      actorUserId: TEACHER,
    });
    expect(r.ok).toBe(false);
  });

  it("남의 조직 학습자는 끊지 못한다", async () => {
    const r = await unlinkLearnerAccount({
      organizationId: "00000000-0000-7000-8000-000000000001",
      learnerId: A,
      actorUserId: TEACHER,
    });
    expect(r.ok).toBe(false);
    const [row] = await sql<{ user_id: string | null }[]>`
      select user_id::text from learners where id = ${A}
    `;
    expect(row!.user_id).not.toBeNull();
  });
});

describe.skipIf(!hasDb)("인증 공급자가 거절할 때", () => {
  it("그 학생만 실패로 보고하고 연결하지 않는다", async () => {
    /* 공급자는 비밀번호 정책·중복 등으로 거절한다. 그 문구를 그대로 삼키면
     * 교사는 무엇을 고쳐야 할지 모른 채 「실패」만 본다. */
    const solo = uuidv7();
    await addLearner(solo, "마학생", MINE);
    authFailure.message = "Password should be at least 8 characters";

    const result = await issueLearnerAccounts({
      organizationId: ORG,
      actorUserId: TEACHER,
      scope: "assigned",
      targets: [{ learnerId: solo, email: `e-${solo}@su-maek.test` }],
    });
    authFailure.message = null;

    expect(result.failed).toBe(1);
    expect(result.outcomes[0]!.message).toContain("8 characters");
    const [row] = await sql<{ user_id: string | null }[]>`
      select user_id::text from learners where id = ${solo}
    `;
    expect(row!.user_id).toBeNull();

    await sql`delete from learning_group_memberships where learner_id = ${solo}`;
    await sql`delete from learners where id = ${solo}`;
  });
});
