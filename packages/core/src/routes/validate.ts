import type { GraphEdge } from "../curriculum/graph";
import { planningEdges } from "../curriculum/graph";

/* ─────────────────────────────────────────────────────────────
 * 루트 검증·시뮬레이션 (골프롬프트 13장).
 * 게시 전 게이트: 목표일 완주 가능성, 커버리지, 선수 공백, 학습량,
 * 확인테스트 배치, 노드 의존 순환.
 * 날짜 배치는 일정 엔진의 몫 — 여기는 루트 구조 자체를 검증한다.
 * ───────────────────────────────────────────────────────────── */

export interface RouteNodeForValidation {
  nodeId: string;
  kind: string;
  sortOrder: number;
  conceptIds: string[];
  expectedMinutes: number;
  isCheckpoint: boolean; // 확인테스트 노드
}

export interface RouteValidationInput {
  nodes: RouteNodeForValidation[];
  /** 노드 간 명시 의존 (sequence 외 prerequisite·checkpoint_gate) */
  dependencies: Array<{ fromNodeId: string; toNodeId: string }>;
  /** 개념 그래프 간선 (승인분만 자동 사용됨) */
  conceptEdges: GraphEdge[];
  /** 이 루트가 커버해야 하는 목표 개념 (성취기준 매핑 유래) */
  targetConceptIds: string[];
  /** 학생이 이미 안다고 간주하는 개념 (이전 과정 완료분) */
  assumedKnownConceptIds: string[];
  /** 목표 기간 내 총 가용 수업 분 (달력에서 산출) */
  availableMinutes: number;
  /** 주당 가용 분 */
  weeklyAvailableMinutes: number;
  /** 계획 주 수 */
  weeks: number;
  /** 확인테스트 없이 허용되는 최대 연속 개념 수업 노드 수 */
  maxNodesBetweenCheckpoints: number;
}

export type RouteIssueCode =
  | "OVER_CAPACITY" // 목표일까지 완료 불가
  | "WEEKLY_OVERLOAD" // 주당 학습량 초과
  | "COVERAGE_GAP" // 목표 개념 누락
  | "PREREQUISITE_GAP" // 선수 개념이 루트에 없거나 순서가 뒤임
  | "CHECKPOINT_GAP" // 확인테스트 없는 장구간
  | "DEPENDENCY_CYCLE" // 노드 의존 순환
  | "DEPENDENCY_ORDER"; // 의존이 정렬 순서와 모순

export interface RouteIssue {
  code: RouteIssueCode;
  message: string;
  nodeIds?: string[];
  conceptIds?: string[];
}

export interface RouteValidationReport {
  ok: boolean;
  issues: RouteIssue[];
  summary: {
    totalMinutes: number;
    availableMinutes: number;
    utilization: number;
    conceptsCovered: number;
    conceptsMissing: number;
  };
}

