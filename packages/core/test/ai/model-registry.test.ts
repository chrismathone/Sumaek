import { describe, expect, it } from "vitest";
import {
  DEFAULT_HALT_CRITERIA,
  DEFAULT_PROMOTION_CRITERIA,
  evaluateHalt,
  evaluatePromotionGate,
  selectModels,
  type CanaryMetrics,
  type ModelVersion,
} from "../../src/ai/model-registry";

/* ─────────────────────────────────────────────────────────────
 * 모델 레지스트리 · 승격 게이트 · 중단 판정 (인수 36).
 *
 * 게이트 테스트는 "통과하는 기준선 하나"를 두고 **한 번에 한 필드만**
 * 망가뜨린다. 그래야 어떤 기준이 실제로 무엇을 막는지가 테스트에 남는다 —
 * 여러 필드를 한꺼번에 나쁘게 만든 테스트는 기준 하나를 지워도 계속 통과한다.
 * ───────────────────────────────────────────────────────────── */

function version(overrides: Partial<ModelVersion> & { id: string }): ModelVersion {
  return {
    operation: "extract_questions",
    provider: "mock",
    model: "mock-extractor-v1",
    role: "candidate",
    ...overrides,
  };
}

describe("selectModels — 레지스트리에서 실사용·섀도 모델 고르기", () => {
  it("빈 레지스트리는 둘 다 null — 공급자 기본 모델로 돌아간다", () => {
    const selection = selectModels([], {
      operation: "extract_questions",
      deployedProvider: "mock",
    });
    expect(selection.active).toBeNull();
    expect(selection.canary).toBeNull();
  });

  it("active·canary 역할만 고른다 (candidate·halted·retired 제외)", () => {
    const rows = [
      version({ id: "1", role: "candidate", model: "cand" }),
      version({ id: "2", role: "halted", model: "halted" }),
      version({ id: "3", role: "retired", model: "old" }),
      version({ id: "4", role: "active", model: "v1" }),
      version({ id: "5", role: "canary", model: "v2" }),
    ];
    const selection = selectModels(rows, {
      operation: "extract_questions",
      deployedProvider: "mock",
    });
    expect(selection.active?.model).toBe("v1");
    expect(selection.canary?.model).toBe("v2");
  });

  it("다른 작업(operation)의 행은 섞이지 않는다", () => {
    const rows = [
      version({ id: "1", role: "active", model: "v1", operation: "grade_answer" }),
      version({ id: "2", role: "canary", model: "v2", operation: "grade_answer" }),
    ];
    const selection = selectModels(rows, {
      operation: "extract_questions",
      deployedProvider: "mock",
    });
    expect(selection.active).toBeNull();
    expect(selection.canary).toBeNull();
  });

  it("배포 공급자와 다른 공급자는 실사용으로도 섀도로도 쓰지 않는다", () => {
    // 섀도는 실사용 원문을 그대로 보낸다 — DB 행 하나로 다른 벤더에
    // 고객 콘텐츠가 넘어가면 안 된다.
    const rows = [
      version({ id: "1", role: "active", provider: "other-vendor", model: "x" }),
      version({ id: "2", role: "canary", provider: "other-vendor", model: "y" }),
    ];
    const selection = selectModels(rows, {
      operation: "extract_questions",
      deployedProvider: "mock",
    });
    expect(selection.active).toBeNull();
    expect(selection.canary).toBeNull();
    expect(selection.skipped).toHaveLength(2);
    expect(selection.skipped[0]?.reason).toContain("배포 공급자");
  });

  it("실사용과 같은 모델이면 섀도를 돌리지 않는다 (비용만 두 배)", () => {
    const rows = [
      version({ id: "1", role: "active", model: "same" }),
      version({ id: "2", role: "canary", model: "same" }),
    ];
    const selection = selectModels(rows, {
      operation: "extract_questions",
      deployedProvider: "mock",
    });
    expect(selection.active?.model).toBe("same");
    expect(selection.canary).toBeNull();
    expect(selection.skipped[0]?.reason).toContain("같은 모델");
  });

  it("active가 없어도 canary는 선택된다 — 기본 모델 대비 섀도", () => {
    const rows = [version({ id: "1", role: "canary", model: "v2" })];
    const selection = selectModels(rows, {
      operation: "extract_questions",
      deployedProvider: "mock",
    });
    expect(selection.active).toBeNull();
    expect(selection.canary?.model).toBe("v2");
  });
});

