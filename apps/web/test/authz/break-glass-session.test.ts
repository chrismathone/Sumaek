import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * break-glass 세션 집행 (인수 28) — 라이브 DB 통합 테스트.
 *
 * 도메인 판정이 맞아도 **웹 게이트에 배선되지 않으면** 아무것도 집행되지 않는다.
 * 그 배선의 실제 지점이 getCurrentUser(역할이 만들어지는가)와
 * requireAccess(메뉴가 열리는가 · 조회가 기록되는가)이므로 두 함수를 직접 부른다.
 *
 * Supabase 인증만 대역으로 세우고 나머지(권한 매트릭스·DB·감사)는 진짜다.
 * ───────────────────────────────────────────────────────────── */

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

/** redirect는 던져서 흐름을 끊는다 — 실제 next/navigation과 같은 계약 */
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { getSharedSql } = await import("@su-maek/db");
const { issueOperatorAccess, revokeOperatorAccess } = await import(
  "@su-maek/db/domain"
);
const { DEFAULT_MATRIX, canWrite } = await import("@su-maek/core/authz");
const { getCurrentUser } = await import("@/lib/auth/current-user");
const { requireAccess } = await import("@/lib/auth/require-access");

const hasDb = Boolean(process.env.DATABASE_URL);

const ORG = "ffffffff-0000-7000-8000-000000281001";
const OWNER = "ffffffff-0000-7000-8000-000000281002";
const OPERATOR = "ffffffff-0000-7000-8000-000000281003";
const TEACHER = "ffffffff-0000-7000-8000-000000281004";

describe.skipIf(!hasDb)("break-glass 세션 게이트 (인수 28)", () => {
  let sql: ReturnType<typeof getSharedSql>;

  const grantFor = async (userId: string, reason: string, minutes = 60) => {
    const result = await issueOperatorAccess({
      organizationId: ORG,
      operatorUserId: userId,
      reason,
      approvedByUserId: OWNER,
      durationMinutes: minutes,
    });
    return result;
  };

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST break-glass 세션', 'itest-bg-session', 'Asia/Seoul')
      on conflict (id) do nothing
    `;
    await sql`
      insert into users (id, email, display_name)
      values
        (${OWNER}, 'itest-bgs-owner@example.test', 'ITEST 세션 소유자'),
        (${OPERATOR}, 'itest-bgs-operator@example.test', 'ITEST 세션 운영자'),
        (${TEACHER}, 'itest-bgs-teacher@example.test', 'ITEST 세션 선생님')
      on conflict (id) do nothing
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values
        (${uuidv7()}, ${ORG}, ${OWNER}, 'owner', 'active'),
        (${uuidv7()}, ${ORG}, ${TEACHER}, 'teacher', 'active')
      on conflict (organization_id, user_id) do nothing
    `;
    await sql`delete from operator_access_grants where organization_id = ${ORG}`;
  });

  afterAll(async () => {
    await sql`delete from operator_access_grants where organization_id = ${ORG}`;
    claims.sub = null;
  });

  it("승인이 없는 계정은 세션이 없다 — 멤버십도 승인도 없으면 아무것도 아니다", async () => {
    claims.sub = OPERATOR;
    expect(await getCurrentUser()).toBeNull();
  });

  it("유효한 승인이 운영자 세션을 만든다 (읽기 전용)", async () => {
    claims.sub = OPERATOR;
    const issued = await grantFor(OPERATOR, "세션 생성 검증 (ITEST)");
    expect(issued.ok).toBe(true);

    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.role).toBe("operator");
    expect(user!.organizationId).toBe(ORG);
    expect(user!.breakGlass?.grantId).toBe(issued.grantId);
    expect(user!.breakGlass?.reason).toContain("세션 생성 검증");

    // 승인은 기간을 줄 뿐 권한을 넓히지 않는다 — 어떤 메뉴에서도 쓰기가 없다
    for (const menu of ["settings", "audit", "routes", "tests"] as const) {
      expect(canWrite(DEFAULT_MATRIX, user!.role, menu), menu).toBe(false);
    }
  });

  it("만료되면 다음 요청에서 세션이 사라진다 — 배경 작업 없이 시각만으로", async () => {
    claims.sub = OPERATOR;
    await sql`delete from operator_access_grants where organization_id = ${ORG}`;
    const issued = await grantFor(OPERATOR, "만료 후 차단 검증 (ITEST)");
    expect(await getCurrentUser()).not.toBeNull();

    await sql`
      update operator_access_grants
      set created_at = now() - interval '3 hours',
          expires_at = now() - interval '1 second'
      where id = ${issued.grantId}
    `;

    expect(await getCurrentUser()).toBeNull();
  });

  it("회수하면 만료 전에도 세션이 사라진다", async () => {
    claims.sub = OPERATOR;
    await sql`delete from operator_access_grants where organization_id = ${ORG}`;
    const issued = await grantFor(OPERATOR, "회수 후 차단 검증 (ITEST)", 240);
    expect(await getCurrentUser()).not.toBeNull();

    await revokeOperatorAccess({
      organizationId: ORG,
      grantId: issued.grantId!,
      actorUserId: OWNER,
    });

    expect(await getCurrentUser()).toBeNull();
  });

  it("이미 구성원인 계정은 승인이 있어도 원래 역할로 남는다", async () => {
    claims.sub = TEACHER;
    await sql`delete from operator_access_grants where organization_id = ${ORG}`;
    // 도메인은 구성원 승인을 거절하므로 직접 심어 최악의 상황을 만든다
    await sql`
      insert into operator_access_grants (
        id, organization_id, operator_user_id, reason, approved_by, approved_at, expires_at
      ) values (
        ${uuidv7()}, ${ORG}, ${TEACHER}, '구성원에게 잘못 붙은 승인 (ITEST)',
        ${OWNER}, now(), now() + interval '1 hour'
      )
    `;

    const user = await getCurrentUser();
    expect(user!.role).toBe("teacher");
    expect(user!.breakGlass).toBeNull();
  });

  it("운영자에게 닫힌 메뉴는 승인 중에도 열리지 않고, 열린 메뉴의 조회는 기록된다", async () => {
    claims.sub = OPERATOR;
    await sql`delete from operator_access_grants where organization_id = ${ORG}`;
    const issued = await grantFor(OPERATOR, "조회 감사 검증 (ITEST)");

    await expect(requireAccess("learners")).rejects.toThrow(
      "REDIRECT:/app/no-access?menu=learners",
    );

    const user = await requireAccess("audit");
    expect(user.role).toBe("operator");

    const viewed = await sql<{ actor_type: string; after: { menu: string } }[]>`
      select actor_type::text as actor_type, after from audit_events
      where access_grant_id = ${issued.grantId}
        and action = 'ops.break_glass_access'
    `;
    expect(viewed).toHaveLength(1);
    expect(viewed[0]!.actor_type).toBe("operator");
    expect(viewed[0]!.after.menu).toBe("audit");
  });

  it("만료된 승인으로는 게이트가 로그인으로 되돌린다", async () => {
    claims.sub = OPERATOR;
    await sql`
      update operator_access_grants
      set created_at = now() - interval '3 hours',
          expires_at = now() - interval '1 second'
      where organization_id = ${ORG}
    `;
    await expect(requireAccess("audit")).rejects.toThrow("REDIRECT:/login");
  });
});
