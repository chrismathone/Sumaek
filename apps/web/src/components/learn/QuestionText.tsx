"use client";

import { SYMBOL_MARK_CLOSE, SYMBOL_MARK_OPEN } from "@/lib/learn/symbol-answer";

/* ─────────────────────────────────────────────────────────────
 * 문항 글 한 줄 — 발문 속 기호를 답 칩과 **같은 그림으로** 그린다.
 *
 * 기호 칩의 그림은 **글자가 아니라 도형이다.**
 *
 * ◯(U+25EF)·△(U+25B3)·×(U+00D7)는 폰트마다 글리프 크기가 제각각이다. 같은
 * font-size를 줘도 ◯는 크고 ×는 작게 나와, 문항마다·칩마다 무게가 눈에 띄게
 * 들쭉날쭉했다(실측). 이모지(⭕🔺❌)는 더 나쁘다 — OS마다 모양·색이 다르고
 * 색이 박혀 있어 잉크 색을 따르지 않는다.
 *
 * 같은 24×24 상자에 같은 선 굵기로 그리면 어디에 놓이든 같은 무게가 된다.
 * 색은 currentColor라 눌림 상태·테마를 그대로 따르고, 크기는 em이라 발문
 * 글자 크기를 따라간다. 제출 값은 여전히 기호 문자 그대로다(채점이 문자열을
 * 본다) — 바뀐 것은 보이는 그림뿐이다.
 * ───────────────────────────────────────────────────────────── */

export function SymbolGlyph({
  symbol,
  className = "h-6 w-6",
}: {
  symbol: string;
  className?: string;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      {symbol === "◯" && <circle cx="12" cy="12" r="8.25" {...common} />}
      {symbol === "△" && <path d="M12 3.9 L20.4 19 L3.6 19 Z" {...common} />}
      {symbol === "×" && (
        <path d="M6.2 6.2 L17.8 17.8 M17.8 6.2 L6.2 17.8" {...common} />
      )}
    </svg>
  );
}

/* 글 속에 놓이는 기호. 글자 대신 그림이 서므로 **읽어 줄 글자를 남긴다** —
 * 그림만 두면 스크린리더가 발문의 「소수이면 ◯」를 「소수이면」으로 읽고,
 * 글로 찾는 테스트도 문장을 못 찾는다. */
function InlineSymbol({ symbol }: { symbol: string }) {
  return (
    <span className="inline-flex items-center align-[-0.15em]">
      <SymbolGlyph symbol={symbol} className="h-[1.05em] w-[1.05em]" />
      <span className="sr-only">{symbol}</span>
    </span>
  );
}

const MARK_RE = new RegExp(`${SYMBOL_MARK_OPEN}(.)${SYMBOL_MARK_CLOSE}`, "g");

/**
 * 렌더가 끝난 문항 HTML 한 줄. 기호 표식(markSymbolGlyphs가 심는다)만
 * 그림으로 바꾸고 나머지는 그대로 낸다.
 *
 * 표식이 없으면 갈래가 하나뿐이라 예전과 똑같은 HTML이 나온다.
 */
export function QuestionLine({ html }: { html: string }) {
  /* 캡처가 있는 split은 잡힌 글자도 배열에 남긴다 — 짝수 자리는 HTML,
   * 홀수 자리는 기호다. */
  const parts = html.split(MARK_RE);
  return (
    <p>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <InlineSymbol key={i} symbol={part} />
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: part }} />
        ),
      )}
    </p>
  );
}
