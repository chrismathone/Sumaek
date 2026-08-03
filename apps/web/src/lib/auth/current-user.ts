import "server-only";
import { cache } from "react";
import { getSharedSql } from "@su-maek/db";
import { findActiveOperatorSession } from "@su-maek/db/domain";
import type { Role } from "@su-maek/core/authz";
import { createClient } from "@/lib/supabase/server";

/* ─────────────────────────────────────────────────────────────
 * 현재 사용자 해석 (eywa 패턴).
 * - getClaims()로 로컬 JWT 검증 (네트워크 왕복 없음).
 * - 역할·조직은 JWT app_metadata가 아니라 **항상 public 테이블에서** 읽는다
 *   (드리프트 0). RLS와 별개의 서버 권한 검사 기반.
 *
 * break-glass(인수 28)의 집행 자리도 여기다. 이유:
 * requireAccess·canWrite는 "이 역할이 이 메뉴를 열 수 있는가"만 답하고,
 * 그 앞에 **역할이 존재하는가**를 정하는 곳이 여기 하나뿐이다. 승인이 만료되면
 * operator 역할이 만들어지지 않으므로, 게이트를 하나하나 손보지 않아도
 * 다음 요청부터 세션 자체가 성립하지 않는다 — 만료가 자동으로 닫는다는 말의
 * 실제 구현이다. getCurrentUser는 요청 단위 React cache라 요청마다 다시
 * 판정되고, 로그인 쿠키가 살아 있어도 승인이 죽으면 접근은 죽는다.
 * ───────────────────────────────────────────────────────────── */

export interface BreakGlassContext {
  grantId: string;
  reason: string;
  expiresAt: Date;
  approvedBy: string | null;
  /** 판정에 쓰인 DB 시계 — 남은 시간 표시용 */
  now: Date;
}

export interface CurrentUser {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  /** 이 세션이 break-glass 승인으로 열렸다면 그 근거. 아니면 null */
  breakGlass: BreakGlassContext | null;
}

export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (!userId) return null;

    const sql = getSharedSql();
    {
      const rows = await sql<
        {
          user_id: string;
          email: string;
          display_name: string;
          organization_id: string;
          organization_name: string;
          role: string;
        }[]
      >`
        select u.id as user_id, u.email, u.display_name,
               m.organization_id, o.name as organization_name,
               m.role
        from users u
        join memberships m on m.user_id = u.id and m.status = 'active'
        join organizations o on o.id = m.organization_id and o.status = 'active'
        where u.id = ${userId}
        order by (m.organization_id = u.default_organization_id) desc nulls last,
                 m.created_at asc
        limit 1
      `;
      const row = rows[0];
      if (row) {
        return {
          userId: row.user_id,
          email: row.email,
          displayName: row.display_name,
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          role: row.role as Role,
          breakGlass: null,
        };
      }
    }

    /* 멤버십이 없다 — 여기서 끝내면 break-glass 운영자는 영원히 못 들어온다.
     * 멤버십을 먼저 보는 순서가 중요하다: 구성원에게 승인이 잘못 붙어도
     * 그 사람의 원래 역할이 이기고, 승인이 권한을 넓히는 일은 없다. */
    const session = await findActiveOperatorSession(userId);
    if (!session) return null;

    const [operator] = await sql<
      { email: string; display_name: string }[]
    >`
      select u.email, u.display_name
      from users u
      where u.id = ${userId}
    `;
    if (!operator) return null;

    return {
      userId,
      email: operator.email,
      displayName: operator.display_name,
      organizationId: session.grant.organizationId,
      organizationName: session.grant.organizationName,
      // 매트릭스의 operator 열에는 full·scoped가 하나도 없다 — 읽기 전용이다
      role: "operator",
      breakGlass: {
        grantId: session.grant.id,
        reason: session.grant.reason,
        expiresAt: session.grant.expiresAt,
        approvedBy: session.grant.approvedBy,
        now: session.now,
      },
    };
  },
);
