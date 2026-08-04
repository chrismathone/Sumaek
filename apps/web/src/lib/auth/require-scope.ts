import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, type MenuKey, type Role } from "@su-maek/core/authz";
import type { CurrentUser } from "./current-user";

/* ─────────────────────────────────────────────────────────────
 * 담당 교사 데이터 스코프 (T5.3 · G-12).
 *
 * 매트릭스는 오래전부터 교사를 `scoped`로 적어 두었다. 그런데 그 값을
 * **읽는 곳이 없었다** — `canAccess`는 scoped를 「접근 가능」으로만 보고
 * 어느 범위인지는 아무도 묻지 않는다. 그래서 담당이 아닌 반의 상세 URL을
 * 직접 치면 그대로 열렸다.
 *
 * 이 파일은 `require-access.ts`의 짝이다. 저쪽이 「이 메뉴를 볼 수 있나」를
 * 막고 이쪽이 「이 **행**을 볼 수 있나」를 막는다. 둘을 한 함수로 합치지
 * 않는 이유는 목록 화면에는 행이 없기 때문이다 — 합치면 목록마다 의미 없는
 * 인자를 넘기게 되고, 그 인자가 비어 있을 때 무엇을 할지가 다시 애매해진다.
 *
 * 범위를 벗어나면 `notFound()`다. 403이 아니라 404인 이유: 「권한이
 * 없습니다」는 **그 id가 존재한다**는 사실을 알려 준다. 남의 반 학생이
 * 있는지 없는지는 담당 아닌 교사가 알 일이 아니다.
 * ───────────────────────────────────────────────────────────── */

export type DataScope = "organization" | "assigned" | "none";

/**
 * 역할의 메뉴 등급에서 범위를 뽑는다.
 *
 * 등급을 새로 정하지 않는다 — 매트릭스가 이미 `full`/`scoped`/`readonly`/
 * `none`을 적어 두었고, 여기서는 그것을 범위로 **읽기만** 한다. 두 곳에서
 * 각자 정하면 메뉴는 열리는데 범위는 닫히는 조합이 생긴다.
 */
export function resolveMenuScope(role: Role, menu: MenuKey): DataScope {
  const level = DEFAULT_MATRIX[menu]?.[role] ?? "none";
  if (level === "none") return "none";
  if (level === "scoped") return "assigned";
  /* full·readonly는 조직 전체다. 운영자의 readonly 전체 열람도 여기 든다 —
   * 그 접근은 승인·시한·감사로 이미 막혀 있고(4장), 여기서 또 좁히면
   * 장애 때 아무것도 못 본다. */
  return "organization";
}

/**
 * 이 사용자가 담당하는 반.
 *
 * 두 곳을 합친다: `learning_groups.home_teacher_user_id`(담임)와
 * `membership_scopes`(명시적 위임). 위임 표만 보면 반을 만든 교사가 자기
 * 반에서 잠기고, 담임 컬럼만 보면 위임이 아무 일도 하지 않는다.
 *
 * React `cache`라 한 요청 안에서 여러 번 불러도 질의는 한 번이다.
 */
export const assignedGroupIds = cache(
  async (organizationId: string, userId: string): Promise<string[]> => {
    const sql = getSharedSql();
    const rows = await sql<{ id: string }[]>`
      select g.id::text
      from learning_groups g
      where g.organization_id = ${organizationId}
        and g.home_teacher_user_id = ${userId}
      union
      select s.scope_id::text
      from membership_scopes s
      join memberships m on m.id = s.membership_id
      where s.organization_id = ${organizationId}
        and m.user_id = ${userId}
        and m.status = 'active'
        and s.scope_kind = 'learning_group'
        and s.scope_id is not null
    `;
    return rows.map((r) => r.id);
  },
);

/** 조직 전체 범위면 true — 담당 목록을 조회할 필요가 없다. */
function isOrgWide(user: CurrentUser, menu: MenuKey): boolean {
  return resolveMenuScope(user.role, menu) === "organization";
}

/**
 * 반 하나에 대한 접근을 확인한다. 범위 밖이면 `notFound()`.
 *
 * 목록 질의와 **같은 정의**(assignedGroupIds)를 쓴다. 각자 조건을 쓰면
 * 화면에는 안 보이는데 URL로는 열리는 상태가 생기고, 그것이 정확히 G-12다.
 */
