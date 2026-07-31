/**
 * HWP 수식 어댑터 — LaTeX 수식을 한글(HWP) 수식 편집기 스크립트로 옮기고,
 * HWPX 문서에 적어야 할 수식 객체 크기를 추정한다.
 *
 * 시험지 한글화 프로젝트(D:\시험지 한글화)에서 이식한 데이터 자산이다.
 * 매핑값·튜닝 상수는 실제 한컴 렌더 실측과 골든셋 84개 회귀로 확정된 것이므로
 * mappings.ts 의 숫자를 임의로 바꾸지 말 것.
 */
export { latexToHwpEq } from "./convert";
export type { HwpEqOptions, HwpEqResult } from "./convert";
export { estimateEquationSize, measureHwpEqWidth } from "./metrics";
export type { EquationSize } from "./metrics";
export {
  ACCENT_MAP,
  FUNC_MAP,
  GREEK_MAP,
  SYMBOL_MAP,
} from "./mappings";
