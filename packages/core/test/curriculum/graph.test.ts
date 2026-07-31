import { describe, expect, it } from "vitest";
import {
  findOrphanEdges,
  findPrerequisiteCycles,
  planningEdges,
  prerequisitePath,
  validateRelease,
  type GraphEdge,
  type GraphNode,
} from "../../src/curriculum/graph";

const edge = (
  from: string,
  to: string,
  overrides?: Partial<GraphEdge>,
): GraphEdge => ({
  fromConceptId: from,
  toConceptId: to,
  kind: "prerequisite",
  provenance: "human",
  status: "active",
  ...overrides,
});

const node = (id: string, overrides?: Partial<GraphNode>): GraphNode => ({
  conceptId: id,
  status: "active",
  evidenceCount: 1,
  ...overrides,
});

describe("교육과정 개념 그래프", () => {
  it("강한 선수 순환을 경로와 함께 검출한다", () => {
    const cycles = findPrerequisiteCycles([
      edge("a", "b"),
      edge("b", "c"),
      edge("c", "a"),
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.path).toContain("a");
    expect(cycles[0]?.path).toContain("c");
  });

  it("약한 선수·대비 관계는 순환 검사 대상이 아니다 (선형 강제 금지)", () => {
    const cycles = findPrerequisiteCycles([
      edge("a", "b"),
      edge("b", "a", { kind: "soft_prerequisite" }),
      edge("a", "b", { kind: "contrasts_with" }),
      edge("b", "a", { kind: "contrasts_with" }),
    ]);
    expect(cycles).toHaveLength(0);
  });

  it("AI 제안 간선은 자동 계획에서 제외된다", () => {
    const edges = [
      edge("a", "b"),
      edge("b", "c", { provenance: "ai_suggested", status: "active" }),
      edge("c", "d", { status: "draft" }),
    ];
    const usable = planningEdges(edges);
    expect(usable).toHaveLength(1);
    expect(usable[0]?.fromConceptId).toBe("a");
  });

  it("선수 경로를 위상 순서로 반환한다", () => {
    // 일차방정식 ← 등식의 성질 ← 문자와 식, 일차방정식 ← 정수와 유리수
    const edges = [
      edge("문자와식", "등식의성질"),
      edge("등식의성질", "일차방정식"),
      edge("정수와유리수", "일차방정식"),
    ];
    const path = prerequisitePath("일차방정식", edges);
    expect(path[path.length - 1]).toBe("일차방정식");
    expect(path.indexOf("문자와식")).toBeLessThan(path.indexOf("등식의성질"));
    expect(path.indexOf("등식의성질")).toBeLessThan(path.indexOf("일차방정식"));
    expect(path).toContain("정수와유리수");
  });

  it("고아 간선을 검출한다", () => {
    const orphans = findOrphanEdges(
      [edge("a", "ghost")],
      [node("a"), node("b")],
    );
    expect(orphans).toHaveLength(1);
  });
});

describe("릴리스 발행 게이트 (2L 품질 게이트)", () => {
  const goodInput = {
    nodes: [node("a"), node("b")],
    edges: [edge("a", "b")],
    standardCodes: ["9수01-01", "9수01-02"],
  };

  it("정상 릴리스는 통과한다", () => {
    expect(validateRelease(goodInput).ok).toBe(true);
  });

  it("성취기준 코드 중복이 있으면 차단한다", () => {
    const report = validateRelease({
      ...goodInput,
      standardCodes: ["9수01-01", "9수01-01"],
    });
    expect(report.ok).toBe(false);
    expect(report.duplicateStandardCodes).toEqual(["9수01-01"]);
  });

  it("순환이 있으면 전체 릴리스가 차단된다 (인수 43)", () => {
    const report = validateRelease({
      ...goodInput,
      edges: [edge("a", "b"), edge("b", "a")],
    });
    expect(report.ok).toBe(false);
    expect(report.prerequisiteCycles.length).toBeGreaterThan(0);
  });

  it("근거 없는 개념이 있으면 차단한다", () => {
    const report = validateRelease({
      ...goodInput,
      nodes: [node("a"), node("b", { evidenceCount: 0 })],
    });
    expect(report.ok).toBe(false);
    expect(report.conceptsWithoutEvidence).toEqual(["b"]);
  });

  it("AI 제안이 active로 가장되면 차단한다 (인수 46)", () => {
    const report = validateRelease({
      ...goodInput,
      edges: [edge("a", "b", { provenance: "ai_suggested", status: "active" })],
    });
    expect(report.ok).toBe(false);
    expect(report.aiEdgesMasqueradingAsActive).toHaveLength(1);
  });

  it("사용 중인 개념의 폐기는 영향 분석으로 탐지한다", () => {
    const report = validateRelease({
      nodes: [node("a"), node("b", { status: "deprecated" })],
      edges: [],
      standardCodes: [],
      conceptsInUse: ["b"],
    });
    expect(report.ok).toBe(false);
    expect(report.deprecatedConceptsInUse).toEqual(["b"]);
  });
});
