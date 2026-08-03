/* ─────────────────────────────────────────────────────────────
 * 수직 진행·표상·오개념 카탈로그 (골프롬프트 2L — 인수 45의 데이터면).
 *
 * 사람 큐레이션. 대상은 문항까지 잇긴 개념 10종의 **수직 계통** —
 * 이전 학교급(초등)에서 다음 확장(중3·고등)까지. 근거 문서는 별책8
 * (초·중·고 수학과 교육과정이 한 문서다).
 *
 * 원칙:
 *   - 간선 방향은 학습 진행 방향 — from을 배우고 to로 간다.
 *     prerequisite(강한 선수)는 DAG 강제·발행 게이트 대상,
 *     extends는 다음 학교급·학년의 확장, transfer_to는 전이 연결.
 *   - 오개념은 **관찰 가능한 오류 패턴**으로 적는다 — "잘 모른다"가 아니라
 *     답안에서 실제로 보이는 형태. 탐지 신호와 교정 전략을 함께 둔다.
 *   - 표상은 같은 개념의 다른 겉모습이다 — 기호·표·그림·상황을 오가는
 *     능력이 이해의 증거다 (표상 전환 차원).
 * ───────────────────────────────────────────────────────────── */

export interface VerticalConcept {
  slug: string;
  name: string;
  description: string;
  schoolLevel: "elementary" | "middle" | "high";
  /** 교과서 통용 배정 — 공식 체계는 학년군이다 (개념 카탈로그와 같은 주의) */
  gradeBand: string;
  domainName: string;
}

/** 이전 학교급·다음 학교급의 인접 개념 — 수직 계통의 양 끝 */
export const VERTICAL_CONCEPTS: readonly VerticalConcept[] = [
  {
    slug: "e6-divisors-multiples",
    name: "약수와 배수 (초등)",
    description:
      "자연수의 약수와 배수의 뜻을 알고 구한다. 초5~6학년군 — 중1 소인수분해 계통의 직접 선수.",
    schoolLevel: "elementary",
    gradeBand: "elementary-5",
    domainName: "수와 연산",
  },
  {
    slug: "e6-fraction-reduction",
    name: "약분과 통분 (초등)",
    description:
      "분수를 약분·통분한다. 공약수·공배수를 명시적 개념 없이 조작으로 경험한다 — 중1 최대공약수·최소공배수의 직관 기반.",
    schoolLevel: "elementary",
    gradeBand: "elementary-5",
    domainName: "수와 연산",
  },
  {
    slug: "h1-polynomial-factorization",
    name: "다항식의 인수분해 (고등)",
    description:
      "공통수학1의 인수분해 — 복잡한 다항식(삼차 이상·치환·조립제법)으로 확장. 중3 인수분해의 다음 고리.",
    schoolLevel: "high",
    gradeBand: "high-1",
    domainName: "다항식",
  },
] as const;

export type VerticalEdgeKind =
  | "prerequisite"
  | "soft_prerequisite"
  | "extends"
  | "transfer_to"
  | "contrasts_with"
  | "equivalent_to";

export interface VerticalEdge {
  fromSlug: string;
  toSlug: string;
  kind: VerticalEdgeKind;
  rationale: string;
}

