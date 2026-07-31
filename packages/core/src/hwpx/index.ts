/**
 * HWPX(한글 문서) 생성기.
 *
 * `@su-maek/core/hwp` 가 LaTeX 한 개를 HWP 수식 스크립트로 옮기는 어댑터라면,
 * 여기는 그 결과를 담아 한글이 여는 .hwpx 파일 하나를 만드는 층이다.
 *
 * 골격 XML 의 출처와 원본 대비 단순화 내역은 `template.ts` 머리말 참고.
 */
export { buildHwpx, buildHwpxSync, buildHwpxEntries, MIMETYPE_PATH } from "./writer";
export { HwpxUnsupportedEquationError } from "./writer";
export type {
  HwpxBuildOptions,
  HwpxExamDoc,
  HwpxQuestion,
  HwpxRun,
  UnsupportedEquation,
} from "./writer";
export { escapeXml } from "./xml";
export { MIMETYPE } from "./template";

/** 산출물을 다시 열어 읽는 쪽 — 형식 검증과 테스트가 함께 쓴다. */
export { findElements, isElement, parseXml, requireElement, textOf } from "./parse";
export type { XmlElement, XmlNode } from "./parse";
export { readZipEntries } from "./read";
export type { ZipEntry } from "./read";

export {
  BASELINE_TOLERANCE,
  GOLDEN_DEVIATION_TOLERANCE,
  validateHwpx,
} from "./validate";
export type {
  HwpxIssueCode,
  HwpxIssueSeverity,
  HwpxValidationInput,
  HwpxValidationIssue,
  HwpxValidationMetrics,
  HwpxValidationReport,
} from "./validate";
