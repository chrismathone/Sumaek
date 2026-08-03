/* ─────────────────────────────────────────────────────────────
 * 학습 목표·평가 증거 카탈로그 (골프롬프트 2M — 인수 48 사슬의 뒤 고리).
 *
 * 사람 큐레이션. 대상은 **문항까지 실제로 잇긴 개념 10종** — 목표는 문항
 * 없이 검증할 수 없으므로, 사슬이 끝까지 닿는 개념부터 채우고 교재 반입이
 * 늘 때마다 함께 자란다.
 *
 * 원칙 (2M):
 *   - 목표는 "학생이 보여줄 수학적 수행"으로 서술한다 — 페이지 범위 금지.
 *   - 한 차시 또는 짧은 평가에서 관찰 가능해야 한다.
 *   - 성공 증거와 **허용 가능한 오류**를 함께 적는다 — 무엇이 실수이고
 *     무엇이 미이해인지 채점·보충 판단이 갈린다.
 *   - dimensions는 개념 이해·절차 유창성·문제 해결·추론·의사소통·표상 전환.
 *
 * 적재는 collect-curriculum.mts가 담당 (stable ID — 재실행 멱등).
 * ───────────────────────────────────────────────────────────── */

export type ObjectiveDimension =
  | "concept_understanding"
  | "procedural_fluency"
  | "problem_solving"
  | "reasoning"
  | "communication"
  | "representation_translation";

export interface CatalogEvidence {
  /** 목표 안에서 안정적 식별 (stable ID 재료) */
  key: string;
  description: string;
  observableVia: {
    questionKinds: Array<
      "multiple_choice" | "short_answer" | "multi_blank" | "essay"
    >;
    note?: string;
  };
}

export interface CatalogObjective {
  conceptSlug: string;
  /** 개념 안에서 안정적 식별 (stable ID 재료) */
  key: string;
  statement: string;
  dimensions: ObjectiveDimension[];
  successEvidence: { success: string; allowedErrors: string };
  expectedMinutes: number;
  evidences: CatalogEvidence[];
}

