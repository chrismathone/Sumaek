/* ─────────────────────────────────────────────────────────────
 * RPM 중1-1 — 유형·소단원·중단원 → 개념 잇기
 *
 * **이 표는 사람이 쓴다.** AI가 유형 제목을 보고 개념을 "추측"하게 두지
 * 않는다. 문항이 엉뚱한 개념에 걸리면 숙련도 추정이 조용히 틀어지고,
 * 그 오류는 학생 화면 어디에도 드러나지 않은 채 출제에만 영향을 준다.
 *
 * 개념은 교재의 유형이 아니라 **교육과정의 개념**으로 잡았다. RPM의 유형
 * 26개는 출제 형태의 분류지 학습 개념이 아니다 — 「직육면체 채우기」와
 * 「일정한 간격으로 놓기」는 둘 다 최대공약수를 쓴다.
 *
 * 표에 없는 유형·소단원의 문항은 중단원 표로 내려가고, 거기에도 없으면
 * **개념 없이** 들어간다. 억지로 붙이지 않는다 — 검수자가 지정한다.
 *
 * ## 표가 둘인 이유 — 같은 이름이 계층마다 나온다
 *
 * 유형·소단원 표(`*_TITLE_TO_CONCEPT`)와 중단원 표(`*_UNIT_TO_CONCEPT`)는
 * **반드시 나뉘어 있어야 한다.** 하나로 두었더니 1단원에서 「소인수분해」
 * 키가 두 번 들어가(소단원용 1개 · 중단원용 3분할) Map이 뒤엣것만 남겼고,
 * 소단원 문항이 단일 개념 대신 3분할로 조용히 들어갔다. 3단원에도 중단원
 * 「일차방정식의 풀이」와 소단원 「일차방정식의 풀이」가 함께 있다.
 *
 * ## 제목은 추출기가 뽑은 그대로다
 *
 * `extract --outline`이 찍는 문자열을 그대로 키로 쓴다. **수식은 제목에서
 * 빠진다** — 「정비례 관계 y=ax의 활용」이 「정비례 관계 의 활용」으로,
 * 「(-1)ⁿ의 계산」이 「의 계산」으로 온다. 보기 흉하지만 고쳐 쓰면 영영
 * 안 걸린다. 뜻이 갈리지 않는 제목(4단원 「의 그래프」처럼 정비례인지
 * 반비례인지 알 수 없는 것)은 **표에 넣지 않고** 중단원 표로 흘린다.
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
 * 개념 표를 만든다 — **같은 제목이 두 번 들어오면 던진다.**
 *
 * `new Map([...])`은 중복 키를 조용히 덮어쓴다. 1단원의 「소인수분해」가
 * 그렇게 사라졌고(handoff 7.1), 그 뒤로 소단원 문항이 몇 달 동안 엉뚱한
 * 3분할로 들어갔다. **어디에도 표시가 나지 않는 종류의 결함이다** —
 * 학생 화면은 멀쩡하고 출제 결과만 조용히 틀어진다.
 *
 * 표를 다시 짜면서 2단원에 「절댓값」을 또 두 번 넣었다. 사람이 조심해서
 * 될 일이 아니라 도구가 막아야 하는 일이다. 불러들이는 순간 터진다.
 */
function conceptTable(
  entries: readonly (readonly [string, ConceptWeight[]])[],
): ReadonlyMap<string, ConceptWeight[]> {
  const table = new Map<string, ConceptWeight[]>();
  for (const [title, weights] of entries) {
    const key = normalizeConceptKey(title);
    if (table.has(key)) {
      throw new Error(
        `개념 표에 같은 제목이 두 번 있습니다: 「${title}」 — ` +
          `Map은 뒤엣것만 남기므로 앞엣것이 조용히 사라집니다. ` +
          `계층이 달라서 겹친 것이라면 유형·소단원 표와 중단원 표를 나누세요.`,
      );
    }
    table.set(key, weights);
  }
  return table;
}

/**
 * 유형·소단원 제목 → 개념. 제목은 추출기가 뽑은 그대로다(`--outline`으로 확인).
 * 제목이 정확히 일치할 때만 잇는다 — 부분 일치로 하면 「최대공약수와
 * 최소공배수의 관계」가 「최대공약수」에 잘못 걸린다.
 */
