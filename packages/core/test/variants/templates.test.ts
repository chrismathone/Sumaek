import { describe, expect, it } from "vitest";
import {
  DIVISOR_COUNT,
  evaluateNumericLatex,
  FACTORIZE_NUMBER,
  GCD_OF_FACTORIZATIONS,
  LCM_OF_FACTORIZATIONS,
  makeRng,
  nearbyDistractors,
  renderMultipleChoice,
  RPM_M1_CH1_TEMPLATES,
} from "../../src/variants";

/* ─────────────────────────────────────────────────────────────
 * 변형 템플릿.
 *
 * 가장 중요한 단언은 **원본 재현**이다 — 교재에 실린 문항의 숫자를 그대로
 * 넣었을 때 교재에 인쇄된 답이 나오는가. 이게 되어야 같은 풀이기가 만든
 * 변형본을 믿을 수 있다.
 * ───────────────────────────────────────────────────────────── */

describe("원본 재현 — 교재에 실린 문항과 답", () => {
  it("문항 0135: 세 수의 최대공약수는 2×3²", () => {
    const stem =
      "세 수 $2^{3}\\times 3^{3}$, $2\\times 3^{4}\\times 7$, $2^{2}\\times 3^{2}\\times 5$의 최대공약수는?";
    const params = GCD_OF_FACTORIZATIONS.parse(stem, null);
    expect(params).not.toBeNull();
    expect(GCD_OF_FACTORIZATIONS.solve(params!).value).toBe(2 * 9);
  });

  it("문항 0136: 답을 「15」로 인쇄해도 값이 같으면 재현이다", () => {
    const stem =
      "세 수 $2^{2}\\times 3^{3}\\times 5$, $2\\times 3\\times 5^{2}\\times 7$, $3^{2}\\times 5$의 최대공약수는?";
    const params = GCD_OF_FACTORIZATIONS.parse(stem, null)!;
    const solution = GCD_OF_FACTORIZATIONS.solve(params);
    expect(solution.display).toBe("3\\times 5");
    expect(evaluateNumericLatex(solution.display)).toBe(15);
  });

  it("문항 0152: 세 수의 최소공배수는 2³×3²×5×7×11", () => {
    const stem =
      "세 수 $2\\times 3\\times 7$, $2^{3}\\times 3\\times 5\\times 11$, $3^{2}\\times 5$의 최소공배수는?";
    const params = LCM_OF_FACTORIZATIONS.parse(stem, null)!;
    expect(LCM_OF_FACTORIZATIONS.solve(params).value).toBe(2 ** 3 * 3 ** 2 * 5 * 7 * 11);
  });

  it("문항 0039: 135의 약수의 개수는 8", () => {
    const params = DIVISOR_COUNT.parse("$135$의 약수의 개수를 구하시오.", null)!;
    expect(DIVISOR_COUNT.solve(params).value).toBe(8);
  });
});

describe("parse — 아닌 문항을 물지 않는다", () => {
  it("약수를 「구하는」 문항에 개수 템플릿이 붙지 않는다 (문항 0066)", () => {
    // 교재의 답은 약수 목록인데 개수를 내놓으면 재현 검사에서 걸린다
    expect(DIVISOR_COUNT.parse("$165$의 약수를 모두 구하시오.", null)).toBeNull();
  });

  it("개수가 주어지고 지수를 묻는 문항도 물지 않는다", () => {
    expect(
      DIVISOR_COUNT.parse("$2^{a}\\times 3$의 약수의 개수가 주어질 때 $a$를 구하시오.", null),
    ).toBeNull();
  });

  it("수가 셋이 아니면 최대공약수 템플릿이 붙지 않는다", () => {
    expect(
      GCD_OF_FACTORIZATIONS.parse("두 수 $2^{2}$, $2^{3}$의 최대공약수는?", null),
    ).toBeNull();
  });
});

