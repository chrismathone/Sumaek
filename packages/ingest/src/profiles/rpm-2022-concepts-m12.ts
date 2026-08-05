/* ─────────────────────────────────────────────────────────────
 * RPM 중1-2 — 유형·소단원·중단원 → 개념 잇기
 *
 * 규칙은 중1-1(rpm-2022-concepts.ts)과 같다. 그 파일 머리말을 먼저 읽을 것.
 * 요약하면 셋이다:
 *   - **사람이 쓴다.** AI가 유형 제목을 보고 개념을 추측하게 두지 않는다.
 *   - 제목은 `extract --outline`이 찍는 **그대로** 쓴다 (수식은 빠져 나온다).
 *   - 뜻이 갈리지 않는 제목은 **넣지 않고** 중단원 표로 흘린다.
 *
 * ## 개념 slug는 이미 있는 것만 쓴다
 *
 * 중1 정본 개념 22개가 이미 canonical_concepts에 있고 그중 12개가 이 책을
 * 통째로 덮는다. 새로 만들지 않았다 — ADR-0011대로 정본 목록이 slug의
 * 권위다. 여기 적힌 12개는 전부 `middle-math-concept-catalog.mts`에 있다.
 *
 * ## 「대푯값」이 중1에 있는 것이 이 책이 22개정이라는 증거다
 *
 * 15개정에서 대푯값은 중3이었다. 정본 목록이 `m1-representative-values`를
 * middle-1로 못박고 있고 이 책 8단원이 그것을 다룬다 — 판을 가리는 데
 * 판권 표기보다 확실한 근거다(그 표기가 이 PDF에는 없다).
 *
 * ## 같은 제목이 여러 유형에 되풀이된다
 *
 * 「직선 반직선 선분의 개수」(유형 03·04), 「맞꼭지각의 성질」(10·11),
 * 「삼각형의 합동 조건 합동」(11·12·13), 「색칠한 부분의 넓이」(13·14·15),
 * 「평행선에서의 활용」(17·20)이 그렇다. 어차피 같은 개념으로 가므로 키는
 * 하나만 둔다 — 두 번 쓰면 conceptTable이 불러들이는 순간 던진다.
 * ───────────────────────────────────────────────────────────── */

import {
  conceptTable,
  type ConceptDefinition,
  type ConceptWeight,
} from "./rpm-2022-concepts";

const m1 = (
  slug: string,
  name: string,
  description: string,
  domainName: string,
): ConceptDefinition => ({
  slug,
  name,
  description,
  schoolLevel: "middle",
  gradeBand: "middle-1",
  domainName,
});

/** 무게 1로 한 개념에만 잇는 흔한 자리를 짧게 쓴다 */
const only = (slug: string): ConceptWeight[] => [{ slug, weight: 1 }];

/* ── I. 기본 도형 (중단원 기본 도형·위치 관계·작도와 합동) ─── */

export const RPM_M12_CH1_CONCEPTS: ConceptDefinition[] = [
  m1(
    "m1-basic-figures",
    "기본 도형과 위치 관계",
    "점·선·면과 각을 이해하고, 평면과 공간에서 두 직선·직선과 평면·두 평면의 위치 관계를 판단한다.",
    "도형과 측정",
  ),
  m1(
    "m1-parallel-angles",
    "평행선과 동위각·엇각",
    "동위각과 엇각을 찾고 평행선의 성질로 각의 크기를 구한다.",
    "도형과 측정",
  ),
  m1(
    "m1-construction",
    "기본 작도와 삼각형의 작도",
    "눈금 없는 자와 컴퍼스로 선분·각·평행선을 작도하고 삼각형이 하나로 정해질 조건을 안다.",
    "도형과 측정",
  ),
  m1(
    "m1-triangle-congruence",
    "삼각형의 합동 조건",
    "합동인 도형의 성질을 알고 세 합동 조건으로 두 삼각형의 합동을 판별한다.",
    "도형과 측정",
  ),
];

