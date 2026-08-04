/* ─────────────────────────────────────────────────────────────
 * RPM 중2-2 — 유형·소단원·중단원 → 개념 잇기
 *
 * 규칙은 중1-1(rpm-2022-concepts.ts) 머리말과 같다.
 *
 * ## 이 권은 중단원 표가 거의 다 한다
 *
 * 중2-2는 도형·확률이라 중단원 하나가 정본 개념 하나와 거의 그대로
 * 맞아떨어진다(「삼각형의 성질」=이등변삼각형과 직각삼각형,
 * 「경우의 수」=경우의 수). 그런 자리에는 유형 표를 두지 않았다 — 표가
 * 없으면 틀릴 자리도 없고, 유형 제목을 76개 옮겨 적다 한 글자 틀리면
 * 그 유형만 조용히 중단원으로 흘러 아무 표시도 나지 않는다.
 *
 * 유형 표를 둔 곳은 **중단원 하나가 개념 둘을 담은 자리**뿐이다 —
 * 「05 도형의 닮음」이 닮음의 뜻·성질(유형 01~08)과 삼각형의 닮음
 * 조건(유형 09~15)을 함께 담는다.
 *
 * ## 삼각형의 무게중심
 *
 * 2022 개정 정본 목록에 무게중심 개념이 따로 없다. 성취기준으로는
 * 「평행선 사이의 선분의 길이의 비」 안에서 중점연결정리와 함께 다루므로
 * 그 개념(m2-parallel-segments)에 건다. 없는 slug를 지어내지 않는다.
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

const EMPTY: ReadonlyMap<string, ConceptWeight[]> = conceptTable([]);

/* ── I. 삼각형의 성질 ──────────────────────────────────────── */

export const RPM_M22_CH1_CONCEPTS: ConceptDefinition[] = [
  m2(
    "m2-isosceles-right-triangles",
    "이등변삼각형과 직각삼각형",
    "이등변삼각형의 성질과 직각삼각형의 합동 조건을 이해하고 설명한다.",
    "도형과 측정",
  ),
  m2(
    "m2-circumcenter-incenter",
    "삼각형의 외심과 내심",
    "삼각형의 외심·내심의 뜻과 성질을 이해하고 각과 길이를 구한다.",
    "도형과 측정",
  ),
];

export const RPM_M22_CH1_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M22_CH1_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["삼각형의 성질", [{ slug: "m2-isosceles-right-triangles", weight: 1 }]],
    ["삼각형의 외심과 내심", [{ slug: "m2-circumcenter-incenter", weight: 1 }]],
  ]);

/* ── II. 사각형의 성질 ─────────────────────────────────────── */

export const RPM_M22_CH2_CONCEPTS: ConceptDefinition[] = [
  m2(
    "m2-quadrilateral-properties",
    "여러 가지 사각형의 성질",
    "평행사변형·직사각형·마름모·정사각형·등변사다리꼴의 성질과 그 사이의 관계를 이해한다.",
    "도형과 측정",
  ),
];

export const RPM_M22_CH2_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M22_CH2_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["평행사변형", [{ slug: "m2-quadrilateral-properties", weight: 1 }]],
    ["여러 가지 사각형", [{ slug: "m2-quadrilateral-properties", weight: 1 }]],
  ]);

/* ── III. 도형의 닮음과 피타고라스 정리 ────────────────────── */

export const RPM_M22_CH3_CONCEPTS: ConceptDefinition[] = [
  m2(
    "m2-similarity-basics",
    "도형의 닮음과 닮음비",
    "닮은 도형의 뜻과 성질을 이해하고 닮음비로 넓이·부피의 비를 구한다.",
    "도형과 측정",
  ),
  m2(
    "m2-triangle-similarity",
    "삼각형의 닮음 조건",
    "삼각형의 닮음 조건으로 두 삼각형이 닮음인지 판별하고 변의 길이를 구한다.",
    "도형과 측정",
  ),
  m2(
    "m2-parallel-segments",
    "평행선 사이의 선분의 비",
    "평행선 사이의 선분의 길이의 비, 중점연결정리, 삼각형의 무게중심을 다룬다.",
    "도형과 측정",
  ),
  m2(
    "m2-pythagorean",
    "피타고라스 정리",
    "피타고라스 정리를 이해하고 평면·입체도형에 활용한다.",
    "도형과 측정",
  ),
];

