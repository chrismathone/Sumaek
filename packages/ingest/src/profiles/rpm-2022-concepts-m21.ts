/* ─────────────────────────────────────────────────────────────
 * RPM 중2-1 — 유형·소단원·중단원 → 개념 잇기
 *
 * 규칙은 중1-1(rpm-2022-concepts.ts)과 같다. 그 파일 머리말을 먼저 읽을 것.
 * 요약하면 셋이다:
 *   - **사람이 쓴다.** AI가 유형 제목을 보고 개념을 추측하게 두지 않는다.
 *   - 제목은 `extract --outline`이 찍는 **그대로** 쓴다 (수식은 빠져 나온다).
 *   - 뜻이 갈리지 않는 제목(「방법 2」·「의 그래프」)은 **넣지 않고** 중단원
 *     표로 흘린다. 억지로 붙이면 숙련도 추정이 조용히 틀어진다.
 *
 * ## 개념 slug는 이미 있는 것만 쓴다
 *
 * 중2 정본 개념 26개가 이미 canonical_concepts에 있다(정본 목록 20 +
 * 연립·일차함수 세분 6). 새로 만들지 않았다 — ADR-0011대로 정본 목록이
 * slug의 권위다. 그래서 I단원은 유형 표가 아예 없다: 「유리수와 순환소수」
 * 하나로 다 걸리므로 중단원 표만으로 충분하고, 표가 없으면 틀릴 자리도 없다.
 *
 * ## 같은 제목이 계층마다 되풀이된다
 *
 * 이 교재는 소단원 머리글과 유형 제목이 자주 같다(「지수법칙 ⑴」·「단항식의
 * 곱셈」·「일차부등식의 풀이」). 게다가 유형 07과 08이 **둘 다** 「일차부등식의
 * 풀이」다. 어차피 같은 개념으로 가므로 키는 하나만 둔다 — 두 번 쓰면
 * conceptTable이 불러들이는 순간 던진다.
 * ───────────────────────────────────────────────────────────── */

import {
  conceptTable,
  type ConceptDefinition,
  type ConceptWeight,
} from "./rpm-2022-concepts";

const m2 = (
  slug: string,
  name: string,
  description: string,
  domainName: string,
): ConceptDefinition => ({
  slug,
  name,
  description,
  schoolLevel: "middle",
  gradeBand: "middle-2",
  domainName,
});

/* ── I. 유리수와 순환소수 ───────────────────────────────────── */

export const RPM_M21_CH1_CONCEPTS: ConceptDefinition[] = [
  m2(
    "m2-repeating-decimals",
    "유리수와 순환소수",
    "유리수를 유한소수·순환소수로 나타내고, 순환소수를 분수로 되돌린다.",
    "수와 연산",
  ),
];

/** I단원은 유형 제목이 전부 한 개념으로 간다 — 표를 두지 않는다 */
export const RPM_M21_CH1_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([]);

export const RPM_M21_CH1_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["유리수와 순환소수", [{ slug: "m2-repeating-decimals", weight: 1 }]],
  ]);

/* ── II. 식의 계산 ─────────────────────────────────────────── */

export const RPM_M21_CH2_CONCEPTS: ConceptDefinition[] = [
  m2(
    "m2-exponent-laws",
    "지수법칙",
    "지수의 합·차·곱, 곱과 몫의 거듭제곱을 계산에 적용한다.",
    "변화와 관계",
  ),
  m2(
    "m2-polynomial-add-sub",
    "다항식의 덧셈과 뺄셈",
    "동류항을 정리해 다항식과 이차식의 덧셈·뺄셈을 한다.",
    "변화와 관계",
  ),
  m2(
    "m2-monomial-polynomial-ops",
    "단항식과 다항식의 곱셈·나눗셈",
    "단항식끼리, 그리고 단항식과 다항식의 곱셈·나눗셈을 하고 식의 값을 구한다.",
    "변화와 관계",
  ),
];