describe("변형 — 답은 계산에서 나온다", () => {
  it("모든 변형의 답이 실제 계산과 일치한다", () => {
    const stem =
      "세 수 $2^{3}\\times 3^{3}$, $2\\times 3^{4}\\times 7$, $2^{2}\\times 3^{2}\\times 5$의 최대공약수는?";
    const params = GCD_OF_FACTORIZATIONS.parse(stem, null)!;
    const rng = makeRng(7);
    for (let i = 0; i < 50; i += 1) {
      const next = GCD_OF_FACTORIZATIONS.vary(params, rng);
      const solution = GCD_OF_FACTORIZATIONS.solve(next);
      const numbers = next.factorizations.map((f) => {
        let n = 1;
        for (const [b, e] of f) n *= b ** e;
        return n;
      });
      // 독립적으로 다시 계산해 본다 — 유클리드 호제법
      const gcd2 = (a: number, b: number): number => (b === 0 ? a : gcd2(b, a % b));
      expect(solution.value).toBe(numbers.reduce(gcd2));
    }
  });

  it("원본과 같은 변형은 거부한다", () => {
    const stem =
      "세 수 $2^{3}\\times 3^{3}$, $2\\times 3^{4}\\times 7$, $2^{2}\\times 3^{2}\\times 5$의 최대공약수는?";
    const params = GCD_OF_FACTORIZATIONS.parse(stem, null)!;
    const problems = GCD_OF_FACTORIZATIONS.check(
      params,
      GCD_OF_FACTORIZATIONS.solve(params),
      params,
    );
    expect(problems).toContain("원본과 같다");
  });

  it("최대공약수가 1이면 거부한다 — 문항이 성립하지 않는다", () => {
    const params = { factorizations: [new Map([[2, 1]]), new Map([[3, 1]]), new Map([[5, 1]])] };
    const problems = GCD_OF_FACTORIZATIONS.check(
      params,
      GCD_OF_FACTORIZATIONS.solve(params),
      { factorizations: [new Map([[7, 1]])] },
    );
    expect(problems.some((p) => p.includes("최대공약수가 1"))).toBe(true);
  });

  it("소수는 소인수분해 문항이 될 수 없다", () => {
    const problems = FACTORIZE_NUMBER.check(
      { n: 97 },
      FACTORIZE_NUMBER.solve({ n: 97 }),
      { n: 100 },
    );
    expect(problems.some((p) => p.includes("소수"))).toBe(true);
  });

  it("같은 seed는 같은 변형 — 검수 통과분이 재실행에서 바뀌면 안 된다", () => {
    const stem =
      "세 수 $2^{3}\\times 3^{3}$, $2\\times 3^{4}\\times 7$, $2^{2}\\times 3^{2}\\times 5$의 최대공약수는?";
    const params = GCD_OF_FACTORIZATIONS.parse(stem, null)!;
    const run = (): unknown =>
      GCD_OF_FACTORIZATIONS.solve(GCD_OF_FACTORIZATIONS.vary(params, makeRng(99))).value;
    expect(run()).toBe(run());
  });
});

describe("선택지", () => {
  it("정답이 하나뿐이다 — 표기가 달라도 값이 같으면 같은 선택지다", () => {
    const stem =
      "세 수 $2^{2}\\times 3^{3}\\times 5$, $2\\times 3\\times 5^{2}\\times 7$, $3^{2}\\times 5$의 최대공약수는?";
    const params = GCD_OF_FACTORIZATIONS.parse(stem, null)!;
    for (const plain of [false, true]) {
      const built = renderMultipleChoice(GCD_OF_FACTORIZATIONS, params, makeRng(3), plain);
      const values = built.question.choices!.map((c) =>
        evaluateNumericLatex(c.replace(/\$/g, "")),
      );
      const correct = built.solution.value;
      expect(values.filter((v) => v === correct)).toHaveLength(1);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("평문 숫자 문항의 오답은 답 언저리다 — 원본 0136의 6·10·12·18처럼", () => {
    const distractors = nearbyDistractors(15, makeRng(1)).map(Number);
    expect(distractors).toHaveLength(4);
    // 답의 10배를 넘는 것이 없어야 한다 (18900 같은 것이 나오면 정답이 튄다)
    expect(distractors.every((d) => d > 0 && d <= 150)).toBe(true);
    expect(distractors).not.toContain(15);
  });

  it("답이 늘 가장 크거나 작지 않다 — 계산 없이 고를 수 없게", () => {
    const distractors = nearbyDistractors(15, makeRng(1)).map(Number);
    expect(distractors.some((d) => d < 15)).toBe(true);
    expect(distractors.some((d) => d > 15)).toBe(true);
  });
});

describe("템플릿 목록", () => {
  it("id가 겹치지 않는다", () => {
    const ids = RPM_M1_CH1_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
