import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 담당 범위 집행 (T5.3 · G-12) — 라이브 DB.
 *
 * 순수 판정은 `test/authz/teacher-scope.test.ts`가 본다. 여기서 보는 것은
 * **담당의 정의가 실제 행으로 맞는가**이다: 담임 컬럼과 명시적 위임
 * (membership_scopes) 둘 다 담당이어야 하고, 그 밖은 아니어야 한다.
 * ───────────────────────────────────────────────────────────── */

const { getSharedSql } = await import("@su-maek/db");
const {
  assignedGroupIds,
  isGroupInScope,
  isLearnerInScope,
  requireGroupScope,
  requireLearnerScope,
} = await import("@/lib/auth/require-scope");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "ffffffff-0000-7000-8000-000000053001";
let sql: ReturnType<typeof getSharedSql>;

const TEACHER = uuidv7();
const MEMBERSHIP = uuidv7();
const PERIOD = uuidv7();
/** 담임인 반 · 위임받은 반 · 남의 반 */
const HOME = uuidv7();
const DELEGATED = uuidv7();
const FOREIGN = uuidv7();
const MY_LEARNER = uuidv7();
const OTHER_LEARNER = uuidv7();

const teacher = (role: "teacher" | "owner") =>
  ({
    userId: TEACHER,
    organizationId: ORG,
    role,
    breakGlass: false,
  }) as never;

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();
  await sql`
    insert into organizations (id, name, slug, timezone)
    values (${ORG}, 'ITEST 스코프', 'itest-scope', 'Asia/Seoul')
    on conflict (id) do nothing
  `;
  await sql`
    insert into users (id, email, display_name, default_organization_id)
    values (${TEACHER}, ${`sc-${TEACHER}@su-maek.test`}, '스코프 교사', ${ORG})
  `;
  await sql`
    insert into memberships (id, organization_id, user_id, role, status)
    values (${MEMBERSHIP}, ${ORG}, ${TEACHER}, 'teacher', 'active')
  `;
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '스코프 기간', 2026, '2026-08-01', '2026-12-31', 'active')
  `;
  await sql`
    insert into learning_groups
      (id, organization_id, course_period_id, name, status, home_teacher_user_id)
    values (${HOME}, ${ORG}, ${PERIOD}, '담임 반', 'operating', ${TEACHER})
  `;
  for (const [g, name] of [
    [DELEGATED, "위임 반"],
    [FOREIGN, "남의 반"],
  ] as const) {
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${g}, ${ORG}, ${PERIOD}, ${name}, 'operating')
    `;
  }
  /* 위임 — 담임 컬럼만 보면 이 반이 빠진다 */
  await sql`
    insert into membership_scopes
      (id, organization_id, membership_id, scope_kind, scope_id)
    values (${uuidv7()}, ${ORG}, ${MEMBERSHIP}, 'learning_group', ${DELEGATED})
  `;
  for (const [l, g, name] of [
    [MY_LEARNER, HOME, "내 학생"],
    [OTHER_LEARNER, FOREIGN, "남의 학생"],
  ] as const) {
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${l}, ${ORG}, ${name}, 'active')
    `;
    await sql`
      insert into learning_group_memberships
        (id, organization_id, learning_group_id, learner_id, status, joined_on)
      values (${uuidv7()}, ${ORG}, ${g}, ${l}, 'active', '2026-08-01')
    `;
  }
});

afterAll(async () => {
  if (!hasDb) return;
  const learners = [MY_LEARNER, OTHER_LEARNER];
  await sql`delete from learning_group_memberships where learner_id = any(${learners}::uuid[])`;
  await sql`delete from learners where id = any(${learners}::uuid[])`;
  await sql`delete from membership_scopes where membership_id = ${MEMBERSHIP}`;
  await sql`delete from learning_groups where id in (${HOME}, ${DELEGATED}, ${FOREIGN})`;
  await sql`delete from course_periods where id = ${PERIOD}`;
  await sql`delete from memberships where id = ${MEMBERSHIP}`;
  await sql`delete from users where id = ${TEACHER}`;
});

describe.skipIf(!hasDb)("담당의 정의", () => {
  it("담임 반과 위임 반을 **둘 다** 담당으로 본다", async () => {
    /* 위임 표만 보면 반을 만든 교사가 자기 반에서 잠기고, 담임 컬럼만 보면
     * 위임이 아무 일도 하지 않는다. */
    const mine = await assignedGroupIds(ORG, TEACHER);
    expect(mine).toContain(HOME);
    expect(mine).toContain(DELEGATED);
    expect(mine).not.toContain(FOREIGN);
  });

  it("담당 밖 반은 액션에서도 거부된다", async () => {
    expect(await isGroupInScope(teacher("teacher"), "groups", HOME)).toBe(true);
    expect(await isGroupInScope(teacher("teacher"), "groups", FOREIGN)).toBe(false);
  });

  it("담당 밖 학생은 액션에서도 거부된다", async () => {
    expect(
      await isLearnerInScope(teacher("teacher"), "learners", MY_LEARNER),
    ).toBe(true);
    expect(
      await isLearnerInScope(teacher("teacher"), "learners", OTHER_LEARNER),
    ).toBe(false);
  });

  it("owner의 정상 범위는 유지된다 — 좁히는 것이 목적이 아니다", async () => {
    expect(await isGroupInScope(teacher("owner"), "groups", FOREIGN)).toBe(true);
    expect(
      await isLearnerInScope(teacher("owner"), "learners", OTHER_LEARNER),
    ).toBe(true);
  });
});

describe.skipIf(!hasDb)("화면 게이트 (notFound)", () => {
  /* 렌더 경로는 notFound를 던진다. 액션용 boolean과 **같은 판정**을 쓰는지
   * 여기서 확인한다 — 두 벌이 되면 한쪽만 고쳐지는 날이 온다. */
  it("담당 밖 반은 notFound다", async () => {
    await expect(
      requireGroupScope(teacher("teacher"), "groups", FOREIGN),
    ).rejects.toThrow();
  });

  it("담당 반은 통과한다", async () => {
    await expect(
      requireGroupScope(teacher("teacher"), "groups", HOME),
    ).resolves.toBeUndefined();
  });

  it("담당 밖 학생은 notFound다", async () => {
    await expect(
      requireLearnerScope(teacher("teacher"), "learners", OTHER_LEARNER),
    ).rejects.toThrow();
  });

  it("담당 학생은 통과하고, owner는 누구든 통과한다", async () => {
    await expect(
      requireLearnerScope(teacher("teacher"), "learners", MY_LEARNER),
    ).resolves.toBeUndefined();
    await expect(
      requireLearnerScope(teacher("owner"), "learners", OTHER_LEARNER),
    ).resolves.toBeUndefined();
  });

  it("메뉴 자체가 none인 역할은 행 판정 전에 막힌다", async () => {
    await expect(
      requireLearnerScope(
        { userId: TEACHER, organizationId: ORG, role: "content_manager", breakGlass: false } as never,
        "learners",
        MY_LEARNER,
      ),
    ).rejects.toThrow();
  });
});