export const RPM_M21_CH2_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 지수법칙 (소단원 머리글과 유형 제목이 같은 자리가 많다)
    ["지수법칙 ⑴", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["지수법칙 ⑵", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["지수법칙 ⑶", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["지수법칙 ⑷", [{ slug: "m2-exponent-laws", weight: 1 }]],
    /* 소단원 머리글 둘·셋이 한 줄에 붙어 오는 자리 */
    ["지수법칙 ⑴ 지수법칙 ⑵", [{ slug: "m2-exponent-laws", weight: 1 }]],
    [
      "지수법칙 ⑴ 지수법칙 ⑵ 지수법칙 ⑶",
      [{ slug: "m2-exponent-laws", weight: 1 }],
    ],
    ["지수법칙 ⑷ 곱의 거듭제곱", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["지수법칙 ⑷ 몫의 거듭제곱", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["지수법칙의 응용 ⑴", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["지수법칙의 응용 ⑵", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["지수법칙의 응용 ⑶", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["지수법칙의 활용", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["자릿수 구하기", [{ slug: "m2-exponent-laws", weight: 1 }]],
    ["일의 자리의 숫자 구하기", [{ slug: "m2-exponent-laws", weight: 1 }]],

    // ── 단항식의 계산
    ["단항식의 곱셈", [{ slug: "m2-monomial-polynomial-ops", weight: 1 }]],
    [
      "단항식의 곱셈 단항식의 나눗셈",
      [{ slug: "m2-monomial-polynomial-ops", weight: 1 }],
    ],
    [
      "단항식의 나눗셈 방법 1 방법 2",
      [{ slug: "m2-monomial-polynomial-ops", weight: 1 }],
    ],
    [
      "단항식의 곱셈과 나눗셈의 혼합 계산",
      [{ slug: "m2-monomial-polynomial-ops", weight: 1 }],
    ],
    [
      "단항식의 곱셈과 나눗셈의 활용",
      [{ slug: "m2-monomial-polynomial-ops", weight: 1 }],
    ],
    /* 지면은 「□ 안에 알맞은 식 구하기」 — □는 사설 영역 글자라 공백이 된다 */
    ["안에 알맞은 식 구하기", [{ slug: "m2-monomial-polynomial-ops", weight: 1 }]],

    // ── 다항식의 덧셈과 뺄셈
    ["다항식의 덧셈과 뺄셈", [{ slug: "m2-polynomial-add-sub", weight: 1 }]],
    ["이차식의 덧셈과 뺄셈", [{ slug: "m2-polynomial-add-sub", weight: 1 }]],
    [
      "괄호가 여러 개인 다항식의 덧셈과 뺄셈",
      [{ slug: "m2-polynomial-add-sub", weight: 1 }],
    ],
    ["어떤 식 구하기", [{ slug: "m2-polynomial-add-sub", weight: 1 }]],
    ["바르게 계산한 식 구하기", [{ slug: "m2-polynomial-add-sub", weight: 1 }]],
    /* 소단원 머리글이 이어 붙어 오는 자리 — 지면은 「다항식의 덧셈과 뺄셈」과
     * 「(단항식)×(다항식)의 계산」이 나란히 선 묶음이다 */
    [
      "다항식의 덧셈과 뺄셈 단항식 다항식 의 계산",
      [
        { slug: "m2-polynomial-add-sub", weight: 0.5 },
        { slug: "m2-monomial-polynomial-ops", weight: 0.5 },
      ],
    ],
    [
      "다항식의 덧셈과 뺄셈 단항식 다항식 의 계산 다항식 단항식 의 계산",
      [
        { slug: "m2-polynomial-add-sub", weight: 0.5 },
        { slug: "m2-monomial-polynomial-ops", weight: 0.5 },
      ],
    ],

    // ── 단항식과 다항식의 곱셈·나눗셈
    ["단항식 다항식", [{ slug: "m2-monomial-polynomial-ops", weight: 1 }]],
    [
      "덧셈 뺄셈 곱셈 나눗셈이 혼합된 식의 계산",
      [{ slug: "m2-monomial-polynomial-ops", weight: 1 }],
    ],
    [
      "단항식과 다항식의 곱셈과 나눗셈의 활용",
      [{ slug: "m2-monomial-polynomial-ops", weight: 1 }],
    ],
    ["식의 값 ⑴", [{ slug: "m2-monomial-polynomial-ops", weight: 1 }]],
    ["식의 값 ⑵", [{ slug: "m2-monomial-polynomial-ops", weight: 1 }]],
    ["식의 대입", [{ slug: "m2-monomial-polynomial-ops", weight: 1 }]],
    ["규칙 찾기", [{ slug: "m2-monomial-polynomial-ops", weight: 1 }]],
  ]);

export const RPM_M21_CH2_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    [
      "단항식의 계산",
      [
        { slug: "m2-exponent-laws", weight: 0.5 },
        { slug: "m2-monomial-polynomial-ops", weight: 0.5 },
      ],
    ],
    [
      "다항식의 계산",
      [
        { slug: "m2-polynomial-add-sub", weight: 0.5 },
        { slug: "m2-monomial-polynomial-ops", weight: 0.5 },
      ],
    ],
  ]);

/* ── III. 일차부등식 ───────────────────────────────────────── */

export const RPM_M21_CH3_CONCEPTS: ConceptDefinition[] = [
  m2(
    "m2-inequality-basics",
    "부등식과 그 성질",
    "부등식의 뜻과 해를 이해하고 부등식의 성질로 식의 값의 범위를 다룬다.",
    "변화와 관계",
  ),
  m2(
    "m2-linear-inequality",
    "일차부등식의 풀이와 활용",
    "일차부등식을 풀고 수직선에 나타내며, 실생활 문제에 적용한다.",
    "변화와 관계",
  ),
];

export const RPM_M21_CH3_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 부등식과 그 성질
    ["부등식", [{ slug: "m2-inequality-basics", weight: 1 }]],
    ["부등식의 뜻", [{ slug: "m2-inequality-basics", weight: 1 }]],
    ["부등식으로 나타내기", [{ slug: "m2-inequality-basics", weight: 1 }]],
    ["부등식의 해", [{ slug: "m2-inequality-basics", weight: 1 }]],
    ["부등식의 성질", [{ slug: "m2-inequality-basics", weight: 1 }]],
    [
      "부등식의 성질을 이용하여 식의 값의 범위 구하기",
      [{ slug: "m2-inequality-basics", weight: 1 }],
    ],

    // ── 일차부등식의 풀이 (유형 07·08이 같은 제목이라 키는 하나다)
    ["일차부등식", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["일차부등식의 뜻", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["일차부등식의 풀이", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["복잡한 일차부등식의 풀이", [{ slug: "m2-linear-inequality", weight: 1 }]],
    [
      "계수가 소수 또는 분수인 일차부등식의 풀이",
      [{ slug: "m2-linear-inequality", weight: 1 }],
    ],
    /* 지면은 「x의 계수가 문자인 …」 — 수식은 제목에서 빠져 나온다 */
    ["의 계수가 문자인 일차부등식의 풀이", [{ slug: "m2-linear-inequality", weight: 1 }]],
    [
      "부등식의 해가 주어진 경우 미지수의 값 구하기",
      [{ slug: "m2-linear-inequality", weight: 1 }],
    ],
    ["해가 서로 같은 두 일차부등식", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["부등식의 해의 조건이 주어진 경우", [{ slug: "m2-linear-inequality", weight: 1 }]],

    // ── 일차부등식의 활용
    ["일차부등식의 활용", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["수에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["예금액에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["평균에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["최대 개수에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["추가 요금에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["유리한 방법을 선택하는 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["도형에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["원가 정가에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["거리 속력 시간에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    ["농도에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
    [
      "농도에 대한 문제 물을 넣거나 증발시키는 경우",
      [{ slug: "m2-linear-inequality", weight: 1 }],
    ],
    [
      "농도에 대한 문제 두 소금물을 섞는 경우",
      [{ slug: "m2-linear-inequality", weight: 1 }],
    ],
    ["합금 식품에 대한 문제", [{ slug: "m2-linear-inequality", weight: 1 }]],
  ]);

export const RPM_M21_CH3_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    [
      "일차부등식",
      [
        { slug: "m2-inequality-basics", weight: 0.5 },
        { slug: "m2-linear-inequality", weight: 0.5 },
      ],
    ],
    ["일차부등식의 활용", [{ slug: "m2-linear-inequality", weight: 1 }]],
  ]);

/* ── IV. 연립일차방정식 ────────────────────────────────────── */

export const RPM_M21_CH4_CONCEPTS: ConceptDefinition[] = [
  m2(
    "m2-simeq-intro",
    "연립일차방정식의 뜻",
    "미지수가 2개인 일차방정식과 연립일차방정식의 뜻·해를 이해한다.",
    "변화와 관계",
  ),
  m2("m2-simeq-substitution", "대입법", "대입법으로 연립일차방정식을 푼다.", "변화와 관계"),
  m2("m2-simeq-elimination", "가감법", "가감법으로 연립일차방정식을 푼다.", "변화와 관계"),
  m2(
    "m2-simeq-application",
    "연립방정식의 활용",
    "연립일차방정식을 세워 실생활 문제를 해결한다.",
    "변화와 관계",
  ),
];

export const RPM_M21_CH4_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    /* 지면은 「미지수가 2개인 …」 — 숫자가 수식 글꼴이라 제목에서 빠진다 */
    ["미지수가 개인 일차방정식", [{ slug: "m2-simeq-intro", weight: 1 }]],
    ["미지수가 개인 일차방정식의 해", [{ slug: "m2-simeq-intro", weight: 1 }]],
    ["미지수가 개인 연립일차방정식", [{ slug: "m2-simeq-intro", weight: 1 }]],
    ["일차방정식의 해가 주어질 때", [{ slug: "m2-simeq-intro", weight: 1 }]],
    ["연립방정식과 그 해", [{ slug: "m2-simeq-intro", weight: 1 }]],
    /* 유형 05와 12가 같은 제목이다. 05는 해의 뜻, 12는 풀이 쪽인데
     * 제목만으로는 갈리지 않으므로 「해의 뜻」으로 둔다. */
    ["연립방정식의 해가 주어질 때", [{ slug: "m2-simeq-intro", weight: 1 }]],

    ["연립방정식의 풀이 대입법", [{ slug: "m2-simeq-substitution", weight: 1 }]],
    ["연립방정식의 풀이 가감법", [{ slug: "m2-simeq-elimination", weight: 1 }]],
    [
      /* 대입법·가감법을 가리지 않고 섞어 내는 자리 */
      "여러 가지 연립방정식의 풀이",
      [
        { slug: "m2-simeq-substitution", weight: 0.5 },
        { slug: "m2-simeq-elimination", weight: 0.5 },
      ],
    ],
    ["해가 특수한 연립방정식", [{ slug: "m2-simeq-elimination", weight: 1 }]],
    ["괄호가 있는 연립방정식의 풀이", [{ slug: "m2-simeq-elimination", weight: 1 }]],
    [
      "계수가 소수 또는 분수인 연립방정식의 풀이",
      [{ slug: "m2-simeq-elimination", weight: 1 }],
    ],
    ["비례식을 포함한 연립방정식의 풀이", [{ slug: "m2-simeq-elimination", weight: 1 }]],
    /* 지면은 「A=B=C의 꼴의 방정식의 풀이」 */
    ["의 꼴의 방정식의 풀이", [{ slug: "m2-simeq-elimination", weight: 1 }]],
    [
      "연립방정식의 해가 다른 일차방정식을 만족시킬 때",
      [{ slug: "m2-simeq-elimination", weight: 1 }],
    ],
    ["해에 대한 조건이 주어질 때", [{ slug: "m2-simeq-elimination", weight: 1 }]],
    ["두 연립방정식의 해가 서로 같을 때", [{ slug: "m2-simeq-elimination", weight: 1 }]],
    [
      "계수 또는 상수항을 잘못 보고 구한 해",
      [{ slug: "m2-simeq-elimination", weight: 1 }],
    ],
    ["계수가 순환소수인 연립방정식", [{ slug: "m2-simeq-elimination", weight: 1 }]],
    ["지수법칙을 이용한 연립방정식", [{ slug: "m2-simeq-elimination", weight: 1 }]],

    // ── 활용
    ["연립일차방정식의 활용 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["수에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["자연수에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["나이에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["가격 개수에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["도형에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["득점 감점에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["증가 감소에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["원가 정가에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["일에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["비율에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    ["거리 속력 시간에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    [
      "거리 속력 시간에 대한 문제 속력이 바뀌는 경우",
      [{ slug: "m2-simeq-application", weight: 1 }],
    ],
    [
      "거리 속력 시간에 대한 문제 만나는 경우",
      [{ slug: "m2-simeq-application", weight: 1 }],
    ],
    [
      "거리 속력 시간에 대한 문제 둘레를 도는 경우",
      [{ slug: "m2-simeq-application", weight: 1 }],
    ],
    [
      "거리 속력 시간에 대한 문제 강물과 배의 속력에 대한 경우",
      [{ slug: "m2-simeq-application", weight: 1 }],
    ],
    [
      "거리 속력 시간에 대한 문제 기차가 다리 또는 터널을 지나는 경우",
      [{ slug: "m2-simeq-application", weight: 1 }],
    ],
    ["농도에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
    [
      "농도에 대한 문제 소금물 또는 소금의 양을 구하는 경우",
      [{ slug: "m2-simeq-application", weight: 1 }],
    ],
    [
      "농도에 대한 문제 농도를 구하는 경우",
      [{ slug: "m2-simeq-application", weight: 1 }],
    ],
    ["합금 식품에 대한 문제", [{ slug: "m2-simeq-application", weight: 1 }]],
  ]);

export const RPM_M21_CH4_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    [
      "연립일차방정식",
      [
        { slug: "m2-simeq-intro", weight: 0.34 },
        { slug: "m2-simeq-substitution", weight: 0.33 },
        { slug: "m2-simeq-elimination", weight: 0.33 },
      ],
    ],
    ["연립일차방정식의 활용", [{ slug: "m2-simeq-application", weight: 1 }]],
  ]);

/* ── V. 일차함수 ───────────────────────────────────────────── */

export const RPM_M21_CH5_CONCEPTS: ConceptDefinition[] = [
  m2(
    "m2-function-concept",
    "함수의 개념과 함숫값",
    "두 변수 사이의 대응에서 함수의 뜻을 이해하고 함숫값을 구한다.",
    "변화와 관계",
  ),
  m2("m2-linear-fn-intro", "일차함수의 뜻", "일차함수의 뜻을 이해한다.", "변화와 관계"),
  m2(
    "m2-linear-fn-graph",
    "일차함수의 그래프",
    "평행이동, x절편·y절편, 기울기로 일차함수의 그래프를 그린다.",
    "변화와 관계",
  ),
  m2(
    "m2-linear-fn-properties",
    "일차함수 그래프의 성질과 활용",
    "기울기와 y절편의 부호로 그래프의 성질을 판단하고 식을 구해 활용한다.",
    "변화와 관계",
  ),
  m2(
    "m2-linear-fn-vs-equation",
    "일차함수와 일차방정식의 관계",
    "미지수가 2개인 일차방정식의 그래프가 직선임을 이해한다.",
    "변화와 관계",
  ),
  m2(
    "m2-linear-fn-vs-simeq",
    "일차함수의 그래프와 연립방정식",
    "두 직선의 교점과 연립방정식의 해를 잇는다.",
    "변화와 관계",
  ),
];

export const RPM_M21_CH5_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 함수와 함숫값
    ["함수", [{ slug: "m2-function-concept", weight: 1 }]],
    ["함숫값", [{ slug: "m2-function-concept", weight: 1 }]],
    ["함수의 뜻과 함숫값", [{ slug: "m2-function-concept", weight: 1 }]],

    // ── 일차함수의 뜻
    ["일차함수", [{ slug: "m2-linear-fn-intro", weight: 1 }]],
    ["일차함수의 뜻", [{ slug: "m2-linear-fn-intro", weight: 1 }]],

    // ── 일차함수의 그래프
    ["일차함수의 그래프 위의 점", [{ slug: "m2-linear-fn-graph", weight: 1 }]],
    ["일차함수의 그래프의 평행이동", [{ slug: "m2-linear-fn-graph", weight: 1 }]],
    /* 지면은 「x절편, y절편」 — 글자 x·y가 수식 글꼴이라 빠진다 */
    ["절편 절편", [{ slug: "m2-linear-fn-graph", weight: 1 }]],
    /* 소단원 머리글이 「일차함수의 그래프의 x절편, y절편」인데 수식 글꼴로 찍힌
     * x·y가 빠지면서 여기까지만 남는다. V단원에서 이 앞머리를 쓰는 소단원은
     * 전부 그래프 쪽이라 뜻이 갈리지 않는다. */
    ["일차함수의 그래프의", [{ slug: "m2-linear-fn-graph", weight: 1 }]],
    ["일차함수의 그래프의 절편 절편", [{ slug: "m2-linear-fn-graph", weight: 1 }]],
    ["일차함수의 그래프의 기울기", [{ slug: "m2-linear-fn-graph", weight: 1 }]],
    [
      "두 점을 지나는 일차함수의 그래프의 기울기",
      [{ slug: "m2-linear-fn-graph", weight: 1 }],
    ],
    ["세 점이 한 직선 위에 있을 조건", [{ slug: "m2-linear-fn-graph", weight: 1 }]],
    [
      "일차함수의 그래프와 좌표축으로 둘러싸인 도형의 넓이",
      [{ slug: "m2-linear-fn-graph", weight: 1 }],
    ],
    [
      "함숫값을 이용하여 일차함수의 그래프의 기울기 구하기",
      [{ slug: "m2-linear-fn-graph", weight: 1 }],
    ],
    [
      "두 일차함수의 그래프와 좌표축으로 둘러싸인 도형의 넓이",
      [{ slug: "m2-linear-fn-graph", weight: 1 }],
    ],

    // ── 그래프의 성질·식 구하기·활용
    /* 지면은 「일차함수 y=ax+b의 그래프의 성질」 */
    ["일차함수 의 그래프의 성질", [{ slug: "m2-linear-fn-properties", weight: 1 }]],
    /* 지면은 「일차함수 y=ax+b의 그래프와 a, b의 부호」 */
    ["일차함수 의 그래프와 의 부호", [{ slug: "m2-linear-fn-properties", weight: 1 }]],
    [
      "일차함수의 그래프의 평행과 일치",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    ["두 일차함수의 그래프의 평행", [{ slug: "m2-linear-fn-properties", weight: 1 }]],
    ["두 일차함수의 그래프의 일치", [{ slug: "m2-linear-fn-properties", weight: 1 }]],
    ["일차함수의 식 구하기", [{ slug: "m2-linear-fn-properties", weight: 1 }]],
    [
      "일차함수의 식 구하기 기울기와 절편이 주어질 때",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "일차함수의 식 구하기 기울기와 한 점의 좌표가 주어질 때",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "일차함수의 식 구하기 두 점의 좌표가 주어질 때",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "일차함수의 식 구하기 절편 절편이 주어질 때",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    ["일차함수의 활용", [{ slug: "m2-linear-fn-properties", weight: 1 }]],
    [
      "일차함수의 활용 온도에 대한 문제",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "일차함수의 활용 길이에 대한 문제",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "일차함수의 활용 물의 양에 대한 문제",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "일차함수의 활용 속력에 대한 문제",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "일차함수의 활용 도형에서의 문제",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "일차함수의 활용 그래프가 주어진 경우의 문제",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "일차함수의 활용 여러 가지 활용 문제",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],
    [
      "두 일차함수의 그래프가 축과 만나는 두 점 사이의 거리가 주어진 경우",
      [{ slug: "m2-linear-fn-properties", weight: 1 }],
    ],

    // ── 일차함수와 일차방정식
    [
      "일차함수와 일차방정식의 관계",
      [{ slug: "m2-linear-fn-vs-equation", weight: 1 }],
    ],
    ["일차방정식의 그래프 위의 점", [{ slug: "m2-linear-fn-vs-equation", weight: 1 }]],
    /* 지면은 「일차방정식 ax+by+c=0의 그래프와 a, b, c의 부호」 */
    [
      "일차방정식 의 그래프와 의 부호",
      [{ slug: "m2-linear-fn-vs-equation", weight: 1 }],
    ],
    ["직선의 방정식 구하기", [{ slug: "m2-linear-fn-vs-equation", weight: 1 }]],
    /* 지면은 「방정식 x=p, y=q의 그래프」 */
    ["방정식 의 그래프", [{ slug: "m2-linear-fn-vs-equation", weight: 1 }]],
    /* 같은 소단원 머리글이 「방정식」만 남고 잘려 오는 자리도 있다 */
    ["방정식", [{ slug: "m2-linear-fn-vs-equation", weight: 1 }]],
    [
      "좌표축에 평행한 네 직선으로 둘러싸인 도형의 넓이",
      [{ slug: "m2-linear-fn-vs-equation", weight: 1 }],
    ],
    ["직선의 방정식의 활용", [{ slug: "m2-linear-fn-vs-equation", weight: 1 }]],
    ["직선과 선분이 만날 조건", [{ slug: "m2-linear-fn-vs-equation", weight: 1 }]],
    [
      "도형의 넓이를 이등분하는 직선",
      [{ slug: "m2-linear-fn-vs-equation", weight: 1 }],
    ],

    // ── 그래프와 연립방정식
    [
      "일차방정식의 그래프와 연립일차방정식의 해",
      [{ slug: "m2-linear-fn-vs-simeq", weight: 1 }],
    ],
    [
      "두 그래프의 위치 관계와 연립일차방정식의 해의 개수",
      [{ slug: "m2-linear-fn-vs-simeq", weight: 1 }],
    ],
    ["연립방정식의 해와 그래프의 교점", [{ slug: "m2-linear-fn-vs-simeq", weight: 1 }]],
    [
      "두 일차방정식의 그래프의 교점의 좌표를 이용하여 미지수의 값 구하기",
      [{ slug: "m2-linear-fn-vs-simeq", weight: 1 }],
    ],
    [
      "두 일차방정식의 그래프의 교점을 지나는 직선의 방정식",
      [{ slug: "m2-linear-fn-vs-simeq", weight: 1 }],
    ],
    ["세 직선이 한 점에서 만날 때", [{ slug: "m2-linear-fn-vs-simeq", weight: 1 }]],
    [
      "연립방정식의 해의 개수와 교점의 개수",
      [{ slug: "m2-linear-fn-vs-simeq", weight: 1 }],
    ],
    [
      "직선으로 둘러싸인 도형의 넓이",
      [{ slug: "m2-linear-fn-vs-simeq", weight: 1 }],
    ],
  ]);

export const RPM_M21_CH5_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    [
      /* ⑴·⑵는 지면의 원문자 그대로다 — 러닝헤드에서 온 제목이라 손대지 않는다 */
      "일차함수와 그 그래프 ⑴",
      [
        { slug: "m2-function-concept", weight: 0.3 },
        { slug: "m2-linear-fn-intro", weight: 0.2 },
        { slug: "m2-linear-fn-graph", weight: 0.5 },
      ],
    ],
    ["일차함수와 그 그래프 ⑵", [{ slug: "m2-linear-fn-properties", weight: 1 }]],
    [
      "일차함수와 일차방정식의 관계",
      [
        { slug: "m2-linear-fn-vs-equation", weight: 0.5 },
        { slug: "m2-linear-fn-vs-simeq", weight: 0.5 },
      ],
    ],
  ]);
