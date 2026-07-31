/**
 * 산출물 검증 보고서의 공통 모양 — PDF·HWPX 가 같은 어휘로 답한다.
 *
 * 상태 머신이 두 형식을 구분하지 않고 `validation_passed` /
 * `validation_needs_review` / `validation_failed` 로 받을 수 있어야 하므로,
 * 판정 규칙도 한 곳에 둔다.
 */

/**
 * `fatal` 은 산출물을 폐기한다 — 학생에게 나가면 안 되는 상태.
 * `review` 는 파일 자체는 쓸 수 있지만 사람이 봐야 하는 상태.
 */
export type ValidationSeverity = "fatal" | "review";

export type ValidationStatus = "passed" | "review_required" | "failed";

export interface ValidationIssue<TCode extends string> {
  readonly code: TCode;
  readonly severity: ValidationSeverity;
  readonly message: string;
}

/**
 * 문제 목록에서 상태를 정한다.
 *
 * 치명 문제가 하나라도 있으면 검수 대상 여부와 무관하게 `failed` 다 — 사람이
 * 봐야 할 것이 있다는 사실이 깨진 산출물을 통과시킬 이유가 되지는 않는다.
 */
export function deriveValidationStatus(
  issues: readonly ValidationIssue<string>[],
): ValidationStatus {
  if (issues.some((issue) => issue.severity === "fatal")) return "failed";
  return issues.length > 0 ? "review_required" : "passed";
}
