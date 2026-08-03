/* ─────────────────────────────────────────────────────────────
 * 중학교 수학 개념 카탈로그 — 2022 개정 성취기준 60개 전체의 매핑.
 *
 * **이 표는 사람이 쓴다** (rpm-2022-concepts.ts와 같은 원칙). 성취기준
 * 문장(교육부 고시 제2022-33호 별책8, curriculum:collect가 적재한 원문)을
 * 하나씩 읽고 교수 단위 개념으로 옮겼다.
 *
 * 개념 ≠ 성취기준 (2K — 1:1 등치 금지). 실제로 갈라지고 합쳐진다:
 *  - [9수02-13] 연립일차방정식 하나가 뜻·대입법·가감법·활용 4개념으로
 *  - [9수02-19] 곱셈·인수분해는 개념 2개가 나눠 맡는다 (각각 partially)
 *  - [9수02-04] 일차방정식은 중1 본개념 + 중2 복습 개념이 함께 잇긴다
 *
 * gradeBand는 **교과서 통용 배정**이다 — 공식 체계는 학년군(중1~3)이라
 * 학년 구분이 없고, 여기 배정은 검정 교과서 관행을 따른 내부 해석이다.
 *
 * 기존 개념 재사용: m1-* 5개(RPM 반입), m2-simeq-* 4개·m2-linear-eq-review·
 * m2-linear-fn-intro(시드). 카탈로그는 이 slug들을 새로 만들지 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface CatalogConcept {
  slug: string;
  name: string;
  description: string;
  gradeBand: "middle-1" | "middle-2" | "middle-3";
  domainName: "수와 연산" | "변화와 관계" | "도형과 측정" | "자료와 가능성";
}

export interface CatalogMapping {
  /** 고정 ID가 있으면 그것을 쓴다 (초기 RPM 매핑 5건의 멱등 유지) —
   * 없으면 로더가 code+slug에서 결정론적으로 만든다 */
  mappingId?: string;
  conceptSlug: string;
  standardCode: string;
  relation: "covers" | "partially_covers" | "extends_beyond";
  note: string;
}

