import { describe, expect, it } from "vitest";
import { DEFAULT_MASTERY_POLICY } from "../../src/mastery/engine";
import {
  FORGETTING_DEFAULTS,
  forgettingParams,
  initialReviewSchedule,
  predictedRetention,
  scheduleNextReview,
} from "../../src/mastery/forgetting";
import type { IsoDate } from "../../src/shared/dates";

/* ─────────────────────────────────────────────────────────────
 * 망각곡선 복습 스케줄러.
 *
 * 이 로직이 들어오기 전 간격 반복은 **작동한 적이 없었다** — 배열의 첫 값만
 * 쓰이고 단계를 저장할 곳이 없어 "간격 1일 무한 반복"이었다. 그래서 여기서
 * 겨누는 것은 "늘어나는가·줄어드는가"와 **"상한이 뚫리지 않는가"** 다.
 * 사용자가 최장 1달을 못박았으므로 상한은 규격이지 취향이 아니다.
 * ───────────────────────────────────────────────────────────── */

const DAY0 = "2026-08-10" as IsoDate;
const P = DEFAULT_MASTERY_POLICY;

describe("예측 기억률", () => {
  it("안정성만큼 지나면 정확히 목표 유지율이 된다 — 모델의 정의 자체", () => {
    for (const s of [1, 3, 7, 30]) {
      expect(
        predictedRetention({ stabilityDays: s, daysSinceReview: s }),
      ).toBeCloseTo(FORGETTING_DEFAULTS.targetRetention, 10);
    }
  });

  it("방금 복습했으면 1, 시간이 갈수록 단조 감소한다", () => {
    expect(predictedRetention({ stabilityDays: 7, daysSinceReview: 0 })).toBe(1);
    const series = [0, 1, 3, 7, 14, 30, 90].map((d) =>
      predictedRetention({ stabilityDays: 7, daysSinceReview: d }),
    );
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!).toBeLessThan(series[i - 1]!);
    }
    expect(series.at(-1)!).toBeGreaterThan(0);
  });

  it("안정성이 큰 개념이 같은 시점에 더 많이 남아 있다 — 출제 정렬의 근거", () => {
    const weak = predictedRetention({ stabilityDays: 2, daysSinceReview: 10 });
    const strong = predictedRetention({ stabilityDays: 20, daysSinceReview: 10 });
    expect(weak).toBeLessThan(strong);
  });

  it("미래 날짜(음수 경과)를 1보다 크게 만들지 않는다", () => {
    expect(predictedRetention({ stabilityDays: 7, daysSinceReview: -5 })).toBe(1);
  });
});

describe("복습 일정 — 처음 배치", () => {
  it("틀린 다음 날 다시 확인한다", () => {
    const r = initialReviewSchedule({ policy: P, occurredOn: DAY0 });
    expect(r.dueOn).toBe("2026-08-11");
    expect(r.intervalDays).toBe(1);
    expect(r.repetitionNo).toBe(0);
    expect(r.lapseCount).toBe(0);
    expect(r.explanation.join(" ")).toContain("다시 확인");
  });

  it("정책이 초기 안정성을 정한다 — 코드 상수가 아니다", () => {
    const r = initialReviewSchedule({
      policy: { ...P, initialStabilityDays: 5 },
      occurredOn: DAY0,
    });
    expect(r.dueOn).toBe("2026-08-15");
  });
});

