import {
  areCoprime,
  divisors,
  factorizationToLatex,
  fromFactorization,
  gcd,
  isPrime,
  lcm,
  parseFactorizationLatex,
  pick,
  primeFactorize,
  randomInt,
  type Factorization,
} from "./arithmetic";
import type { Rejection, VariantTemplate } from "./types";

/* ─────────────────────────────────────────────────────────────
 * 「개념 익히기」 계열 템플릿 — 계산 연습 문항
 *
 * 이쪽이 변형의 값어치가 가장 크다. 유형 문항은 4개씩이지만 이 드릴은
 * 학생이 **여러 번 반복해야** 하는 것들이고, 교재는 6~8개밖에 안 준다.
 *
 * 골격은 실제 DB에 든 발문을 훑어 뽑았다(158종 중 3문항 이상 모인 것).
 * 추측으로 만들지 않았다 — 없는 유형에 템플릿을 붙여 봐야 parse가 0건이다.
 * ───────────────────────────────────────────────────────────── */

const SMALL_PRIMES = [2, 3, 5, 7, 11, 13] as const;

/** 발문 안의 `$…$` 조각들 */
const inlineMath = (stem: string): string[] =>
  [...stem.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]!);

/** 소인수분해 꼴이든 평문이든 자연수로 */
function asNumber(latex: string): number | null {
  const cleaned = latex.replace(/[$\s{}]/g, "");
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  const f = parseFactorizationLatex(cleaned);
  return f ? fromFactorization(f) : null;
}

/** 소인수 2~3개로 적당한 크기의 합성수 하나 */
function niceComposite(rng: () => number, min: number, max: number): number {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bases = new Set<number>();
    while (bases.size < randomInt(rng, 2, 3)) bases.add(pick(rng, SMALL_PRIMES));
    let n = 1;
    for (const base of bases) n *= base ** randomInt(rng, 1, 3);
    if (n >= min && n <= max) return n;
  }
  return min;
}

/* ── 소수인가 합성수인가 (0001~0006) ────────────────────────── */

export interface OneNumberParams {
  n: number;
}

export const PRIME_OR_COMPOSITE: VariantTemplate<OneNumberParams> = {
  id: "prime-or-composite",
  label: "소수인지 합성수인지 판정",
  conceptSlugs: ["m1-prime-composite"],
  kind: "short_answer",

  parse(stem) {
    if (!/소수이면.*합성수이면/.test(stem)) return null;
    const numbers = inlineMath(stem).map(asNumber).filter((n): n is number => n !== null);
    return numbers.length >= 1 && numbers[0]! > 1 ? { n: numbers[0]! } : null;
  },

  solve(params) {
    const prime = isPrime(params.n);
    return {
      display: prime ? "◯" : "△",
      value: prime ? "◯" : "△",
      steps: prime
        ? [`${params.n}의 약수는 1과 ${params.n}뿐이므로 소수다`]
        : [`${params.n} = ${factorizationToLatex(primeFactorize(params.n))} 이므로 합성수다`],
    };
  },

  render(params) {
    return { stem: `$${params.n}$이 소수이면 ◯, 합성수이면 △를 ( ) 안에 써넣으시오.` };
  },

  vary(params, rng) {
    /* 소수와 합성수를 **번갈아** 낸다. 한쪽으로 쏠리면 학생이 답을 찍는다. */
    const wantPrime = rng() < 0.5;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const n = randomInt(rng, 11, 120);
      if (isPrime(n) === wantPrime) return { n };
    }
    return params;
  },

  check(params, _solution, original) {
    const problems: Rejection[] = [];
    if (params.n === original.n) problems.push("원본과 같다");
    if (params.n < 10) problems.push(`${params.n} — 너무 작아 판정이 자명하다`);
    if (params.n > 200) problems.push(`${params.n} — 중1이 손으로 판정하기 어렵다`);
    return problems;
  },
};

/* ── 거듭제곱으로 나타내기 (0013~0018) ──────────────────────── */

export interface RepeatedProductParams {
  base: number;
  times: number;
}

