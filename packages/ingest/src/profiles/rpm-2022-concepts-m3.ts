/* ─────────────────────────────────────────────────────────────
 * RPM 중3-1·중3-2 — 중단원 → 개념 잇기
 *
 * 규칙은 중1-1(rpm-2022-concepts.ts) 머리말과 같다.
 *
 * 중2-2와 마찬가지로 **중단원 표만 둔다.** 이 두 권은 중단원 하나가 정본
 * 개념 하나와 거의 그대로 맞아떨어진다(「제곱근의 뜻과 성질」·「삼각비」·
 * 「원주각」…). 유형 제목을 수백 개 옮겨 적다 한 글자 틀리면 그 유형만
 * 조용히 중단원으로 흘러 **아무 표시도 나지 않으므로**, 표를 두지 않는
 * 편이 안전하다.
 *
 * 개념 slug는 이미 canonical_concepts에 있는 중3 16개만 쓴다 — 새로
 * 만들지 않는다(ADR-0011).
 * ───────────────────────────────────────────────────────────── */

import {
  conceptTable,
  type ConceptDefinition,
  type ConceptWeight,
} from "./rpm-2022-concepts";

const m3 = (
  slug: string,
  name: string,
  description: string,
  domainName: string,
): ConceptDefinition => ({
  slug,
  name,
  description,
  schoolLevel: "middle",
  gradeBand: "middle-3",
  domainName,
});

const EMPTY: ReadonlyMap<string, ConceptWeight[]> = conceptTable([]);

/* ── 중3-1 I. 실수와 그 연산 ───────────────────────────────── */

export const RPM_M31_CH1_CONCEPTS: ConceptDefinition[] = [
  m3(
    "m3-square-root",
    "제곱근의 뜻과 성질",
    "제곱근의 뜻과 표현, 근호를 포함한 수의 성질을 이해한다.",
    "수와 연산",
  ),
  m3(
    "m3-irrational-numbers",
    "무리수와 실수",
    "무리수의 뜻을 알고 실수를 수직선 위에 대응시킨다.",
    "수와 연산",
  ),
  m3("m3-real-order", "실수의 대소", "실수의 대소 관계를 판단한다.", "수와 연산"),
  m3(
    "m3-radical-arithmetic",
    "근호를 포함한 식의 계산",
    "제곱근의 곱셈·나눗셈·덧셈·뺄셈과 분모의 유리화를 한다.",
    "수와 연산",
  ),
];

export const RPM_M31_CH1_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M31_CH1_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["제곱근의 뜻과 성질", [{ slug: "m3-square-root", weight: 1 }]],
    [
      /* 이 중단원은 무리수의 뜻과 실수의 대소를 함께 담는다 */
      "무리수와 실수",
      [
        { slug: "m3-irrational-numbers", weight: 0.5 },
        { slug: "m3-real-order", weight: 0.5 },
      ],
    ],
    ["근호를 포함한 식의 계산", [{ slug: "m3-radical-arithmetic", weight: 1 }]],
  ]);

/* ── 중3-1 II. 다항식의 곱셈과 인수분해 ────────────────────── */

export const RPM_M31_CH2_CONCEPTS: ConceptDefinition[] = [
  m3(
    "m3-poly-multiplication",
    "다항식의 곱셈과 곱셈 공식",
    "곱셈 공식으로 다항식의 곱을 전개하고 수의 계산에 활용한다.",
    "변화와 관계",
  ),
  m3(
    "m3-factorization",
    "인수분해",
    "인수분해 공식으로 다항식을 인수분해하고 활용한다.",
    "변화와 관계",
  ),
];

export const RPM_M31_CH2_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M31_CH2_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["다항식의 곱셈", [{ slug: "m3-poly-multiplication", weight: 1 }]],
    ["다항식의 인수분해", [{ slug: "m3-factorization", weight: 1 }]],
  ]);

/* ── 중3-1 III. 이차방정식 ─────────────────────────────────── */

export const RPM_M31_CH3_CONCEPTS: ConceptDefinition[] = [
  m3(
    "m3-quadratic-equation",
    "이차방정식의 풀이와 활용",
    "인수분해·제곱근·근의 공식으로 이차방정식을 풀고 활용한다.",
    "변화와 관계",
  ),
];