export const RPM_M12_CH1_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 01 기본 도형
    ["교점 교선의 개수", only("m1-basic-figures")],
    ["직선 반직선 선분", only("m1-basic-figures")],
    ["직선 반직선 선분의 개수", only("m1-basic-figures")],
    ["선분의 중점", only("m1-basic-figures")],
    ["두 점 사이의 거리", only("m1-basic-figures")],
    ["평각 또는 직각을 이용하여 각의 크기 구하기", only("m1-basic-figures")],
    [
      "각의 크기 사이의 조건이 주어진 경우 각의 크기 구하기",
      only("m1-basic-figures"),
    ],
    ["각의 크기의 비가 주어진 경우 각의 크기 구하기", only("m1-basic-figures")],
    ["맞꼭지각의 성질", only("m1-basic-figures")],
    ["맞꼭지각의 쌍의 개수", only("m1-basic-figures")],
    ["수직과 수선", only("m1-basic-figures")],
    ["시계에서 각의 계산", only("m1-basic-figures")],

    // ── 02 위치 관계 (앞쪽은 위치 관계, 뒤쪽은 평행선)
    ["점과 직선 점과 평면의 위치 관계", only("m1-basic-figures")],
    ["평면에서 두 직선의 위치 관계", only("m1-basic-figures")],
    ["평면이 하나로 정해질 조건", only("m1-basic-figures")],
    ["공간에서 두 직선의 위치 관계", only("m1-basic-figures")],
    ["공간에서 직선과 평면의 위치 관계", only("m1-basic-figures")],
    ["점과 평면 사이의 거리", only("m1-basic-figures")],
    ["공간에서 두 평면의 위치 관계", only("m1-basic-figures")],
    ["일부를 잘라 낸 입체도형에서의 위치 관계", only("m1-basic-figures")],
    ["전개도가 주어졌을 때의 위치 관계", only("m1-basic-figures")],
    ["공간에서 여러 가지 위치 관계", only("m1-basic-figures")],
    ["동위각과 엇각", only("m1-parallel-angles")],
    ["평행선에서 동위각 엇각의 크기", only("m1-parallel-angles")],
    ["두 직선이 평행할 조건", only("m1-parallel-angles")],
    [
      "평행선에서 각의 크기 구하기 삼각형의 성질 이용",
      only("m1-parallel-angles"),
    ],
    [
      "평행선에서 각의 크기 구하기 평행한 보조선을 긋는 경우",
      only("m1-parallel-angles"),
    ],
    ["평행선에서의 활용", only("m1-parallel-angles")],
    ["직사각형 모양의 종이를 접은 경우", only("m1-parallel-angles")],

    // ── 03 작도와 합동
    ["작도", only("m1-construction")],
    ["길이가 같은 선분의 작도", only("m1-construction")],
    ["크기가 같은 각의 작도", only("m1-construction")],
    ["평행선의 작도", only("m1-construction")],
    ["삼각형의 세 변의 길이 사이의 관계", only("m1-construction")],
    ["삼각형의 작도", only("m1-construction")],
    ["삼각형이 하나로 정해질 조건", only("m1-construction")],
    ["합동인 도형의 성질", only("m1-triangle-congruence")],
    ["합동인 삼각형 찾기", only("m1-triangle-congruence")],
    ["두 삼각형이 합동이 되기 위한 조건", only("m1-triangle-congruence")],
    ["삼각형의 합동 조건 합동", only("m1-triangle-congruence")],
    ["삼각형의 합동의 활용", only("m1-triangle-congruence")],
  ]);

