import type { PageDump, Span } from "./types";

/** 흰색 (0xFFFFFF) */
const WHITE = 0xffffff;

/**
 * 지면에 **보이지 않는 글자**인가.
 *
 * 조판 원본에는 고쳤다가 지우지 않은 흔적이 흰 글자로 남아 있다. 눈에는
 * 안 보이지만 텍스트 층에는 그대로 있어서, 그냥 읽으면 지면에 없는 수가
 * 섞인다:
 *
 * - 별책 4쪽 `2)6`이 `2)46`이 됐다 (흰 `4`가 앞에 숨어 있었다)
 * - 별책 13쪽 표의 `2 5 6`이 `20 50 60`이 됐다 (흰 `0` 넷)
 *
 * 흰 글자라고 다 지우면 안 된다 — 「답」 배지처럼 **색을 칠한 바탕 위의**
 * 흰 글자는 지면에서 잘 보이는 진짜 글자다. 두 책을 세어 보니 흰 글자
 * 1217개 중 1205개가 칠한 바탕 위에 있었고, 맨 종이 위에 놓인 12개는
 * 전부 지워야 할 흔적이었다.
 *
 * 그래서 판정은 **바탕에 무엇이 칠해져 있는가**로 한다. 글꼴이나 내용으로
 * 거르면 다음 교재에서 다시 틀린다.
 */
export function isInvisibleInk(span: Span, page: PageDump): boolean {
  if (span.color !== WHITE) return false;
  return !page.drawings.some(
    (d) =>
      d.fill &&
      d.x0 <= span.x0 + 1 &&
      d.x1 >= span.x1 - 1 &&
      d.y0 <= span.y0 + 1 &&
      d.y1 >= span.y1 - 1,
  );
}

/** 보이지 않는 글자를 걷어 낸 span 목록 */
export function visibleSpans(page: PageDump): Span[] {
  return page.spans.filter((s) => !isInvisibleInk(s, page));
}