/** 수직 계통 간선 — 학습 진행 방향 (from을 배우고 to로) */
export const VERTICAL_EDGES: readonly VerticalEdge[] = [
  /* 초등 → 중1 (이전 학교급 연결) */
  {
    fromSlug: "e6-divisors-multiples",
    toSlug: "m1-prime-composite",
    kind: "prerequisite",
    rationale: "약수의 뜻 없이는 '약수가 2개뿐인 수'라는 소수 정의 자체가 성립하지 않는다.",
  },
  {
    fromSlug: "e6-divisors-multiples",
    toSlug: "m1-divisors",
    kind: "prerequisite",
    rationale: "초등의 나열식 약수 구하기가 중1의 지수 기반 약수 세기로 정식화된다.",
  },
  {
    fromSlug: "e6-fraction-reduction",
    toSlug: "m1-gcd",
    kind: "soft_prerequisite",
    rationale: "약분 경험이 공약수 직관을 만든다 — 없어도 정의는 배울 수 있어 약한 선수.",
  },
  {
    fromSlug: "e6-fraction-reduction",
    toSlug: "m1-lcm",
    kind: "soft_prerequisite",
    rationale: "통분 경험이 공배수 직관을 만든다.",
  },
  /* 중1 내부 (소인수분해 계통) */
  {
    fromSlug: "m1-prime-composite",
    toSlug: "m1-prime-factorization",
    kind: "prerequisite",
    rationale: "소수를 판별할 수 있어야 소인수로 분해를 멈출 곳을 안다.",
  },
  {
    fromSlug: "m1-prime-factorization",
    toSlug: "m1-divisors",
    kind: "prerequisite",
    rationale: "약수의 개수 (a+1)(b+1)은 소인수분해 결과 위에서만 성립한다.",
  },
  {
    fromSlug: "m1-prime-factorization",
    toSlug: "m1-gcd",
    kind: "prerequisite",
    rationale: "공통 소인수의 최소 지수 선택은 소인수분해가 전제다.",
  },
  {
    fromSlug: "m1-prime-factorization",
    toSlug: "m1-lcm",
    kind: "prerequisite",
    rationale: "모든 소인수의 최대 지수 선택은 소인수분해가 전제다.",
  },
  {
    fromSlug: "m1-gcd",
    toSlug: "m1-lcm",
    kind: "contrasts_with",
    rationale: "최소 지수(공약수) vs 최대 지수(공배수) — 혼동이 가장 잦은 대조쌍. 함께 대조해 가르친다.",
  },
  /* 방정식 계통 (중1 → 중2) */
  {
    fromSlug: "m1-equation-basics",
    toSlug: "m1-linear-equation",
    kind: "prerequisite",
    rationale: "등식·해의 뜻과 등식의 성질 없이 이항을 규칙 암기로만 배우게 된다.",
  },
  {
    fromSlug: "m1-linear-equation",
    toSlug: "m2-linear-eq-review",
    kind: "equivalent_to",
    rationale: "같은 내용의 복습 단위 — 중2 연립 진입 전 선수 기능 점검용.",
  },
  /* 수직 확장 (중1 → 중3 → 고1) */
  {
    fromSlug: "m1-prime-factorization",
    toSlug: "m3-factorization",
    kind: "extends",
    rationale: "수의 분해가 식의 분해로 확장된다 — 소인수분해의 구조 감각이 인수분해의 기반.",
  },
  {
    fromSlug: "m3-poly-multiplication",
    toSlug: "m3-factorization",
    kind: "prerequisite",
    rationale: "인수분해는 곱셈 공식의 역과정이다.",
  },
  {
    fromSlug: "m3-factorization",
    toSlug: "h1-polynomial-factorization",
    kind: "extends",
    rationale: "이차식 인수분해가 고등의 삼차 이상·치환·조립제법으로 확장된다.",
  },
  /* 연립 계통의 전이 (기존 6간선 뒤) */
  {
    fromSlug: "m2-simeq-application",
    toSlug: "m2-linear-fn-vs-simeq",
    kind: "transfer_to",
    rationale: "연립방정식의 해가 두 직선의 교점이라는 기하 해석으로 전이된다.",
  },
] as const;

export interface CatalogRepresentation {
  conceptSlug: string;
  /** 개념 안에서 안정적 식별 */
  key: string;
  kind:
    | "verbal"
    | "symbolic"
    | "equation"
    | "table"
    | "graph"
    | "number_line"
    | "figure"
    | "manipulative"
    | "context";
  description: string;
  example?: { text: string };
}

