import "server-only";
import { getSharedSql } from "@su-maek/db";

/* ─────────────────────────────────────────────────────────────
 * 차시 노드의 이름 — 반 루트 노드는 route_nodes, 보충 노드는 오버라이드 안.
 *
 * 오늘 학습 화면과 지난 기록의 하루 상세가 **같은 규칙**으로 이름을 읽게
 * 하려고 떼어 냈다. 두 화면이 각자 풀면 보충 차시의 이름이 한쪽에서만
 * 「보충」으로 뭉개지는 식으로 갈린다.
 *
 * 오버라이드 노드의 id는 `override:<오버라이드 id>:<끼워 넣은 순번>` 꼴이고
 * 이름은 delta.insertBefore.nodes[순번].title에 있다 — 별도 테이블이 아니라
 * jsonb 안이라, 이름이 없으면 「보충」으로 되돌린다.
 * ───────────────────────────────────────────────────────────── */

export function nodeIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * 노드 id → 제목 맵.
 *
 * route 노드가 하나도 없으면 왕복하지 않는다. 오버라이드 노드가 섞여 있을
 * 때만 오버라이드 테이블을 한 번 더 읽는다.
 */
export async function nodeTitleMap(input: {
  organizationId: string;
  learnerId: string;
  nodeIds: string[];
}): Promise<Map<string, string>> {
  const sql = getSharedSql();
  const map = new Map<string, string>();

  const routeNodeIds = input.nodeIds.filter((n) => !n.startsWith("override:"));
  if (routeNodeIds.length > 0) {
    const titles = await sql<{ id: string; title: string }[]>`
      select id::text, title from route_nodes where id = any(${routeNodeIds}::uuid[])
    `;
    for (const t of titles) map.set(t.id, t.title);
  }

  if (input.nodeIds.some((n) => n.startsWith("override:"))) {
    const overrides = await sql<{ id: string; delta: unknown }[]>`
      select id::text, delta from student_route_overrides
      where organization_id = ${input.organizationId}
        and learner_id = ${input.learnerId}
    `;
    for (const o of overrides) {
      const inserted =
        ((o.delta ?? {}) as {
          insertBefore?: { nodes?: Array<{ title?: string }> };
        }).insertBefore?.nodes ?? [];
      inserted.forEach((n, i) =>
        map.set(`override:${o.id}:${i}`, n.title ?? "보충"),
      );
    }
  }
  return map;
}

/** 맵에 없으면 보충 노드는 「보충」, 아니면 「이름 없는 항목」 */
export function titleOf(map: Map<string, string>, id: string): string {
  return map.get(id) ?? (id.startsWith("override:") ? "보충" : "이름 없는 항목");
}
