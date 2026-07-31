/**
 * 문서 출력 어댑터의 공통 층 — 형식(PDF·HWPX)에 독립적인 부분.
 *
 * 형식별 생성기는 각자의 모듈에 있다(`@su-maek/core/hwpx`). 여기 있는 것은
 * "무엇을 만들든 똑같이 지켜야 하는 것": 상태 전이 규칙과, 세 형식이 같은 수식을
 * 담았는지 대조하는 검증이다.
 */
export {
  DOCUMENT_EXPORT_STATES,
  InvalidExportTransitionError,
  applyExportEvent,
  canTransition,
  isTerminalExportState,
  nextExportState,
} from "./state-machine";
export type {
  DocumentExportEvent,
  DocumentExportEventType,
  DocumentExportSnapshot,
  DocumentExportState,
} from "./state-machine";

export { deriveValidationStatus } from "./report";
export type {
  ValidationIssue,
  ValidationSeverity,
  ValidationStatus,
} from "./report";

export { PDF_POSITION_TOLERANCE, validatePdfLayout } from "./pdf-validate";
export type {
  MeasuredBox,
  PdfBoxKind,
  PdfIssueCode,
  PdfPageGeometry,
  PdfValidationInput,
  PdfValidationIssue,
  PdfValidationMetrics,
  PdfValidationReport,
} from "./pdf-validate";

export { CROSS_FORMAT_TARGETS, verifyCrossFormat } from "./cross-format";
export type {
  CrossFormatInput,
  CrossFormatReport,
  CrossFormatTarget,
  FingerprintMismatch,
  MissingExpression,
  RenderedExpression,
  UnexpectedExpression,
} from "./cross-format";
