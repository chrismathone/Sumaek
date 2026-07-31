import { describe, expect, it } from "vitest";

import { countPdfPages, renderExamPdf } from "../../src/export/pdf-renderer";

/* ─────────────────────────────────────────────────────────────
 * PDF 렌더러 — 실제 Chromium 을 띄운다.
 *
 * 순수 판정 규칙은 `@su-maek/core` 쪽 pdf-validate 테스트가 맡는다. 여기서
 * 확인하는 것은 브라우저를 실제로 몰았을 때의 배선이다: 인쇄 CSS 가 먹는지,
 * 측정 셀렉터가 정말 요소를 잡는지, 텍스트 레이어 확인이 DOM 텍스트를 보는지.
 *
 * 웹 앱 서버 없이 돌 수 있게 `html` 입력으로 최소 마크업을 넣는다 — 서버가
 * 필요한 검증은 시각 회귀(태스크 #17)의 몫이다.
 * ───────────────────────────────────────────────────────────── */

/** ExamPaper 가 내는 클래스 구조만 흉내 낸 최소 마크업. */
const SAMPLE_HTML = `
<html lang="ko"><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: sans-serif; }
  .exam-question { margin-bottom: 12px; }
  .q-head { display: flex; gap: 6px; }
  .choice-item { display: flex; gap: 6px; }
  .katex { display: inline-block; min-width: 20px; min-height: 14px; }
</style></head>
<body>
  <div class="exam-question">
    <div class="q-head"><span class="q-number">1.</span><span>다음을 계산하시오.</span></div>
    <span class="katex">x&sup2;+1</span>
    <div class="choice-item"><span>①</span><span class="katex">2</span></div>
    <div class="choice-item"><span>②</span><span class="katex">3</span></div>
  </div>
  <div class="exam-question">
    <div class="q-head"><span class="q-number">2.</span><span>서술하시오.</span></div>
  </div>
</body></html>`;

describe("PDF 렌더러 — Chromium 배선", () => {
  it("PDF 바이트를 만든다", async () => {
    const result = await renderExamPdf({ html: SAMPLE_HTML });
    expect(Buffer.from(result.pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(result.pdf.length).toBeGreaterThan(1000);
  });

  it("문항·선택지·수식 상자를 실제로 잰다", async () => {
    const { boxes } = await renderExamPdf({ html: SAMPLE_HTML });
    const kinds = boxes.map((b) => b.kind);
    expect(kinds).toContain("question");
    expect(kinds).toContain("question_head");
    expect(kinds).toContain("choice");
    expect(kinds).toContain("equation");

    expect(boxes.filter((b) => b.kind === "question")).toHaveLength(2);
    expect(boxes.filter((b) => b.kind === "choice")).toHaveLength(2);
    // 중첩 .katex 를 두 번 세지 않는다.
    expect(boxes.filter((b) => b.kind === "equation")).toHaveLength(3);
  });

  it("잰 상자에 실제 크기가 들어 있다", async () => {
    const { boxes } = await renderExamPdf({ html: SAMPLE_HTML });
    for (const box of boxes) {
      expect(box.width, box.ref).toBeGreaterThan(0);
      expect(box.height, box.ref).toBeGreaterThan(0);
    }
  });

  it("문항 번호를 참조 이름으로 쓴다", async () => {
    const { boxes } = await renderExamPdf({ html: SAMPLE_HTML });
    expect(boxes.some((b) => b.ref === "1.")).toBe(true);
    expect(boxes.some((b) => b.ref === "2.")).toBe(true);
  });

  it("정상 마크업은 검증을 통과한다", async () => {
    const result = await renderExamPdf({ html: SAMPLE_HTML });
    expect(result.report.status).toBe("passed");
  });

  it("본문 폭을 넘는 요소를 잡는다", async () => {
    const overflowing = SAMPLE_HTML.replace(
      '<span class="katex">x&sup2;+1</span>',
      '<span class="katex" style="display:inline-block;width:2000px">넘침</span>',
    );
    const result = await renderExamPdf({ html: overflowing });
    expect(result.report.status).toBe("failed");
    expect(result.report.issues.map((i) => i.code)).toContain(
      "horizontal_overflow",
    );
  });

  it("텍스트 레이어에 본문 텍스트가 남는다", async () => {
    const result = await renderExamPdf({
      html: SAMPLE_HTML,
      requiredText: ["다음을 계산하시오.", "서술하시오."],
    });
    expect(result.report.status).toBe("passed");
  });

  it("텍스트 레이어에 없는 문자열을 요구하면 실패한다", async () => {
    const result = await renderExamPdf({
      html: SAMPLE_HTML,
      requiredText: ["이 문장은 문서에 없다"],
    });
    expect(result.report.status).toBe("failed");
    expect(result.report.issues.map((i) => i.code)).toContain(
      "missing_text_layer",
    );
  });

  it("렌더러 버전을 함께 돌려준다", async () => {
    const result = await renderExamPdf({ html: SAMPLE_HTML });
    expect(result.rendererVersion).toMatch(/chromium/);
  });

  it("url 도 html 도 없으면 거부한다", async () => {
    await expect(renderExamPdf({})).rejects.toThrow(/url 또는 html/);
  });
});

describe("PDF 페이지 수 세기", () => {
  it("한 쪽짜리 문서를 1 로 센다", async () => {
    const { geometry } = await renderExamPdf({ html: SAMPLE_HTML });
    expect(geometry.pageCount).toBe(1);
  });

  it("여러 쪽 문서를 여러 쪽으로 센다", async () => {
    const tall = SAMPLE_HTML.replace(
      "</body>",
      '<div style="height:3000px"></div></body>',
    );
    const { geometry } = await renderExamPdf({ html: tall });
    expect(geometry.pageCount).toBeGreaterThan(1);
  });

  it("PDF 로 보이지 않는 바이트는 1 로 떨어뜨린다", () => {
    // 세지 못했다고 0 쪽이라고 답하면 뒤 계산이 전부 틀어진다.
    expect(countPdfPages(new TextEncoder().encode("not a pdf"))).toBe(1);
  });
});