export const CATALOG_OBJECTIVES: readonly CatalogObjective[] = [
  /* ── 소수와 합성수 ── */
  {
    conceptSlug: "m1-prime-composite",
    key: "classify",
    statement:
      "주어진 자연수를 소수·합성수로 분류하고, 그 판단의 근거를 약수의 개수로 말할 수 있다.",
    dimensions: ["concept_understanding", "reasoning"],
    successEvidence: {
      success:
        "1은 소수도 합성수도 아님을 포함해 20 이하 자연수를 오류 없이 분류하고, 분류 근거를 약수의 개수로 설명한다.",
      allowedErrors:
        "큰 수(예: 91=7×13)의 소수 판정 실수는 허용 — 판정 절차를 알면 미이해가 아니다. 1을 소수로 분류하면 미이해.",
    },
    expectedMinutes: 10,
    evidences: [
      {
        key: "classify-under-50",
        description: "50 이하 자연수 여러 개를 소수·합성수·둘 다 아님으로 분류한다.",
        observableVia: { questionKinds: ["multiple_choice", "short_answer"] },
      },
      {
        key: "explain-one",
        description: "1이 소수가 아닌 이유를 약수의 개수로 설명한다.",
        observableVia: { questionKinds: ["essay"], note: "서술 채점 — 약수 1개 언급 필수" },
      },
    ],
  },
  {
    conceptSlug: "m1-prime-composite",
    key: "distinguish-parity",
    statement:
      "소수·합성수 분류가 홀짝이나 크기와 무관함을 반례를 들어 보일 수 있다.",
    dimensions: ["reasoning", "communication"],
    successEvidence: {
      success: "『홀수는 모두 소수다』 같은 명제에 반례(예: 9)를 제시한다.",
      allowedErrors: "반례가 하나만 나와도 성공 — 여러 개일 필요 없다.",
    },
    expectedMinutes: 5,
    evidences: [
      {
        key: "counterexample",
        description: "잘못된 소수 판정 명제에 대한 반례를 찾는다.",
        observableVia: { questionKinds: ["short_answer", "multiple_choice"] },
      },
    ],
  },

  /* ── 소인수분해 ── */
  {
    conceptSlug: "m1-prime-factorization",
    key: "factorize",
    statement:
      "자연수를 소인수분해하여 거듭제곱 꼴로 나타낼 수 있다.",
    dimensions: ["procedural_fluency", "representation_translation"],
    successEvidence: {
      success:
        "세 자리 이하 자연수를 소인수의 거듭제곱 곱(예: 360 = 2³×3²×5)으로 정확히 나타낸다.",
      allowedErrors:
        "지수 표기 없이 2×2×2×3×3×5로 풀어 쓰는 것은 허용(표기 지도 대상). 합성수 인수를 남기면(예: 4×90) 미완결로 재지도.",
    },
    expectedMinutes: 10,
    evidences: [
      {
        key: "factorize-3digit",
        description: "두세 자리 자연수를 소인수분해해 거듭제곱 꼴로 쓴다.",
        observableVia: { questionKinds: ["short_answer"] },
      },
      {
        key: "read-exponents",
        description: "소인수분해 결과에서 특정 소인수의 지수를 읽어낸다.",
        observableVia: { questionKinds: ["short_answer", "multiple_choice"] },
      },
    ],
  },
  {
    conceptSlug: "m1-prime-factorization",
    key: "apply-structure",
    statement:
      "소인수분해를 이용해 어떤 수가 다른 수의 배수·제곱수가 되는 조건을 판단할 수 있다.",
    dimensions: ["problem_solving", "reasoning"],
    successEvidence: {
      success:
        "『몇을 곱하면 제곱수가 되는가』 유형에서 지수의 홀짝을 근거로 최소 곱셈 인수를 찾는다.",
      allowedErrors: "판단 근거(지수 홀짝)가 맞으면 계산 실수는 허용.",
    },
    expectedMinutes: 15,
    evidences: [
      {
        key: "make-square",
        description:
          "주어진 수에 자연수를 곱해 제곱수를 만들 때 곱할 최소 자연수를 구한다.",
        observableVia: { questionKinds: ["short_answer"] },
      },
    ],
  },

  /* ── 약수와 약수의 개수 ── */
  {
    conceptSlug: "m1-divisors",
    key: "count-via-exponents",
    statement:
      "소인수분해 결과의 지수를 이용해 약수의 개수를 계산할 수 있다.",
    dimensions: ["procedural_fluency", "concept_understanding"],
    successEvidence: {
      success:
        "2^a×3^b 꼴에서 약수의 개수 (a+1)(b+1)을 구하고, 왜 지수에 1을 더하는지(지수 0 포함) 말할 수 있다.",
      allowedErrors:
        "곱셈 실수는 허용. (a+1)에서 +1을 빠뜨리면 지수 0(=1 포함)을 놓친 미이해로 재지도.",
    },
    expectedMinutes: 10,
    evidences: [
      {
        key: "count-divisors",
        description: "소인수분해된 수의 약수의 개수를 구한다.",
        observableVia: { questionKinds: ["short_answer", "multiple_choice"] },
      },
      {
        key: "enumerate-check",
        description: "작은 수는 약수를 직접 나열해 공식 결과와 대조한다.",
        observableVia: { questionKinds: ["multi_blank"], note: "나열 누락 여부 관찰" },
      },
    ],
  },

  /* ── 최대공약수 ── */
  {
    conceptSlug: "m1-gcd",
    key: "compute",
    statement:
      "두세 수의 최대공약수를 소인수분해로 구하고, 공약수가 최대공약수의 약수임을 이용할 수 있다.",
    dimensions: ["procedural_fluency", "concept_understanding"],
    successEvidence: {
      success:
        "공통 소인수의 최소 지수를 택해 최대공약수를 구하고, 공약수 전체를 최대공약수의 약수로 나열한다.",
      allowedErrors: "최소 지수 선택이 맞으면 곱셈 실수 허용. 최대 지수를 택하면 최소공배수와의 혼동 — 대조 지도.",
    },
    expectedMinutes: 10,
    evidences: [
      {
        key: "gcd-two-numbers",
        description: "소인수분해를 이용해 두 수의 최대공약수를 구한다.",
        observableVia: { questionKinds: ["short_answer"] },
      },
    ],
  },
  {
    conceptSlug: "m1-gcd",
    key: "model-situation",
    statement:
      "『가능한 한 크게·똑같이 나누는』 상황을 최대공약수 문제로 번역해 풀 수 있다.",
    dimensions: ["problem_solving", "representation_translation"],
    successEvidence: {
      success: "나눔·포장·타일 상황에서 구하는 값이 최대공약수임을 식별하고 답을 상황 단위로 해석한다.",
      allowedErrors: "식별이 맞으면 계산 실수 허용. 최소공배수 상황과 뒤바꾸면 상황 번역 재지도.",
    },
    expectedMinutes: 15,
    evidences: [
      {
        key: "gcd-word-problem",
        description: "실생활 나눔 상황에서 최대공약수를 구해 답한다.",
        observableVia: { questionKinds: ["short_answer", "essay"] },
      },
    ],
  },

  /* ── 최소공배수 ── */
  {
    conceptSlug: "m1-lcm",
    key: "compute",
    statement:
      "두세 수의 최소공배수를 소인수분해로 구하고, 공배수가 최소공배수의 배수임을 이용할 수 있다.",
    dimensions: ["procedural_fluency", "concept_understanding"],
    successEvidence: {
      success:
        "모든 소인수의 최대 지수를 택해 최소공배수를 구하고, 범위 안의 공배수를 그 배수로 나열한다.",
      allowedErrors: "최대 지수 선택이 맞으면 곱셈 실수 허용. 공통 소인수만 곱하면 최대공약수와의 혼동 — 대조 지도.",
    },
    expectedMinutes: 10,
    evidences: [
      {
        key: "lcm-two-numbers",
        description: "소인수분해를 이용해 두 수의 최소공배수를 구한다.",
        observableVia: { questionKinds: ["short_answer"] },
      },
    ],
  },
  {
    conceptSlug: "m1-lcm",
    key: "model-situation",
    statement:
      "『동시에 다시 만나는·다시 맞물리는』 주기 상황을 최소공배수 문제로 번역해 풀 수 있다.",
    dimensions: ["problem_solving", "representation_translation"],
    successEvidence: {
      success: "버스 배차·톱니바퀴 상황에서 구하는 값이 최소공배수임을 식별하고 답을 상황 단위로 해석한다.",
      allowedErrors: "식별이 맞으면 계산 실수 허용.",
    },
    expectedMinutes: 15,
    evidences: [
      {
        key: "lcm-word-problem",
        description: "주기가 다른 두 사건이 동시에 일어나는 때를 구한다.",
        observableVia: { questionKinds: ["short_answer", "essay"] },
      },
    ],
  },

  /* ── 연립일차방정식의 뜻 ── */
  {
    conceptSlug: "m2-simeq-intro",
    key: "meaning-of-solution",
    statement:
      "미지수가 2개인 연립일차방정식의 해가 두 방정식을 동시에 만족하는 순서쌍임을 확인할 수 있다.",
    dimensions: ["concept_understanding"],
    successEvidence: {
      success:
        "주어진 순서쌍을 두 식에 각각 대입해 해인지 판정하고, 한 식만 만족하는 쌍은 해가 아님을 말한다.",
      allowedErrors: "대입 계산 실수는 허용. 한 식만 검사하고 판정하면 '동시에'의 미이해 — 재지도.",
    },
    expectedMinutes: 10,
    evidences: [
      {
        key: "check-pair",
        description: "순서쌍이 연립방정식의 해인지 대입으로 판정한다.",
        observableVia: { questionKinds: ["multiple_choice", "short_answer"] },
      },
    ],
  },

  /* ── 대입법 ── */
  {
    conceptSlug: "m2-simeq-substitution",
    key: "solve",
    statement:
      "한 미지수를 다른 미지수로 나타내어 대입법으로 연립일차방정식을 풀 수 있다.",
    dimensions: ["procedural_fluency"],
    successEvidence: {
      success:
        "계수가 1인 미지수를 골라 정리·대입해 해를 구하고, 구한 해를 원래 두 식에 대입해 검산한다.",
      allowedErrors:
        "이항 부호 실수는 허용(검산으로 스스로 잡으면 더 좋음). 대입 후에도 미지수가 2개 남으면 절차 미이해.",
    },
    expectedMinutes: 15,
    evidences: [
      {
        key: "solve-substitution",
        description: "대입법으로 연립방정식의 해를 구한다.",
        observableVia: { questionKinds: ["short_answer", "multi_blank"] },
      },
    ],
  },

  /* ── 가감법 ── */
  {
    conceptSlug: "m2-simeq-elimination",
    key: "solve",
    statement:
      "두 식을 변끼리 더하거나 빼어 한 미지수를 소거하는 가감법으로 연립일차방정식을 풀 수 있다.",
    dimensions: ["procedural_fluency", "reasoning"],
    successEvidence: {
      success:
        "소거할 미지수의 계수를 맞추기 위해 적절한 수를 곱하고, 부호에 맞게 더하거나 빼어 해를 구한다.",
      allowedErrors:
        "곱셈 실수는 허용. 빼야 할 때 더하는(부호 처리) 반복 오류는 소거 원리 미이해 — 재지도.",
    },
    expectedMinutes: 15,
    evidences: [
      {
        key: "solve-elimination",
        description: "가감법으로 연립방정식의 해를 구한다.",
        observableVia: { questionKinds: ["short_answer", "multi_blank"] },
      },
    ],
  },

  /* ── 연립방정식의 활용 ── */
  {
    conceptSlug: "m2-simeq-application",
    key: "model-and-solve",
    statement:
      "두 조건이 있는 상황을 미지수 2개의 연립일차방정식으로 세우고, 풀이 결과를 상황에 맞게 해석할 수 있다.",
    dimensions: ["problem_solving", "representation_translation", "communication"],
    successEvidence: {
      success:
        "미지수 정의 → 두 식 수립 → 풀이 → 답이 상황에 맞는지(음수·비자연수 배제) 확인의 네 단계가 답안에 드러난다.",
      allowedErrors:
        "풀이 계산 실수는 허용. 조건 하나로 식 하나만 세우면 모델링 미완 — 대응 조건 찾기 재지도.",
    },
    expectedMinutes: 20,
    evidences: [
      {
        key: "word-problem",
        description: "수량·가격·나이 상황을 연립방정식으로 세워 푼다.",
        observableVia: { questionKinds: ["short_answer", "essay"] },
      },
      {
        key: "interpret-solution",
        description: "구한 해가 상황의 제약(자연수 등)에 맞는지 판단한다.",
        observableVia: { questionKinds: ["essay"], note: "해석 문장 관찰" },
      },
    ],
  },

  /* ── 일차방정식 복습 (연립의 선수 복습) ── */
  {
    conceptSlug: "m2-linear-eq-review",
    key: "refresh",
    statement:
      "이항과 동류항 정리를 이용해 일차방정식을 오류 없이 풀 수 있다 (연립방정식의 선수 기능 복습).",
    dimensions: ["procedural_fluency"],
    successEvidence: {
      success: "괄호·분수 계수가 있는 일차방정식을 표준 절차로 푼다.",
      allowedErrors: "한 문제 안의 단발 부호 실수는 허용 — 반복되면 중1 과정 보충으로 되돌린다.",
    },
    expectedMinutes: 10,
    evidences: [
      {
        key: "solve-linear",
        description: "괄호·분수 계수를 포함한 일차방정식을 푼다.",
        observableVia: { questionKinds: ["short_answer"] },
      },
    ],
  },
] as const;