export const CATALOG_REPRESENTATIONS: readonly CatalogRepresentation[] = [
  { conceptSlug: "m1-prime-composite", key: "verbal", kind: "verbal", description: "말: 약수가 1과 자기 자신뿐인 수", example: { text: "7의 약수는 1, 7 — 소수" } },
  { conceptSlug: "m1-prime-composite", key: "sieve", kind: "table", description: "에라토스테네스의 체 — 배수를 지워가는 표", example: { text: "1~100 표에서 2·3·5·7의 배수 소거" } },
  { conceptSlug: "m1-prime-factorization", key: "symbolic", kind: "symbolic", description: "거듭제곱 곱 표기", example: { text: "360 = 2³×3²×5" } },
  { conceptSlug: "m1-prime-factorization", key: "tree", kind: "figure", description: "인수 나무 — 분해 과정의 그림", example: { text: "360 → 2×180 → … 잎이 전부 소수" } },
  { conceptSlug: "m1-divisors", key: "table", kind: "table", description: "약수 쌍 나열 표", example: { text: "12: (1,12)(2,6)(3,4)" } },
  { conceptSlug: "m1-divisors", key: "formula", kind: "symbolic", description: "지수 기반 개수 공식", example: { text: "2³×3² → (3+1)(2+1) = 12개" } },
  { conceptSlug: "m1-gcd", key: "venn", kind: "figure", description: "벤 다이어그램 — 공통 소인수 영역", example: { text: "12와 18의 공통 부분 2×3" } },
  { conceptSlug: "m1-gcd", key: "context", kind: "context", description: "상황: 가능한 한 크게 똑같이 나누기", example: { text: "사과 12개·배 18개를 최대 몇 묶음으로" } },
  { conceptSlug: "m1-lcm", key: "number-line", kind: "number_line", description: "수직선 위 배수의 겹침", example: { text: "4와 6의 배수 표시 — 첫 겹침 12" } },
  { conceptSlug: "m1-lcm", key: "context", kind: "context", description: "상황: 동시에 다시 만나는 주기", example: { text: "4분·6분 배차 버스의 동시 출발" } },
  { conceptSlug: "m2-simeq-intro", key: "equation", kind: "equation", description: "연립 기호 — 두 식을 한 묶음으로", example: { text: "{ x+y=5, x−y=1 }" } },
  { conceptSlug: "m2-simeq-intro", key: "table", kind: "table", description: "순서쌍 대입 표 — 각 식의 해와 공통 해", example: { text: "x+y=5의 해 나열 ∩ x−y=1의 해 나열" } },
  { conceptSlug: "m2-simeq-intro", key: "graph", kind: "graph", description: "두 직선의 교점 (중2 후반 일차함수에서 연결)", example: { text: "두 그래프가 만나는 한 점 = 공통 해" } },
  { conceptSlug: "m2-simeq-substitution", key: "equation", kind: "equation", description: "식 변형 사슬 — 한 미지수를 다른 미지수로", example: { text: "y = 5−x를 x−y=1에 대입" } },
  { conceptSlug: "m2-simeq-elimination", key: "equation", kind: "equation", description: "변끼리 더하고 빼는 소거 배열", example: { text: "두 식을 세로로 놓고 +/−" } },
  { conceptSlug: "m2-simeq-application", key: "context", kind: "context", description: "상황 → 식 번역 표 (수량·단가·합계)", example: { text: "어른 x명·아이 y명, 합계 조건 2개" } },
  { conceptSlug: "m2-linear-eq-review", key: "equation", kind: "equation", description: "이항 과정의 단계별 등식", example: { text: "3x+5=2x−1 → 3x−2x = −1−5" } },
] as const;

export interface CatalogMisconception {
  conceptSlug: string;
  key: string;
  name: string;
  /** 답안에서 실제로 보이는 형태 */
  errorPattern: string;
  /** 혼동 대상 개념 (있으면) */
  confusedWithSlug?: string;
  detectionEvidence: { signals: string[] };
  remediationStrategy: { steps: string[] };
}

