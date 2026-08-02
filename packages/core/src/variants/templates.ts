import {
  divisorCount,
  evaluateNumericLatex,
  factorizationToLatex,
  fromFactorization,
  gcdAll,
  lcmAll,
  parseFactorizationLatex,
  pick,
  primeFactorize,
  randomInt,
  type Factorization,
} from "./arithmetic";
import type { RenderedQuestion, Rejection, Solution, VariantTemplate } from "./types";

/* ─────────────────────────────────────────────────────────────
 * RPM 중1-1 I. 소인수분해 — 변형 템플릿
 *
 * 이 단원을 먼저 하는 이유: 답이 **정확히 계산된다.** 소인수분해·최대공약수·
 * 최소공배수·약수의 개수는 어림이 끼어들 자리가 없다. 그래서 "숫자를 바꾸면
 * 답이 틀릴까 봐"라는 걱정이 여기서는 성립하지 않는다 — 계산이 맞으면 답이
 * 맞는다.
 *
 * 대신 다른 것이 어렵다: **바꾼 숫자가 교육적으로 적당한가.** 최대공약수가
 * 1이 되어 버리면 문항이 시시해지고, 답이 네 자리가 되면 중1 수준을 벗어난다.
 * 그 판단이 각 템플릿의 check()에 들어 있다.
 * ───────────────────────────────────────────────────────────── */

/** 중1 문항에 자연스럽게 나오는 소인수 — 큰 소수를 넣으면 계산이 험해진다 */
const SMALL_PRIMES = [2, 3, 5, 7, 11, 13] as const;

const CHOICE_MARKERS = "①②③④⑤";

function factorizationsFromStem(stem: string, count: number): Factorization[] | null {
  const inline = [...stem.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]!);
  const parsed = inline
    .map((latex) => parseFactorizationLatex(latex))
    .filter((f): f is Factorization => f !== null);
  return parsed.length === count ? parsed : null;
}

/** 소인수분해 여럿을 「자연수 여럿」으로 */
const toNumbers = (fs: readonly Factorization[]): number[] => fs.map(fromFactorization);

/**
 * 선택지를 만든다 — 정답 하나 + 그럴듯한 오답.
 * 오답은 **학생이 실제로 하는 실수**에서 만든다: 지수를 큰 쪽으로 고르기,
 * 공통이 아닌 소인수를 끼워 넣기, 최대공약수·최소공배수 뒤바꾸기.
 * 무작위 숫자를 오답으로 쓰면 답이 눈에 띄어 문항이 망가진다.
 */
function buildChoices(
  correct: string,
  distractors: readonly string[],
  rng: () => number,
): { choices: string[]; correctIndex: number } {
  /* 값이 같으면 표기가 달라도 같은 선택지다 — `3\times 5`와 `15`가 함께
   * 들어가면 정답이 둘이 된다. 값으로 걸러야 한다. */
  const correctValue = evaluateNumericLatex(correct);
  const seen = new Set<number | string>([correctValue ?? correct]);
  const unique: string[] = [];
  for (const d of distractors) {
    const key = evaluateNumericLatex(d) ?? d;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(d);
    if (unique.length === 4) break;
  }
  const all = [correct, ...unique];
  // 정답 위치를 고정하지 않는다 — 늘 ①이면 학생이 규칙을 학습한다
  const correctIndex = randomInt(rng, 0, all.length - 1);
  const rest = all.slice(1);
  const choices: string[] = [];
  for (let i = 0, r = 0; i < all.length; i += 1) {
    choices.push(i === correctIndex ? correct : rest[r++]!);
  }
  return { choices, correctIndex };
}

/* ── 템플릿 1 · 세 수의 최대공약수 (객관식) ─────────────────── */

export interface GcdParams {
  factorizations: Factorization[];
}

