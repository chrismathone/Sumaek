/**
 * PDF 출력 — Chromium(Playwright)으로 인쇄 CSS 를 A4 로 찍는다 (ADR-0013 §5).
 *
 * 웹과 **같은 CSS 로 같은 DOM 을** 찍는 것이 요점이다. 별도 조판 엔진(XeLaTeX 등)을
 * 쓰면 화면과 인쇄본의 수식이 미묘하게 달라지고, 그 차이는 아무도 눈치채지 못한
 * 채 학생에게 나간다(ADR-0013 대안 D).
 *
 * 이 모듈은 **측정만** 하고 판정하지 않는다. 판정은
 * `@su-maek/core/export` 의 `validatePdfLayout` 이 한다 — 브라우저 없이 회귀
 * 테스트를 돌릴 수 있어야 하기 때문이다.
 *
 * 알려진 한계(정직하게 적어둔다):
 * - JS 로 잰 좌표는 브라우저가 인쇄용으로 다시 흘리기 **전** 값이다. 시험지처럼
 *   `column-count` 를 쓰는 조판에서는 세로 좌표가 인쇄 쪽 번호와 대응하지 않아
 *   페이지 경계 검사를 끈다(`checkPageSplits: false`). 묶음 보호는 CSS
 *   `break-inside: avoid` 가 맡고, 실제 확인은 시각 회귀의 몫이다.
 * - 페이지 수는 생성된 PDF 바이트에서 `/Type /Page` 를 세어 얻는다. 스트림이
 *   압축된 경우 빗나갈 수 있어 실패가 아니라 검수 신호로만 쓴다.
 */

import { type Browser, chromium } from "playwright";

import { validatePdfLayout } from "@su-maek/core/export";
import type {
  MeasuredBox,
  PdfPageGeometry,
  PdfValidationReport,
} from "@su-maek/core/export";

/** 96dpi 기준 mm → CSS px. */
const PX_PER_MM = 96 / 25.4;

/** A4 세로. */
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

/** apps/web/src/app/print/print.css 의 `@page margin` 과 같아야 한다. */
export const PRINT_MARGIN_MM = {
  top: 18,
  right: 14,
  bottom: 16,
  left: 14,
} as const;

/** 렌더러 버전 — 게시 스냅샷에 복사된다(ADR-0013 §1). */
export const PDF_RENDERER_VERSION =
  process.env["PDF_RENDERER_VERSION"] ?? "chromium-playwright-1.62";

export interface RenderPdfInput {
  /** 인쇄할 페이지 주소. `html` 과 하나만 준다. */
  readonly url?: string;
  /** 주소 대신 직접 넘기는 HTML. 테스트·미리보기용. */
  readonly html?: string;
  /** 텍스트 레이어에 반드시 있어야 하는 문자열 (보통 문항 번호). */
  readonly requiredText?: readonly string[];
  readonly expectedPageCount?: number;
  /**
   * 페이지 경계 걸침을 검사할지. 시험지는 다단이라 기본 false.
   * 단단(1단) 문서를 찍을 때만 켠다.
   */
  readonly checkPageSplits?: boolean;
  readonly timeoutMs?: number;
}

export interface RenderPdfResult {
  readonly pdf: Uint8Array;
  readonly report: PdfValidationReport;
  readonly boxes: readonly MeasuredBox[];
  readonly geometry: PdfPageGeometry;
  readonly rendererVersion: string;
}

/**
 * 인쇄 페이지를 PDF 로 찍고 레이아웃을 검증한다.
 *
 * 실패를 던지지 않고 보고서로 돌려준다 — 호출자(출력 잡)가 상태 머신에
 * `validation_failed` 로 넘겨야 하기 때문이다. 브라우저를 못 띄우는 것 같은
 * 인프라 오류만 예외가 된다.
 */