export const CATALOG_MISCONCEPTIONS: readonly CatalogMisconception[] = [
  {
    conceptSlug: "m1-prime-composite",
    key: "one-is-prime",
    name: "1을 소수로 분류",
    errorPattern: "소수를 모두 고르는 문항에서 1을 포함한다 (예: 1, 2, 3, 5)",
    detectionEvidence: { signals: ["소수 목록에 1 포함", "'1은 약수가 1개'를 답하고도 소수로 분류"] },
    remediationStrategy: {
      steps: [
        "약수의 개수로 세 부류(1 / 소수 / 합성수)를 표로 만들게 한다",
        "소인수분해 유일성이 왜 1을 제외해야 성립하는지 반례(12=1×1×2²×3…)로 보인다",
      ],
    },
  },
  {
    conceptSlug: "m1-prime-composite",
    key: "odd-is-prime",
    name: "홀수를 소수로 동일시",
    errorPattern: "9, 15, 21을 소수로 고른다",
    detectionEvidence: { signals: ["홀수 합성수를 소수로 판정", "2를 소수에서 제외"] },
    remediationStrategy: {
      steps: ["9=3², 15=3×5 직접 분해", "2가 유일한 짝수 소수임을 확인"],
    },
  },
  {
    conceptSlug: "m1-prime-factorization",
    name: "합성수 인수에서 멈춘 분해",
    key: "composite-leaf",
    errorPattern: "36 = 4×9 로 답하고 끝낸다 — 잎이 소수가 아니다",
    detectionEvidence: { signals: ["결과에 4·6·8·9 등 합성수 포함", "같은 수를 다르게 분해해 다른 답 제출"] },
    remediationStrategy: {
      steps: ["인수 나무에서 '잎은 전부 소수'라는 종료 조건을 명시", "4×9를 더 분해해 2²×3²로 잇게 한다"],
    },
  },
  {
    conceptSlug: "m1-divisors",
    key: "forget-plus-one",
    name: "약수 개수 공식에서 +1 누락",
    errorPattern: "2³×3² 의 약수 개수를 3×2 = 6개로 계산한다",
    detectionEvidence: { signals: ["지수끼리 곱한 값 제출", "작은 수에서 나열 결과와 공식 결과 불일치를 못 느낌"] },
    remediationStrategy: {
      steps: ["12=2²×3의 약수를 표로 전부 나열해 (2+1)(1+1)=6과 대조", "지수 0(=1을 곱함)도 선택지임을 표의 행·열로 보인다"],
    },
  },
  {
    conceptSlug: "m1-gcd",
    key: "max-exponent",
    name: "최대공약수에 최대 지수 사용",
    errorPattern: "12=2²×3, 18=2×3² 의 최대공약수를 2²×3²=36으로 계산한다",
    confusedWithSlug: "m1-lcm",
    detectionEvidence: { signals: ["최대공약수가 원래 수보다 큼", "gcd·lcm 답이 뒤바뀜"] },
    remediationStrategy: {
      steps: ["'약수는 나누어야 한다' — 36이 12를 나누는지 검산시킨다", "gcd(최소 지수)·lcm(최대 지수)을 한 표에 대조"],
    },
  },
  {
    conceptSlug: "m1-lcm",
    key: "common-only",
    name: "공통 소인수만 곱한 최소공배수",
    errorPattern: "12와 18의 최소공배수를 공통 부분 2×3=6으로 계산한다",
    confusedWithSlug: "m1-gcd",
    detectionEvidence: { signals: ["lcm이 두 수보다 작음", "배수 검산 생략"] },
    remediationStrategy: {
      steps: ["'배수는 나누어떨어져야 한다' — 6이 12의 배수인지 검산", "벤 다이어그램에서 합집합(전체 영역)이 lcm임을 보인다"],
    },
  },
  {
    conceptSlug: "m2-simeq-intro",
    key: "single-equation-check",
    name: "한 식만 만족해도 해로 판정",
    errorPattern: "(3,2)를 x+y=5에만 대입해 보고 연립의 해라고 답한다",
    detectionEvidence: { signals: ["대입 검산이 한 식뿐", "'동시에'라는 조건 누락"] },
    remediationStrategy: {
      steps: ["두 식의 해 집합을 각각 나열해 교집합만 남김", "검산 양식에 식 2개 칸을 강제"],
    },
  },
  {
    conceptSlug: "m2-simeq-substitution",
    key: "distribute-miss",
    name: "대입 시 분배 누락",
    errorPattern: "y=2x+1을 3y에 대입하며 3×2x+1 = 6x+1로 쓴다 (괄호 없음)",
    detectionEvidence: { signals: ["괄호 없는 대입식", "검산하면 안 맞는 해를 그대로 제출"] },
    remediationStrategy: {
      steps: ["대입은 '괄호째 넣기'로 규칙화 — 3(2x+1)", "구한 해를 두 식에 대입하는 검산을 풀이의 마지막 단계로 고정"],
    },
  },
  {
    conceptSlug: "m2-simeq-elimination",
    key: "sign-on-subtract",
    name: "빼기에서 부호 처리 오류",
    errorPattern: "(x+2y) − (x−y) = 3y가 아니라 y로 계산한다 — 뒤 항 부호 반전 누락",
    detectionEvidence: { signals: ["소거 후 남은 계수가 틀림", "덧셈으로 풀면 맞는데 뺄셈 선택 시만 틀림"] },
    remediationStrategy: {
      steps: ["뺄셈을 '부호 바꿔 더하기'로 다시 쓰게 한다", "소거 직후 남은 식만 따로 검산"],
    },
  },
  {
    conceptSlug: "m2-simeq-application",
    key: "one-unknown",
    name: "미지수 하나에 두 조건을 욱여넣음",
    errorPattern: "어른·아이 인원 문제를 x 하나로 세우다 조건 하나를 버린다",
    detectionEvidence: { signals: ["식이 1개뿐", "답이 조건 하나만 만족"] },
    remediationStrategy: {
      steps: ["'모르는 양이 2개면 미지수 2개·식 2개' 대응을 명시", "각 문장 → 각 식의 번역 표를 먼저 완성하게 한다"],
    },
  },
  {
    conceptSlug: "m2-linear-eq-review",
    key: "move-keep-sign",
    name: "이항 시 부호 유지",
    errorPattern: "3x+5 = 2x−1 → 3x−2x = −1+5 로 쓴다",
    detectionEvidence: { signals: ["이항한 항의 부호가 그대로", "등식 성질 검산 생략"] },
    remediationStrategy: {
      steps: ["이항을 '양변에 같은 수를 더한다'로 되돌려 유도", "한 단계마다 양변 값이 같은지 수치 대입으로 확인"],
    },
  },
] as const;
