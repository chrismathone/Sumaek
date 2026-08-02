/* ─────────────────────────────────────────────────────────────
 * RPM 중1-1 I. 소인수분해 — 유형·소단원 → 개념 잇기
 *
 * **이 표는 사람이 쓴다.** AI가 유형 제목을 보고 개념을 "추측"하게 두지
 * 않는다. 문항이 엉뚱한 개념에 걸리면 숙련도 추정이 조용히 틀어지고,
 * 그 오류는 학생 화면 어디에도 드러나지 않은 채 출제에만 영향을 준다.
 *
 * 개념은 교재의 유형이 아니라 **교육과정의 개념**으로 잡았다. RPM의 유형
 * 26개는 출제 형태의 분류지 학습 개념이 아니다 — 「직육면체 채우기」와
 * 「일정한 간격으로 놓기」는 둘 다 최대공약수를 쓴다.
 *
 * 표에 없는 유형·소단원의 문항은 **개념 없이** 들어간다. 억지로 붙이지
 * 않는다 — 검수자가 지정한다.
 * ───────────────────────────────────────────────────────────── */

export interface ConceptDefinition {
  slug: string;
  name: string;
  description: string;
  schoolLevel: "middle";
  gradeBand: "middle-1";
  domainName: string;
}

/** 2022 개정 교육과정 중1 「수와 연산」 — I. 소인수분해 */
export const RPM_M1_CH1_CONCEPTS: ConceptDefinition[] = [
  {
    slug: "m1-prime-composite",
    name: "소수와 합성수",
    description: "1보다 큰 자연수를 약수의 개수로 소수와 합성수로 가른다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-prime-factorization",
    name: "소인수분해",
    description: "자연수를 소인수의 곱으로 나타내고 거듭제곱으로 쓴다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-divisors",
    name: "약수와 약수의 개수",
    description: "소인수분해를 이용해 약수를 구하고 그 개수를 센다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-gcd",
    name: "최대공약수",
    description: "공약수와 최대공약수를 구하고 활용 문제에 적용한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-lcm",
    name: "최소공배수",
    description: "공배수와 최소공배수를 구하고 활용 문제에 적용한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
];

export interface ConceptWeight {
  slug: string;
  weight: number;
}

/**
 * 유형·소단원 제목 → 개념. 제목은 추출기가 뽑은 그대로다(`--outline`으로 확인).
 * 제목이 정확히 일치할 때만 잇는다 — 부분 일치로 하면 「최대공약수와
 * 최소공배수의 관계」가 「최대공약수」에 잘못 걸린다.
 */
export const RPM_M1_CH1_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  new Map([
    // ── 소수와 합성수
    ["소수와 합성수", [{ slug: "m1-prime-composite", weight: 1 }]],
    ["소수와 합성수의 성질", [{ slug: "m1-prime-composite", weight: 1 }]],

    // ── 소인수분해
    ["거듭제곱", [{ slug: "m1-prime-factorization", weight: 1 }]],
    ["소인수분해", [{ slug: "m1-prime-factorization", weight: 1 }]],
    ["소인수 구하기", [{ slug: "m1-prime-factorization", weight: 1 }]],
    ["제곱인 수 만들기", [{ slug: "m1-prime-factorization", weight: 1 }]],
    [
      "소인수분해를 이용하여 약수 구하기",
      [
        { slug: "m1-prime-factorization", weight: 0.5 },
        { slug: "m1-divisors", weight: 0.5 },
      ],
    ],

    // ── 약수와 약수의 개수
    ["약수 구하기", [{ slug: "m1-divisors", weight: 1 }]],
    ["약수의 개수 구하기", [{ slug: "m1-divisors", weight: 1 }]],
    ["약수의 개수가 주어질 때 지수 구하기", [{ slug: "m1-divisors", weight: 1 }]],
    [
      "약수의 개수가 주어질 때 안에 들어 갈 수 있는 자연수 구하기",
      [{ slug: "m1-divisors", weight: 1 }],
    ],

    // ── 최대공약수
    ["서로소", [{ slug: "m1-gcd", weight: 1 }]],
    ["최대공약수 구하기", [{ slug: "m1-gcd", weight: 1 }]],
    ["공약수와 최대공약수", [{ slug: "m1-gcd", weight: 1 }]],
    [
      "최대공약수의 활용 일정한 양을 가능한 한 많은 사람에게 나누어 주기",
      [{ slug: "m1-gcd", weight: 1 }],
    ],
    ["최대공약수의 활용 직사각형 직육면체 채우기", [{ slug: "m1-gcd", weight: 1 }]],
    ["최대공약수의 활용 일정한 간격으로 놓기", [{ slug: "m1-gcd", weight: 1 }]],

    // ── 최소공배수
    ["최소공배수 구하기", [{ slug: "m1-lcm", weight: 1 }]],
    ["공배수와 최소공배수", [{ slug: "m1-lcm", weight: 1 }]],
    ["미지수가 포함된 세 수의 최소공배수", [{ slug: "m1-lcm", weight: 1 }]],
    ["최소공배수가 주어질 때 미지수 구하기", [{ slug: "m1-lcm", weight: 1 }]],
    ["최소공배수의 활용 정사각형 정육면체 만들기", [{ slug: "m1-lcm", weight: 1 }]],
    [
      "최소공배수의 활용 동시에 출발하여 다시 만나는 경우",
      [{ slug: "m1-lcm", weight: 1 }],
    ],
    ["최소공배수의 활용 맞물려 도는 톱니바퀴", [{ slug: "m1-lcm", weight: 1 }]],

    /* ── 둘 다 쓰는 유형. 한쪽으로 몰면 숙련도 증거가 한쪽에만 쌓인다. */
    [
      "최대공약수와 최소공배수의 관계",
      [
        { slug: "m1-gcd", weight: 0.5 },
        { slug: "m1-lcm", weight: 0.5 },
      ],
    ],
    [
      "최대공약수와 최소공배수가 주어질 때 지수 구하기",
      [
        { slug: "m1-gcd", weight: 0.5 },
        { slug: "m1-lcm", weight: 0.5 },
      ],
    ],
    [
      "최대공약수와 최소공배수가 주어질 때 두 수의 합과 차 구하기",
      [
        { slug: "m1-gcd", weight: 0.5 },
        { slug: "m1-lcm", weight: 0.5 },
      ],
    ],

    /* ── 중단원 — 유형·소단원 머리글이 **아예 없는** 문항용 ──────────
     *
     * 「중단원 마무리」와 「실력 UP」 쪽에는 유형 머리글이 없다. 그 51문항이
     * 아무 개념에도 걸리지 않은 채 남아 있었다. 교재의 계층은 러닝헤드가
     * 알려 주므로(「02 최대공약수와 최소공배수」) 중단원까지는 확실하다.
     *
     * 중단원 안에서 어느 개념인지는 문항마다 다르다. 한쪽으로 몰지 않고
     * 그 중단원이 다루는 개념에 **고르게 나눈다** — 마무리 문항은 실제로
     * 그 중단원 전체를 묻는다. 더 좁히려면 검수자가 지정한다. */
    [
      "소인수분해",
      [
        { slug: "m1-prime-composite", weight: 0.34 },
        { slug: "m1-prime-factorization", weight: 0.33 },
        { slug: "m1-divisors", weight: 0.33 },
      ],
    ],
    [
      "최대공약수와 최소공배수",
      [
        { slug: "m1-gcd", weight: 0.5 },
        { slug: "m1-lcm", weight: 0.5 },
      ],
    ],
  ]);

/**
 * 표를 찾을 때 쓰는 제목 정규화.
 *
 * 지면의 □·▢ 기호는 벡터라 텍스트로 안 나오고 **공백만 남는다** —
 * 「약수의 개수가 주어질 때  안에 들어 갈 수 있는 자연수 구하기」처럼
 * 가운데가 두 칸 벌어진다. 표의 문자열과 정확히 일치하지 않아 4문항이
 * 개념에 못 걸렸다. 공백은 하나로 눌러 비교한다.
 */
export function normalizeConceptKey(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}