/** 전 기준을 넉넉히 통과하는 표본 — 여기서 한 필드씩만 망가뜨린다 */
function passingMetrics(overrides: Partial<CanaryMetrics> = {}): CanaryMetrics {
  return {
    samples: 40,
    errorCount: 0,
    meanAgreement: 0.99,
    baselineLatencyP95Ms: 800,
    canaryLatencyP95Ms: 820,
    baselineCostUsd: 1.0,
    canaryCostUsd: 1.1,
    costPriced: true,
    ...overrides,
  };
}

describe("evaluatePromotionGate — 기준 미달이면 승격을 막는다", () => {
  it("전 기준을 넘으면 승격 가능", () => {
    const decision = evaluatePromotionGate(passingMetrics());
    expect(decision.promotable).toBe(true);
    expect(decision.failures).toHaveLength(0);
  });

  it("표본이 모자라면 막는다", () => {
    const decision = evaluatePromotionGate(
      passingMetrics({ samples: DEFAULT_PROMOTION_CRITERIA.minSamples - 1 }),
    );
    expect(decision.promotable).toBe(false);
    expect(decision.failures.map((f) => f.criterion)).toEqual(["samples"]);
  });

  it("일치도가 하한에 못 미치면 막는다", () => {
    const decision = evaluatePromotionGate(passingMetrics({ meanAgreement: 0.9 }));
    expect(decision.promotable).toBe(false);
    expect(decision.failures.map((f) => f.criterion)).toEqual(["agreement"]);
  });

  it("성공 표본이 하나도 없으면(일치도 null) 막는다", () => {
    const decision = evaluatePromotionGate(
      // 실패율은 임계 안이지만 성공 표본이 없다 — 계산할 일치도가 없다
      passingMetrics({ meanAgreement: null }),
    );
    expect(decision.promotable).toBe(false);
    expect(decision.failures.map((f) => f.criterion)).toEqual(["agreement"]);
  });

  it("실패율이 상한을 넘으면 막는다", () => {
    // 40건 중 4건 실패 = 10% > 2%
    const decision = evaluatePromotionGate(passingMetrics({ errorCount: 4 }));
    expect(decision.promotable).toBe(false);
    expect(decision.failures.map((f) => f.criterion)).toEqual(["error_rate"]);
  });

  it("p95 지연이 허용 배수를 넘으면 막는다", () => {
    // 800 × 1.25 + 50 = 1050ms 가 허용치
    const decision = evaluatePromotionGate(
      passingMetrics({ canaryLatencyP95Ms: 1_051 }),
    );
    expect(decision.promotable).toBe(false);
    expect(decision.failures.map((f) => f.criterion)).toEqual(["latency"]);
  });

  it("지연 절대 허용치 안이면 비율이 커도 통과한다", () => {
    // 기준선 1ms · 카나리 40ms — 비율은 40배지만 사용자는 체감하지 못한다.
    // 이 완충이 없으면 목 공급자처럼 지연이 0에 가까운 환경에서
    // 승격이 영영 불가능해진다.
    const decision = evaluatePromotionGate(
      passingMetrics({ baselineLatencyP95Ms: 1, canaryLatencyP95Ms: 40 }),
    );
    expect(decision.promotable).toBe(true);
  });

  it("비용이 허용 배수를 넘으면 막는다", () => {
    const decision = evaluatePromotionGate(
      passingMetrics({ baselineCostUsd: 1, canaryCostUsd: 1.6 }),
    );
    expect(decision.promotable).toBe(false);
    expect(decision.failures.map((f) => f.criterion)).toEqual(["cost"]);
  });

  it("가격표에 없는 모델은 비용 0으로 통과시키지 않는다", () => {
    const decision = evaluatePromotionGate(
      passingMetrics({ costPriced: false, canaryCostUsd: 0 }),
    );
    expect(decision.promotable).toBe(false);
    expect(decision.failures[0]?.criterion).toBe("cost");
    expect(decision.failures[0]?.message).toContain("가격표");
  });

  it("기준선이 무료인데 카나리가 유료면 그 자체가 회귀다", () => {
    const decision = evaluatePromotionGate(
      passingMetrics({ baselineCostUsd: 0, canaryCostUsd: 0.5 }),
    );
    expect(decision.promotable).toBe(false);
    expect(decision.failures.map((f) => f.criterion)).toEqual(["cost"]);
  });

  it("둘 다 무료면 비용은 문제 삼지 않는다", () => {
    const decision = evaluatePromotionGate(
      passingMetrics({ baselineCostUsd: 0, canaryCostUsd: 0 }),
    );
    expect(decision.promotable).toBe(true);
  });

  it("실패한 기준을 첫 건에서 멈추지 않고 전부 보고한다", () => {
    // 운영자가 한 번에 하나씩만 고치게 되면 승격이 며칠씩 늦어진다.
    const decision = evaluatePromotionGate(
      passingMetrics({
        samples: 3,
        errorCount: 3,
        meanAgreement: 0.1,
        canaryLatencyP95Ms: 9_000,
        canaryCostUsd: 99,
      }),
    );
    expect(decision.promotable).toBe(false);
    expect(decision.failures.map((f) => f.criterion).sort()).toEqual([
      "agreement",
      "cost",
      "error_rate",
      "latency",
      "samples",
    ]);
  });
});

