import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
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
 *
 * break-glass(인수 28)에서 이 자리가 하는 일은 **조회 감사**다.
 * 접근을 열고 닫는 판정은 getCurrentUser(승인이 살아 있어야 operator 역할이
 * 생긴다)와 매트릭스(operator 열은 전부 readonly·none)가 이미 끝냈다.
 * 남는 것은 "이 기간의 모든 조회를 기록한다"는 약속이고, 모든 페이지가
 * 반드시 지나는 지점은 여기 하나다 — 페이지마다 감사 호출을 심으면
 * 새 페이지가 생길 때 조용히 빠진다.
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

  if (user.breakGlass) {
    await recordBreakGlassView(
      user.organizationId,
      user.userId,
      user.breakGlass.grantId,
      menu,
    );
  }
  return user;
}

/**
 * 운영자 조회 기록. React cache라 한 요청에서 같은 메뉴를 여러 번 렌더해도
 * (레이아웃·스트리밍 재실행) 감사에는 한 줄만 남는다 — 기록이 부풀면
 * 소유자에게 보여줄 활동 요약이 쓸모없어진다.
 *
 * 기록 실패가 페이지를 죽이지는 않게 하되 조용히 넘기지도 않는다: 감사가
 * 끊긴 채로 접근이 계속되면 그것이야말로 통제 실패이므로 서버 로그에 남긴다.
 */
const recordBreakGlassView = cache(
  async (
    organizationId: string,
    operatorUserId: string,
    grantId: string,
    menu: MenuKey,
  ): Promise<void> => {
    try {
      const sql = getSharedSql();
      await sql`
        insert into audit_events (
          id, organization_id, actor_type, actor_id, action,
          target_type, target_id, after, access_grant_id
        ) values (
          ${uuidv7()}, ${organizationId}, 'operator', ${operatorUserId},
          'ops.break_glass_access', 'menu', null,
          ${sql.json({ menu } as never)}, ${grantId}
        )
      `;
    } catch (error) {
      console.error("[break-glass] 조회 감사 기록 실패", { grantId, menu, error });
    }
  },
);
