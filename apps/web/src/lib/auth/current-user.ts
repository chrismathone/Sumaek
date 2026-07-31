import "server-only";
import { cache } from "react";
import { getSharedSql } from "@su-maek/db";
import type { Role } from "@su-maek/core/authz";
import { createClient } from "@/lib/supabase/server";

/* ─────────────────────────────────────────────────────────────
 * 현재 사용자 해석 (eywa 패턴).
 * - getClaims()로 로컬 JWT 검증 (네트워크 왕복 없음).
 * - 역할·조직은 JWT app_metadata가 아니라 **항상 public 테이블에서** 읽는다
 *   (드리프트 0). RLS와 별개의 서버 권한 검사 기반.
 * ───────────────────────────────────────────────────────────── */

export interface CurrentUser {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  timezone: string;
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
          timezone: string;
        }[]
      >`
        select u.id as user_id, u.email, u.display_name,
               m.organization_id, o.name as organization_name,
               m.role, o.timezone
        from users u
        join memberships m on m.user_id = u.id and m.status = 'active'
        join organizations o on o.id = m.organization_id and o.status = 'active'
        where u.id = ${userId}
        order by (m.organization_id = u.default_organization_id) desc nulls last,
                 m.created_at asc
        limit 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        role: row.role as Role,
        timezone: row.timezone,
      };
    }
  },
);