export const RPM_M12_CH1_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // 중단원 — 유형 머리글이 없는 「시험에 꼭 나오는 문제」·「실력」이 여기 걸린다
    ["기본 도형", only("m1-basic-figures")],
    ["위치 관계", only("m1-basic-figures")],
    ["작도와 합동", only("m1-construction")],

    // 소단원 — 교과서문제 정복하기
    ["점 선 면", only("m1-basic-figures")],
    ["점 선 면 직선 반직선 선분", only("m1-basic-figures")],
    ["두 점 사이의 거리", only("m1-basic-figures")],
    ["각", only("m1-basic-figures")],
    ["맞꼭지각", only("m1-basic-figures")],
    ["수직과 수선", only("m1-basic-figures")],
    ["점과 직선 점과 평면의 위치 관계", only("m1-basic-figures")],
    ["평면에서 두 직선의 위치 관계", only("m1-basic-figures")],
    ["공간에서 두 직선의 위치 관계", only("m1-basic-figures")],
    ["공간에서 직선과 평면의 위치 관계", only("m1-basic-figures")],
    ["공간에서 두 평면의 위치 관계", only("m1-basic-figures")],
    /* p.38 「참고」 — 제목만으로는 뜻이 없지만 위치 관계 안에만 있다 */
    ["참고", only("m1-basic-figures")],
    ["동위각과 엇각", only("m1-parallel-angles")],
    ["평행선의 성질", only("m1-parallel-angles")],
    ["두 직선이 평행할 조건", only("m1-parallel-angles")],
    ["작도", only("m1-construction")],
    ["길이가 같은 선분의 작도", only("m1-construction")],
    ["크기가 같은 각의 작도", only("m1-construction")],
    ["평행선의 작도", only("m1-construction")],
    ["삼각형", only("m1-construction")],
    ["삼각형 삼각형의 작도", only("m1-construction")],
    ["도형의 합동", only("m1-triangle-congruence")],
    ["삼각형의 합동 조건", only("m1-triangle-congruence")],
  ]);

/* ── II. 평면도형 (중단원 다각형·원과 부채꼴) ──────────────── */

export const RPM_M12_CH2_CONCEPTS: ConceptDefinition[] = [
  m1(
    "m1-polygon-properties",
    "다각형의 성질",
    "다각형의 대각선의 개수, 내각과 외각의 크기의 합, 정다각형의 한 내각·외각의 크기를 구한다.",
    "도형과 측정",
  ),
  m1(
    "m1-circle-sector",
    "원과 부채꼴",
    "중심각의 크기와 호·현·넓이의 관계를 알고 원과 부채꼴의 둘레의 길이와 넓이를 구한다.",
    "도형과 측정",
  ),
];

export const RPM_M12_CH2_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 04 다각형
    ["다각형", only("m1-polygon-properties")],
    ["다각형의 내각과 외각", only("m1-polygon-properties")],
    ["정다각형", only("m1-polygon-properties")],
    [
      "한 꼭짓점에서 그을 수 있는 대각선의 개수",
      only("m1-polygon-properties"),
    ],
    ["다각형의 대각선의 개수", only("m1-polygon-properties")],
    ["대각선의 개수가 주어질 때 다각형 구하기", only("m1-polygon-properties")],
    ["다각형의 대각선의 개수의 활용", only("m1-polygon-properties")],
    ["삼각형의 세 내각의 크기의 합", only("m1-polygon-properties")],
    ["삼각형의 내각과 외각 사이의 관계", only("m1-polygon-properties")],
    ["삼각형의 한 내각의 이등분선이 이루는 각", only("m1-polygon-properties")],
    ["삼각형의 두 내각의 이등분선이 이루는 각", only("m1-polygon-properties")],
    [
      "삼각형의 한 내각의 이등분선과 한 외각의 이등분선이 이루는 각",
      only("m1-polygon-properties"),
    ],
    ["삼각형의 두 외각의 이등분선이 이루는 각", only("m1-polygon-properties")],
    [
      "삼각형의 외각의 성질을 이용하여 각의 크기 구하기",
      only("m1-polygon-properties"),
    ],
    [
      "이등변삼각형의 성질을 이용하여 각의 크기 구하기",
      only("m1-polygon-properties"),
    ],
    ["모양의 도형에서 각의 크기 구하기", only("m1-polygon-properties")],
    ["별 모양의 도형에서 각의 크기 구하기", only("m1-polygon-properties")],
    ["다각형의 내각의 크기의 합", only("m1-polygon-properties")],
    ["다각형의 내각의 크기 구하기", only("m1-polygon-properties")],
    ["다각형의 외각의 크기 구하기", only("m1-polygon-properties")],
    ["다각형의 내각의 크기의 합의 활용", only("m1-polygon-properties")],
    [
      "정다각형의 한 내각의 크기와 한 외각의 크기",
      only("m1-polygon-properties"),
    ],
    ["정다각형에서 각의 크기 구하기 ⑴", only("m1-polygon-properties")],
    ["정다각형에서 각의 크기 구하기 ⑵", only("m1-polygon-properties")],

    // ── 05 원과 부채꼴
    ["원과 부채꼴", only("m1-circle-sector")],
    ["중심각의 크기와 호의 길이", only("m1-circle-sector")],
    ["호의 길이의 비가 주어질 때 중심각의 크기 구하기", only("m1-circle-sector")],
    ["보조선을 그어 호의 길이 구하기", only("m1-circle-sector")],
    ["중심각의 크기와 부채꼴의 넓이", only("m1-circle-sector")],
    ["중심각의 크기와 현의 길이", only("m1-circle-sector")],
    ["중심각의 크기에 정비례하는 것", only("m1-circle-sector")],
    ["도형의 성질을 이용하여 호의 길이 구하기", only("m1-circle-sector")],
    ["원의 둘레의 길이와 넓이", only("m1-circle-sector")],
    ["부채꼴의 호의 길이와 넓이", only("m1-circle-sector")],
    [
      "부채꼴에서 색칠한 부분의 둘레의 길이와 넓이",
      only("m1-circle-sector"),
    ],
    ["색칠한 부분의 둘레의 길이", only("m1-circle-sector")],
    ["색칠한 부분의 넓이", only("m1-circle-sector")],
    ["끈의 길이", only("m1-circle-sector")],
    ["원이 지나간 자리의 넓이", only("m1-circle-sector")],
    ["도형을 회전시켰을 때 움직인 거리", only("m1-circle-sector")],
  ]);

