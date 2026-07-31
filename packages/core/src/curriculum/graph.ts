/* ─────────────────────────────────────────────────────────────
 * 교육과정 개념 그래프 (골프롬프트 2L).
 *
 * - 강한 PREREQUISITE 부분 그래프는 DAG여야 하며 발행 전 순환을 차단한다.
 * - 수학 학습 전체를 하나의 엄격한 선형 순서로 강제하지 않는다 —
 *   SOFT_PREREQUISITE·CONTRASTS_WITH·REPRESENTED_BY는 순환 검사 대상이 아니다.
 * - AI 제안 관계(provenance=ai_suggested)는 승인 전 자동 계획에 사용하지 않는다.
 * ───────────────────────────────────────────────────────────── */

export type ConceptEdgeKind =
  | "part_of"
  | "prerequisite"
  | "soft_prerequisite"
  | "extends"
  | "special_case_of"
  | "equivalent_to"
  | "contrasts_with"
  | "represented_by"
  | "misconception_of"
  | "assessed_by"
  | "transfer_to";

export interface GraphEdge {
  fromConceptId: string;
  toConceptId: string;
  kind: ConceptEdgeKind;
  provenance: "human" | "ai_suggested" | "imported";
  status: "draft" | "reviewed" | "active" | "deprecated";
}

export interface GraphNode {
  conceptId: string;
  status: "draft" | "reviewed" | "active" | "deprecated";
  /** 최소 1개 근거 보유 게이트 검사용 */
  evidenceCount: number;
}

export interface CycleFinding {
  /** 순환을 이루는 개념 ID 경로 (마지막이 시작으로 되돌아감) */
  path: string[];
}

/**
 * 자동 계획에 사용 가능한 간선 — 사람 승인(reviewed|active) + AI 미제안 상태.
 * AI 제안이 사람 승인 관계로 가장되지 않게 provenance를 함께 본다.
 */
export function planningEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return edges.filter(
    (e) =>
      (e.status === "reviewed" || e.status === "active") &&
      e.provenance !== "ai_suggested",
  );
}

/** 강한 선수 관계 DAG 순환 검출 — 발행 게이트 (순환 0건). */
export function findPrerequisiteCycles(
  edges: readonly GraphEdge[],
): CycleFinding[] {
  const strong = edges.filter((e) => e.kind === "prerequisite");
  const adjacency = new Map<string, string[]>();
  for (const e of strong) {
    const list = adjacency.get(e.fromConceptId) ?? [];
    list.push(e.toConceptId);
    adjacency.set(e.fromConceptId, list);
  }
  // 결정론적 순회
  for (const list of adjacency.values()) list.sort();

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const cycles: CycleFinding[] = [];
  const stack: string[] = [];

  const visit = (node: string): void => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const start = stack.indexOf(next);
        cycles.push({ path: [...stack.slice(start), next] });
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };

  const nodes = [...adjacency.keys()].sort();
  for (const node of nodes) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node);
  }
  return cycles;
}

/** 존재하지 않는 노드로 향하는 고아 간선 검출 — 발행 게이트 (고아 0건). */
export function findOrphanEdges(
  edges: readonly GraphEdge[],
  nodes: readonly GraphNode[],
): GraphEdge[] {
  const ids = new Set(nodes.map((n) => n.conceptId));
  return edges.filter(
    (e) => !ids.has(e.fromConceptId) || !ids.has(e.toConceptId),
  );
}

/**
 * 목표 개념까지의 선수 경로 — 위상 정렬 순서로 반환.
 * 진단 설계(2M)와 루트 시뮬레이션의 기반. 승인된 간선만 사용한다.
 */
export function prerequisitePath(
  targetConceptId: string,
  edges: readonly GraphEdge[],
): string[] {
  const approved = planningEdges(edges).filter(
    (e) => e.kind === "prerequisite",
  );
  // to ← from (from이 to의 선수) 역방향 탐색: 목표에서 선수들로
  const prereqsOf = new Map<string, string[]>();
  for (const e of approved) {
    const list = prereqsOf.get(e.toConceptId) ?? [];
    list.push(e.fromConceptId);
    prereqsOf.set(e.toConceptId, list);
  }
  for (const list of prereqsOf.values()) list.sort();

  const visited = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const p of prereqsOf.get(id) ?? []) visit(p);
    ordered.push(id);
  };
  visit(targetConceptId);
  return ordered;
}

export interface ReleaseGateInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 성취기준 코드 목록 (릴리스 내) */
  standardCodes: string[];
  /** 활성 루트·평가가 사용 중인 개념 ID (폐기 영향 분석) */
  conceptsInUse?: string[];
}

export interface ReleaseGateReport {
  ok: boolean;
  duplicateStandardCodes: string[];
  prerequisiteCycles: CycleFinding[];
  orphanEdges: GraphEdge[];
  conceptsWithoutEvidence: string[];
  aiEdgesMasqueradingAsActive: GraphEdge[];
  deprecatedConceptsInUse: string[];
}

/** 릴리스 발행 게이트 (2L 품질 게이트). 하나라도 실패하면 발행 차단. */
export function validateRelease(input: ReleaseGateInput): ReleaseGateReport {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const code of input.standardCodes) {
    if (seen.has(code)) duplicates.add(code);
    seen.add(code);
  }

  const activeEdges = input.edges.filter((e) => e.status === "active");
  const aiMasquerade = activeEdges.filter(
    (e) => e.provenance === "ai_suggested",
  );

  const cycles = findPrerequisiteCycles(
    input.edges.filter((e) => e.status !== "deprecated"),
  );
  const orphans = findOrphanEdges(input.edges, input.nodes);

  const withoutEvidence = input.nodes
    .filter((n) => n.status !== "deprecated" && n.evidenceCount === 0)
    .map((n) => n.conceptId);

  const deprecatedSet = new Set(
    input.nodes.filter((n) => n.status === "deprecated").map((n) => n.conceptId),
  );
  const deprecatedInUse = (input.conceptsInUse ?? []).filter((id) =>
    deprecatedSet.has(id),
  );

  return {
    ok:
      duplicates.size === 0 &&
      cycles.length === 0 &&
      orphans.length === 0 &&
      withoutEvidence.length === 0 &&
      aiMasquerade.length === 0 &&
      deprecatedInUse.length === 0,
    duplicateStandardCodes: [...duplicates].sort(),
    prerequisiteCycles: cycles,
    orphanEdges: orphans,
    conceptsWithoutEvidence: withoutEvidence,
    aiEdgesMasqueradingAsActive: aiMasquerade,
    deprecatedConceptsInUse: deprecatedInUse,
  };
}
