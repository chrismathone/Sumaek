import { describe, expect, it } from "vitest";

import { validatePdfLayout } from "../../src/export";
import type {
  MeasuredBox,
  PdfIssueCode,
  PdfPageGeometry,
} from "../../src/export";

/* ─────────────────────────────────────────────────────────────
 * PDF 레이아웃 검증 (ADR-0013 §5).
 *
 * 브라우저를 띄우지 않고 판정 규칙만 검사한다 — 측정과 판정을 분리해 둔 이유가
 * 바로 이것이다. 실제 Chromium 측정은 워커가 하고, 여기서는 "이런 상자가 나오면
 * 이렇게 판정해야 한다"를 고정한다.
 * ───────────────────────────────────────────────────────────── */

/** A4 세로, 여백 안쪽 영역을 96dpi CSS px 로 잡은 값. */
const A4: PdfPageGeometry = {
  contentWidth: 640,
  contentHeight: 950,
  pageCount: 1,
};

function box(overrides: Partial<MeasuredBox> = {}): MeasuredBox {
  return {
    ref: "q1",
    kind: "question",
    top: 0,
    left: 0,
    width: 200,
    height: 40,
    ...overrides,
  };
}

function codes(report: ReturnType<typeof validatePdfLayout>): PdfIssueCode[] {
  return report.issues.map((i) => i.code);
}

describe("PDF 레이아웃 검증 — 정상", () => {
  it("본문 안에 얌전히 놓인 상자들은 통과한다", () => {
    const report = validatePdfLayout({
      boxes: [
        box({ ref: "q1", kind: "question", top: 0, height: 120 }),
        box({ ref: "q1-head", kind: "question_head", top: 0, height: 20 }),
        box({ ref: "e1", kind: "equation", top: 24, left: 40, width: 80, height: 24 }),
      ],
      geometry: A4,
    });
    expect(report.status).toBe("passed");
    expect(report.issues).toEqual([]);
    expect(report.metrics.equationCount).toBe(1);
    expect(report.metrics.maxOverflow).toBe(0);
  });

  it("상자가 하나도 없어도 통과한다", () => {
    expect(validatePdfLayout({ boxes: [], geometry: A4 }).status).toBe("passed");
  });

  it("본문 폭에 딱 맞는 상자는 넘침이 아니다", () => {
    const report = validatePdfLayout({
      boxes: [box({ left: 0, width: A4.contentWidth })],
      geometry: A4,
    });
    expect(report.status).toBe("passed");
  });
});

describe("PDF 레이아웃 검증 — 가로 넘침", () => {
  it("오른쪽으로 벗어나면 잡는다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "e1", kind: "equation", left: 600, width: 100 })],
      geometry: A4,
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("horizontal_overflow");
    expect(report.metrics.maxOverflow).toBeCloseTo(60, 1);
  });

  it("왼쪽으로 벗어나도 잡는다", () => {
    const report = validatePdfLayout({
      boxes: [box({ left: -20, width: 100 })],
      geometry: A4,
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("horizontal_overflow");
  });

  it("허용 오차 안의 미세한 넘침은 넘어간다", () => {
    // ±2 pt 는 브라우저·프린터 차이로 늘 생긴다. 이걸 실패로 보면 아무것도
    // 통과하지 못한다.
    const report = validatePdfLayout({
      boxes: [box({ left: 0, width: A4.contentWidth + 2 })],
      geometry: A4,
    });
    expect(report.status).toBe("passed");
  });

  it("어느 요소가 얼마나 넘쳤는지 알려준다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "choice-3", kind: "choice", left: 500, width: 200 })],
      geometry: A4,
    });
    expect(report.issues[0]?.message).toContain("choice-3");
    expect(report.issues[0]?.message).toContain("60.0px");
  });
});

describe("PDF 레이아웃 검증 — 페이지 경계", () => {
  it("선택지가 페이지 경계에 걸치면 잡는다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "c1", kind: "choice", top: 930, height: 40 })],
      geometry: A4,
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("page_split");
    expect(report.issues[0]?.message).toContain("1쪽→2쪽");
  });

  it("수식이 페이지 경계에 걸치면 잡는다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "e1", kind: "equation", top: 940, height: 30 })],
      geometry: A4,
    });
    expect(codes(report)).toContain("page_split");
  });

  it("문항 번호-첫 줄 묶음이 갈라지면 잡는다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "q7-head", kind: "question_head", top: 945, height: 20 })],
      geometry: A4,
    });
    expect(codes(report)).toContain("page_split");
  });

  it("문항 전체는 길면 페이지를 넘어가도 된다", () => {
    // 긴 문항이 두 쪽에 걸치는 것 자체는 정상이다. 갈라지면 안 되는 것은 묶음이다.
    const report = validatePdfLayout({
      boxes: [box({ ref: "q7", kind: "question", top: 900, height: 200 })],
      geometry: A4,
    });
    expect(report.status).toBe("passed");
  });

  it("경계에 정확히 닿기만 한 요소는 통과한다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "c1", kind: "choice", top: 910, height: 40 })],
      geometry: A4,
    });
    expect(report.status).toBe("passed");
  });

  it("다단 조판에서는 경계 검사를 끄면 신고하지 않는다", () => {
    // 다단에서는 JS 로 잰 세로 좌표가 인쇄 쪽 번호와 대응하지 않는다.
    const split = box({ ref: "c1", kind: "choice", top: 930, height: 40 });
    expect(validatePdfLayout({ boxes: [split], geometry: A4 }).status).toBe("failed");
    expect(
      validatePdfLayout({ boxes: [split], geometry: A4, checkPageSplits: false }).status,
    ).toBe("passed");
  });

  it("경계 검사를 꺼도 넘침·크기 0 은 계속 잡는다", () => {
    const report = validatePdfLayout({
      boxes: [
        box({ ref: "c1", kind: "choice", top: 930, height: 40 }),
        box({ ref: "e1", kind: "equation", width: 0, height: 0 }),
      ],
      geometry: A4,
      checkPageSplits: false,
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toEqual(["zero_size"]);
  });

  it("둘째 쪽 안에 있는 요소는 통과한다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "c1", kind: "choice", top: 1000, height: 40 })],
      geometry: { ...A4, pageCount: 2 },
    });
    expect(report.status).toBe("passed");
  });
});