export const RPM_M12_CH2_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // 중단원
    ["다각형", only("m1-polygon-properties")],
    ["원과 부채꼴", only("m1-circle-sector")],

    // 소단원
    ["정다각형", only("m1-polygon-properties")],
    ["다각형의 대각선", only("m1-polygon-properties")],
    ["삼각형의 내각과 외각", only("m1-polygon-properties")],
    [
      "다각형의 내각의 크기의 합과 외각의 크기의 합",
      only("m1-polygon-properties"),
    ],
    [
      "정다각형의 한 내각의 크기와 한 외각의 크기",
      only("m1-polygon-properties"),
    ],
    [
      "중심각의 크기와 호의 길이 사이의 관계",
      only("m1-circle-sector"),
    ],
    [
      "중심각의 크기와 부채꼴의 넓이 사이의 관계",
      only("m1-circle-sector"),
    ],
    [
      "중심각의 크기와 현의 길이 사이의 관계",
      only("m1-circle-sector"),
    ],
    ["원주율", only("m1-circle-sector")],
    ["원의 둘레의 길이와 넓이", only("m1-circle-sector")],
    ["부채꼴의 호의 길이와 넓이", only("m1-circle-sector")],
    [
      "부채꼴의 호의 길이와 넓이 사이의 관계",
      only("m1-circle-sector"),
    ],
  ]);

/* ── III. 입체도형 (중단원 다면체와 회전체·겉넓이와 부피) ─── */

export const RPM_M12_CH3_CONCEPTS: ConceptDefinition[] = [
  m1(
    "m1-solids",
    "다면체와 회전체",
    "각기둥·각뿔·각뿔대와 정다면체를 분류하고, 회전체와 그 단면·전개도를 이해한다.",
    "도형과 측정",
  ),
  m1(
    "m1-solid-measure",
    "입체도형의 겉넓이와 부피",
    "기둥·뿔·구의 겉넓이와 부피를 구한다.",
    "도형과 측정",
  ),
];

