import { describe, expect, it } from "vitest";
import { normalizeShortAnswer } from "../../src/grading/answer-normalize";
import { gradeAnswer, type GradeOptions } from "../../src/grading/grade";

const OPTS: GradeOptions = { minAutoConfidence: 0.9 };

const shortKey = (
  value: string,
  extra?: Partial<{ unit: string; allowEquivalence: boolean }>,
) => ({
  kind: "short_answer" as const,
  accepted: [
    {
      value,
      form: "number" as const,
      allowEquivalence: extra?.allowEquivalence ?? true,
      ...(extra?.unit ? { unit: extra.unit } : {}),
    },
  ],
});

const shortAns = (rawText: string) => ({
  kind: "short_answer" as const,
  rawText,
});

describe("단답 정규화", () => {
  it("분수·소수·정수·대분수를 유리수로 해석한다", () => {
    expect(normalizeShortAnswer("3/4").rational).toEqual({ num: 3n, den: 4n });
    expect(normalizeShortAnswer("0.75").rational).toEqual({ num: 3n, den: 4n });
    expect(normalizeShortAnswer("-12").rational).toEqual({ num: -12n, den: 1n });
    expect(normalizeShortAnswer("1 3/4").rational).toEqual({ num: 7n, den: 4n });
    expect(normalizeShortAnswer("2/4").rational).toEqual({ num: 1n, den: 2n });
  });

  it("LaTeX 분수·전각 숫자·유니코드 마이너스를 처리한다", () => {
    expect(normalizeShortAnswer("\\frac{3}{4}").rational).toEqual({
      num: 3n,
      den: 4n,
    });
    expect(normalizeShortAnswer("１２").rational).toEqual({ num: 12n, den: 1n });
    expect(normalizeShortAnswer("−5").rational).toEqual({ num: -5n, den: 1n });
  });

  it("단위를 분리한다", () => {
    const a = normalizeShortAnswer("12cm");
    expect(a.rational).toEqual({ num: 12n, den: 1n });
    expect(a.unit).toBe("cm");
    const b = normalizeShortAnswer("3/4 L");
    expect(b.rational).toEqual({ num: 3n, den: 4n });
    expect(b.unit).toBe("L");
  });

  it("분모 0·± 표기는 모호로 표시한다", () => {
    expect(normalizeShortAnswer("5/0").ambiguous).toBe(true);
    expect(normalizeShortAnswer("±3").ambiguous).toBe(true);
  });
});