export const RPM_M1_CH1_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 소수와 합성수
    ["소수와 합성수", [{ slug: "m1-prime-composite", weight: 1 }]],
    ["소수와 합성수의 성질", [{ slug: "m1-prime-composite", weight: 1 }]],

    /* 소단원 머리글 둘이 한 줄에 붙어 오는 자리 — 지면은 「소수와 합성수」와
     * 「소인수분해」가 나란히 선 소단원 묶음이다. 29문항이 이 제목으로 온다. */
    [
      "소수와 합성수 소인수분해",
      [
        { slug: "m1-prime-composite", weight: 0.5 },
        { slug: "m1-prime-factorization", weight: 0.5 },
      ],
    ],

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

  ]);

/**
 * 중단원 표 — 유형·소단원 머리글이 **아예 없는** 문항용.
 *
 * 「중단원 마무리」와 「실력 UP」 쪽에는 유형 머리글이 없다. 그 51문항이
 * 아무 개념에도 걸리지 않은 채 남아 있었다. 교재의 계층은 러닝헤드가
 * 알려 주므로(「02 최대공약수와 최소공배수」) 중단원까지는 확실하다.
 *
 * 중단원 안에서 어느 개념인지는 문항마다 다르다. 한쪽으로 몰지 않고
 * 그 중단원이 다루는 개념에 **고르게 나눈다** — 마무리 문항은 실제로
 * 그 중단원 전체를 묻는다. 더 좁히려면 검수자가 지정한다.
 */
export const RPM_M1_CH1_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
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

/* ═══════════════════════════════════════════════════════════════
 * II. 정수와 유리수 (중단원 03 정수와 유리수 · 04 정수와 유리수의 계산)
 *     본책 p.34–73 · 0214~0523 · 310문항
 * ═══════════════════════════════════════════════════════════════ */