export const GCD_OF_FACTORIZATIONS: VariantTemplate<GcdParams> = {
  id: "gcd-of-factorizations",
  label: "세 수(소인수분해 꼴)의 최대공약수",
  conceptSlugs: ["m1-gcd"],
  kind: "multiple_choice",

  parse(stem) {
    if (!/최대공약수는\?|최대공약수를 구하시오/.test(stem)) return null;
    const fs = factorizationsFromStem(stem, 3);
    return fs ? { factorizations: fs } : null;
  },

  solve(params) {
    const numbers = toNumbers(params.factorizations);
    const answer = gcdAll(numbers);
    return {
      display: factorizationToLatex(primeFactorize(answer)),
      value: answer,
      steps: [
        `세 수: ${numbers.join(", ")}`,
        "공통인 소인수의 지수 중 작거나 같은 것을 택해 곱한다",
        `최대공약수 = ${answer}`,
      ],
    };
  },

  render(params) {
    const listed = params.factorizations
      .map((f) => `$${factorizationToLatex(f)}$`)
      .join(", ");
    return { stem: `세 수 ${listed}의 최대공약수는?` };
  },

  vary(params, rng) {
    /* **원본의 구조를 지킨다** — 어느 수에 어느 소인수가 들어 있는지는
     * 그대로 두고 지수만 ±1 흔든다.
     *
     * 처음에는 모든 소인수에 1~4를 새로 뿌렸는데, 그러면 세 수가 폭발해
     * 최소공배수가 57조가 나왔다(실측). 거부율 79%. 원본이 이미 중1에
     * 알맞은 크기이므로 그 언저리에서 흔드는 것이 맞다. */
    return {
      factorizations: params.factorizations.map((f) => {
        const next = new Map<number, number>();
        for (const [base, exponent] of f) {
          next.set(base, Math.min(4, Math.max(1, exponent + randomInt(rng, -1, 1))));
        }
        return next;
      }),
    };
  },

  check(params, solution, original) {
    const problems: Rejection[] = [];
    const answer = solution.value as number;
    if (answer === 1) problems.push("최대공약수가 1 — 문항이 성립하지 않는다");
    if (answer > 1000) problems.push(`최대공약수 ${answer} — 중1에 너무 크다`);
    const numbers = toNumbers(params.factorizations);
    if (numbers.some((n) => n > 100000)) problems.push("세 수가 너무 크다");
    if (
      JSON.stringify(numbers) ===
      JSON.stringify(toNumbers(original.factorizations))
    ) {
      problems.push("원본과 같다");
    }
    return problems;
  },
};

/* ── 템플릿 2 · 세 수의 최소공배수 (객관식) ─────────────────── */

export const LCM_OF_FACTORIZATIONS: VariantTemplate<GcdParams> = {
  id: "lcm-of-factorizations",
  label: "세 수(소인수분해 꼴)의 최소공배수",
  conceptSlugs: ["m1-lcm"],
  kind: "multiple_choice",

  parse(stem) {
    if (!/최소공배수는\?|최소공배수를 구하시오/.test(stem)) return null;
    const fs = factorizationsFromStem(stem, 3);
    return fs ? { factorizations: fs } : null;
  },

  solve(params) {
    const numbers = toNumbers(params.factorizations);
    const answer = lcmAll(numbers);
    return {
      display: factorizationToLatex(primeFactorize(answer)),
      value: answer,
      steps: [
        `세 수: ${numbers.join(", ")}`,
        "모든 소인수의 지수 중 크거나 같은 것을 택해 곱한다",
        `최소공배수 = ${answer}`,
      ],
    };
  },

  render(params) {
    const listed = params.factorizations
      .map((f) => `$${factorizationToLatex(f)}$`)
      .join(", ");
    return { stem: `세 수 ${listed}의 최소공배수는?` };
  },

  vary: GCD_OF_FACTORIZATIONS.vary,

  check(params, solution, original) {
    const problems: Rejection[] = [];
    const answer = solution.value as number;
    /* 최소공배수는 답을 소인수분해 꼴로 쓰므로 값이 커도 읽을 수 있다.
     * 교재 원본도 27720이 나온다. 다만 백만을 넘으면 계산이 험해진다. */
    if (answer > 1000000) problems.push(`최소공배수 ${answer} — 중1에 너무 크다`);
    const numbers = toNumbers(params.factorizations);
    if (
      JSON.stringify(numbers) ===
      JSON.stringify(toNumbers(original.factorizations))
    ) {
      problems.push("원본과 같다");
    }
    return problems;
  },
};

