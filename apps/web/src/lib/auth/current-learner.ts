import "server-only";
import { cache } from "react";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser, type CurrentUser } from "./current-user";

export interface CurrentLearner {
  user: CurrentUser;
  learnerId: string;
  displayName: string;
}

/** 학생 사용자 → 학습자 매핑. 학생 역할이 아니거나 연결이 없으면 null. */
export const getCurrentLearner = cache(
  async (): Promise<CurrentLearner | null> => {
    const user = await getCurrentUser();
    if (!user || user.role !== "student") return null;
    const sql = getSharedSql();
    const [row] = await sql<{ id: string; display_name: string }[]>`
      select id, display_name from learners
      where organization_id = ${user.organizationId} and user_id = ${user.userId}
      limit 1
    `;
    if (!row) return null;
    return { user, learnerId: row.id, displayName: row.display_name };
  },
);
