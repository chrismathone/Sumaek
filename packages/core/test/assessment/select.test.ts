import { describe, expect, it } from "vitest";
import {
  selectQuestions,
  type PoolQuestion,
  type SelectionBucket,
} from "../../src/assessment/select";

function q(
  id: string,
  band: "low" | "mid" | "high",
  concepts: string[] = ["c1"],
  extra?: Partial<PoolQuestion>,
): PoolQuestion {
  return {
    questionId: id,
    questionVersionId: `${id}-v1`,
    conceptIds: concepts,
    difficultyBand: band,
    ...extra,
  };
}

const pool = (prefix: string, n: number, band: "low" | "mid" | "high") =>
  Array.from({ length: n }, (_, i) => q(`${prefix}${i}`, band));

describe("자동 문항 선정 엔진", () => {
  it("버킷 비율대로 선정하고 이유를 기록한다 (일일테스트 50/30/20)", () => {
    const buckets: SelectionBucket[] = [
      { reason: "today_concept", count: 6, candidates: pool("t", 20, "mid") },
      { reason: "weakness", count: 4, candidates: pool("w", 20, "low") },
      { reason: "wrong_answer_review", count: 2, candidates: pool("r", 20, "mid") },
    ];
    const result = selectQuestions(buckets, {}, "seed-1");
    expect(result.selected).toHaveLength(12);
    expect(result.shortfalls).toEqual([]);
    const reasons = result.selected.map((s) => s.reason);
    expect(reasons.filter((r) => r === "today_concept")).toHaveLength(6);
    expect(reasons.filter((r) => r === "weakness")).toHaveLength(4);
    expect(reasons.filter((r) => r === "wrong_answer_review")).toHaveLength(2);
  });

  it("결정론: 같은 풀·제약·시드는 같은 선택과 해시", () => {
    const buckets: SelectionBucket[] = [
      { reason: "today_concept", count: 5, candidates: pool("t", 30, "mid") },
    ];
    const a = selectQuestions(buckets, {}, "seed-x");
    const b = selectQuestions(buckets, {}, "seed-x");
    expect(a.selected).toEqual(b.selected);
    expect(a.outputHash).toBe(b.outputHash);
    // 다른 시드는 (거의 확실히) 다른 선택
    const c = selectQuestions(buckets, {}, "seed-y");
    expect(c.outputHash).not.toBe(a.outputHash);
  });

  it("문항 부족은 조용히 메우지 않고 shortfall로 보고한다", () => {
    const buckets: SelectionBucket[] = [
      { reason: "today_concept", count: 5, candidates: pool("t", 2, "mid") },
      { reason: "weakness", count: 3, candidates: [] },
    ];
    const result = selectQuestions(buckets, {}, "s");
    expect(result.selected).toHaveLength(2);
    expect(result.shortfalls).toEqual([
      {
        reason: "today_concept",
        requested: 5,
        selected: 2,
        cause: "constraints_exhausted",
      },
      { reason: "weakness", requested: 3, selected: 0, cause: "pool_empty" },
    ]);
  });

  it("난이도 분포 목표를 지킨다 (하3·중6·상3)", () => {
    const buckets: SelectionBucket[] = [
      {
        reason: "today_concept",
        count: 12,
        candidates: [
          ...pool("l", 10, "low"),
          ...pool("m", 10, "mid"),
          ...pool("h", 10, "high"),
        ],
      },
    ];
    const result = selectQuestions(
      buckets,
      { difficultyDistribution: { low: 3, mid: 6, high: 3 } },
      "seed-d",
    );
    const bands = result.selected.map((s) => s.difficultyBand);
    expect(bands.filter((b) => b === "low")).toHaveLength(3);
    expect(bands.filter((b) => b === "mid")).toHaveLength(6);
    expect(bands.filter((b) => b === "high")).toHaveLength(3);
  });

  it("중복 문항은 버킷을 넘어 한 번만 선정된다", () => {
    const shared = q("dup", "mid");
    const buckets: SelectionBucket[] = [
      { reason: "today_concept", count: 1, candidates: [shared] },
      { reason: "weakness", count: 1, candidates: [shared, q("w1", "mid")] },
    ];
    const result = selectQuestions(buckets, {}, "s");
    const ids = result.selected.map((s) => s.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("재출제 제한: excludeUsedSince 이후 사용 문항 제외", () => {
    const buckets: SelectionBucket[] = [
      {
        reason: "today_concept",
        count: 2,
        candidates: [
          q("recent", "mid", ["c1"], { lastUsedOn: "2026-08-01" }),
          q("old", "mid", ["c1"], { lastUsedOn: "2026-07-01" }),
          q("fresh", "mid", ["c1"]),
        ],
      },
    ];
    const result = selectQuestions(
      buckets,
      { excludeUsedSince: "2026-07-15" },
      "s",
    );
    const ids = result.selected.map((s) => s.questionId);
    expect(ids).not.toContain("recent");
    expect(ids).toEqual(expect.arrayContaining(["old", "fresh"]));
  });

  it("개념당 최대 문항 수 제약", () => {
    const buckets: SelectionBucket[] = [
      {
        reason: "today_concept",
        count: 5,
        candidates: [
          q("a1", "mid", ["cA"]),
          q("a2", "mid", ["cA"]),
          q("a3", "mid", ["cA"]),
          q("b1", "mid", ["cB"]),
          q("b2", "mid", ["cB"]),
        ],
      },
    ];
    const result = selectQuestions(buckets, { maxPerConcept: 2 }, "s");
    expect(result.selected).toHaveLength(4);
    expect(result.shortfalls[0]?.cause).toBe("constraints_exhausted");
  });

  it("노출 횟수가 낮은 문항을 우선한다 (편중 방지)", () => {
    const buckets: SelectionBucket[] = [
      {
        reason: "today_concept",
        count: 2,
        candidates: [
          q("hot1", "mid", ["c1"], { exposureCount: 50 }),
          q("hot2", "mid", ["c1"], { exposureCount: 40 }),
          q("cold1", "mid", ["c1"], { exposureCount: 0 }),
          q("cold2", "mid", ["c1"], { exposureCount: 1 }),
        ],
      },
    ];
    const result = selectQuestions(buckets, {}, "s");
    const ids = result.selected.map((s) => s.questionId);
    expect(ids).toEqual(expect.arrayContaining(["cold1", "cold2"]));
  });
});