/* ── 템플릿 3 · 소인수분해하기 (단답) ───────────────────────── */

export interface FactorizeParams {
  n: number;
}

export const FACTORIZE_NUMBER: VariantTemplate<FactorizeParams> = {
  id: "factorize-number",
  label: "자연수를 소인수분해하기",
  conceptSlugs: ["m1-prime-factorization"],
  kind: "short_answer",

  parse(stem) {
    if (!/소인수분해\s*하시오|소인수분해하시오/.test(stem)) return null;
    const numbers = [...stem.matchAll(/\$(\d+)\$/g)].map((m) => Number(m[1]));
    return numbers.length === 1 && numbers[0]! > 1 ? { n: numbers[0]! } : null;
  },

  solve(params) {
    const f = primeFactorize(params.n);
    return {
      display: factorizationToLatex(f),
      value: factorizationToLatex(f),
      steps: [
        `${params.n}을 가장 작은 소수부터 나눈다`,
        `${params.n} = ${factorizationToLatex(f)}`,
      ],
    };
  },

  render(params) {
    return { stem: `$${params.n}$을 소인수분해하시오.` };
  },

  vary(params, rng) {
    /* 소인수 2~3개를 골라 지수를 얹는다. 곱이 세 자리 근처가 되게 잡는다 —
     * 중1 교재의 실제 범위다(실측: 대부분 100~1000). */
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const count = randomInt(rng, 2, 3);
      const bases = new Set<number>();
      while (bases.size < count) bases.add(pick(rng, SMALL_PRIMES));
      let n = 1;
      for (const base of bases) n *= base ** randomInt(rng, 1, 3);
      if (n >= 60 && n <= 2000) return { n };
    }
    return params;
  },

  check(params, solution, original) {
    const problems: Rejection[] = [];
    if (params.n === original.n) problems.push("원본과 같다");
    if (params.n < 20) problems.push(`${params.n} — 너무 작아 연습이 안 된다`);
    if (params.n > 2000) problems.push(`${params.n} — 중1에 너무 크다`);
    const f = primeFactorize(params.n);
    if (f.size === 1 && [...f.values()][0] === 1) {
      problems.push(`${params.n}은 소수 — 소인수분해 문항이 될 수 없다`);
    }
    return problems;
  },
};

/* ── 템플릿 4 · 약수의 개수 (단답) ──────────────────────────── */

export const DIVISOR_COUNT: VariantTemplate<FactorizeParams> = {
  id: "divisor-count",
  label: "약수의 개수 구하기",
  conceptSlugs: ["m1-divisors"],
  kind: "short_answer",

  parse(stem) {
    /* 「약수의 개수를 구하시오」만 받는다. 「약수를 구하시오」(0066)까지
     * 물면 개수를 답으로 내놓고 교재는 약수 목록을 답으로 갖고 있어
     * 재현 검사에서 걸린다 — 실제로 걸렸다. */
    if (!/약수의 개수를?\s*(를|은|는)?\s*구하시오|약수의 개수는\?/.test(stem)) return null;
    if (/개수가|주어질 때/.test(stem)) return null; // 역으로 지수를 묻는 문항
    const inline = [...stem.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]!);
    if (inline.length !== 1) return null;
    const plain = /^\d+$/.test(inline[0]!) ? Number(inline[0]) : null;
    const f = plain === null ? parseFactorizationLatex(inline[0]!) : null;
    const n = plain ?? (f ? fromFactorization(f) : null);
    return n !== null && n > 1 ? { n } : null;
  },

  solve(params) {
    const f = primeFactorize(params.n);
    const parts = [...f.values()].map((e) => `(${e}+1)`);
    const count = divisorCount(params.n);
    return {
      display: `${count}개`,
      value: count,
      steps: [
        `${params.n} = ${factorizationToLatex(f)}`,
        `약수의 개수 = ${parts.join("\\times ")} = ${count}`,
      ],
    };
  },

  render(params) {
    return { stem: `$${params.n}$의 약수의 개수를 구하시오.` };
  },

  vary: FACTORIZE_NUMBER.vary,

  check(params, solution, original) {
    const problems: Rejection[] = [];
    if (params.n === original.n) problems.push("원본과 같다");
    const count = solution.value as number;
    if (count < 4) problems.push(`약수 ${count}개 — 너무 적어 연습이 안 된다`);
    if (count > 40) problems.push(`약수 ${count}개 — 세다가 지친다`);
    if (params.n > 2000) problems.push(`${params.n} — 중1에 너무 크다`);
    return problems;
  },
};