/** 2022 개정 교육과정 중1 「수와 연산」 — II. 정수와 유리수 */
export const RPM_M1_CH2_CONCEPTS: ConceptDefinition[] = [
  {
    slug: "m1-integers-rationals",
    name: "정수와 유리수",
    description: "양수와 음수로 크기와 방향을 나타내고, 수를 정수·유리수로 분류한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-absolute-value",
    name: "절댓값",
    description: "수직선에서 원점까지의 거리로 절댓값을 이해하고 그 성질을 쓴다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-number-order",
    name: "수의 대소 관계",
    description: "유리수의 크기를 비교하고 부등호로 나타낸다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-rational-add-sub",
    name: "유리수의 덧셈과 뺄셈",
    description: "부호가 있는 수를 더하고 빼며, 덧셈의 계산 법칙을 쓴다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-rational-mul-div",
    name: "유리수의 곱셈과 나눗셈",
    description: "부호가 있는 수를 곱하고 나누며, 거듭제곱·분배법칙·역수를 쓴다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-rational-mixed",
    name: "유리수의 혼합 계산",
    description: "덧셈·뺄셈·곱셈·나눗셈이 섞인 식을 순서에 맞게 계산한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
];

export const RPM_M1_CH2_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 03 정수와 유리수 · 소단원
    ["양수와 음수", [{ slug: "m1-integers-rationals", weight: 1 }]],
    ["양수와 음수 정수와 유리수", [{ slug: "m1-integers-rationals", weight: 1 }]],
    ["수직선", [{ slug: "m1-integers-rationals", weight: 1 }]],
    ["절댓값", [{ slug: "m1-absolute-value", weight: 1 }]],
    ["수의 대소 관계", [{ slug: "m1-number-order", weight: 1 }]],
    ["부등호의 사용", [{ slug: "m1-number-order", weight: 1 }]],

    // ── 03 정수와 유리수 · 유형
    ["부호를 사용하여 나타내기", [{ slug: "m1-integers-rationals", weight: 1 }]],
    ["정수의 분류", [{ slug: "m1-integers-rationals", weight: 1 }]],
    ["유리수의 분류", [{ slug: "m1-integers-rationals", weight: 1 }]],
    ["정수와 유리수의 성질", [{ slug: "m1-integers-rationals", weight: 1 }]],
    ["수를 수직선 위에 나타내기", [{ slug: "m1-integers-rationals", weight: 1 }]],
    [
      "수직선 위의 두 점으로부터 같은 거리에 있는 점",
      [{ slug: "m1-integers-rationals", weight: 1 }],
    ],
    /* 소단원 「절댓값」과 유형 07 「절댓값」이 같은 이름이다 — 한 줄이 둘 다 받는다 */
    ["절댓값의 성질", [{ slug: "m1-absolute-value", weight: 1 }]],
    ["절댓값을 이용하여 수 찾기", [{ slug: "m1-absolute-value", weight: 1 }]],
    ["절댓값이 같고 부호가 반대인 두 수", [{ slug: "m1-absolute-value", weight: 1 }]],
    ["절댓값의 응용", [{ slug: "m1-absolute-value", weight: 1 }]],
    ["부등호를 사용하여 나타내기", [{ slug: "m1-number-order", weight: 1 }]],
    ["두 유리수 사이에 있는 정수", [{ slug: "m1-number-order", weight: 1 }]],
    /* 「조건을 만족시키는 수의 대소 관계」는 절댓값 조건으로 범위를 좁힌 뒤
     * 크기를 비교한다 — 한쪽으로 몰면 숙련도 증거가 한쪽에만 쌓인다. */
    [
      "조건을 만족시키는 수의 대소 관계",
      [
        { slug: "m1-number-order", weight: 0.5 },
        { slug: "m1-absolute-value", weight: 0.5 },
      ],
    ],

    // ── 04 정수와 유리수의 계산 · 소단원
    ["유리수의 덧셈", [{ slug: "m1-rational-add-sub", weight: 1 }]],
    ["유리수의 덧셈 유리수의 뺄셈", [{ slug: "m1-rational-add-sub", weight: 1 }]],
    ["덧셈과 뺄셈의 혼합 계산", [{ slug: "m1-rational-add-sub", weight: 1 }]],
    ["유리수의 곱셈", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    ["유리수의 곱셈 유리수의 나눗셈", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    ["덧셈 뺄셈 곱셈", [{ slug: "m1-rational-mixed", weight: 1 }]],

    // ── 04 정수와 유리수의 계산 · 유형
    ["덧셈의 계산 법칙", [{ slug: "m1-rational-add-sub", weight: 1 }]],
    ["유리수의 뺄셈", [{ slug: "m1-rational-add-sub", weight: 1 }]],
    ["부호가 생략된 수의 덧셈과 뺄셈", [{ slug: "m1-rational-add-sub", weight: 1 }]],
    [
      "어떤 수보다 만큼 큰 수 또는 작은 수",
      [{ slug: "m1-rational-add-sub", weight: 1 }],
    ],
    ["덧셈과 뺄셈 사이의 관계", [{ slug: "m1-rational-add-sub", weight: 1 }]],
    [
      "바르게 계산한 답 구하기 덧셈 뺄셈",
      [{ slug: "m1-rational-add-sub", weight: 1 }],
    ],
    [
      "절댓값이 주어진 두 수의 덧셈과 뺄셈",
      [
        { slug: "m1-rational-add-sub", weight: 0.5 },
        { slug: "m1-absolute-value", weight: 0.5 },
      ],
    ],
    ["덧셈과 뺄셈의 활용 ⑴", [{ slug: "m1-rational-add-sub", weight: 1 }]],
    ["덧셈과 뺄셈의 활용 ⑵", [{ slug: "m1-rational-add-sub", weight: 1 }]],
    ["곱셈의 계산 법칙", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    [
      "네 유리수 중에서 세 수를 뽑아 곱하기",
      [{ slug: "m1-rational-mul-div", weight: 1 }],
    ],
    ["거듭제곱의 계산", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    /* 지면은 「(-1)ⁿ의 계산」인데 수식이 제목에서 빠져 「의 계산」만 남는다.
     * 추출기가 내놓는 문자열이 이것이므로 이대로 둔다. */
    ["의 계산", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    ["분배법칙", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    ["역수", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    ["유리수의 나눗셈", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    ["곱셈과 나눗셈의 혼합 계산", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    ["곱셈과 나눗셈 사이의 관계", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    [
      "바르게 계산한 답 구하기 곱셈 나눗셈",
      [{ slug: "m1-rational-mul-div", weight: 1 }],
    ],
    ["유리수의 부호 결정", [{ slug: "m1-rational-mul-div", weight: 1 }]],
    [
      "문자로 주어진 수의 대소 관계",
      [
        { slug: "m1-number-order", weight: 0.5 },
        { slug: "m1-rational-mul-div", weight: 0.5 },
      ],
    ],
    [
      "덧셈 뺄셈 곱셈 나눗셈의 혼합 계산",
      [{ slug: "m1-rational-mixed", weight: 1 }],
    ],
    [
      "실생활에서 유리수의 혼합 계산의 활용",
      [{ slug: "m1-rational-mixed", weight: 1 }],
    ],
    [
      "수직선에서 유리수의 혼합 계산의 활용",
      [{ slug: "m1-rational-mixed", weight: 1 }],
    ],
  ]);

export const RPM_M1_CH2_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    [
      "정수와 유리수",
      [
        { slug: "m1-integers-rationals", weight: 0.34 },
        { slug: "m1-absolute-value", weight: 0.33 },
        { slug: "m1-number-order", weight: 0.33 },
      ],
    ],
    [
      "정수와 유리수의 계산",
      [
        { slug: "m1-rational-add-sub", weight: 0.34 },
        { slug: "m1-rational-mul-div", weight: 0.33 },
        { slug: "m1-rational-mixed", weight: 0.33 },
      ],
    ],
  ]);

/* ═══════════════════════════════════════════════════════════════
 * III. 문자와 식 (05 문자의 사용과 식의 계산 · 06 일차방정식의 풀이
 *                · 07 일차방정식의 활용)
 *      본책 p.74–123 · 0524~0914 · 391문항
 * ═══════════════════════════════════════════════════════════════ */

/** 2022 개정 교육과정 중1 「변화와 관계」 — III. 문자와 식 */
export const RPM_M1_CH3_CONCEPTS: ConceptDefinition[] = [
  {
    slug: "m1-symbolic-expression",
    name: "문자를 사용한 식",
    description: "수량 관계를 문자로 나타내고 곱셈·나눗셈 기호를 생략해 쓴다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-value-of-expression",
    name: "식의 값",
    description: "문자에 수를 대입해 식의 값을 구한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-polynomial-linear",
    name: "다항식과 일차식",
    description: "항·계수·차수를 알고 다항식에서 일차식을 가려낸다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-linear-expression-calc",
    name: "일차식의 계산",
    description: "동류항을 정리해 일차식을 더하고 빼며, 수와 곱하고 나눈다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-equation-identity",
    name: "방정식과 항등식",
    description: "방정식의 해와 항등식의 뜻을 구별한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-equality-properties",
    name: "등식의 성질",
    description: "등식의 양변에 같은 수를 연산해도 등식이 유지됨을 이용해 식을 변형한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-linear-equation-solve",
    name: "일차방정식의 풀이",
    description: "이항해 일차방정식을 정리하고 해를 구한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-linear-equation-apply",
    name: "일차방정식의 활용",
    description: "문제 상황을 일차방정식으로 세워 풀고 답이 맞는지 확인한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
];

export const RPM_M1_CH3_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 05 문자의 사용과 식의 계산 · 소단원
    ["문자를 사용한 식", [{ slug: "m1-symbolic-expression", weight: 1 }]],
    [
      "곱셈 기호와 나눗셈 기호의 생략",
      [{ slug: "m1-symbolic-expression", weight: 1 }],
    ],
    ["식의 값", [{ slug: "m1-value-of-expression", weight: 1 }]],
    ["다항식과 일차식", [{ slug: "m1-polynomial-linear", weight: 1 }]],
    ["일차식과 수의 곱셈", [{ slug: "m1-linear-expression-calc", weight: 1 }]],
    ["나눗셈", [{ slug: "m1-linear-expression-calc", weight: 1 }]],
    ["나눗셈 일차식의 덧셈", [{ slug: "m1-linear-expression-calc", weight: 1 }]],
    ["뺄셈", [{ slug: "m1-linear-expression-calc", weight: 1 }]],

    // ── 05 · 유형
    [
      "문자를 사용한 식으로 나타내기 수 단위 금액",
      [{ slug: "m1-symbolic-expression", weight: 1 }],
    ],
    [
      "문자를 사용한 식으로 나타내기 도형",
      [{ slug: "m1-symbolic-expression", weight: 1 }],
    ],
    [
      "문자를 사용한 식으로 나타내기 속력 농도",
      [{ slug: "m1-symbolic-expression", weight: 1 }],
    ],
    ["식의 값 구하기", [{ slug: "m1-value-of-expression", weight: 1 }]],
    [
      "식의 값 구하기 분모에 분수 대입하기",
      [{ slug: "m1-value-of-expression", weight: 1 }],
    ],
    [
      "식의 값의 활용 식이 주어진 경우",
      [{ slug: "m1-value-of-expression", weight: 1 }],
    ],
    [
      "식의 값의 활용 식이 주어지지 않은 경우",
      [{ slug: "m1-value-of-expression", weight: 1 }],
    ],
    ["다항식", [{ slug: "m1-polynomial-linear", weight: 1 }]],
    ["일차식", [{ slug: "m1-polynomial-linear", weight: 1 }]],
    [
      "일차식과 수의 곱셈 나눗셈",
      [{ slug: "m1-linear-expression-calc", weight: 1 }],
    ],
    ["동류항", [{ slug: "m1-linear-expression-calc", weight: 1 }]],
    ["일차식의 덧셈과 뺄셈", [{ slug: "m1-linear-expression-calc", weight: 1 }]],
    [
      "괄호가 여러 개인 일차식의 덧셈과 뺄셈",
      [{ slug: "m1-linear-expression-calc", weight: 1 }],
    ],
    [
      "분수 꼴인 일차식의 덧셈과 뺄셈",
      [{ slug: "m1-linear-expression-calc", weight: 1 }],
    ],
    ["문자에 일차식을 대입하기", [{ slug: "m1-linear-expression-calc", weight: 1 }]],
    ["어떤 식 구하기", [{ slug: "m1-linear-expression-calc", weight: 1 }]],
    ["바르게 계산한 식 구하기", [{ slug: "m1-linear-expression-calc", weight: 1 }]],
    [
      "도형에서의 일차식의 덧셈과 뺄셈의 활용",
      [{ slug: "m1-linear-expression-calc", weight: 1 }],
    ],
    /* 지면은 「[ ]의 꼴이 포함된 일차식의 계산」 — 대괄호가 벡터라 빠진다 */
    [
      "의 꼴이 포함된 일차식의 계산",
      [{ slug: "m1-linear-expression-calc", weight: 1 }],
    ],

    // ── 06 일차방정식의 풀이 · 소단원
    ["방정식과 항등식", [{ slug: "m1-equation-identity", weight: 1 }]],
    ["등식의 성질", [{ slug: "m1-equality-properties", weight: 1 }]],
    ["일차방정식의 풀이", [{ slug: "m1-linear-equation-solve", weight: 1 }]],

    // ── 06 · 유형
    ["등식", [{ slug: "m1-equation-identity", weight: 1 }]],
    ["문장을 등식으로 나타내기", [{ slug: "m1-equation-identity", weight: 1 }]],
    ["방정식의 해", [{ slug: "m1-equation-identity", weight: 1 }]],
    ["항등식", [{ slug: "m1-equation-identity", weight: 1 }]],
    ["항등식이 되는 조건", [{ slug: "m1-equation-identity", weight: 1 }]],
    [
      "등식의 성질을 이용한 방정식의 풀이",
      [{ slug: "m1-equality-properties", weight: 1 }],
    ],
    ["이항", [{ slug: "m1-linear-equation-solve", weight: 1 }]],
    ["일차방정식", [{ slug: "m1-linear-equation-solve", weight: 1 }]],
    [
      "계수가 소수인 일차방정식의 풀이",
      [{ slug: "m1-linear-equation-solve", weight: 1 }],
    ],
    [
      "계수가 분수인 일차방정식의 풀이",
      [{ slug: "m1-linear-equation-solve", weight: 1 }],
    ],
    [
      "계수에 소수와 분수가 섞인 일차방정식의 풀이",
      [{ slug: "m1-linear-equation-solve", weight: 1 }],
    ],
    [
      "비례식으로 주어진 일차방정식의 풀이",
      [{ slug: "m1-linear-equation-solve", weight: 1 }],
    ],
    [
      "일차방정식의 해가 주어진 경우",
      [{ slug: "m1-linear-equation-solve", weight: 1 }],
    ],
    [
      "두 일차방정식의 해가 서로 같은 경우",
      [{ slug: "m1-linear-equation-solve", weight: 1 }],
    ],
    [
      "해에 대한 조건이 주어진 경우",
      [{ slug: "m1-linear-equation-solve", weight: 1 }],
    ],
    ["특수한 해를 갖는 경우", [{ slug: "m1-linear-equation-solve", weight: 1 }]],

    // ── 07 일차방정식의 활용 · 소단원·유형 (전부 같은 개념이다)
    ["일차방정식의 활용 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["농도에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["어떤 수에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    [
      "연속하는 자연수에 대한 문제",
      [{ slug: "m1-linear-equation-apply", weight: 1 }],
    ],
    ["자릿수에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["나이에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["예금에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["개수의 합이 일정한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["도형에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["과부족에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["증가 감소에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["전체의 양에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    [
      "거리 속력 시간에 대한 문제 속력이 바뀌는 경우",
      [{ slug: "m1-linear-equation-apply", weight: 1 }],
    ],
    [
      "거리 속력 시간에 대한 문제 시간 차가 발생하는 경우",
      [{ slug: "m1-linear-equation-apply", weight: 1 }],
    ],
    [
      "거리 속력 시간에 대한 문제 시간 차를 두고 출발하는 경우",
      [{ slug: "m1-linear-equation-apply", weight: 1 }],
    ],
    [
      "거리 속력 시간에 대한 문제 마주 보고 가거나 둘레를 도는 경우",
      [{ slug: "m1-linear-equation-apply", weight: 1 }],
    ],
    [
      "거리 속력 시간에 대한 문제 기차가 다리 또는 터널을 지나는 경우",
      [{ slug: "m1-linear-equation-apply", weight: 1 }],
    ],
    [
      "농도에 대한 문제 물을 넣거나 증발시키는 경우",
      [{ slug: "m1-linear-equation-apply", weight: 1 }],
    ],
    [
      "농도에 대한 문제 소금을 더 넣는 경우",
      [{ slug: "m1-linear-equation-apply", weight: 1 }],
    ],
    [
      "농도에 대한 문제 농도가 다른 두 소금물을 섞는 경우",
      [{ slug: "m1-linear-equation-apply", weight: 1 }],
    ],
    ["원가 정가에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["일에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["긴 의자에 대한 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
    ["규칙을 찾는 문제", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
  ]);

export const RPM_M1_CH3_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    [
      "문자의 사용과 식의 계산",
      [
        { slug: "m1-symbolic-expression", weight: 0.25 },
        { slug: "m1-value-of-expression", weight: 0.25 },
        { slug: "m1-polynomial-linear", weight: 0.25 },
        { slug: "m1-linear-expression-calc", weight: 0.25 },
      ],
    ],
    [
      "일차방정식의 풀이",
      [
        { slug: "m1-equation-identity", weight: 0.34 },
        { slug: "m1-equality-properties", weight: 0.33 },
        { slug: "m1-linear-equation-solve", weight: 0.33 },
      ],
    ],
    /* 활용 중단원은 개념이 하나다 — 나눌 것이 없다 */
    ["일차방정식의 활용", [{ slug: "m1-linear-equation-apply", weight: 1 }]],
  ]);

/* ═══════════════════════════════════════════════════════════════
 * IV. 좌표평면과 그래프 (08 좌표와 그래프 · 09 정비례와 반비례)
 *     본책 p.124–155 · 0915~1123 · 209문항
 * ═══════════════════════════════════════════════════════════════ */

/** 2022 개정 교육과정 중1 「변화와 관계」 — IV. 좌표평면과 그래프 */
export const RPM_M1_CH4_CONCEPTS: ConceptDefinition[] = [
  {
    slug: "m1-coordinate-plane",
    name: "좌표와 좌표평면",
    description: "순서쌍으로 좌표평면 위의 점을 나타내고 읽는다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-quadrants",
    name: "사분면",
    description: "좌표의 부호로 점이 속한 사분면을 판단한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-graph-interpret",
    name: "그래프와 그 해석",
    description: "상황을 그래프로 나타내고 그래프에서 변화를 읽는다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-direct-proportion",
    name: "정비례",
    description: "정비례 관계를 식과 그래프로 나타내고 성질을 이용한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-inverse-proportion",
    name: "반비례",
    description: "반비례 관계를 식과 그래프로 나타내고 성질을 이용한다.",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
];

export const RPM_M1_CH4_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 08 좌표와 그래프
    ["좌표와 좌표평면", [{ slug: "m1-coordinate-plane", weight: 1 }]],
    ["사분면", [{ slug: "m1-quadrants", weight: 1 }]],
    ["그래프와 그 해석", [{ slug: "m1-graph-interpret", weight: 1 }]],
    [
      "순서쌍과 좌표평면 위의 점의 좌표",
      [{ slug: "m1-coordinate-plane", weight: 1 }],
    ],
    /* 지면은 「x축 또는 y축 위의 점의 좌표」 — 축 이름이 수식이라 빠진다 */
    ["축 또는 축 위의 점의 좌표", [{ slug: "m1-coordinate-plane", weight: 1 }]],
    ["좌표평면 위의 도형의 넓이", [{ slug: "m1-coordinate-plane", weight: 1 }]],
    ["대칭인 점의 좌표", [{ slug: "m1-coordinate-plane", weight: 1 }]],
    [
      "사분면 위의 점 점 가 속한 사분면이 주어진 경우",
      [{ slug: "m1-quadrants", weight: 1 }],
    ],
    [
      "사분면 위의 점 두 수의 부호를 이용하는 경우",
      [{ slug: "m1-quadrants", weight: 1 }],
    ],
    ["상황을 그래프로 나타내기", [{ slug: "m1-graph-interpret", weight: 1 }]],
    ["그래프의 해석", [{ slug: "m1-graph-interpret", weight: 1 }]],
    ["주기적 변화를 나타내는 그래프", [{ slug: "m1-graph-interpret", weight: 1 }]],
    ["그래프의 해석 두 그래프의 비교", [{ slug: "m1-graph-interpret", weight: 1 }]],

    // ── 09 정비례와 반비례 · 정비례
    ["정비례", [{ slug: "m1-direct-proportion", weight: 1 }]],
    ["정비례 관계", [{ slug: "m1-direct-proportion", weight: 1 }]],
    ["정비례 관계의 식 구하기", [{ slug: "m1-direct-proportion", weight: 1 }]],
    [
      "정비례 관계 의 활용 와 사이의 관계를 나타내는 식 구하기",
      [{ slug: "m1-direct-proportion", weight: 1 }],
    ],
    ["정비례 관계 의 활용", [{ slug: "m1-direct-proportion", weight: 1 }]],
    ["정비례 관계 의 그래프", [{ slug: "m1-direct-proportion", weight: 1 }]],
    [
      "정비례 관계 의 그래프와 의 절댓값 사이의 관계",
      [{ slug: "m1-direct-proportion", weight: 1 }],
    ],
    [
      "정비례 관계 의 그래프가 지나는 점",
      [{ slug: "m1-direct-proportion", weight: 1 }],
    ],
    ["정비례 관계 의 그래프의 성질", [{ slug: "m1-direct-proportion", weight: 1 }]],
    [
      "정비례 관계의 그래프가 주어진 경우",
      [{ slug: "m1-direct-proportion", weight: 1 }],
    ],
    [
      "정비례 관계 의 그래프와 도형의 넓이",
      [{ slug: "m1-direct-proportion", weight: 1 }],
    ],
    ["두 정비례 관계의 그래프 비교하기", [{ slug: "m1-direct-proportion", weight: 1 }]],

    // ── 09 정비례와 반비례 · 반비례
    ["반비례", [{ slug: "m1-inverse-proportion", weight: 1 }]],
    ["반비례 관계", [{ slug: "m1-inverse-proportion", weight: 1 }]],
    ["반비례 관계의 식 구하기", [{ slug: "m1-inverse-proportion", weight: 1 }]],
    ["반비례 관계 의 활용", [{ slug: "m1-inverse-proportion", weight: 1 }]],
    ["반비례 관계 의 그래프", [{ slug: "m1-inverse-proportion", weight: 1 }]],
    [
      "반비례 관계의 그래프가 주어진 경우",
      [{ slug: "m1-inverse-proportion", weight: 1 }],
    ],
    /* 유형 번호가 붙지 않아 소단원으로 잡힌 다섯 — 제목이 짧게 잘렸지만
     * 어느 개념인지는 **교재의 쪽 참조**가 말해 준다. 213~217쪽은 반비례
     * 구간이다(정비례는 202~205쪽). 문항 번호도 유형 12와 14 사이 등
     * 반비례 유형들 사이에 끼어 있다. */
    [
      "와 사이의 관계를 나타내는 식 구하기",
      [{ slug: "m1-inverse-proportion", weight: 1 }],
    ],
    ["의 절댓값 사이의 관계", [{ slug: "m1-inverse-proportion", weight: 1 }]],
    ["지나는 점", [{ slug: "m1-inverse-proportion", weight: 1 }]],
    ["성질", [{ slug: "m1-inverse-proportion", weight: 1 }]],
    ["도형의 넓이", [{ slug: "m1-inverse-proportion", weight: 1 }]],

    // ── 둘 다 쓰는 유형
    [
      "정비례 관계와 반비례 관계의 그래프가 만나는 점",
      [
        { slug: "m1-direct-proportion", weight: 0.5 },
        { slug: "m1-inverse-proportion", weight: 0.5 },
      ],
    ],
    [
      "도형의 넓이를 이등분하는 직선",
      [
        { slug: "m1-direct-proportion", weight: 0.5 },
        { slug: "m1-inverse-proportion", weight: 0.5 },
      ],
    ],

    /* 「의 그래프」(0997~1017)는 **표에 넣지 않는다.** 지면은
     * 「y=ax의 그래프」인지 「y=a/x의 그래프」인지 수식이 갈라 주는데
     * 제목에서 그 수식이 빠져 둘을 구별할 수 없다. 억지로 한쪽에 붙이면
     * 조용히 틀린다 — 중단원 표(정비례·반비례 반반)로 흘려보낸다. */
  ]);

export const RPM_M1_CH4_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    [
      "좌표와 그래프",
      [
        { slug: "m1-coordinate-plane", weight: 0.34 },
        { slug: "m1-quadrants", weight: 0.33 },
        { slug: "m1-graph-interpret", weight: 0.33 },
      ],
    ],
    [
      "정비례와 반비례",
      [
        { slug: "m1-direct-proportion", weight: 0.5 },
        { slug: "m1-inverse-proportion", weight: 0.5 },
      ],
    ],
  ]);

/**
 * 표를 찾을 때 쓰는 제목 정규화.
 *
 * 지면의 □ 기호(「약수의 개수가 주어질 때 □ 안에 들어 갈 수 있는 자연수
 * 구하기」)는 **공백이 아니라 사설 사용 영역 글자로 온다** — U+E22D다.
 * 눈으로는 두 칸 벌어진 것처럼 보여서 「공백을 눌러 비교하면 된다」고
 * 적어 두었는데, `\s`는 이 글자를 공백으로 치지 않는다. 4문항이 계속
 * 유형 표를 못 찾고 중단원 표(3분할)로 내려가고 있었다 — **개념 미지정이
 * 0으로 나와서 아무도 몰랐다.** 걸리기는 걸리되 엉뚱한 데 걸린 것이다.
 *
 * 그래서 사설 영역(U+E000~U+F8FF)을 공백으로 바꾼 뒤 눌러서 비교한다.
 * 표에 쓸 때는 그 자리를 그냥 한 칸 띄우면 된다.
 */
export function normalizeConceptKey(title: string): string {
  return title
    .replace(/[-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