export const TO_POWER: VariantTemplate<RepeatedProductParams> = {
  id: "to-power",
  label: "같은 수의 곱을 거듭제곱으로",
  conceptSlugs: ["m1-prime-factorization"],
  kind: "short_answer",

  parse(stem) {
    if (!/거듭제곱으로 나타내/.test(stem)) return null;
    if (/\[/.test(stem)) return null; // 「[ ] 안의 수의 거듭제곱」은 다른 템플릿
    const first = inlineMath(stem)[0];
    if (first === undefined) return null;
    const parts = first.replace(/[{}\s]/g, "").split("\\times");
    if (parts.length < 2) return null;
    const base = Number(parts[0]);
    if (!Number.isInteger(base) || base < 2) return null;
    if (!parts.every((p) => Number(p) === base)) return null;
    return { base, times: parts.length };
  },

  solve(params) {
    return {
      display: `${params.base}^{${params.times}}`,
      value: params.base ** params.times,
      steps: [`${params.base}을 ${params.times}번 곱했으므로 ${params.base}^{${params.times}}`],
    };
  },

  render(params) {
    const product = Array.from({ length: params.times }, () => params.base).join("\\times ");
    return { stem: `다음을 거듭제곱으로 나타내시오. $${product}$` };
  },

  vary(params, rng) {
    return { base: pick(rng, SMALL_PRIMES), times: randomInt(rng, 2, 5) };
  },

  check(params, _solution, original) {
    const problems: Rejection[] = [];
    if (params.base === original.base && params.times === original.times) {
      problems.push("원본과 같다");
    }
    if (params.times < 2) problems.push("거듭제곱이 아니다");
    if (params.base ** params.times > 100000) problems.push("값이 너무 크다");
    return problems;
  },
};

/* ── 약수를 모두 구하기 (0032~0035) ─────────────────────────── */

export const LIST_DIVISORS: VariantTemplate<OneNumberParams> = {
  id: "list-divisors",
  label: "약수를 모두 구하기",
  conceptSlugs: ["m1-divisors"],
  kind: "short_answer",

  parse(stem) {
    if (!/약수를 모두 구하시오/.test(stem)) return null;
    /* 수가 하나여야 한다. 발문에 둘 이상 있으면 **어느 것을 묻는지 알 수
     * 없다** — 첫 번째를 집으면 조용히 다른 문항의 답을 낸다.
     * 실제로 0033~0035가 전부 18로 파싱돼 같은 답이 나왔다(공통 지시문에
     * 딸려 온 예시 수 때문). 모르면 손대지 않는다. */
    const numbers = [
      ...new Set(inlineMath(stem).map(asNumber).filter((v): v is number => v !== null)),
    ];
    return numbers.length === 1 && numbers[0]! > 1 ? { n: numbers[0]! } : null;
  },

  solve(params) {
    const list = divisors(params.n);
    return {
      display: list.join(", "),
      value: list.join(","),
      steps: [
        `${params.n} = ${factorizationToLatex(primeFactorize(params.n))}`,
        `약수: ${list.join(", ")} (${list.length}개)`,
      ],
    };
  },

  render(params) {
    return { stem: `$${params.n}$의 약수를 모두 구하시오.` };
  },

  vary(params, rng) {
    return { n: niceComposite(rng, 24, 200) };
  },

  check(params, solution, original) {
    const problems: Rejection[] = [];
    if (params.n === original.n) problems.push("원본과 같다");
    const count = String(solution.value).split(",").length;
    if (count < 4) problems.push(`약수 ${count}개 — 나열할 것이 없다`);
    if (count > 16) problems.push(`약수 ${count}개 — 다 적기에 너무 많다`);
    return problems;
  },
};

/* ── 소인수분해하고 소인수 구하기 (0023~0030) ───────────────── */

export const FACTORIZE_WITH_PRIMES: VariantTemplate<OneNumberParams> = {
  id: "factorize-with-primes",
  label: "소인수분해하고 소인수 구하기",
  conceptSlugs: ["m1-prime-factorization"],
  kind: "short_answer",

  parse(stem) {
    if (!/소인수분해.*소인수를 모두 구하시오/.test(stem)) return null;
    const n = inlineMath(stem).map(asNumber).find((v): v is number => v !== null);
    return n !== undefined && n > 1 ? { n } : null;
  },

  solve(params) {
    const f = primeFactorize(params.n);
    const primes = [...f.keys()].sort((a, b) => a - b);
    return {
      display: `${factorizationToLatex(f)}, 소인수: ${primes.join(", ")}`,
      value: factorizationToLatex(f),
      steps: [
        `${params.n}을 가장 작은 소수부터 나눈다`,
        `${params.n} = ${factorizationToLatex(f)}`,
        `소인수는 ${primes.join(", ")}`,
      ],
    };
  },

  render(params) {
    return { stem: `$${params.n}$을 소인수분해 하고, 소인수를 모두 구하시오.` };
  },

  vary(params, rng) {
    return { n: niceComposite(rng, 24, 400) };
  },

  check(params, _solution, original) {
    const problems: Rejection[] = [];
    if (params.n === original.n) problems.push("원본과 같다");
    const f = primeFactorize(params.n);
    if (f.size < 2) problems.push(`${params.n} — 소인수가 하나뿐이라 연습이 안 된다`);
    if (params.n > 500) problems.push(`${params.n} — 손으로 나누기에 크다`);
    return problems;
  },
};

/* ── 두 수가 서로소인가 (0107~0110) ─────────────────────────── */

export interface TwoNumberParams {
  a: number;
  b: number;
}

export const COPRIME_CHECK: VariantTemplate<TwoNumberParams> = {
  id: "coprime-check",
  label: "두 수가 서로소인지 판정",
  conceptSlugs: ["m1-gcd"],
  kind: "short_answer",

  parse(stem) {
    if (!/서로소이면.*서로소가 아니면/.test(stem)) return null;
    const numbers = inlineMath(stem).map(asNumber).filter((n): n is number => n !== null);
    return numbers.length >= 2 ? { a: numbers[0]!, b: numbers[1]! } : null;
  },

  solve(params) {
    const g = gcd(params.a, params.b);
    return {
      display: g === 1 ? "◯" : "×",
      value: g === 1 ? "◯" : "×",
      steps: [`${params.a}와 ${params.b}의 최대공약수는 ${g}`,
        g === 1 ? "1이므로 서로소다" : "1이 아니므로 서로소가 아니다"],
    };
  },

  render(params) {
    return {
      stem: `$${params.a}$, $${params.b}$가 서로소이면 ◯, 서로소가 아니면 ×를 ( ) 안에 써넣으시오.`,
    };
  },

  vary(params, rng) {
    /* 서로소인 짝과 아닌 짝을 번갈아 — 한쪽만 나오면 찍을 수 있다 */
    const wantCoprime = rng() < 0.5;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const a = randomInt(rng, 6, 60);
      const b = randomInt(rng, 6, 60);
      if (a !== b && areCoprime(a, b) === wantCoprime) return { a, b };
    }
    return params;
  },

  check(params, _solution, original) {
    const problems: Rejection[] = [];
    if (params.a === original.a && params.b === original.b) problems.push("원본과 같다");
    if (params.a === params.b) problems.push("두 수가 같다");
    if (isPrime(params.a) && isPrime(params.b) && params.a !== params.b) {
      problems.push("서로 다른 두 소수 — 판정이 자명하다");
    }
    return problems;
  },
};

