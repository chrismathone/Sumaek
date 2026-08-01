import "server-only";
import { getSharedSql } from "@su-maek/db";
import { conceptIdsForNodes } from "@/lib/domain/learning-material";
import type { CurrentLearner } from "@/lib/auth/current-learner";

/* 오늘의 학습 범위 — 여러 학생 화면이 같은 방식으로 "오늘 배우는 개념"을
 * 찾아야 해서 한 곳에 둔다. 각 화면이 따로 구하면 화면마다 범위가 갈린다.
 *
 * 개별 일정(learner_schedule_items)을 먼저 보고 없을 때만 반 공통(sessions)으로
 * 물러선다 — 보충·재합류로 반과 달라진 학생에게 반 공통 개념을 보여 주면
 * 오늘 배우지도 않는 자료가 나온다. */

export interface TodayScope {
  today: string;
  nodeIds: string[];
  conceptIds: string[];
  hasSession: boolean;
}

export async function getTodayScope(
  learner: CurrentLearner,
  today: string,
): Promise<TodayScope> {
  const sql = getSharedSql();
  const rows = await sql<{ planned_node_ids: unknown }[]>`
    select li.planned_node_ids
    from learner_schedule_items li
    where li.organization_id = ${learner.user.organizationId}
      and li.learner_id = ${learner.learnerId}
      and li.item_date = ${today}::date
    order by li.starts_at
  `;
  const fallback =
    rows.length > 0
      ? []
      : await sql<{ planned_node_ids: unknown }[]>`
          select s.planned_node_ids
          from sessions s
          join learning_group_memberships m
            on m.learning_group_id = s.learning_group_id
           and m.learner_id = ${learner.learnerId}
           and m.status = 'active'
          where s.organization_id = ${learner.user.organizationId}
            and s.session_date = ${today}::date
            and s.status <> 'cancelled'
          order by s.starts_at
        `;
  const source = rows.length > 0 ? rows : fallback;
  const nodeIds = source.flatMap((r) =>
    Array.isArray(r.planned_node_ids)
      ? (r.planned_node_ids as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
  );
  return {
    today,
    nodeIds,
    conceptIds: await conceptIdsForNodes(nodeIds),
    hasSession: source.length > 0,
  };
}
