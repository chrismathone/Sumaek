/* ─────────────────────────────────────────────────────────────
 * 문항 변형 템플릿의 계약
 *
 * 나눠 놓은 역할이 이 파일의 요지다:
 *
 *   parse   원문 문항 → 파라미터        (읽기. 못 읽으면 null)
 *   solve   파라미터 → 정답             ← **정답의 유일한 권한**
 *   render  파라미터 → 발문·선택지      (쓰기)
 *   vary    파라미터 → 다른 파라미터    (결정론적)
 *   check   변형이 쓸 만한가            (거부 사유 목록)
 *
 * AI는 이 사슬에 끼지 않는다. AI가 하는 일은 "이 문항이 어느 템플릿인가"를
 * 고르는 것과, 만들어진 변형의 **문장이 자연스러운지**를 보는 것뿐이다.
 * 둘 다 틀려도 답이 틀리지는 않는다 — 틀린 템플릿을 고르면 parse가 실패하거나
 * 아래 「원본 재현 검사」에서 걸린다.
 *
 * ── 원본 재현 검사 ──────────────────────────────────────────
 * 풀이기를 믿을 근거는 이것 하나다: **원본 숫자로 돌려 교재에 인쇄된 답이
 * 그대로 나오는가.** 213문항의 답이 정답 별책에 있으므로 전수로 확인할 수
 * 있다. 재현하지 못하는 템플릿은 그 문항에 쓰지 않는다.
 * ───────────────────────────────────────────────────────────── */

/** 템플릿이 계산해 낸 답 */
export interface Solution {
  /** 사람이 읽는 정답 (교재 표기와 같은 꼴) */
  display: string;
  /** 채점용 값 — 수치면 number, 표현이면 LaTeX */
  value: number | string;
  /** 객관식이면 정답 선택지의 0-based 위치 */
  correctIndex?: number;
  /** 왜 이 답인지 — 사람이 검수할 때 읽는다 */
  steps: string[];
}

export interface RenderedQuestion {
  /** 발문 (한글 + $…$ 인라인 수식) */
  stem: string;
  /** 객관식이면 선택지 5개 */
  choices?: string[];
}

/** 변형을 거부한 이유. 비어 있으면 통과. */
export type Rejection = string;

export interface VariantTemplate<P> {
  id: string;
  label: string;
  /** 이 템플릿이 다루는 개념 (canonical_concepts.slug) */
  conceptSlugs: readonly string[];
  /** 객관식 문항용 템플릿인가 */
  kind: "multiple_choice" | "short_answer";

  /** 원문 발문에서 파라미터를 읽는다. 형태가 다르면 null — 억지로 읽지 않는다. */
  parse(stem: string, choices: readonly string[] | null): P | null;

  /** **정답의 권한.** 파라미터만으로 답이 정해진다. */
  solve(params: P): Solution;

  /** 파라미터로 문항을 짓는다 */
  render(params: P, solution: Solution): RenderedQuestion;

  /** 파라미터를 흔든다. 같은 seed는 같은 결과. */
  vary(params: P, rng: () => number): P;

  /**
   * 만들어진 변형이 쓸 만한가. 거부 사유를 문자열로 돌린다.
   * 「답이 너무 크다」 「선택지가 겹친다」 「원본과 같다」 같은 것.
   */
  check(params: P, solution: Solution, original: P): Rejection[];
}

/** 원본 문항 하나에 대한 템플릿 적용 결과 */
export interface TemplateMatch<P> {
  templateId: string;
  params: P;
  computed: Solution;
  /** 교재에 인쇄된 답 */
  printed: string;
  /** 계산한 답이 인쇄된 답과 맞는가 — 이것이 신뢰의 근거다 */
  reproduces: boolean;
}
