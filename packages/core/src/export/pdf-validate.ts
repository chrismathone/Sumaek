/**
 * PDF 레이아웃 검증 — ADR-0013 §5.
 *
 * Chromium 이 인쇄한 결과가 "나오기는 했다"와 "쓸 만하다" 사이의 간격을 메운다.
 * 브라우저에서 잰 요소 상자들을 받아 판정만 하는 **순수 함수**다 — Playwright 를
 * 여기 두지 않는 이유는 두 가지다. 이 판정 규칙이야말로 회귀 테스트가 필요한
 * 부분인데 브라우저를 띄워야만 돌릴 수 있으면 아무도 안 돌리고, 측정과 판정이
 * 한 덩어리면 "왜 실패했는지"를 재현할 수 없다.
 *
 * 잡는 것 (ADR-0013 §5 표):
 * - 본문 폭을 벗어난 가로 넘침 (인쇄하면 잘린다)
 * - 쪼개지면 안 되는 요소가 페이지 경계에 걸침 (문항 번호와 첫 줄, 선택지
 *   번호와 식, 도형 캡션과 도형)
 * - 크기가 0 인 수식 (렌더가 실패했는데 페이지는 나온 경우)
 * - 수식끼리 겹침
 * - 텍스트 레이어 누락 (수식이 이미지로만 남으면 복사·스크린리더 불가)
 */

import {
  type ValidationIssue,
  type ValidationStatus,
  deriveValidationStatus,
} from "./report";

/** 위치 허용 오차(px). ADR-0013 의 ±2 pt 를 96dpi 기준으로 환산. */
export const PDF_POSITION_TOLERANCE = 2.7;

/**
 * 페이지 경계에서 쪼개지면 안 되는 요소 종류.
 * 문항 전체는 길면 넘어갈 수 있으므로 대상이 아니다 — 넘어가면 안 되는 것은
 * "번호와 첫 줄", "선택지 번호와 식", "캡션과 도형" 같은 **묶음**이다.
 */
const UNBREAKABLE_KINDS: ReadonlySet<PdfBoxKind> = new Set([
  "question_head",
  "choice",
  "equation",
  "figure",
]);

export type PdfBoxKind =
  | "question"
  | "question_head"
  | "choice"
  | "equation"
  | "figure"
  | "caption";