describe("evaluateHalt — 운영 중 악화되면 중단한다", () => {
  it("표본이 적으면 전부 실패해도 중단하지 않는다", () => {
    const decision = evaluateHalt(
      passingMetrics({
        samples: DEFAULT_HALT_CRITERIA.minSamples - 1,
        errorCount: DEFAULT_HALT_CRITERIA.minSamples - 1,
        meanAgreement: null,
      }),
    );
    expect(decision.halt).toBe(false);
  });

  it("실패율이 중단 임계를 넘으면 사유와 함께 중단한다", () => {
    // 10건 중 5건 실패 = 50% > 25%
    const decision = evaluateHalt(
      passingMetrics({ samples: 10, errorCount: 5, meanAgreement: 0.99 }),
    );
    expect(decision.halt).toBe(true);
    expect(decision.reason).toContain("실패율");
  });

  it("일치도가 중단 임계 아래로 떨어지면 중단한다", () => {
    const decision = evaluateHalt(
      passingMetrics({ samples: 10, errorCount: 0, meanAgreement: 0.4 }),
    );
    expect(decision.halt).toBe(true);
    expect(decision.reason).toContain("일치도");
  });

  it("건강한 카나리는 중단하지 않는다", () => {
    expect(evaluateHalt(passingMetrics()).halt).toBe(false);
  });

  it("승격 기준을 못 넘는 카나리라고 해서 중단되지는 않는다", () => {
    // 두 기준이 같은 임계로 묶이면, 승격에 조금 못 미치는 카나리가 계속
    // 중단되어 표본을 모을 기회 자체를 잃는다.
    const mediocre = passingMetrics({
      samples: 30,
      errorCount: 3, // 10% — 승격 상한 2% 초과, 중단 임계 25% 미만
      meanAgreement: 0.8, // 승격 하한 0.95 미만, 중단 임계 0.6 초과
    });
    expect(evaluatePromotionGate(mediocre).promotable).toBe(false);
    expect(evaluateHalt(mediocre).halt).toBe(false);
  });
});
