import { describe, expect, it } from "vitest";
import {
  areCoprime,
  divisorCount,
  divisors,
  factorizationToLatex,
  fromFactorization,
  gcdAll,
  isComposite,
  isPerfectSquare,
  isPrime,
  lcmAll,
  makeRng,
  parseFactorizationLatex,
  primeFactorize,
} from "../../src/variants/arithmetic";

/* ─────────────────────────────────────────────────────────────
 * 이 함수들이 변형 문항의 **정답**을 낸다. 틀리면 학생이 맞는 답을 쓰고
 * 틀렸다는 채점을 받는다. 그래서 교재에 실제로 실린 값으로 건다.
 * ───────────────────────────────────────────────────────────── */

describe("소인수분해", () => {
  it("교재 값과 맞는다", () => {
    // RPM 중1-1 별책의 실제 답들
    expect(factorizationToLatex(primeFactorize(100))).toBe("2^{2}\\times 5^{2}");
    expect(factorizationToLatex(primeFactorize(189))).toBe("3^{3}\\times 7");
    expect(factorizationToLatex(primeFactorize(504))).toBe("2^{3}\\times 3^{2}\\times 7");
    expect(factorizationToLatex(primeFactorize(360))).toBe("2^{3}\\times 3^{2}\\times 5");
  });

  it("소수 자신은 지수 1로 나온다", () => {
    expect(factorizationToLatex(primeFactorize(97))).toBe("97");
  });

  it("1은 빈 분해다 — 소수도 합성수도 아니다", () => {
    expect(primeFactorize(1).size).toBe(0);
    expect(isPrime(1)).toBe(false);
    expect(isComposite(1)).toBe(false);
  });

  it("되돌리면 원래 수가 된다", () => {
    for (const n of [2, 12, 100, 189, 504, 1024, 999]) {
      expect(fromFactorization(primeFactorize(n))).toBe(n);
    }
  });

  it("자연수가 아니면 던진다 — 조용히 이상한 값을 내지 않는다", () => {
    expect(() => primeFactorize(0)).toThrow();
    expect(() => primeFactorize(-4)).toThrow();
    expect(() => primeFactorize(2.5)).toThrow();
  });
});

describe("최대공약수·최소공배수", () => {
  it("문항 0135의 답을 재현한다 — 2³×3³, 2×3⁴×7, 2²×3²×5의 최대공약수는 2×3²", () => {
    const numbers = [2 ** 3 * 3 ** 3, 2 * 3 ** 4 * 7, 2 ** 2 * 3 ** 2 * 5];
    expect(gcdAll(numbers)).toBe(2 * 3 ** 2);
    expect(factorizationToLatex(primeFactorize(gcdAll(numbers)))).toBe("2\\times 3^{2}");
  });

  it("문항 0192의 답을 재현한다 — 110·220·275의 최대공약수는 55", () => {
    expect(gcdAll([110, 220, 275])).toBe(55);
    // 55의 두 자리 약수는 11과 55 → 2개 (교재 답 ②)
    expect(divisors(55).filter((d) => d >= 10 && d <= 99)).toEqual([11, 55]);
  });

  it("최소공배수 × 최대공약수 = 두 수의 곱", () => {
    for (const [a, b] of [
      [12, 18],
      [72, 108],
      [8, 280],
    ] as const) {
      expect(gcdAll([a, b]) * lcmAll([a, b])).toBe(a * b);
    }
  });

  it("서로소 판정", () => {
    expect(areCoprime(7, 17)).toBe(true);
    expect(areCoprime(6, 15)).toBe(false);
    // 1은 모든 자연수와 서로소 (문항 0133 ①)
    expect(areCoprime(1, 100)).toBe(true);
    // 서로 다른 두 홀수가 늘 서로소인 것은 아니다 (문항 0133 ②는 틀린 진술)
    expect(areCoprime(3, 9)).toBe(false);
  });
});

describe("약수", () => {
  it("문항 0036~0041의 답을 재현한다", () => {
    expect(divisorCount(135)).toBe(8); // 3³×5 → 4×2
    expect(divisorCount(180)).toBe(18); // 2²×3²×5 → 3×3×2
    expect(divisorCount(243)).toBe(6); // 3⁵ → 6
    expect(divisorCount(360)).toBe(24); // 2³×3²×5 → 4×3×2
  });

  it("약수를 오름차순으로 전부 낸다 (문항 0034: 100)", () => {
    expect(divisors(100)).toEqual([1, 2, 4, 5, 10, 20, 25, 50, 100]);
  });

  it("제곱수 판정", () => {
    expect(isPerfectSquare(36)).toBe(true);
    expect(isPerfectSquare(72)).toBe(false);
    expect(isPerfectSquare(1)).toBe(true);
  });
});

describe("LaTeX 왕복", () => {
  it("만든 것을 그대로 되읽는다", () => {
    for (const n of [12, 100, 504, 360, 97]) {
      const latex = factorizationToLatex(primeFactorize(n));
      const back = parseFactorizationLatex(latex);
      expect(back).not.toBeNull();
      expect(fromFactorization(back!)).toBe(n);
    }
  });

  it("교재 표기(지수 1 생략)를 읽는다", () => {
    const f = parseFactorizationLatex("2\\times 3^{2}\\times 5");
    expect(f && fromFactorization(f)).toBe(2 * 9 * 5);
  });

  it("형태가 다르면 null — 억지로 읽지 않는다", () => {
    expect(parseFactorizationLatex("2+3")).toBeNull();
    expect(parseFactorizationLatex("\\frac{1}{2}")).toBeNull();
    expect(parseFactorizationLatex("2\\times x")).toBeNull();
    expect(parseFactorizationLatex("")).toBeNull();
  });
});

describe("결정론", () => {
  it("같은 seed는 같은 수열 — 검수 통과한 변형이 재실행에서 바뀌면 안 된다", () => {
    const a = Array.from({ length: 8 }, makeRng(42));
    const b = Array.from({ length: 8 }, makeRng(42));
    expect(a).toEqual(b);
  });

  it("다른 seed는 다른 수열", () => {
    const a = Array.from({ length: 8 }, makeRng(1));
    const b = Array.from({ length: 8 }, makeRng(2));
    expect(a).not.toEqual(b);
  });
});