/** 브라우저에서 잰 요소 하나. 좌표는 문서 전체 기준 CSS px. */
export interface MeasuredBox {
  /** 되짚어갈 식별자 — 문항 번호, choice_id, expression_id 등. */
  readonly ref: string;
  readonly kind: PdfBoxKind;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** 인쇄 페이지 기하. Playwright 가 `@page` 설정에서 계산해 넘긴다. */
export interface PdfPageGeometry {
  /** 인쇄 가능 영역 폭(px) — 여백 안쪽. */
  readonly contentWidth: number;
  /** 인쇄 가능 영역 높이(px) — 페이지 경계 계산 기준. */
  readonly contentHeight: number;
  /** 실제 생성된 페이지 수. */
  readonly pageCount: number;
}

export type PdfIssueCode =
  | "horizontal_overflow"
  | "page_split"
  | "zero_size"
  | "overlap"
  | "missing_text_layer"
  | "page_count";

export type PdfValidationIssue = ValidationIssue<PdfIssueCode>;

export interface PdfValidationMetrics {
  readonly boxCount: number;
  readonly equationCount: number;
  readonly pageCount: number;
  /** 본문 폭을 넘어선 최대 크기(px). 0 이면 넘침 없음. */
  readonly maxOverflow: number;
}

export interface PdfValidationReport {
  readonly status: ValidationStatus;
  readonly issues: readonly PdfValidationIssue[];
  readonly metrics: PdfValidationMetrics;
}

export interface PdfValidationInput {
  readonly boxes: readonly MeasuredBox[];
  readonly geometry: PdfPageGeometry;
  /**
   * PDF 텍스트 레이어에서 추출한 문자열. 주면 `requiredText` 가 전부 들어있는지
   * 확인한다. 수식이 저해상도 이미지로만 남는 사고를 잡는 유일한 방법이다.
   */
  readonly extractedText?: string;
  /** 텍스트 레이어에 반드시 있어야 하는 문자열 (보통 문항 번호·핵심 지문). */
  readonly requiredText?: readonly string[];
  /** 기대 페이지 수. 주면 다르면 검수 대상으로 올린다. */
  readonly expectedPageCount?: number;
  /**
   * 페이지 경계 걸침을 검사할지. 기본 true.
   *
   * **다단 조판(`column-count`)에서는 false 로 줘야 한다.** 이 검사는
   * `top / contentHeight` 산술로 쪽을 계산하는데, 다단에서는 브라우저가 단을
   * 채운 뒤 다음 쪽으로 넘기므로 JS 로 잰 세로 좌표와 실제 인쇄 쪽 번호가
   * 대응하지 않는다. 그 상태로 검사하면 멀쩡한 조판을 실패로 신고한다.
   * 다단에서 묶음 보호는 CSS `break-inside: avoid` 가 맡고, 확인은 시각 회귀가 한다.
   */
  readonly checkPageSplits?: boolean;
}

/** 잰 상자들을 판정한다. 예외를 던지지 않고 보고서로 답한다. */
export function validatePdfLayout(
  input: PdfValidationInput,
): PdfValidationReport {
  const issues: PdfValidationIssue[] = [];
  const fail = (code: PdfIssueCode, message: string): void => {
    issues.push({ code, severity: "fatal", message });
  };
  const review = (code: PdfIssueCode, message: string): void => {
    issues.push({ code, severity: "review", message });
  };

  const { boxes, geometry } = input;
  const checkPageSplits = input.checkPageSplits ?? true;
  let maxOverflow = 0;

  for (const box of boxes) {
    // 크기 0 — 렌더가 조용히 실패한 자리.
    if (box.kind === "equation" && (box.width <= 0 || box.height <= 0)) {
      fail("zero_size", `수식이 크기 0 으로 렌더됐다: ${box.ref}`);
    }

    // 가로 넘침 — 인쇄하면 오른쪽이 잘린다.
    const right = box.left + box.width;
    const overflow = Math.max(
      -box.left,
      right - geometry.contentWidth,
    );
    if (overflow > PDF_POSITION_TOLERANCE) {
      maxOverflow = Math.max(maxOverflow, overflow);
      fail(
        "horizontal_overflow",
        `본문 폭을 ${overflow.toFixed(1)}px 벗어났다: ${box.ref} (${box.kind})`,
      );
    }

    // 페이지 경계 걸침 — 묶여 있어야 할 것이 두 쪽으로 나뉜다.
    if (checkPageSplits && UNBREAKABLE_KINDS.has(box.kind) && box.height > 0) {
      const startPage = Math.floor(box.top / geometry.contentHeight);
      const endPage = Math.floor(
        (box.top + box.height - PDF_POSITION_TOLERANCE) / geometry.contentHeight,
      );
      if (endPage > startPage) {
        fail(
          "page_split",
          `페이지 경계에 걸쳤다: ${box.ref} (${box.kind}, ${startPage + 1}쪽→${endPage + 1}쪽)`,
        );
      }
    }
  }

  // 수식끼리 겹침 — 옆 글자를 덮어 읽을 수 없게 된다.
  const equations = boxes.filter((b) => b.kind === "equation");
  for (let i = 0; i < equations.length; i += 1) {
    for (let j = i + 1; j < equations.length; j += 1) {
      const a = equations[i] as MeasuredBox;
      const b = equations[j] as MeasuredBox;
      if (overlaps(a, b)) {
        fail("overlap", `수식이 겹쳤다: ${a.ref} ↔ ${b.ref}`);
      }
    }
  }

  // 텍스트 레이어 — 수식이 이미지로만 남지 않았는지.
  if (input.extractedText !== undefined && input.requiredText) {
    for (const required of input.requiredText) {
      if (!input.extractedText.includes(required)) {
        fail(
          "missing_text_layer",
          `PDF 텍스트 레이어에 없다: ${JSON.stringify(required)}`,
        );
      }
    }
  }

  if (
    input.expectedPageCount !== undefined &&
    geometry.pageCount !== input.expectedPageCount
  ) {
    // 쪽 수가 달라진 것은 조판이 밀렸다는 신호지 파일이 깨진 것은 아니다.
    review(
      "page_count",
      `페이지 수가 기대와 다르다: ${geometry.pageCount}쪽, 기대 ${input.expectedPageCount}쪽`,
    );
  }

  return {
    status: deriveValidationStatus(issues),
    issues,
    metrics: {
      boxCount: boxes.length,
      equationCount: equations.length,
      pageCount: geometry.pageCount,
      maxOverflow,
    },
  };
}

/** 두 상자가 실제로 겹치는지. 맞닿기만 한 것은 겹침이 아니다. */
function overlaps(a: MeasuredBox, b: MeasuredBox): boolean {
  const gapX = Math.max(a.left, b.left) - Math.min(a.left + a.width, b.left + b.width);
  const gapY = Math.max(a.top, b.top) - Math.min(a.top + a.height, b.top + b.height);
  return gapX < -PDF_POSITION_TOLERANCE && gapY < -PDF_POSITION_TOLERANCE;
}