export async function requireGroupScope(
  user: CurrentUser,
  menu: MenuKey,
  learningGroupId: string,
): Promise<void> {
  if (resolveMenuScope(user.role, menu) === "none") notFound();
  if (isOrgWide(user, menu)) return;
  const mine = await assignedGroupIds(user.organizationId, user.userId);
  if (!mine.includes(learningGroupId)) notFound();
}

/**
 * 학생 하나에 대한 접근을 확인한다.
 *
 * 반에 속하지 않은 학생은 담당 교사에게 보이지 않는다. 등록만 하고 반을
 * 아직 안 정한 학생이 그렇고, 그 학생을 다루는 것은 반을 정하는 사람
 * (owner·프로그램 디렉터)의 일이다.
 */
export async function requireLearnerScope(
  user: CurrentUser,
  menu: MenuKey,
  learnerId: string,
): Promise<void> {
  if (resolveMenuScope(user.role, menu) === "none") notFound();
  if (isOrgWide(user, menu)) return;

  const mine = await assignedGroupIds(user.organizationId, user.userId);
  if (mine.length === 0) notFound();

  const sql = getSharedSql();
  const [row] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from learning_group_memberships m
      where m.organization_id = ${user.organizationId}
        and m.learner_id = ${learnerId}
        and m.status = 'active'
        and m.learning_group_id = any(${mine}::uuid[])
    ) as ok
  `;
  if (!row?.ok) notFound();
}

/**
 * 액션에서 쓰는 판정 — `notFound()` 대신 boolean을 돌려준다.
 *
 * 서버 액션은 렌더가 아니라서 `notFound()`가 화면을 바꾸지 못한다. 액션이
 * 조용히 통과하면 URL은 막혔는데 폼 POST는 열린 상태가 된다 — 인수 조건이
 * 「URL 직접 입력과 서버 action 조작 **모두**」라고 적은 이유다.
 */
export async function isGroupInScope(
  user: CurrentUser,
  menu: MenuKey,
  learningGroupId: string,
): Promise<boolean> {
  const scope = resolveMenuScope(user.role, menu);
  if (scope === "none") return false;
  if (scope === "organization") return true;
  const mine = await assignedGroupIds(user.organizationId, user.userId);
  return mine.includes(learningGroupId);
}

/** 학생 판정의 액션용 짝 — `notFound()` 대신 boolean. */
export async function isLearnerInScope(
  user: CurrentUser,
  menu: MenuKey,
  learnerId: string,
): Promise<boolean> {
  const scope = resolveMenuScope(user.role, menu);
  if (scope === "none") return false;
  if (scope === "organization") return true;
  const mine = await assignedGroupIds(user.organizationId, user.userId);
  if (mine.length === 0) return false;
  const sql = getSharedSql();
  const [row] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from learning_group_memberships m
      where m.organization_id = ${user.organizationId}
        and m.learner_id = ${learnerId}
        and m.status = 'active'
        and m.learning_group_id = any(${mine}::uuid[])
    ) as ok
  `;
  return Boolean(row?.ok);
}

/**
 * 범위를 확인하지 않는 상세 화면과 그 이유.
 *
 * 「빠뜨린 것」과 「없어도 되는 것」을 구분해 둔다 — 구분이 없으면 정적
 * 검사가 무의미해진다(EVENT_WITHOUT_CONSUMER와 같은 규약).
 */
export const SCOPE_EXEMPT_DETAIL_PAGES: Readonly<Record<string, string>> = {
  "/content/materials/[id]/page.tsx":
    "학습 자료는 반이 아니라 개념에 매인다 — 담당 반으로 자를 수 있는 축이 없고, 자료 메뉴 자체가 콘텐츠 역할의 것이다",
  "/content/questions/[id]/page.tsx":
    "문항도 같다 — 문항 은행은 조직 공용이고 반 소속이 없다. 격리·권한은 문항 자체의 상태가 정한다",
  "/routes/[id]/page.tsx":
    "루트는 반에 붙기 전 초안 단계가 있어 learning_group_id가 null일 수 있다 — 범위 축을 만들려면 초안 소유 개념이 먼저 필요하다(T5.4 이후)",
};