export const RPM_M12_CH3_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 06 다면체와 회전체
    ["다면체", only("m1-solids")],
    ["다면체의 면의 개수", only("m1-solids")],
    ["다면체의 모서리 꼭짓점의 개수", only("m1-solids")],
    ["다면체의 면 모서리 꼭짓점의 개수의 활용", only("m1-solids")],
    ["다면체의 꼭짓점 모서리 면의 개수 사이의 관계", only("m1-solids")],
    ["다면체의 옆면의 모양", only("m1-solids")],
    ["다면체의 이해", only("m1-solids")],
    ["주어진 조건을 만족시키는 다면체", only("m1-solids")],
    ["정다면체", only("m1-solids")],
    ["정다면체의 면 모서리 꼭짓점의 개수", only("m1-solids")],
    ["정다면체의 이해", only("m1-solids")],
    ["정다면체의 전개도", only("m1-solids")],
    ["정다면체의 단면", only("m1-solids")],
    [
      "정다면체의 각 면의 한가운데 점을 연결하여 만든 입체도형",
      only("m1-solids"),
    ],
    ["회전체", only("m1-solids")],
    ["평면도형을 회전시킬 때 생기는 회전체", only("m1-solids")],
    ["회전체의 단면의 모양", only("m1-solids")],
    ["회전체의 단면의 넓이", only("m1-solids")],
    ["회전체의 전개도", only("m1-solids")],
    ["회전체의 이해", only("m1-solids")],

    // ── 07 입체도형의 겉넓이와 부피
    ["각기둥의 겉넓이", only("m1-solid-measure")],
    ["원기둥의 겉넓이", only("m1-solid-measure")],
    ["각기둥의 부피", only("m1-solid-measure")],
    ["원기둥의 부피", only("m1-solid-measure")],
    ["전개도가 주어진 기둥의 겉넓이와 부피", only("m1-solid-measure")],
    ["밑면이 부채꼴인 기둥의 겉넓이와 부피", only("m1-solid-measure")],
    ["구멍이 뚫린 기둥의 겉넓이와 부피", only("m1-solid-measure")],
    ["일부분을 잘라 낸 입체도형의 겉넓이와 부피", only("m1-solid-measure")],
    /* 회전체의 겉넓이와 부피는 원기둥·원뿔·구로 유형이 갈린다 —
     * 셋 다 겉넓이와 부피를 구하는 것이므로 같은 개념으로 간다 */
    ["회전체의 겉넓이와 부피 원기둥", only("m1-solid-measure")],
    ["회전체의 겉넓이와 부피 원뿔", only("m1-solid-measure")],
    ["회전체의 겉넓이와 부피 구", only("m1-solid-measure")],
    ["각뿔의 겉넓이", only("m1-solid-measure")],
    ["원뿔의 겉넓이", only("m1-solid-measure")],
    ["뿔대의 겉넓이", only("m1-solid-measure")],
    ["각뿔의 부피", only("m1-solid-measure")],
    ["원뿔의 부피", only("m1-solid-measure")],
    ["뿔대의 부피", only("m1-solid-measure")],
    ["잘라 낸 각뿔의 부피", only("m1-solid-measure")],
    ["직육면체 모양의 그릇에 담긴 물의 부피", only("m1-solid-measure")],
    ["원뿔 모양의 그릇에 담긴 물의 부피", only("m1-solid-measure")],
    ["전개도가 주어진 원뿔의 겉넓이와 부피", only("m1-solid-measure")],
    ["구의 겉넓이", only("m1-solid-measure")],
    ["구의 부피", only("m1-solid-measure")],
    [
      "구의 일부분을 잘라 낸 입체도형의 겉넓이와 부피",
      only("m1-solid-measure"),
    ],
    ["원뿔 구 원기둥의 부피의 비", only("m1-solid-measure")],
    ["입체도형에 꼭 맞게 들어가는 입체도형", only("m1-solid-measure")],
  ]);

export const RPM_M12_CH3_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // 중단원
    ["다면체와 회전체", only("m1-solids")],
    ["입체도형의 겉넓이와 부피", only("m1-solid-measure")],

    // 소단원
    ["다면체", only("m1-solids")],
    ["다면체의 종류", only("m1-solids")],
    ["정다면체", only("m1-solids")],
    ["회전체", only("m1-solids")],
    ["회전체의 성질", only("m1-solids")],
    ["회전체의 전개도", only("m1-solids")],
    ["기둥의 겉넓이", only("m1-solid-measure")],
    ["기둥의 부피", only("m1-solid-measure")],
    ["뿔의 겉넓이", only("m1-solid-measure")],
    ["뿔의 부피", only("m1-solid-measure")],
    ["구의 겉넓이와 부피", only("m1-solid-measure")],
  ]);