/**
 * 중단원 「05 도형의 닮음」만 개념이 둘이다 — 유형 제목으로 가른다.
 * 나머지 중단원은 표를 두지 않고 중단원 표로 흘린다.
 */
export const RPM_M22_CH3_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 닮음의 뜻·성질·닮음비
    ["닮은 도형", [{ slug: "m2-similarity-basics", weight: 1 }]],
    ["닮은 도형의 성질", [{ slug: "m2-similarity-basics", weight: 1 }]],
    [
      "닮은 도형의 넓이의 비와 부피의 비",
      [{ slug: "m2-similarity-basics", weight: 1 }],
    ],
    ["평면도형에서 닮음의 성질", [{ slug: "m2-similarity-basics", weight: 1 }]],
    ["입체도형에서 닮음의 성질", [{ slug: "m2-similarity-basics", weight: 1 }]],
    ["원뿔 또는 원기둥의 닮음비", [{ slug: "m2-similarity-basics", weight: 1 }]],
    ["닮은 두 평면도형의 넓이의 비", [{ slug: "m2-similarity-basics", weight: 1 }]],
    [
      "닮은 두 입체도형의 겉넓이의 비와 부피의 비",
      [{ slug: "m2-similarity-basics", weight: 1 }],
    ],
    [
      "닮은 두 평면도형의 넓이의 비의 활용",
      [{ slug: "m2-similarity-basics", weight: 1 }],
    ],
    [
      "닮은 두 입체도형의 겉넓이의 비와 부피의 비의 활용",
      [{ slug: "m2-similarity-basics", weight: 1 }],
    ],

    // ── 삼각형의 닮음 조건
    ["삼각형의 닮음 조건", [{ slug: "m2-triangle-similarity", weight: 1 }]],
    ["직각삼각형의 닮음의 응용", [{ slug: "m2-triangle-similarity", weight: 1 }]],
    /* 유형 10·11이 같은 제목이다 — 지면은 「… (SSS 닮음)」·「… (SAS 닮음)」인데
     * 괄호 안이 다른 글꼴이라 제목에서 빠진다. 같은 개념이므로 키는 하나다. */
    [
      "삼각형의 닮음을 이용하여 변의 길이 구하기 닮음",
      [{ slug: "m2-triangle-similarity", weight: 1 }],
    ],
    ["직각삼각형의 닮음", [{ slug: "m2-triangle-similarity", weight: 1 }]],
    ["닮음의 활용", [{ slug: "m2-triangle-similarity", weight: 1 }]],
    ["접은 도형에서의 닮은 삼각형", [{ slug: "m2-triangle-similarity", weight: 1 }]],
  ]);

export const RPM_M22_CH3_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    [
      "도형의 닮음",
      [
        { slug: "m2-similarity-basics", weight: 0.5 },
        { slug: "m2-triangle-similarity", weight: 0.5 },
      ],
    ],
    [
      "평행선 사이의 선분의 길이의 비",
      [{ slug: "m2-parallel-segments", weight: 1 }],
    ],
    /* 정본 목록에 무게중심 개념이 따로 없다 — 성취기준상 같은 자리다 */
    ["삼각형의 무게중심", [{ slug: "m2-parallel-segments", weight: 1 }]],
    ["피타고라스 정리", [{ slug: "m2-pythagorean", weight: 1 }]],
  ]);

/* ── IV. 확률 ─────────────────────────────────────────────── */

export const RPM_M22_CH4_CONCEPTS: ConceptDefinition[] = [
  m2(
    "m2-counting",
    "경우의 수",
    "사건이 일어나는 경우의 수를 합의 법칙·곱의 법칙으로 구한다.",
    "자료와 가능성",
  ),
  m2(
    "m2-probability",
    "확률의 뜻과 계산",
    "확률의 뜻과 기본 성질을 이해하고 여사건·덧셈·곱셈으로 확률을 구한다.",
    "자료와 가능성",
  ),
];

export const RPM_M22_CH4_TITLE_TO_CONCEPT = EMPTY;

export const RPM_M22_CH4_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    ["경우의 수", [{ slug: "m2-counting", weight: 1 }]],
    ["확률", [{ slug: "m2-probability", weight: 1 }]],
  ]);
