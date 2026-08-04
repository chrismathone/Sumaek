import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionLine } from "@/components/learn/QuestionText";
import {
  markSymbolGlyphs,
  SYMBOL_MARK_CLOSE,
  SYMBOL_MARK_OPEN,
} from "@/lib/learn/symbol-answer";

/* ─────────────────────────────────────────────────────────────
 * 문항 글의 기호 그리기 — 발문의 ◯·△·×가 답 칩과 **같은 그림**이 된다.
 *
 * 예전에는 발문은 폰트 글리프, 칩은 SVG였다. 폰트 글리프는 ◯가 크고 ×가
 * 작게 나와, 한 문항 안에서 같은 뜻의 기호가 두 가지 모습·두 가지 무게로
 * 서 있었다(사용자 신고).
 *
 * 여기가 틀리면 표식(사설 영역 문자)이 **글자 그대로 화면에 샌다** — 학생은
 * 뜻 없는 네모를 보게 되고, 오류로 보이지 않아 조용히 남는다.
 * ───────────────────────────────────────────────────────────── */

const render = (html: string) =>
  renderToStaticMarkup(createElement(QuestionLine, { html }));

describe("QuestionLine", () => {
  it("표식을 그림으로 바꾼다 — 표식 글자는 화면에 남지 않는다", () => {
    const out = render(markSymbolGlyphs("소수이면 ◯, 합성수이면 △를 고르시오."));
    expect(out).toContain("<svg");
    expect(out).not.toContain(SYMBOL_MARK_OPEN);
    expect(out).not.toContain(SYMBOL_MARK_CLOSE);
  });

  it("기호 셋이 같은 상자·같은 선 굵기로 그려진다", () => {
    const out = render(markSymbolGlyphs("◯ △ ×"));
    expect(out.match(/viewBox="0 0 24 24"/g)).toHaveLength(3);
    expect(out.match(/stroke-width="1.75"/g)).toHaveLength(3);
    expect(out.match(/h-\[1\.05em\] w-\[1\.05em\]/g)).toHaveLength(3);
  });

  it("읽어 줄 글자를 남긴다 — 그림만 두면 발문을 못 읽는다", () => {
    const out = render(markSymbolGlyphs("옳으면 ◯를 고르시오."));
    expect(out).toContain('class="sr-only">◯<');
  });

  it("표식이 없으면 예전과 같은 HTML이 그대로 나온다", () => {
    const out = render('<span class="katex">11</span>');
    expect(out).toContain('<span class="katex">11</span>');
    expect(out).not.toContain("<svg");
  });
});