describe("복습 일정 — 갱신", () => {
  it("맞히면 간격이 늘어난다 (예전에는 늘지 않았다)", () => {
    const r = scheduleNextReview({
      policy: P,
      stabilityDays: 1,
      repetitionNo: 0,
      lapseCount: 0,
      wasCorrect: true,
      dueOn: DAY0,
      reviewedOn: DAY0,
    });
    expect(r.stabilityDays).toBe(2);
    expect(r.dueOn).toBe("2026-08-12");
    expect(r.repetitionNo).toBe(1);
    expect(r.explanation.join(" ")).toContain("맞혔으므로");
  });

  it("틀리면 줄되 하한 아래로 내려가지 않는다", () => {
    const r = scheduleNextReview({
      policy: P,
      stabilityDays: 16,
      repetitionNo: 4,
      lapseCount: 1,
      wasCorrect: false,
      dueOn: DAY0,
      reviewedOn: DAY0,
    });
    expect(r.stabilityDays).toBeCloseTo(6.4, 5);
    expect(r.lapseCount).toBe(2);

    const floor = scheduleNextReview({
      policy: P,
      stabilityDays: 1,
      repetitionNo: 1,
      lapseCount: 0,
      wasCorrect: false,
      dueOn: DAY0,
      reviewedOn: DAY0,
    });
    expect(floor.stabilityDays).toBe(FORGETTING_DEFAULTS.minStabilityDays);
    expect(floor.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it("연속 정답 20회로도 상한 30일을 넘지 못한다 — 사용자가 못박은 규격", () => {
    let stability: number | null = null;
    let rep = 0;
    let day = DAY0;
    for (let i = 0; i < 20; i++) {
      const r = scheduleNextReview({
        policy: P,
        stabilityDays: stability,
        repetitionNo: rep,
        lapseCount: 0,
        wasCorrect: true,
        dueOn: day,
        reviewedOn: day,
      });
      expect(r.stabilityDays).toBeLessThanOrEqual(30);
      expect(r.intervalDays).toBeLessThanOrEqual(30);
      stability = r.stabilityDays;
      rep = r.repetitionNo;
      day = r.dueOn;
    }
    expect(stability).toBe(30);
  });

  it("늦게 보고도 맞히면 보너스가 붙되 상한을 넘지 않는다", () => {
    const onTime = scheduleNextReview({
      policy: P,
      stabilityDays: 4,
      repetitionNo: 2,
      lapseCount: 0,
      wasCorrect: true,
      dueOn: "2026-08-10" as IsoDate,
      reviewedOn: "2026-08-10" as IsoDate,
    });
    const late = scheduleNextReview({
      policy: P,
      stabilityDays: 4,
      repetitionNo: 2,
      lapseCount: 0,
      wasCorrect: true,
      dueOn: "2026-08-10" as IsoDate,
      reviewedOn: "2026-08-18" as IsoDate,
    });
    expect(late.stabilityDays).toBeGreaterThan(onTime.stabilityDays);
    expect(late.stabilityDays).toBeLessThanOrEqual(30);
    expect(late.explanation.join(" ")).toContain("늦게");

    // 아주 늦게 봐도 보너스 상한에서 멈춘다
    const veryLate = scheduleNextReview({
      policy: P,
      stabilityDays: 4,
      repetitionNo: 2,
      lapseCount: 0,
      wasCorrect: true,
      dueOn: "2026-08-10" as IsoDate,
      reviewedOn: "2027-08-10" as IsoDate,
    });
    expect(veryLate.stabilityDays).toBeLessThanOrEqual(
      4 * FORGETTING_DEFAULTS.successMultiplier * FORGETTING_DEFAULTS.maxOverdueBonus,
    );
  });

  it("일찍 봐도 보너스가 붙지 않는다 (음수 경과를 이득으로 세지 않는다)", () => {
    const early = scheduleNextReview({
      policy: P,
      stabilityDays: 4,
      repetitionNo: 1,
      lapseCount: 0,
      wasCorrect: true,
      dueOn: "2026-08-20" as IsoDate,
      reviewedOn: "2026-08-10" as IsoDate,
    });
    expect(early.stabilityDays).toBe(8);
    expect(early.explanation.join(" ")).not.toContain("늦게");
  });

  it("상한에서 잘렸다는 사실을 설명에 남긴다", () => {
    const r = scheduleNextReview({
      policy: P,
      stabilityDays: 25,
      repetitionNo: 6,
      lapseCount: 0,
      wasCorrect: true,
      dueOn: DAY0,
      reviewedOn: DAY0,
    });
    expect(r.stabilityDays).toBe(30);
    expect(r.explanation.join(" ")).toContain("상한");
  });

  it("같은 입력은 같은 결과를 낸다 — 재현 가능성", () => {
    const args = {
      policy: P,
      stabilityDays: 3,
      repetitionNo: 2,
      lapseCount: 1,
      wasCorrect: true,
      dueOn: DAY0,
      reviewedOn: "2026-08-12" as IsoDate,
    };
    expect(scheduleNextReview(args)).toEqual(scheduleNextReview(args));
  });
});

describe("정책 해석", () => {
  it("망각곡선 필드가 없는 낡은 정책도 기본값으로 동작한다 — DB에 그런 행이 있다", () => {
    const legacy = {
      minEvidenceCount: 3,
      minDistinctDays: 2,
      recencyHalfLifeDays: 30,
      stableThreshold: 0.8,
      partialThreshold: 0.4,
      recheckAfterDays: 45,
      transferEvidenceCount: 1,
      hintPenalty: 0.6,
      requiredDimensions: [],
      reviewIntervalsDays: [1, 3, 7, 14, 30],
    };
    expect(forgettingParams(legacy)).toEqual(FORGETTING_DEFAULTS);
    const r = scheduleNextReview({
      policy: legacy,
      stabilityDays: null,
      repetitionNo: 0,
      lapseCount: 0,
      wasCorrect: true,
      dueOn: null,
      reviewedOn: DAY0,
    });
    expect(r.dueOn).toBe("2026-08-12");
  });

  it("정책이 아예 없어도(null) 동작한다", () => {
    expect(forgettingParams(null)).toEqual(FORGETTING_DEFAULTS);
    expect(forgettingParams(undefined)).toEqual(FORGETTING_DEFAULTS);
  });

  /* 잘못 저장된 정책이 스케줄러를 망가뜨리면 안 된다. 정책은 jsonb라
   * 스키마 검증이 없어(조사에서 확인) 무엇이든 들어올 수 있다. */
  it("범위를 벗어난 값은 조용히 쓰지 않고 기본값으로 되돌린다", () => {
    const broken = {
      targetRetention: 1, // ln(1/θ)=0 → 0으로 나눔
      successMultiplier: 0.5, // 1 이하면 간격이 줄어든다
      lapseMultiplier: 2, // 1 이상이면 틀렸는데 늘어난다
      maxIntervalDays: -5,
      minStabilityDays: 0,
      maxOverdueBonus: 100,
      initialStabilityDays: Number.POSITIVE_INFINITY,
    } as never;
    expect(forgettingParams(broken)).toEqual(FORGETTING_DEFAULTS);
  });

  it("θ=1에 가까운 정책도 유한한 간격을 낸다 (0으로 나누지 않는다)", () => {
    const r = predictedRetention({
      stabilityDays: 7,
      daysSinceReview: 7,
      targetRetention: 0.99,
    });
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeCloseTo(0.99, 10);
  });

  it("정책으로 상한을 바꾸면 그 값이 규격이 된다", () => {
    const r = scheduleNextReview({
      policy: { ...P, maxIntervalDays: 7 },
      stabilityDays: 20,
      repetitionNo: 3,
      lapseCount: 0,
      wasCorrect: true,
      dueOn: DAY0,
      reviewedOn: DAY0,
    });
    expect(r.stabilityDays).toBe(7);
    expect(r.dueOn).toBe("2026-08-17");
  });
});
