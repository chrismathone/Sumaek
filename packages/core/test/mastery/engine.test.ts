import { describe, expect, it } from "vitest";
import {
  DEFAULT_MASTERY_POLICY,
  estimateMastery,
  nextReviewDate,
  type MasteryEvidenceInput,
} from "../../src/mastery/engine";

const ASOF = "2026-08-10T00:00:00Z";

let seq = 0;
function ev(
  date: string,
  correct: boolean,
  extra?: Partial<MasteryEvidenceInput["signal"]> & {
    mappingConfidence?: number;
  },
): MasteryEvidenceInput {
  const { mappingConfidence, ...signal } = extra ?? {};
  return {
    evidenceId: `e${seq++}`,
    evidenceDate: date,
    occurredAt: `${date}T10:00:00Z`,
    mappingConfidence: mappingConfidence ?? 1,
    signal: {
      correct,
      difficulty: 0.5,
      dimension: "procedural",
      ...signal,
    },
  };
}

describe("숙련도 추정 엔진", () => {
  it("증거가 없으면 no_evidence", () => {
    const r = estimateMastery([], DEFAULT_MASTERY_POLICY, ASOF);
    expect(r.state).toBe("no_evidence");
    expect(r.pointEstimate).toBeNull();
  });

  it("한 번의 정답만으로 숙련을 확정하지 않는다 (원칙 14)", () => {
    const r = estimateMastery(
      [ev("2026-08-09", true, { dimension: "conceptual" })],
      DEFAULT_MASTERY_POLICY,
      ASOF,
    );
    expect(r.state).toBe("exploring");
    expect(r.explanation.join(" ")).toContain("한 번의 결과로 확정하지 않는다");
  });

  it("같은 날 반복은 학습일 1일 — stable 불가", () => {
    const r = estimateMastery(
      [
        ev("2026-08-09", true, { dimension: "conceptual" }),
        ev("2026-08-09", true),
        ev("2026-08-09", true),
      ],
      DEFAULT_MASTERY_POLICY,
      ASOF,
    );
    expect(r.distinctDays).toBe(1);
    expect(r.state).toBe("exploring");
  });

  it("서로 다른 날짜·필수 차원 충족 + 높은 정답률 → stable", () => {
    const r = estimateMastery(
      [
        ev("2026-08-05", true, { dimension: "conceptual" }),
        ev("2026-08-07", true, { dimension: "procedural" }),
        ev("2026-08-09", true, { dimension: "procedural" }),
      ],
      DEFAULT_MASTERY_POLICY,
      ASOF,
    );
    expect(r.state).toBe("stable");
    expect(r.pointEstimate).toBeGreaterThanOrEqual(0.8);
    expect(r.nextCheck?.kind).toBe("transfer_check");
  });

  it("필수 차원(개념 이해) 증거가 없으면 stable이 될 수 없다", () => {
    const r = estimateMastery(
      [
        ev("2026-08-05", true), // 전부 procedural
        ev("2026-08-07", true),
        ev("2026-08-09", true),
      ],
      DEFAULT_MASTERY_POLICY,
      ASOF,
    );
    expect(r.state).toBe("partial");
    expect(r.explanation.join(" ")).toContain("필수 차원");
  });

  it("전이 맥락 정답이 있으면 transfer_confirmed", () => {
    const r = estimateMastery(
      [
        ev("2026-08-05", true, { dimension: "conceptual" }),
        ev("2026-08-07", true, { dimension: "procedural" }),
        ev("2026-08-09", true, { dimension: "application", isTransfer: true }),
      ],
      DEFAULT_MASTERY_POLICY,
      ASOF,
    );
    expect(r.state).toBe("transfer_confirmed");
  });

  it("오래 확인하지 않으면 recheck_needed — 영구 래치 금지", () => {
    const old = [
      ev("2026-05-01", true, { dimension: "conceptual" }),
      ev("2026-05-03", true, { dimension: "procedural" }),
      ev("2026-05-05", true, { dimension: "procedural" }),
    ];
    // 5월 초 기준으로는 stable
    const then = estimateMastery(old, DEFAULT_MASTERY_POLICY, "2026-05-06T00:00:00Z");
    expect(then.state).toBe("stable");
    // 석 달 뒤에는 자동으로 재점검 필요 — is_mastered 래치가 아니다
    const now = estimateMastery(old, DEFAULT_MASTERY_POLICY, ASOF);
    expect(now.state).toBe("recheck_needed");
  });

  it("힌트 사용 증거는 가중이 낮다", () => {
    const noHint = estimateMastery(
      [
        ev("2026-08-05", true, { dimension: "conceptual" }),
        ev("2026-08-07", false, { dimension: "procedural" }),
        ev("2026-08-09", true, { dimension: "procedural" }),
      ],
      DEFAULT_MASTERY_POLICY,
      ASOF,
    );
    const withHint = estimateMastery(
      [
        ev("2026-08-05", true, { dimension: "conceptual", hintUsed: true }),
        ev("2026-08-07", false, { dimension: "procedural" }),
        ev("2026-08-09", true, { dimension: "procedural", hintUsed: true }),
      ],
      DEFAULT_MASTERY_POLICY,
      ASOF,
    );
    expect(withHint.pointEstimate ?? 0).toBeLessThan(noHint.pointEstimate ?? 0);
  });

  it("결정론: 같은 증거·정책·기준 시각 = 같은 결과", () => {
    const evidence = [
      ev("2026-08-05", true, { dimension: "conceptual" }),
      ev("2026-08-07", false),
    ];
    const a = estimateMastery(evidence, DEFAULT_MASTERY_POLICY, ASOF);
    const b = estimateMastery(evidence, DEFAULT_MASTERY_POLICY, ASOF);
    expect(a).toEqual(b);
  });

  it("cutoff 이후 증거는 계산에서 제외 — 재현 가능성 (불변 조건 11)", () => {
    const evidence = [
      ev("2026-08-05", true, { dimension: "conceptual" }),
      ev("2026-08-07", true, { dimension: "procedural" }),
      ev("2026-08-09", true),
      ev("2026-08-15", false), // cutoff 이후
    ];
    const r = estimateMastery(evidence, DEFAULT_MASTERY_POLICY, ASOF);
    expect(r.evidenceCount).toBe(3);
  });

  it("임계값 변경은 정책 객체로만 — 다른 정책은 다른 판정", () => {
    const evidence = [
      ev("2026-08-05", true, { dimension: "conceptual" }),
      ev("2026-08-07", true, { dimension: "procedural" }),
      ev("2026-08-08", false, { dimension: "procedural" }),
      ev("2026-08-09", true, { dimension: "procedural" }),
    ];
    const lenient = estimateMastery(
      evidence,
      { ...DEFAULT_MASTERY_POLICY, stableThreshold: 0.6 },
      ASOF,
    );
    const strict = estimateMastery(
      evidence,
      { ...DEFAULT_MASTERY_POLICY, stableThreshold: 0.95 },
      ASOF,
    );
    expect(lenient.state).toBe("stable");
    expect(strict.state).toBe("partial");
  });
});

describe("간격 복습", () => {
  it("정답이면 다음 단계, 오답이면 1단계 리셋", () => {
    const p = DEFAULT_MASTERY_POLICY; // [1,3,7,14,30]
    expect(nextReviewDate(p, 1, true, "2026-08-10")).toEqual({
      stage: 2,
      dueOn: "2026-08-13",
    });
    expect(nextReviewDate(p, 3, false, "2026-08-10")).toEqual({
      stage: 1,
      dueOn: "2026-08-11",
    });
  });

  it("마지막 단계 정답이면 졸업", () => {
    expect(nextReviewDate(DEFAULT_MASTERY_POLICY, 5, true, "2026-08-10")).toBeNull();
  });
});