/** 새로 만드는 개념 — 기존 slug(m1- 5종, m2-simeq- 등)는 여기 없다 */
export const CATALOG_CONCEPTS: CatalogConcept[] = [
  /* ── 수와 연산 ── */
  {
    slug: "m1-integers-rationals",
    name: "정수와 유리수의 뜻",
    description: "음수의 필요성에서 출발해 양수·음수, 정수와 유리수를 분류한다.",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-rational-order",
    name: "정수와 유리수의 대소",
    description: "수직선과 절댓값을 이용해 정수·유리수의 대소를 판단한다.",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-rational-arithmetic",
    name: "정수와 유리수의 사칙계산",
    description: "부호 규칙과 연산 법칙으로 정수·유리수의 사칙계산을 한다.",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m2-repeating-decimals",
    name: "유리수와 순환소수",
    description: "순환소수의 뜻을 알고 유리수와 순환소수의 관계를 설명한다.",
    gradeBand: "middle-2",
    domainName: "수와 연산",
  },
  {
    slug: "m3-square-root",
    name: "제곱근의 뜻과 성질",
    description: "제곱근의 뜻·성질을 알고 제곱근의 대소를 판단한다.",
    gradeBand: "middle-3",
    domainName: "수와 연산",
  },
  {
    slug: "m3-irrational-numbers",
    name: "무리수와 실수",
    description: "무리수 개념과 유용성을 이해하고 실수 체계로 확장한다.",
    gradeBand: "middle-3",
    domainName: "수와 연산",
  },
  {
    slug: "m3-real-order",
    name: "실수의 대소",
    description: "수직선 위에서 실수의 대소 관계를 판단하고 설명한다.",
    gradeBand: "middle-3",
    domainName: "수와 연산",
  },
  {
    slug: "m3-radical-arithmetic",
    name: "근호를 포함한 식의 계산",
    description: "제곱근의 곱셈·나눗셈·덧셈·뺄셈과 분모의 유리화를 다룬다.",
    gradeBand: "middle-3",
    domainName: "수와 연산",
  },

  /* ── 변화와 관계: 문자와 식 ── */
  {
    slug: "m1-algebraic-expressions",
    name: "문자의 사용과 식의 값",
    description: "상황을 문자를 사용한 식으로 나타내고 식의 값을 구한다.",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-linear-expression-ops",
    name: "일차식의 계산",
    description: "동류항을 정리해 일차식의 덧셈과 뺄셈을 한다.",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-equation-basics",
    name: "방정식과 등식의 성질",
    description: "방정식과 해의 뜻을 알고 등식의 성질을 설명한다.",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-linear-equation",
    name: "일차방정식의 풀이와 활용",
    description: "일차방정식을 풀고 실생활 문제 해결에 활용한다.",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-coordinates",
    name: "순서쌍과 좌표",
    description: "좌표평면에서 순서쌍과 좌표를 이해하고 그 편리함을 인식한다.",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-graphs",
    name: "그래프의 표현과 해석",
    description: "다양한 상황을 그래프로 나타내고 주어진 그래프를 해석한다.",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m1-proportionality",
    name: "정비례와 반비례",
    description: "정비례·반비례 관계를 표·식·그래프로 나타내고 해석한다.",
    gradeBand: "middle-1",
    domainName: "변화와 관계",
  },
  {
    slug: "m2-exponent-laws",
    name: "지수법칙",
    description: "지수법칙을 이해하고 단항식의 곱과 몫을 간단히 한다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m2-polynomial-add-sub",
    name: "다항식의 덧셈과 뺄셈",
    description: "이차식까지의 다항식 덧셈·뺄셈을 원리에 따라 계산한다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m2-monomial-polynomial-ops",
    name: "단항식과 다항식의 곱셈·나눗셈",
    description: "(단항식)×(다항식) 꼴의 곱셈과 나눗셈을 전개·계산한다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m2-inequality-basics",
    name: "부등식과 그 성질",
    description: "부등식과 해의 뜻을 알고 부등식의 성질을 설명한다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m2-linear-inequality",
    name: "일차부등식의 풀이와 활용",
    description: "일차부등식을 풀고 실생활 문제 해결에 활용한다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m3-poly-multiplication",
    name: "다항식의 곱셈과 곱셈 공식",
    description: "곱셈 공식을 이용해 다항식의 곱을 전개한다.",
    gradeBand: "middle-3",
    domainName: "변화와 관계",
  },
  {
    slug: "m3-factorization",
    name: "인수분해",
    description: "인수분해 공식을 이용해 다항식을 인수분해한다.",
    gradeBand: "middle-3",
    domainName: "변화와 관계",
  },
  {
    slug: "m3-quadratic-equation",
    name: "이차방정식의 풀이와 활용",
    description: "인수분해·완전제곱식·근의 공식으로 이차방정식을 풀고 활용한다.",
    gradeBand: "middle-3",
    domainName: "변화와 관계",
  },

  /* ── 변화와 관계: 함수 ── */
  {
    slug: "m2-function-concept",
    name: "함수의 개념과 함숫값",
    description: "함수의 개념을 이해하고 함숫값을 구한다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m2-linear-fn-graph",
    name: "일차함수의 그래프",
    description: "기울기와 절편을 이용해 일차함수의 그래프를 그린다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m2-linear-fn-properties",
    name: "일차함수 그래프의 성질과 활용",
    description: "그래프의 성질을 이해하고 실생활 문제 해결에 활용한다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m2-linear-fn-vs-equation",
    name: "일차함수와 일차방정식의 관계",
    description: "미지수가 2개인 일차방정식의 그래프를 일차함수로 해석한다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m2-linear-fn-vs-simeq",
    name: "일차함수의 그래프와 연립방정식",
    description: "두 그래프의 교점과 연립일차방정식의 해의 관계를 설명한다.",
    gradeBand: "middle-2",
    domainName: "변화와 관계",
  },
  {
    slug: "m3-quadratic-fn-concept",
    name: "이차함수의 뜻",
    description: "이차함수의 개념을 이해한다.",
    gradeBand: "middle-3",
    domainName: "변화와 관계",
  },
  {
    slug: "m3-quadratic-fn-graph",
    name: "이차함수의 그래프와 성질",
    description: "이차함수의 그래프를 그리고 꼭짓점·축·폭 등 성질을 설명한다.",
    gradeBand: "middle-3",
    domainName: "변화와 관계",
  },

  /* ── 도형과 측정 ── */
  {
    slug: "m1-basic-figures",
    name: "기본 도형과 위치 관계",
    description: "점·선·면·각을 이해하고 점·직선·평면의 위치 관계를 설명한다.",
    gradeBand: "middle-1",
    domainName: "도형과 측정",
  },
  {
    slug: "m1-parallel-angles",
    name: "평행선과 동위각·엇각",
    description: "평행선에서 동위각·엇각의 성질을 이해하고 설명한다.",
    gradeBand: "middle-1",
    domainName: "도형과 측정",
  },
  {
    slug: "m1-construction",
    name: "기본 작도와 삼각형의 작도",
    description: "자와 컴퍼스로 삼각형을 작도하고 과정을 설명한다.",
    gradeBand: "middle-1",
    domainName: "도형과 측정",
  },
  {
    slug: "m1-triangle-congruence",
    name: "삼각형의 합동 조건",
    description: "SSS·SAS·ASA 합동 조건으로 두 삼각형의 합동을 판별한다.",
    gradeBand: "middle-1",
    domainName: "도형과 측정",
  },
  {
    slug: "m1-polygon-properties",
    name: "다각형의 성질",
    description: "다각형의 내각·외각의 크기 합과 대각선의 성질을 다룬다.",
    gradeBand: "middle-1",
    domainName: "도형과 측정",
  },
  {
    slug: "m1-circle-sector",
    name: "원과 부채꼴",
    description: "중심각과 호의 관계로 부채꼴의 호의 길이와 넓이를 구한다.",
    gradeBand: "middle-1",
    domainName: "도형과 측정",
  },
  {
    slug: "m1-solids",
    name: "다면체와 회전체",
    description: "다면체·회전체의 성질을 모형과 공학 도구로 탐구한다.",
    gradeBand: "middle-1",
    domainName: "도형과 측정",
  },
  {
    slug: "m1-solid-measure",
    name: "입체도형의 겉넓이와 부피",
    description: "기둥·뿔·구의 겉넓이와 부피를 구한다.",
    gradeBand: "middle-1",
    domainName: "도형과 측정",
  },
  {
    slug: "m2-isosceles-right-triangles",
    name: "이등변삼각형과 직각삼각형",
    description: "이등변삼각형의 성질을 정당화한다. 직각삼각형 합동 조건 포함(통용 범위).",
    gradeBand: "middle-2",
    domainName: "도형과 측정",
  },
  {
    slug: "m2-circumcenter-incenter",
    name: "삼각형의 외심과 내심",
    description: "외심·내심의 성질을 이해하고 정당화한다.",
    gradeBand: "middle-2",
    domainName: "도형과 측정",
  },
  {
    slug: "m2-quadrilateral-properties",
    name: "여러 가지 사각형의 성질",
    description: "평행사변형·직사각형·마름모·정사각형·등변사다리꼴의 성질을 정당화한다.",
    gradeBand: "middle-2",
    domainName: "도형과 측정",
  },
  {
    slug: "m2-similarity-basics",
    name: "도형의 닮음과 닮음비",
    description: "닮음의 뜻과 닮은 도형의 성질을 이해하고 닮음비를 구한다.",
    gradeBand: "middle-2",
    domainName: "도형과 측정",
  },
  {
    slug: "m2-triangle-similarity",
    name: "삼각형의 닮음 조건",
    description: "SSS·SAS·AA 닮음 조건으로 두 삼각형의 닮음을 판별한다.",
    gradeBand: "middle-2",
    domainName: "도형과 측정",
  },
  {
    slug: "m2-parallel-segments",
    name: "평행선 사이의 선분의 비",
    description: "평행선 사이 선분의 길이의 비를 구한다.",
    gradeBand: "middle-2",
    domainName: "도형과 측정",
  },
  {
    slug: "m2-pythagorean",
    name: "피타고라스 정리",
    description: "피타고라스 정리를 이해하고 정당화하며 길이 계산에 쓴다.",
    gradeBand: "middle-2",
    domainName: "도형과 측정",
  },
  {
    slug: "m3-trig-ratio",
    name: "삼각비의 뜻과 값",
    description: "sin·cos·tan의 뜻을 알고 특수각 등 간단한 삼각비 값을 구한다.",
    gradeBand: "middle-3",
    domainName: "도형과 측정",
  },
  {
    slug: "m3-trig-applications",
    name: "삼각비의 활용",
    description: "길이·넓이 문제를 삼각비로 해결한다.",
    gradeBand: "middle-3",
    domainName: "도형과 측정",
  },
  {
    slug: "m3-circle-chords-tangents",
    name: "원의 현과 접선",
    description: "현·접선에 관한 성질을 이해하고 정당화한다.",
    gradeBand: "middle-3",
    domainName: "도형과 측정",
  },
  {
    slug: "m3-inscribed-angle",
    name: "원주각",
    description: "원주각의 성질을 이해하고 정당화한다.",
    gradeBand: "middle-3",
    domainName: "도형과 측정",
  },

  /* ── 자료와 가능성 ── */
  {
    slug: "m1-representative-values",
    name: "대푯값",
    description: "평균·중앙값·최빈값을 자료 특성에 맞게 선택해 구한다.",
    gradeBand: "middle-1",
    domainName: "자료와 가능성",
  },
  {
    slug: "m1-frequency-distribution",
    name: "도수분포표와 히스토그램",
    description: "줄기와 잎 그림·도수분포표·히스토그램·도수분포다각형으로 자료를 정리·해석한다.",
    gradeBand: "middle-1",
    domainName: "자료와 가능성",
  },
  {
    slug: "m1-relative-frequency",
    name: "상대도수",
    description: "상대도수를 구하고 분포를 표·그래프로 나타내 해석한다.",
    gradeBand: "middle-1",
    domainName: "자료와 가능성",
  },
  {
    slug: "m1-statistical-inquiry",
    name: "통계적 탐구",
    description: "탐구 문제를 설정하고 공학 도구로 자료를 수집·분석·해석한다.",
    gradeBand: "middle-1",
    domainName: "자료와 가능성",
  },
  {
    slug: "m2-counting",
    name: "경우의 수",
    description: "합의 법칙·곱의 법칙으로 경우의 수를 구한다.",
    gradeBand: "middle-2",
    domainName: "자료와 가능성",
  },
  {
    slug: "m2-probability",
    name: "확률의 뜻과 계산",
    description: "확률의 개념과 기본 성질을 이해하고 확률을 구한다.",
    gradeBand: "middle-2",
    domainName: "자료와 가능성",
  },
  {
    slug: "m3-dispersion",
    name: "분산과 표준편차",
    description: "분산·표준편차를 구하고 자료의 흩어진 정도를 설명한다.",
    gradeBand: "middle-3",
    domainName: "자료와 가능성",
  },
  {
    slug: "m3-box-plot",
    name: "상자그림",
    description: "공학 도구로 상자그림을 그리고 분포를 비교한다.",
    gradeBand: "middle-3",
    domainName: "자료와 가능성",
  },
  {
    slug: "m3-scatter-correlation",
    name: "산점도와 상관관계",
    description: "산점도를 그리고 상관관계를 말한다.",
    gradeBand: "middle-3",
    domainName: "자료와 가능성",
  },
];

