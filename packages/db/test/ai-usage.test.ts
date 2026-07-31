import { describe, expect, it } from "vitest";
import {
  estimateCostUsd,
  evaluateBudget,
} from "../src/domain/ai-usage";

/* AI 비용 한도 판정 (인수 37) — 순수 부분.
 * DB 왕복(집계·알림)은 반입 E2E·통합 경로가 덮는다. */

describe("estimateCostUsd", () => {
  it("가격표에 있는 모델은 토큰 비례로 계산한다", () => {
    // mock: 입력 $3/M, 출력 $15/M
    expect(estimateCostUsd("mock", "mock-extractor-v1", 1_000_000, 0)).toBe(3);
    expect(estimateCostUsd("mock", "mock-extractor-v1", 0, 1_000_000)).toBe(15);
    expect(
      estimateCostUsd("mock", "mock-extractor-v1", 500_000, 100_000),
    ).toBeCloseTo(1.5 + 1.5, 10);
  });

  it("가격표에 없는 모델은 0으로 기록한다 (막지 않되 과장하지 않음)", () => {
    expect(estimateCostUsd("unknown", "model-x", 1_000_000, 1_000_000)).toBe(0);
  });
});

describe("evaluateBudget", () => {
  it("예산 미설정이면 기록만 하고 막지 않는다", () => {
    const r = evaluateBudget({ monthToDateUsd: 999, limitUsd: null, warnRatio: 0.8 });
    expect(r.allowed).toBe(true);
    expect(r.warn).toBe(false);
  });

  it("경고 임계(80%) 미만은 통과·무경고", () => {
    const r = evaluateBudget({ monthToDateUsd: 79.99, limitUsd: 100, warnRatio: 0.8 });
    expect(r.allowed).toBe(true);
    expect(r.warn).toBe(false);
  });

  it("경고 임계 도달은 통과하되 경고한다", () => {
    const r = evaluateBudget({ monthToDateUsd: 80, limitUsd: 100, warnRatio: 0.8 });
    expect(r.allowed).toBe(true);
    expect(r.warn).toBe(true);
    expect(r.message).toContain("경고 임계");
  });

  it("한도 도달은 차단한다 (인수 37 — 100% 차단)", () => {
    const r = evaluateBudget({ monthToDateUsd: 100, limitUsd: 100, warnRatio: 0.8 });
    expect(r.allowed).toBe(false);
    expect(r.message).toContain("차단");
  });
});