/* ── 두 수의 최대공약수·최소공배수 (0111~0126) ──────────────── */

export interface TwoFactorizationParams {
  factorizations: Factorization[];
}

function twoFactorizations(stem: string): Factorization[] | null {
  const parsed = inlineMath(stem)
    .map((latex) => parseFactorizationLatex(latex))
    .filter((f): f is Factorization => f !== null);
  return parsed.length === 2 ? parsed : null;
}

/** 두 소인수분해의 지수를 ±1 흔든다 — 구조는 지킨다 */
const varyTwo: VariantTemplate<TwoFactorizationParams>["vary"] = (params, rng) => ({
  factorizations: params.factorizations.map((f) => {
    const next = new Map<number, number>();
    for (const [base, exponent] of f) {
      next.set(base, Math.min(4, Math.max(1, exponent + randomInt(rng, -1, 1))));
    }
    return next;
  }),
});

export const GCD_OF_TWO: VariantTemplate<TwoFactorizationParams> = {
  id: "gcd-of-two",
  label: "두 수의 최대공약수를 소인수의 곱으로",
  conceptSlugs: ["m1-gcd"],
  kind: "short_answer",

  parse(stem) {
    /* **드릴 문항만** 받는다. 「최대공약수」가 든 문장제까지 물면 계산은
     * 되지만 문항이 묻는 것이 다르다 — 0186은 「두 수의 합」을, 0190은
     * 「개수」를 묻는데 최대공약수를 답이라고 내놓았다(재현 검사에서 걸림). */
    if (!/최대공약수를?\s*소인수의 곱으로/.test(stem)) return null;
    const fs = twoFactorizations(stem);
    return fs ? { factorizations: fs } : null;
  },

  solve(params) {
    const [a, b] = params.factorizations.map(fromFactorization) as [number, number];
    const answer = gcd(a, b);
    return {
      display: factorizationToLatex(primeFactorize(answer)),
      value: answer,
      steps: [`${a}와 ${b}의 공통인 소인수의 지수 중 작은 것을 택한다`, `최대공약수 = ${answer}`],
    };
  },

  render(params) {
    const listed = params.factorizations.map((f) => `$${factorizationToLatex(f)}$`).join(", ");
    return { stem: `두 수 ${listed}의 최대공약수를 소인수의 곱으로 나타내시오.` };
  },

  vary: varyTwo,

  check(params, solution, original) {
    const problems: Rejection[] = [];
    const answer = solution.value as number;
    if (answer === 1) problems.push("최대공약수가 1 — 소인수의 곱으로 쓸 것이 없다");
    if (answer > 1000) problems.push(`최대공약수 ${answer} — 중1에 크다`);
    const now = params.factorizations.map(fromFactorization).join(",");
    if (now === original.factorizations.map(fromFactorization).join(",")) {
      problems.push("원본과 같다");
    }
    return problems;
  },
};