export const RPM_M1_CH1_TEMPLATES = [
  GCD_OF_FACTORIZATIONS,
  LCM_OF_FACTORIZATIONS,
  FACTORIZE_NUMBER,
  DIVISOR_COUNT,
] as const;

/* ── 객관식 오답 만들기 ─────────────────────────────────────── */

/**
 * 최대공약수·최소공배수 문항의 오답.
 * **학생이 실제로 하는 실수**를 답으로 만든다 — 무작위 숫자를 넣으면
 * 정답만 튀어 보여 문항이 망가진다.
 */
export function gcdLcmDistractors(
  factorizations: readonly Factorization[],
  wanted: "gcd" | "lcm",
): string[] {
  const numbers = factorizations.map(fromFactorization);
  const out: string[] = [];

  // 1) 최대공약수와 최소공배수를 뒤바꾸는 실수
  const opposite = wanted === "gcd" ? lcmAll(numbers) : gcdAll(numbers);
  out.push(factorizationToLatex(primeFactorize(opposite)));

  // 2) 지수를 반대쪽으로 고르는 실수 (작은 것 대신 큰 것)
  const bases = [...new Set(factorizations.flatMap((f) => [...f.keys()]))].sort(
    (a, b) => a - b,
  );
  const common = bases.filter((b) => factorizations.every((f) => f.has(b)));
  const swapped = new Map<number, number>();
  for (const base of common) {
    const exponents = factorizations.map((f) => f.get(base)!);
    swapped.set(base, wanted === "gcd" ? Math.max(...exponents) : Math.min(...exponents));
  }
  if (swapped.size > 0) out.push(factorizationToLatex(swapped));

  // 3) 공통이 아닌 소인수를 끼워 넣는 실수
  const notCommon = bases.filter((b) => !common.includes(b));
  if (notCommon.length > 0 && common.length > 0) {
    const extra = new Map<number, number>();
    for (const base of common) {
      const exponents = factorizations.map((f) => f.get(base)!);
      extra.set(base, wanted === "gcd" ? Math.min(...exponents) : Math.max(...exponents));
    }
    extra.set(notCommon[0]!, 1);
    out.push(factorizationToLatex(extra));
  }

  // 4) 지수를 하나 빠뜨리는 실수
  if (common.length > 0) {
    const dropped = new Map<number, number>();
    for (const base of common) {
      const exponents = factorizations.map((f) => f.get(base)!);
      const chosen = wanted === "gcd" ? Math.min(...exponents) : Math.max(...exponents);
      dropped.set(base, Math.max(1, chosen - 1));
    }
    out.push(factorizationToLatex(dropped));
  }

  // 5) 세 수 중 하나를 그대로 답이라고 보는 실수
  for (const f of factorizations) out.push(factorizationToLatex(f));

  /* 6) 그래도 모자라면 정답의 지수를 하나씩 올린 것. 마지막 수단이다 —
   * 앞의 것들이 「학생이 실제로 하는 실수」인 반면 이건 그냥 다른 수다. */
  const answer =
    wanted === "gcd"
      ? primeFactorize(gcdAll(numbers))
      : primeFactorize(lcmAll(numbers));
  for (const [base] of answer) {
    const bumped = new Map(answer);
    bumped.set(base, (bumped.get(base) ?? 1) + 1);
    out.push(factorizationToLatex(bumped));
  }

  return out;
}