export async function renderExamPdf(
  input: RenderPdfInput,
): Promise<RenderPdfResult> {
  if (!input.url && !input.html) {
    throw new Error("renderExamPdf: url 또는 html 중 하나는 있어야 한다");
  }

  const contentWidthPx =
    (A4_WIDTH_MM - PRINT_MARGIN_MM.left - PRINT_MARGIN_MM.right) * PX_PER_MM;
  const contentHeightPx =
    (A4_HEIGHT_MM - PRINT_MARGIN_MM.top - PRINT_MARGIN_MM.bottom) * PX_PER_MM;
  const timeout = input.timeoutMs ?? 30_000;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: {
        width: Math.round(contentWidthPx),
        height: Math.round(contentHeightPx),
      },
    });

    if (input.url) {
      await page.goto(input.url, { waitUntil: "networkidle", timeout });
    } else {
      await page.setContent(input.html as string, {
        waitUntil: "networkidle",
        timeout,
      });
    }

    // 인쇄 CSS 를 적용한 상태에서 재고, 폰트가 다 온 뒤에 찍는다. 이 두 줄이
    // 없으면 폰트 대체 상태의 폭을 재거나 대체 글꼴로 인쇄된다.
    await page.emulateMedia({ media: "print" });
    // FontFaceSet 자체는 직렬화할 수 없으므로 기다리기만 하고 아무것도 돌려주지 않는다.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const boxes = await measureBoxes(page);
    const documentText = await page.evaluate(() => document.body.innerText);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: `${PRINT_MARGIN_MM.top}mm`,
        right: `${PRINT_MARGIN_MM.right}mm`,
        bottom: `${PRINT_MARGIN_MM.bottom}mm`,
        left: `${PRINT_MARGIN_MM.left}mm`,
      },
    });

    const geometry: PdfPageGeometry = {
      contentWidth: contentWidthPx,
      contentHeight: contentHeightPx,
      pageCount: countPdfPages(pdf),
    };

    const report = validatePdfLayout({
      boxes,
      geometry,
      checkPageSplits: input.checkPageSplits ?? false,
      // 텍스트 레이어 확인은 인쇄 DOM 의 실제 텍스트로 한다. Chromium 은 DOM
      // 텍스트를 PDF 텍스트 레이어로 그대로 내보내므로, 여기 없으면 PDF 에도
      // 없다 — 수식이 이미지로만 남는 사고를 이 경로로 잡는다.
      ...(input.requiredText
        ? { extractedText: documentText, requiredText: input.requiredText }
        : {}),
      ...(input.expectedPageCount !== undefined
        ? { expectedPageCount: input.expectedPageCount }
        : {}),
    });

    return {
      pdf: new Uint8Array(pdf),
      report,
      boxes,
      geometry,
      rendererVersion: PDF_RENDERER_VERSION,
    };
  } finally {
    await browser?.close();
  }
}

/**
 * 인쇄 DOM 에서 검사 대상 요소의 상자를 잰다.
 *
 * 셀렉터는 `apps/web/src/components/print/ExamPaper.tsx` 의 마크업과 짝이다.
 * 컴포넌트의 클래스 이름을 바꾸면 여기도 같이 바꿔야 한다 — 안 그러면 아무것도
 * 재지 못한 채 "문제 없음"으로 통과한다.
 */
async function measureBoxes(
  page: Awaited<ReturnType<Browser["newPage"]>>,
): Promise<MeasuredBox[]> {
  // 타입 표기는 컴파일 시점에만 쓰이므로 콜백 안에서도 그대로 쓸 수 있다.
  // 런타임 값(상수·함수)은 브라우저로 넘어가지 않으니 안에서 다 만든다.
  return page.evaluate<MeasuredBox[]>(() => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const measure = (
      element: Element,
      ref: string,
      kind: MeasuredBox["kind"],
    ): MeasuredBox => {
      const rect = element.getBoundingClientRect();
      return {
        ref,
        kind,
        top: rect.top + scrollY,
        left: rect.left + scrollX,
        width: rect.width,
        height: rect.height,
      };
    };

    const out: MeasuredBox[] = [];

    document.querySelectorAll(".exam-question").forEach((question, qIndex) => {
      const number =
        question.querySelector(".q-number")?.textContent?.trim() ?? `q${qIndex + 1}`;
      out.push(measure(question, number, "question"));

      const head = question.querySelector(".q-head");
      if (head) out.push(measure(head, `${number} 머리`, "question_head"));

      question.querySelectorAll(".choice-item").forEach((choice, cIndex) => {
        out.push(measure(choice, `${number} 선택지 ${cIndex + 1}`, "choice"));
      });
    });

    // 중첩된 .katex(예: .katex-display > .katex)는 바깥 것만 센다 — 안 그러면
    // 같은 수식을 두 번 세고 자기 자신과 겹쳤다고 신고한다.
    let eqIndex = 0;
    document.querySelectorAll(".katex").forEach((katex) => {
      if (katex.parentElement?.closest(".katex")) return;
      eqIndex += 1;
      out.push(measure(katex, `수식 ${eqIndex}`, "equation"));
    });

    document.querySelectorAll("figure").forEach((figure, index) => {
      out.push(measure(figure, `도형 ${index + 1}`, "figure"));
      const caption = figure.querySelector("figcaption");
      if (caption) out.push(measure(caption, `도형 ${index + 1} 캡션`, "caption"));
    });

    return out;
  });
}

/**
 * PDF 바이트에서 페이지 수를 센다.
 *
 * 객체 스트림이 압축돼 있으면 0 이 나올 수 있어, 세지 못하면 1 로 둔다.
 * 이 값은 검수 신호로만 쓰고 실패 판정에 쓰지 않는다.
 */
export function countPdfPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
  return matches && matches.length > 0 ? matches.length : 1;
}
