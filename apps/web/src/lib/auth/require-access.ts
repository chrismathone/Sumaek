import "server-only";
import { redirect } from "next/navigation";
import { DEFAULT_MATRIX, canAccess, type MenuKey } from "@su-maek/core/authz";
import { getCurrentUser, type CurrentUser } from "./current-user";

/* ─────────────────────────────────────────────────────────────
 * 읽기 게이트 — /app 하위 모든 페이지의 첫 줄에서 호출한다.
 *
 * 내비에서 링크를 숨기는 것은 접근 제한이 아니다. URL을 직접 입력하면
 * 그대로 렌더되므로, 콘텐츠 역할이 학습자 개인정보 화면에 도달할 수 있었다
 * (매트릭스 가드레일 isPermissionLocked가 금지하는 조합).
 * canWrite가 변경 액션을 막듯, canAccess는 여기서 조회를 막는다.
 *
 * getCurrentUser는 React cache라 페이지가 다시 불러도 추가 질의가 없다.
 * ───────────────────────────────────────────────────────────── */

export async function requireAccess(menu: MenuKey): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/today");
  if (user.role === "student") redirect("/learn/today");

  // 워크스페이스 오버라이드를 붙일 자리 — 지금은 기본 매트릭스가 유일한 진실이며
  // 셸(lib/nav.ts)의 링크 노출도 같은 매트릭스를 본다.
  if (!canAccess(DEFAULT_MATRIX, user.role, menu)) {
    redirect(`/app/no-access?menu=${menu}`);
  }
  return user;
}