/**
 * 객관식 문항 한 벌 짓기 — 정답 위치를 매번 다르게 둔다.
 *
 * `plainNumbers`: 원본이 선택지를 「6, 10, 12」처럼 **평문 숫자**로 쓴
 * 문항인가. 교재는 같은 유형을 두 가지로 쓴다 — 0135는 소인수분해 꼴,
 * 0136은 계산한 값. 변형이 원본과 다른 꼴로 나오면 같은 자리에 놓았을 때
 * 티가 난다.
 */
export function nearbyDistractors(answer: number, rng: () => number): string[] {
  /* 1순위: 답과 소인수를 나눠 갖는 수(약수·배수). 이런 것이 실제로 최대공약수
   * 자리에 올 수 있어 지워 낼 수 없다.
   * 2순위: 근처의 아무 정수. 원본 0136의 오답 6·10·12·18은 전부 1순위 꼴이다.
   * 소수(13·17 같은 것)를 섞으면 계산하지 않고도 지울 수 있어 문항이 헐거워진다. */
  const preferred = new Set<number>();
  for (const factor of [2, 3, 5]) {
    if (answer % factor === 0) preferred.add(answer / factor);
    preferred.add(answer * factor);
  }
  for (const step of [2, 3, 4, 6]) {
    if (answer % step === 0) {
      preferred.add(answer + answer / step);
      if (answer - answer / step > 1) preferred.add(answer - answer / step);
    }
  }
  const filler = new Set<number>();
  for (const delta of [-6, -4, -3, -2, 2, 3, 4, 6]) {
    if (answer + delta > 1) filler.add(answer + delta);
  }
  const pool = [
    ...[...preferred].filter((v) => v !== answer && v > 0),
    ...[...filler].filter((v) => v !== answer && v > 0 && !preferred.has(v)),
  ];
  /* 답을 사이에 두도록 위아래에서 골고루 뽑는다 — 답이 늘 가장 크거나
   * 가장 작으면 계산하지 않고도 고를 수 있다. */
  /* 순서(1순위 먼저)를 지키되 답을 사이에 두도록 위아래에서 번갈아 뽑는다 —
   * 답이 늘 가장 크거나 가장 작으면 계산하지 않고도 고를 수 있다. */
  const below = pool.filter((v) => v < answer);
  const above = pool.filter((v) => v > answer);
  const out: number[] = [];
  let preferBelow = rng() < 0.5;
  for (let i = 0; out.length < 4 && (below.length > 0 || above.length > 0); i += 1) {
    const from = preferBelow ? below : above;
    const other = preferBelow ? above : below;
    const taken = from.shift() ?? other.shift();
    if (taken === undefined) break;
    out.push(taken);
    preferBelow = !preferBelow;
  }
  return out.map(String);
}

export function renderMultipleChoice(
  template: VariantTemplate<GcdParams>,
  params: GcdParams,
  rng: () => number,
  plainNumbers = false,
): { question: RenderedQuestion; solution: Solution } {
  const solution = template.solve(params);
  const wanted = template.id === "gcd-of-factorizations" ? "gcd" : "lcm";
  const asShown = (latex: string): string => {
    if (!plainNumbers) return latex;
    const value = evaluateNumericLatex(latex);
    return value === null ? latex : String(value);
  };

  /* 평문 숫자로 쓰는 문항은 오답도 **답 언저리**여야 한다. 원본 0136의
   * 선택지는 6·10·12·15·18로 전부 답(15) 근처다. 소인수분해 꼴에서 쓰던
   * 오답을 그대로 숫자로 바꾸면 18900·1984500 같은 것이 나와 정답이
   * 한눈에 보인다 — 문항이 망가진다. */
  const answerValue = solution.value as number;
  const distractors = plainNumbers
    ? nearbyDistractors(answerValue, rng)
    : gcdLcmDistractors(params.factorizations, wanted);

  const { choices, correctIndex } = buildChoices(
    asShown(solution.display),
    distractors.map(asShown),
    rng,
  );
  const base = template.render(params, solution);
  return {
    question: { stem: base.stem, choices: choices.map((c) => `$${c}$`) },
    solution: { ...solution, display: asShown(solution.display), correctIndex },
  };
}

export { CHOICE_MARKERS };