describe("PDF 레이아웃 검증 — 크기 0 과 겹침", () => {
  it("크기 0 인 수식을 잡는다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "e1", kind: "equation", width: 0, height: 0 })],
      geometry: A4,
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("zero_size");
  });

  it("높이만 0 이어도 잡는다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "e1", kind: "equation", width: 50, height: 0 })],
      geometry: A4,
    });
    expect(codes(report)).toContain("zero_size");
  });

  it("수식이 아닌 요소의 크기 0 은 보지 않는다", () => {
    // 빈 캡션 자리 같은 것은 정상이다.
    const report = validatePdfLayout({
      boxes: [box({ ref: "cap", kind: "caption", width: 0, height: 0 })],
      geometry: A4,
    });
    expect(report.status).toBe("passed");
  });

  it("수식끼리 겹치면 잡는다", () => {
    const report = validatePdfLayout({
      boxes: [
        box({ ref: "e1", kind: "equation", top: 100, left: 0, width: 100, height: 30 }),
        box({ ref: "e2", kind: "equation", top: 110, left: 50, width: 100, height: 30 }),
      ],
      geometry: A4,
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("overlap");
    expect(report.issues[0]?.message).toContain("e1");
    expect(report.issues[0]?.message).toContain("e2");
  });

  it("나란히 붙어 있기만 한 수식은 겹침이 아니다", () => {
    const report = validatePdfLayout({
      boxes: [
        box({ ref: "e1", kind: "equation", top: 100, left: 0, width: 100, height: 30 }),
        box({ ref: "e2", kind: "equation", top: 100, left: 100, width: 100, height: 30 }),
      ],
      geometry: A4,
    });
    expect(report.status).toBe("passed");
  });

  it("세로로만 떨어져 있으면 겹침이 아니다", () => {
    const report = validatePdfLayout({
      boxes: [
        box({ ref: "e1", kind: "equation", top: 100, left: 0, width: 100, height: 30 }),
        box({ ref: "e2", kind: "equation", top: 140, left: 0, width: 100, height: 30 }),
      ],
      geometry: A4,
    });
    expect(report.status).toBe("passed");
  });
});

describe("PDF 레이아웃 검증 — 텍스트 레이어", () => {
  it("필수 문자열이 텍스트 레이어에 없으면 잡는다", () => {
    // 수식이 이미지로만 남으면 여기서 걸린다 — 복사도 스크린리더도 안 된다.
    const report = validatePdfLayout({
      boxes: [],
      geometry: A4,
      extractedText: "1. 다음을 계산하시오.",
      requiredText: ["1. 다음을 계산하시오.", "x^2 - 5x + 6 = 0"],
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("missing_text_layer");
  });

  it("필수 문자열이 다 있으면 통과한다", () => {
    const report = validatePdfLayout({
      boxes: [],
      geometry: A4,
      extractedText: "1. 다음을 계산하시오. x^2",
      requiredText: ["1.", "x^2"],
    });
    expect(report.status).toBe("passed");
  });

  it("추출 텍스트를 주지 않으면 검사를 건너뛴다", () => {
    const report = validatePdfLayout({
      boxes: [],
      geometry: A4,
      requiredText: ["없는 문자열"],
    });
    expect(report.status).toBe("passed");
  });
});

describe("PDF 레이아웃 검증 — 페이지 수", () => {
  it("기대와 다르면 검수 대상으로 올린다", () => {
    const report = validatePdfLayout({
      boxes: [],
      geometry: { ...A4, pageCount: 3 },
      expectedPageCount: 2,
    });
    // 조판이 밀린 것이지 파일이 깨진 것은 아니다.
    expect(report.status).toBe("review_required");
    expect(codes(report)).toContain("page_count");
  });

  it("치명 문제가 함께 있으면 failed 가 우선한다", () => {
    const report = validatePdfLayout({
      boxes: [box({ ref: "e1", kind: "equation", width: 0, height: 0 })],
      geometry: { ...A4, pageCount: 3 },
      expectedPageCount: 2,
    });
    expect(report.status).toBe("failed");
  });
});