export const LCM_OF_TWO: VariantTemplate<TwoFactorizationParams> = {
  id: "lcm-of-two",
  label: "두 수의 최소공배수를 소인수의 곱으로",
  conceptSlugs: ["m1-lcm"],
  kind: "short_answer",

  parse(stem) {
    // 드릴 문항만 — 이유는 GCD_OF_TWO.parse의 주석과 같다
    if (!/최소공배수를?\s*소인수의 곱으로/.test(stem)) return null;
    const fs = twoFactorizations(stem);
    return fs ? { factorizations: fs } : null;
  },

  solve(params) {
    const [a, b] = params.factorizations.map(fromFactorization) as [number, number];
    const answer = lcm(a, b);
    return {
      display: factorizationToLatex(primeFactorize(answer)),
      value: answer,
      steps: [`${a}와 ${b}의 모든 소인수의 지수 중 큰 것을 택한다`, `최소공배수 = ${answer}`],
    };
  },

  render(params) {
    const listed = params.factorizations.map((f) => `$${factorizationToLatex(f)}$`).join(", ");
    return { stem: `두 수 ${listed}의 최소공배수를 소인수의 곱으로 나타내시오.` };
  },

  vary: varyTwo,

  check(params, solution, original) {
    const problems: Rejection[] = [];
    if ((solution.value as number) > 100000) problems.push("최소공배수가 너무 크다");
    const now = params.factorizations.map(fromFactorization).join(",");
    if (now === original.factorizations.map(fromFactorization).join(",")) {
      problems.push("원본과 같다");
    }
    return problems;
  },
};

export const RPM_M1_CH1_DRILL_TEMPLATES = [
  PRIME_OR_COMPOSITE,
  TO_POWER,
  LIST_DIVISORS,
  FACTORIZE_WITH_PRIMES,
  COPRIME_CHECK,
  GCD_OF_TWO,
  LCM_OF_TWO,
] as const;