export function validateRoute(
  input: RouteValidationInput,
): RouteValidationReport {
  const issues: RouteIssue[] = [];
  const nodes = [...input.nodes].sort((a, b) => a.sortOrder - b.sortOrder);

  /* 1. 용량 */
  const totalMinutes = nodes.reduce((s, n) => s + n.expectedMinutes, 0);
  if (totalMinutes > input.availableMinutes) {
    issues.push({
      code: "OVER_CAPACITY",
      message: `총 예상 ${totalMinutes}분 > 가용 ${input.availableMinutes}분 — 목표일까지 완료할 수 없습니다`,
    });
  }
  const weeklyAvg = input.weeks > 0 ? totalMinutes / input.weeks : totalMinutes;
  if (weeklyAvg > input.weeklyAvailableMinutes) {
    issues.push({
      code: "WEEKLY_OVERLOAD",
      message: `주당 평균 ${Math.round(weeklyAvg)}분 > 주당 가용 ${input.weeklyAvailableMinutes}분`,
    });
  }

  /* 2. 커버리지 */
  const covered = new Set(nodes.flatMap((n) => n.conceptIds));
  const missing = input.targetConceptIds.filter((c) => !covered.has(c));
  if (missing.length > 0) {
    issues.push({
      code: "COVERAGE_GAP",
      message: `목표 개념 ${missing.length}개가 루트에 없습니다`,
      conceptIds: missing,
    });
  }

  /* 3. 선수 공백 — 각 개념의 승인된 강한 선수가 (a) 이미 아는 개념이거나
     (b) 루트에서 더 앞에 등장해야 한다 */
  const known = new Set(input.assumedKnownConceptIds);
  const firstIndexOfConcept = new Map<string, number>();
  nodes.forEach((n, i) => {
    for (const c of n.conceptIds) {
      if (!firstIndexOfConcept.has(c)) firstIndexOfConcept.set(c, i);
    }
  });
  const prereqEdges = planningEdges(input.conceptEdges).filter(
    (e) => e.kind === "prerequisite",
  );
  const prereqsOf = new Map<string, string[]>();
  for (const e of prereqEdges) {
    const list = prereqsOf.get(e.toConceptId) ?? [];
    list.push(e.fromConceptId);
    prereqsOf.set(e.toConceptId, list);
  }
  const gapSet = new Set<string>();
  for (const [concept, atIndex] of firstIndexOfConcept) {
    for (const prereq of prereqsOf.get(concept) ?? []) {
      if (known.has(prereq)) continue;
      const prereqIndex = firstIndexOfConcept.get(prereq);
      if (prereqIndex === undefined || prereqIndex >= atIndex) {
        gapSet.add(`${prereq}→${concept}`);
      }
    }
  }
  if (gapSet.size > 0) {
    issues.push({
      code: "PREREQUISITE_GAP",
      message: `선수 개념 공백 ${gapSet.size}건 (선수가 루트에 없거나 대상 개념보다 뒤에 있음)`,
      conceptIds: [...gapSet].sort(),
    });
  }

  /* 4. 확인테스트 배치 — 개념 수업 장구간 검출 */
  let streak = 0;
  let streakNodes: string[] = [];
  for (const n of nodes) {
    if (n.isCheckpoint) {
      streak = 0;
      streakNodes = [];
      continue;
    }
    if (n.kind === "concept_lesson" || n.kind === "problem_solving") {
      streak++;
      streakNodes.push(n.nodeId);
      if (streak === input.maxNodesBetweenCheckpoints + 1) {
        issues.push({
          code: "CHECKPOINT_GAP",
          message: `확인테스트 없이 ${streak}개 이상의 수업 노드가 이어집니다`,
          nodeIds: [...streakNodes],
        });
      }
    }
  }

  /* 5. 노드 의존 순환·순서 모순 */
  const orderIndex = new Map(nodes.map((n, i) => [n.nodeId, i]));
  const adjacency = new Map<string, string[]>();
  for (const d of input.dependencies) {
    const list = adjacency.get(d.fromNodeId) ?? [];
    list.push(d.toNodeId);
    adjacency.set(d.fromNodeId, list);
    const fromIdx = orderIndex.get(d.fromNodeId);
    const toIdx = orderIndex.get(d.toNodeId);
    if (fromIdx !== undefined && toIdx !== undefined && fromIdx >= toIdx) {
      issues.push({
        code: "DEPENDENCY_ORDER",
        message: `의존 ${d.fromNodeId}→${d.toNodeId}이 정렬 순서와 모순됩니다`,
        nodeIds: [d.fromNodeId, d.toNodeId],
      });
    }
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    for (const next of (adjacency.get(id) ?? []).sort()) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        issues.push({
          code: "DEPENDENCY_CYCLE",
          message: "노드 의존에 순환이 있습니다",
          nodeIds: [...stack.slice(stack.indexOf(next)), next],
        });
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };
  for (const id of [...adjacency.keys()].sort()) {
    if ((color.get(id) ?? WHITE) === WHITE) visit(id);
  }

  return {
    ok: issues.length === 0,
    issues,
    summary: {
      totalMinutes,
      availableMinutes: input.availableMinutes,
      utilization:
        input.availableMinutes > 0 ? totalMinutes / input.availableMinutes : 1,
      conceptsCovered: covered.size,
      conceptsMissing: missing.length,
    },
  };
}
