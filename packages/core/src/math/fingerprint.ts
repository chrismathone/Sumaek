import { stableHash } from "../shared/deterministic";

/**
 * 의미 지문 (semantic fingerprint) — 표시 형식 차이를 무시하고 수학적 의미가
 * 같은지 비교하기 위한 정규화 해시 (골프롬프트 2O·불변 조건 19).
 *
 * 제거 대상 (표시 전용):
 * - 스타일 지시자 (\displaystyle 등), 간격 명령 (\, \; \quad …)
 * - \left / \right (괄호 크기)
 * - 크기 구분자 (\big \Big …)
 * - 공백
 * 통일 대상:
 * - \dfrac/\tfrac/\cfrac → \frac
 * - \le/\leq, \ge/\geq, \ne/\neq 동의어 통일
 *
 * 숫자·연산자·변수·부등호 방향·구조 중괄호는 절대 건드리지 않는다
 * (시험지 한글화 ocr_eval 정규화 철학: "정답을 바꾸는 차이는 흡수하지 않는다").
 */
export function semanticFingerprint(latex: string): string {
  return stableHash(canonicalizeForFingerprint(latex));
}

export function canonicalizeForFingerprint(latex: string): string {
  return (
    latex
      // 스타일·간격 (표시 전용)
      .replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b/g, "")
      .replace(/\\(?:quad|qquad)\b/g, "")
      .replace(/\\[,;:!]/g, "")
      // 괄호 크기 명령
      .replace(/\\left(?=[([|.]|\\)/g, "")
      .replace(/\\right(?=[)\]|.]|\\)/g, "")
      .replace(/\\(?:bigg?|Bigg?)[lrm]?\b/g, "")
      // 분수 동의어 통일
      .replace(/\\[dtc]frac(?![a-zA-Z])/g, "\\frac")
      // 관계 기호 동의어 통일
      .replace(/\\leq\b/g, "\\le")
      .replace(/\\geq\b/g, "\\ge")
      .replace(/\\neq\b/g, "\\ne")
      // 공백 제거 (수식 의미에 영향 없음)
      .replace(/\s+/g, "")
  );
}

/** 의미 토큰 추출 — 정규화가 숫자·연산자·부등호를 바꾸지 않았는지 속성 테스트용 */
export function extractMeaningTokens(latex: string): {
  digits: string;
  relations: string[];
} {
  const digits = (latex.match(/\d/g) ?? []).join("");
  const relations = (
    latex.match(/\\le\b|\\leq\b|\\ge\b|\\geq\b|\\ne\b|\\neq\b|<|>|=/g) ?? []
  ).map((r) =>
    r.replace(/\\leq\b/, "\\le").replace(/\\geq\b/, "\\ge").replace(/\\neq\b/, "\\ne"),
  );
  return { digits, relations };
}