/* ── IV. 통계 (중단원 대푯값·도수분포표와 상대도수) ────────── */

export const RPM_M12_CH4_CONCEPTS: ConceptDefinition[] = [
  m1(
    "m1-representative-values",
    "대푯값",
    "평균·중앙값·최빈값을 구하고 자료의 특성에 맞는 대푯값을 고른다.",
    "자료와 가능성",
  ),
  m1(
    "m1-frequency-distribution",
    "도수분포표와 히스토그램",
    "줄기와 잎 그림·도수분포표로 자료를 정리하고 히스토그램·도수분포다각형으로 나타내어 해석한다.",
    "자료와 가능성",
  ),
  m1(
    "m1-relative-frequency",
    "상대도수",
    "상대도수를 구하고 그 분포표와 그래프로 도수의 총합이 다른 두 집단을 비교한다.",
    "자료와 가능성",
  ),
];

export const RPM_M12_CH4_TITLE_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // ── 08 대푯값
    ["평균", only("m1-representative-values")],
    ["중앙값", only("m1-representative-values")],
    ["최빈값", only("m1-representative-values")],
    ["적절한 대푯값 찾기", only("m1-representative-values")],
    ["대푯값이 주어졌을 때 변량 구하기", only("m1-representative-values")],
    [
      "새로운 변량을 추가했을 때 대푯값 구하기",
      only("m1-representative-values"),
    ],

    // ── 09 앞쪽: 도수분포표·히스토그램·도수분포다각형
    ["줄기와 잎 그림의 이해", only("m1-frequency-distribution")],
    ["도수분포표의 이해", only("m1-frequency-distribution")],
    ["도수분포표에서 특정 계급의 백분율", only("m1-frequency-distribution")],
    ["히스토그램의 이해", only("m1-frequency-distribution")],
    ["히스토그램에서 직사각형의 넓이", only("m1-frequency-distribution")],
    ["일부가 보이지 않는 히스토그램", only("m1-frequency-distribution")],
    ["도수분포다각형의 이해", only("m1-frequency-distribution")],
    ["도수분포다각형의 넓이", only("m1-frequency-distribution")],
    ["일부가 보이지 않는 도수분포다각형", only("m1-frequency-distribution")],
    ["두 도수분포다각형의 비교", only("m1-frequency-distribution")],

    // ── 09 뒤쪽: 상대도수
    ["상대도수", only("m1-relative-frequency")],
    ["상대도수 구하기", only("m1-relative-frequency")],
    ["상대도수의 분포표의 이해", only("m1-relative-frequency")],
    ["일부가 보이지 않는 상대도수의 분포표", only("m1-relative-frequency")],
    ["도수의 총합이 다른 두 집단의 상대도수", only("m1-relative-frequency")],
    ["도수의 총합이 다른 두 집단의 상대도수의 비", only("m1-relative-frequency")],
    ["상대도수의 분포를 나타낸 그래프", only("m1-relative-frequency")],
    [
      "일부가 보이지 않는 상대도수의 분포를 나타낸 그래프",
      only("m1-relative-frequency"),
    ],
    ["도수의 총합이 다른 두 집단의 비교", only("m1-relative-frequency")],
  ]);

export const RPM_M12_CH4_UNIT_TO_CONCEPT: ReadonlyMap<string, ConceptWeight[]> =
  conceptTable([
    // 중단원
    ["대푯값", only("m1-representative-values")],
    ["도수분포표와 상대도수", only("m1-frequency-distribution")],

    // 소단원
    ["줄기와 잎 그림", only("m1-frequency-distribution")],
    ["도수분포표", only("m1-frequency-distribution")],
    ["히스토그램", only("m1-frequency-distribution")],
    ["도수분포다각형", only("m1-frequency-distribution")],
    [
      "상대도수와 상대도수의 분포를 나타낸 그래프",
      only("m1-relative-frequency"),
    ],
  ]);