/** 성취기준 60개 전체의 매핑 — 기존 개념 slug 재사용 포함 */
export const CATALOG_MAPPINGS: CatalogMapping[] = [
  /* ── 수와 연산 (RPM 반입분 — 고정 ID 유지) ── */
  {
    mappingId: "00000000-0000-7000-8000-0000000c1101",
    conceptSlug: "m1-prime-composite",
    standardCode: "9수01-01",
    relation: "covers",
    note: "소수·합성수 구분은 소인수분해의 뜻을 아는 것의 전제",
  },
  {
    mappingId: "00000000-0000-7000-8000-0000000c1102",
    conceptSlug: "m1-prime-factorization",
    standardCode: "9수01-01",
    relation: "covers",
    note: "성취기준 문장의 본체",
  },
  {
    mappingId: "00000000-0000-7000-8000-0000000c1103",
    conceptSlug: "m1-divisors",
    standardCode: "9수01-01",
    relation: "partially_covers",
    note: "약수의 개수 세기는 문장 문면 밖·해설/교과서 통용 범위",
  },
  {
    mappingId: "00000000-0000-7000-8000-0000000c1104",
    conceptSlug: "m1-gcd",
    standardCode: "9수01-02",
    relation: "covers",
    note: "최대공약수 — 성취기준 문장에 명시",
  },
  {
    mappingId: "00000000-0000-7000-8000-0000000c1105",
    conceptSlug: "m1-lcm",
    standardCode: "9수01-02",
    relation: "covers",
    note: "최소공배수 — 성취기준 문장에 명시",
  },
  { conceptSlug: "m1-integers-rationals", standardCode: "9수01-03", relation: "covers", note: "음수 필요성·정수·유리수 개념" },
  { conceptSlug: "m1-rational-order", standardCode: "9수01-04", relation: "covers", note: "대소 판단" },
  { conceptSlug: "m1-rational-arithmetic", standardCode: "9수01-05", relation: "covers", note: "사칙계산 원리·계산" },
  { conceptSlug: "m2-repeating-decimals", standardCode: "9수01-06", relation: "covers", note: "순환소수와 유리수의 관계" },
  { conceptSlug: "m3-square-root", standardCode: "9수01-07", relation: "covers", note: "뜻·성질·대소" },
  { conceptSlug: "m3-irrational-numbers", standardCode: "9수01-08", relation: "covers", note: "무리수 개념·유용성" },
  { conceptSlug: "m3-real-order", standardCode: "9수01-09", relation: "covers", note: "실수의 대소" },
  { conceptSlug: "m3-radical-arithmetic", standardCode: "9수01-10", relation: "covers", note: "근호 포함 식의 사칙계산" },

  /* ── 변화와 관계 ── */
  { conceptSlug: "m1-algebraic-expressions", standardCode: "9수02-01", relation: "covers", note: "문자 사용·식의 값" },
  { conceptSlug: "m1-linear-expression-ops", standardCode: "9수02-02", relation: "covers", note: "일차식 덧셈·뺄셈" },
  { conceptSlug: "m1-equation-basics", standardCode: "9수02-03", relation: "covers", note: "방정식·해·등식의 성질" },
  { conceptSlug: "m1-linear-equation", standardCode: "9수02-04", relation: "covers", note: "일차방정식 풀이·활용의 본개념" },
  {
    conceptSlug: "m2-linear-eq-review",
    standardCode: "9수02-04",
    relation: "partially_covers",
    note: "중2 연립방정식 도입용 복습 개념 — 같은 성취기준을 다시 다룬다",
  },
  { conceptSlug: "m1-coordinates", standardCode: "9수02-05", relation: "covers", note: "순서쌍·좌표" },
  { conceptSlug: "m1-graphs", standardCode: "9수02-06", relation: "covers", note: "그래프 표현·해석" },
  { conceptSlug: "m1-proportionality", standardCode: "9수02-07", relation: "covers", note: "정비례·반비례" },
  { conceptSlug: "m2-exponent-laws", standardCode: "9수02-08", relation: "covers", note: "지수법칙" },
  { conceptSlug: "m2-polynomial-add-sub", standardCode: "9수02-09", relation: "covers", note: "다항식 덧셈·뺄셈" },
  { conceptSlug: "m2-monomial-polynomial-ops", standardCode: "9수02-10", relation: "covers", note: "단항식×다항식 곱셈·나눗셈" },
  { conceptSlug: "m2-inequality-basics", standardCode: "9수02-11", relation: "covers", note: "부등식·해·성질" },
  { conceptSlug: "m2-linear-inequality", standardCode: "9수02-12", relation: "covers", note: "일차부등식 풀이·활용" },
  {
    conceptSlug: "m2-simeq-intro",
    standardCode: "9수02-13",
    relation: "partially_covers",
    note: "연립일차방정식의 뜻 — 성취기준의 도입부",
  },
  {
    conceptSlug: "m2-simeq-substitution",
    standardCode: "9수02-13",
    relation: "partially_covers",
    note: "대입법 풀이",
  },
  {
    conceptSlug: "m2-simeq-elimination",
    standardCode: "9수02-13",
    relation: "partially_covers",
    note: "가감법 풀이",
  },
  {
    conceptSlug: "m2-simeq-application",
    standardCode: "9수02-13",
    relation: "partially_covers",
    note: "활용 문제 해결",
  },
  { conceptSlug: "m2-function-concept", standardCode: "9수02-14", relation: "covers", note: "함수 개념·함숫값" },
  {
    conceptSlug: "m2-linear-fn-intro",
    standardCode: "9수02-15",
    relation: "partially_covers",
    note: "일차함수의 개념 부분 (기존 시드 개념 재사용)",
  },
  {
    conceptSlug: "m2-linear-fn-graph",
    standardCode: "9수02-15",
    relation: "partially_covers",
    note: "그래프 그리기 부분",
  },
  { conceptSlug: "m2-linear-fn-properties", standardCode: "9수02-16", relation: "covers", note: "그래프 성질·활용" },
  { conceptSlug: "m2-linear-fn-vs-equation", standardCode: "9수02-17", relation: "covers", note: "일차함수 ↔ 이원일차방정식" },
  { conceptSlug: "m2-linear-fn-vs-simeq", standardCode: "9수02-18", relation: "covers", note: "그래프 교점 ↔ 연립방정식 해" },
  {
    conceptSlug: "m3-poly-multiplication",
    standardCode: "9수02-19",
    relation: "partially_covers",
    note: "곱셈 공식·전개 부분",
  },
  {
    conceptSlug: "m3-factorization",
    standardCode: "9수02-19",
    relation: "partially_covers",
    note: "인수분해 부분",
  },
  { conceptSlug: "m3-quadratic-equation", standardCode: "9수02-20", relation: "covers", note: "이차방정식 풀이·활용" },
  { conceptSlug: "m3-quadratic-fn-concept", standardCode: "9수02-21", relation: "covers", note: "이차함수 개념" },
  { conceptSlug: "m3-quadratic-fn-graph", standardCode: "9수02-22", relation: "covers", note: "그래프·성질" },

  /* ── 도형과 측정 ── */
  { conceptSlug: "m1-basic-figures", standardCode: "9수03-01", relation: "covers", note: "점·선·면·각·위치 관계" },
  { conceptSlug: "m1-parallel-angles", standardCode: "9수03-02", relation: "covers", note: "동위각·엇각" },
  { conceptSlug: "m1-construction", standardCode: "9수03-03", relation: "covers", note: "삼각형 작도" },
  { conceptSlug: "m1-triangle-congruence", standardCode: "9수03-04", relation: "covers", note: "합동 조건·판별" },
  { conceptSlug: "m1-polygon-properties", standardCode: "9수03-05", relation: "covers", note: "다각형 성질" },
  { conceptSlug: "m1-circle-sector", standardCode: "9수03-06", relation: "covers", note: "부채꼴 호·넓이" },
  { conceptSlug: "m1-solids", standardCode: "9수03-07", relation: "covers", note: "다면체·회전체" },
  { conceptSlug: "m1-solid-measure", standardCode: "9수03-08", relation: "covers", note: "겉넓이·부피" },
  {
    conceptSlug: "m2-isosceles-right-triangles",
    standardCode: "9수03-09",
    relation: "covers",
    note: "이등변삼각형 성질 정당화 (직각삼각형 합동은 통용 확장)",
  },
  { conceptSlug: "m2-circumcenter-incenter", standardCode: "9수03-10", relation: "covers", note: "외심·내심" },
  { conceptSlug: "m2-quadrilateral-properties", standardCode: "9수03-11", relation: "covers", note: "사각형 성질 정당화" },
  { conceptSlug: "m2-similarity-basics", standardCode: "9수03-12", relation: "covers", note: "닮음·닮음비" },
  { conceptSlug: "m2-triangle-similarity", standardCode: "9수03-13", relation: "covers", note: "닮음 조건·판별" },
  { conceptSlug: "m2-parallel-segments", standardCode: "9수03-14", relation: "covers", note: "평행선과 선분의 비" },
  { conceptSlug: "m2-pythagorean", standardCode: "9수03-15", relation: "covers", note: "피타고라스 정리" },
  { conceptSlug: "m3-trig-ratio", standardCode: "9수03-16", relation: "covers", note: "삼각비 뜻·값" },
  { conceptSlug: "m3-trig-applications", standardCode: "9수03-17", relation: "covers", note: "삼각비 활용" },
  { conceptSlug: "m3-circle-chords-tangents", standardCode: "9수03-18", relation: "covers", note: "현·접선" },
  { conceptSlug: "m3-inscribed-angle", standardCode: "9수03-19", relation: "covers", note: "원주각" },

  /* ── 자료와 가능성 ── */
  { conceptSlug: "m1-representative-values", standardCode: "9수04-01", relation: "covers", note: "대푯값 선택·계산" },
  { conceptSlug: "m1-frequency-distribution", standardCode: "9수04-02", relation: "covers", note: "도수분포 표현·해석" },
  { conceptSlug: "m1-relative-frequency", standardCode: "9수04-03", relation: "covers", note: "상대도수" },
  { conceptSlug: "m1-statistical-inquiry", standardCode: "9수04-04", relation: "covers", note: "통계적 탐구 과정" },
  { conceptSlug: "m2-counting", standardCode: "9수04-05", relation: "covers", note: "경우의 수" },
  { conceptSlug: "m2-probability", standardCode: "9수04-06", relation: "covers", note: "확률 개념·계산" },
  { conceptSlug: "m3-dispersion", standardCode: "9수04-07", relation: "covers", note: "분산·표준편차" },
  { conceptSlug: "m3-box-plot", standardCode: "9수04-08", relation: "covers", note: "상자그림 (2022 신설)" },
  { conceptSlug: "m3-scatter-correlation", standardCode: "9수04-09", relation: "covers", note: "산점도·상관관계 (2022 신설)" },
];