export const RPM_M31_CH3_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M31_CH3_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["이차방정식의 풀이", [{ slug: "m3-quadratic-equation", weight: 1 }]],
    ["이차방정식의 활용", [{ slug: "m3-quadratic-equation", weight: 1 }]],
  ]);

/* ── 중3-1 IV. 이차함수 ────────────────────────────────────── */

export const RPM_M31_CH4_CONCEPTS: ConceptDefinition[] = [
  m3("m3-quadratic-fn-concept", "이차함수의 뜻", "이차함수의 뜻을 이해한다.", "변화와 관계"),
  m3(
    "m3-quadratic-fn-graph",
    "이차함수의 그래프와 성질",
    "이차함수의 그래프를 그리고 꼭짓점·축·최댓값을 다룬다.",
    "변화와 관계",
  ),
];

export const RPM_M31_CH4_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M31_CH4_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    [
      /* ⑴은 이차함수의 뜻부터 y=a(x-p)²+q까지다 */
      "이차함수의 그래프 ⑴",
      [
        { slug: "m3-quadratic-fn-concept", weight: 0.3 },
        { slug: "m3-quadratic-fn-graph", weight: 0.7 },
      ],
    ],
    ["이차함수의 그래프 ⑵", [{ slug: "m3-quadratic-fn-graph", weight: 1 }]],
  ]);

/* ── 중3-2 I. 삼각비 ───────────────────────────────────────── */

export const RPM_M32_CH1_CONCEPTS: ConceptDefinition[] = [
  m3(
    "m3-trig-ratio",
    "삼각비의 뜻과 값",
    "삼각비의 뜻을 알고 특수각의 삼각비와 삼각비표를 다룬다.",
    "도형과 측정",
  ),
  m3(
    "m3-trig-applications",
    "삼각비의 활용",
    "삼각비로 변의 길이·넓이를 구하고 실생활 문제에 적용한다.",
    "도형과 측정",
  ),
];

export const RPM_M32_CH1_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M32_CH1_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["삼각비", [{ slug: "m3-trig-ratio", weight: 1 }]],
    ["삼각비의 활용", [{ slug: "m3-trig-applications", weight: 1 }]],
  ]);

/* ── 중3-2 II. 원의 성질 ───────────────────────────────────── */

export const RPM_M32_CH2_CONCEPTS: ConceptDefinition[] = [
  m3(
    "m3-circle-chords-tangents",
    "원의 현과 접선",
    "현의 수직이등분선과 접선의 성질을 이해한다.",
    "도형과 측정",
  ),
  m3(
    "m3-inscribed-angle",
    "원주각",
    "원주각과 중심각의 관계, 원에 내접하는 사각형의 성질을 다룬다.",
    "도형과 측정",
  ),
];

export const RPM_M32_CH2_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M32_CH2_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["원과 직선", [{ slug: "m3-circle-chords-tangents", weight: 1 }]],
    ["원주각", [{ slug: "m3-inscribed-angle", weight: 1 }]],
    ["원주각의 활용", [{ slug: "m3-inscribed-angle", weight: 1 }]],
  ]);

/* ── 중3-2 III. 통계 ───────────────────────────────────────── */

export const RPM_M32_CH3_CONCEPTS: ConceptDefinition[] = [
  m3(
    "m3-dispersion",
    "분산과 표준편차",
    "편차·분산·표준편차로 자료의 흩어진 정도를 나타낸다.",
    "자료와 가능성",
  ),
  m3(
    "m3-box-plot",
    "상자그림",
    "사분위수를 구하고 상자그림으로 자료의 분포를 나타낸다.",
    "자료와 가능성",
  ),
  m3(
    "m3-scatter-correlation",
    "산점도와 상관관계",
    "산점도를 그리고 두 변량 사이의 상관관계를 해석한다.",
    "자료와 가능성",
  ),
];

export const RPM_M32_CH3_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M32_CH3_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["산포도", [{ slug: "m3-dispersion", weight: 1 }]],
    [
      "상자그림과 산점도",
      [
        { slug: "m3-box-plot", weight: 0.5 },
        { slug: "m3-scatter-correlation", weight: 0.5 },
      ],
    ],
  ]);
