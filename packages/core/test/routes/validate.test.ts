import { describe, expect, it } from "vitest";
import type { GraphEdge } from "../../src/curriculum/graph";
import {
  validateRoute,
  type RouteNodeForValidation,
  type RouteValidationInput,
} from "../../src/routes/validate";

const node = (
  id: string,
  order: number,
  overrides?: Partial<RouteNodeForValidation>,
): RouteNodeForValidation => ({
  nodeId: id,
  kind: "concept_lesson",
  sortOrder: order,
  conceptIds: [],
  expectedMinutes: 60,
  isCheckpoint: false,
  ...overrides,
});

const prereq = (from: string, to: string): GraphEdge => ({
  fromConceptId: from,
  toConceptId: to,
  kind: "prerequisite",
  provenance: "human",
  status: "active",
});

const base = (overrides?: Partial<RouteValidationInput>): RouteValidationInput => ({
  nodes: [
    node("n1", 1, { conceptIds: ["등식의성질"] }),
    node("n2", 2, { conceptIds: ["일차방정식"] }),
    node("n3", 3, { kind: "confirmation_test", isCheckpoint: true }),
  ],
  dependencies: [],
  conceptEdges: [prereq("등식의성질", "일차방정식")],
  targetConceptIds: ["등식의성질", "일차방정식"],
  assumedKnownConceptIds: [],
  availableMinutes: 600,
  weeklyAvailableMinutes: 300,
  weeks: 2,
  maxNodesBetweenCheckpoints: 5,
  ...overrides,
});

describe("루트 검증·시뮬레이션", () => {
  it("정상 루트는 통과한다", () => {
    const report = validateRoute(base());
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.summary.totalMinutes).toBe(180);
  });

  it("가용 시간 초과를 감지한다", () => {
    const report = validateRoute(base({ availableMinutes: 100 }));
    expect(report.issues.map((i) => i.code)).toContain("OVER_CAPACITY");
  });

  it("주당 학습량 초과를 감지한다", () => {
    const report = validateRoute(base({ weeklyAvailableMinutes: 60 }));
    expect(report.issues.map((i) => i.code)).toContain("WEEKLY_OVERLOAD");
  });

  it("목표 개념 누락을 감지한다", () => {
    const report = validateRoute(
      base({ targetConceptIds: ["등식의성질", "일차방정식", "연립방정식"] }),
    );
    const issue = report.issues.find((i) => i.code === "COVERAGE_GAP");
    expect(issue?.conceptIds).toEqual(["연립방정식"]);
  });

  it("선수 개념이 대상보다 뒤에 있으면 공백으로 감지한다", () => {
    const report = validateRoute(
      base({
        nodes: [
          node("n1", 1, { conceptIds: ["일차방정식"] }),
          node("n2", 2, { conceptIds: ["등식의성질"] }), // 순서 역전
        ],
      }),
    );
    const issue = report.issues.find((i) => i.code === "PREREQUISITE_GAP");
    expect(issue?.conceptIds).toEqual(["등식의성질→일차방정식"]);
  });

  it("이미 아는 개념은 선수 공백이 아니다", () => {
    const report = validateRoute(
      base({
        nodes: [node("n1", 1, { conceptIds: ["일차방정식"] })],
        targetConceptIds: ["일차방정식"],
        assumedKnownConceptIds: ["등식의성질"],
      }),
    );
    expect(report.issues.map((i) => i.code)).not.toContain("PREREQUISITE_GAP");
  });

  it("확인테스트 없는 장구간을 감지한다", () => {
    const nodes = Array.from({ length: 7 }, (_, i) =>
      node(`n${i}`, i, { conceptIds: [] }),
    );
    const report = validateRoute(
      base({
        nodes,
        targetConceptIds: [],
        conceptEdges: [],
        maxNodesBetweenCheckpoints: 5,
      }),
    );
    expect(report.issues.map((i) => i.code)).toContain("CHECKPOINT_GAP");
  });

  it("노드 의존 순환·순서 모순을 감지한다", () => {
    const report = validateRoute(
      base({
        dependencies: [
          { fromNodeId: "n1", toNodeId: "n2" },
          { fromNodeId: "n2", toNodeId: "n1" }, // 순환 + n2→n1 순서 모순
        ],
      }),
    );
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("DEPENDENCY_CYCLE");
    expect(codes).toContain("DEPENDENCY_ORDER");
  });
});