describe("자동 채점 계층", () => {
  it("객관식: 선택지 ID 집합 비교 (표시 문자 아님)", () => {
    const key = { kind: "multiple_choice" as const, correctChoiceIds: ["c2"] };
    const correct = gradeAnswer(
      key,
      { kind: "multiple_choice", selectedChoiceIds: ["c2"] },
      5,
      OPTS,
    );
    expect(correct.verdict).toBe("correct");
    expect(correct.confidence).toBe(1);

    const wrong = gradeAnswer(
      key,
      { kind: "multiple_choice", selectedChoiceIds: ["c3"] },
      5,
      OPTS,
    );
    expect(wrong.verdict).toBe("incorrect");
    expect(wrong.score).toBe(0);
  });

  it("단답: 0.5 = 1/2 = 2/4 동치를 인정하고 근거를 남긴다", () => {
    for (const input of ["0.5", "1/2", "2/4", "\\frac{1}{2}"]) {
      const r = gradeAnswer(shortKey("1/2"), shortAns(input), 4, OPTS);
      expect(r.verdict, input).toBe("correct");
      expect(r.rationale.length).toBeGreaterThan(0);
    }
  });

  it("단답: 표기 형태를 요구하면(allowEquivalence=false) 동치라도 사람 확인", () => {
    const r = gradeAnswer(
      shortKey("1/2", { allowEquivalence: false }),
      shortAns("0.5"),
      4,
      OPTS,
    );
    expect(r.verdict).toBe("needs_review");
    expect(r.exceptionKind).toBe("multiple_valid_answers");
  });

  it("단답: 값이 맞고 단위만 다르면 오답 확정하지 않고 예외함으로", () => {
    const r = gradeAnswer(
      shortKey("12", { unit: "cm" }),
      shortAns("12"),
      4,
      OPTS,
    );
    expect(r.verdict).toBe("needs_review");
    expect(r.exceptionKind).toBe("format_mismatch");
    expect(r.score).toBeNull(); // 점수를 확정하지 않는다
  });

  it("단답: 명백한 불일치는 오답 확정", () => {
    const r = gradeAnswer(shortKey("1/2"), shortAns("2/3"), 4, OPTS);
    expect(r.verdict).toBe("incorrect");
    expect(r.confidence).toBeGreaterThanOrEqual(0.99);
  });

  /* 교재 판별 문항(RPM 0001~ 등)의 정답이 ◯·△·× 기호다. 키보드에 없는
   * 글자라 비슷한 것을 치는데, 코드포인트·대소·한글 ㅇ까지 같은 뜻이면
   * 맞다고 본다. 단 **기준이 기호일 때만** — 기준이 숫자인 문항은 그대로다. */
  it("단답: 기호 답은 동치류로 비교한다 (◯≡○≡O≡o≡ㅇ, ×≡x≡X)", () => {
    for (const input of ["◯", "○", "O", "o", "ㅇ"]) {
      const r = gradeAnswer(shortKey("◯"), shortAns(input), 4, OPTS);
      expect(r.verdict, input).toBe("correct");
    }
    for (const input of ["×", "x", "X", "✕"]) {
      const r = gradeAnswer(shortKey("×"), shortAns(input), 4, OPTS);
      expect(r.verdict, input).toBe("correct");
    }
    expect(gradeAnswer(shortKey("△"), shortAns("▲"), 4, OPTS).verdict).toBe("correct");
    // 다른 기호는 오답
    expect(gradeAnswer(shortKey("◯"), shortAns("△"), 4, OPTS).verdict).toBe("incorrect");
    expect(gradeAnswer(shortKey("◯"), shortAns("x"), 4, OPTS).verdict).toBe("incorrect");
  });

  it("단답: 기준이 숫자면 o·x가 기호로 승격되지 않는다", () => {
    // 정답 0에 대한 o 입력은 오답이다 — 숫자와 기호를 섞지 않는다
    expect(gradeAnswer(shortKey("0"), shortAns("o"), 4, OPTS).verdict).toBe("incorrect");
    expect(gradeAnswer(shortKey("0"), shortAns("0"), 4, OPTS).verdict).toBe("correct");
  });

  it("단답: 비수치 서술 답은 공백 차이를 무시한다", () => {
    const key = shortKey("밑: $2$, 지수: $5$");
    expect(gradeAnswer(key, shortAns("밑:2,지수:5"), 4, OPTS).verdict).toBe("correct");
    expect(gradeAnswer(key, shortAns("밑: 2, 지수: 5"), 4, OPTS).verdict).toBe("correct");
    expect(gradeAnswer(key, shortAns("밑:5,지수:2"), 4, OPTS).verdict).toBe("incorrect");
  });

  it("단답: 공백 무시가 수치 답으로 번지지 않는다 — 대분수 1 3/4 ≠ 13/4", () => {
    const r = gradeAnswer(shortKey("1 3/4"), shortAns("13/4"), 4, OPTS);
    expect(r.verdict).not.toBe("correct");
  });

  it("단답: 식 답은 한 글자 지수 중괄호·×/* 표기 차이를 관용한다", () => {
    const key = shortKey("2^{2}\\times 3^{2}");
    for (const input of ["2^2×3^2", "2^2*3^2", "2^{2}×3^{2}", "2^{2}\\times 3^{2}"]) {
      const r = gradeAnswer(key, shortAns(input), 4, OPTS);
      expect(r.verdict, input).toBe("correct");
    }
    expect(gradeAnswer(key, shortAns("2^3×3^2"), 4, OPTS).verdict).toBe("incorrect");
    expect(
      gradeAnswer(shortKey("5^{3}"), shortAns("5^3"), 4, OPTS).verdict,
    ).toBe("correct");
    // 관용은 **한 글자** 지수에만 — 여러 글자 지수(2^{10})는 중괄호 표기를
    // 요구한다. 벗기면 2^10의 해석이 갈라질 수 있다.
    expect(
      gradeAnswer(shortKey("2^{10}"), shortAns("2^10"), 4, OPTS).verdict,
    ).not.toBe("correct");
  });

  it("단답: ± 등 모호한 답은 확정하지 않는다 (원칙 8)", () => {
    const r = gradeAnswer(shortKey("3"), shortAns("±3"), 4, OPTS);
    expect(r.verdict).toBe("needs_review");
  });

  it("복수 빈칸: 부분 점수", () => {
    const key = {
      kind: "multi_blank" as const,
      blanks: [
        {
          blankId: "b1",
          key: { accepted: [{ value: "3", form: "number" as const, allowEquivalence: true }] },
          points: 2,
        },
        {
          blankId: "b2",
          key: { accepted: [{ value: "5", form: "number" as const, allowEquivalence: true }] },
          points: 2,
        },
      ],
    };
    const r = gradeAnswer(
      key,
      {
        kind: "multi_blank",
        blanks: [
          { blankId: "b1", rawText: "3" },
          { blankId: "b2", rawText: "7" },
        ],
      },
      4,
      OPTS,
    );
    expect(r.verdict).toBe("partial");
    expect(r.score).toBe(2);
    expect(r.maxScore).toBe(4);
  });

  it("서술형: 자동 확정하지 않고 루브릭 경로로 보낸다", () => {
    const key = {
      kind: "essay" as const,
      rubric: [
        { rubricKey: "setup", description: "식 세우기", points: 2, required: true },
        { rubricKey: "solve", description: "풀이", points: 3, required: false },
      ],
    };
    const r = gradeAnswer(
      key,
      { kind: "essay", text: "x를 세우면...", assetIds: [] },
      5,
      OPTS,
    );
    expect(r.verdict).toBe("needs_review");
    expect(r.exceptionKind).toBe("essay_partial");
  });

  it("답안 형식 불일치는 예외함으로", () => {
    const r = gradeAnswer(
      { kind: "multiple_choice", correctChoiceIds: ["c1"] },
      shortAns("텍스트 답"),
      5,
      OPTS,
    );
    expect(r.verdict).toBe("needs_review");
    expect(r.exceptionKind).toBe("format_mismatch");
  });
});
