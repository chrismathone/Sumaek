import { describe, expect, it } from "vitest";
import { extractPage } from "../src/segment";
import { RPM_2022 } from "../src/profiles/rpm-2022";
import type { PageDump, Run, Span } from "../src/types";

/* ─────────────────────────────────────────────────────────────
 * 문장 안에 낀 ①을 선택지 기호로 읽던 것 — RPM 중1-1 p.147 문항 1084.
 *
 *   다음 그림에서 ① ~ ⑤의 그래프가 나타내는 식으로 옳은 것을 모두 고르면?
 *
 * 그림 위에 ①~⑤가 찍혀 있고 발문이 그것을 가리킨다. 그 ①을 기호로 읽으면
 * **그 줄부터 선택지가 되어 발문이 통째로 사라진다.** 화면에는 선택지가
 * 일곱 개(①「~」, ⑤「의 그래프가…」, 그리고 진짜 다섯) 있고 물음이 없는
 * 문항이 나갔다. 중1-2 0763도 같은 자리다.
 *
 * 지면은 둘을 **자리**로 가른다 — 진짜 기호는 줄 맨 앞에 서거나 앞엣것과
 * 26pt 넘게 떨어져 있고, 문장 안에 낀 것은 1pt도 안 떨어져 있다.
 * ───────────────────────────────────────────────────────────── */

const span = (s: Partial<Span> & Pick<Span, "text" | "x0" | "y0" | "x1" | "y1" | "font">): Span => ({
  size: 10.2,
  flags: 0,
  color: 0,
  ...s,
});

const body = (text: string, x0: number, x1: number, y1: number): Span =>
  span({ text, x0, y0: y1 - 11.1, x1, y1, font: "YDVYMjOStd12" });

const mark = (text: string, x0: number, y1: number): Span =>
  span({ text, x0, y0: y1 - 11.2, x1: x0 + 10, y1, font: "SMSSMyungJoStd-Regular" });

const math = (text: string, x0: number, x1: number, y1: number): Span =>
  span({ text, x0, y0: y1 - 12.4, x1, y1, font: "EHsang-Italic", size: 10.5 });

const HEAD = "다음 그림에서 ";
const TAIL = "의 그래프가 나타내는 식으로 옳은 것을 모두 고르면?";

const page: PageDump = {
  page: 147,
  width: 623.62,
  height: 841.89,
  spans: [
    span({ text: "1", x0: 65.2, y0: 523, x1: 72.8, y1: 543, font: "DINPro-Bold", size: 14 }),
    span({ text: "084", x0: 72.3, y0: 523, x1: 94.1, y1: 543, font: "DINPro-Bold", size: 14 }),
    /* 발문 — 「① ~ ⑤」가 문장 한가운데 낀다. 틈은 0.8pt와 -2.5pt다. */
    body(HEAD, 65.2, 127.4, 554.3),
    mark("①", 128.2, 554.4),
    body(" ~ ", 137.9, 150.2, 554.3),
    mark("⑤", 147.7, 554.4),
    body(TAIL, 157.3, 305.0, 554.3),
    /* 진짜 선택지 — 줄 맨 앞이거나 28pt 넘게 떨어져 있다 */
    mark("①", 65.2, 711.7),
    math("y=-2x", 77.9, 115.7, 711.8),
    mark("②", 144.1, 711.7),
    math("y=3x", 156.8, 188.5, 711.8),
    mark("③", 223.0, 711.7),
    math("y=4x", 235.7, 267.4, 711.8),
    mark("④", 65.2, 736.2),
    math("y=-5x", 77.9, 114.9, 736.3),
    mark("⑤", 144.1, 736.2),
    math("y=-4x", 156.8, 193.8, 736.3),
  ],
  drawings: [],
  images: [],
};

describe("문장 안에 낀 ①은 선택지 기호가 아니다", () => {
  const q = extractPage(page, RPM_2022).questions[0];
  const render = (runs: Run[]): string =>
    runs.map((r) => (r.kind === "text" ? r.text : r.latex)).join("");

  it("문항이 선다 — 전제가 성립하는지부터", () => {
    expect(q?.printedNumber).toBe("1084");
  });

  /* 여기가 물어야 할 자리다 — 기호로 읽으면 발문이 통째로 빈다 */
  it("발문이 남는다", () => {
    expect(render(q?.stem ?? [])).toContain(HEAD);
    expect(render(q?.stem ?? [])).toContain(TAIL);
  });

  it("가리키는 말도 발문에 남는다", () => {
    expect(render(q?.stem ?? [])).toContain("①");
    expect(render(q?.stem ?? [])).toContain("⑤");
  });

  it("선택지는 다섯이고 제 내용을 갖는다", () => {
    expect((q?.choices ?? []).map((c) => c.marker)).toEqual(["①", "②", "③", "④", "⑤"]);
    expect(render(q?.choices?.[0]?.runs ?? [])).toBe("y=-2x");
    expect(render(q?.choices?.[4]?.runs ?? [])).toBe("y=-4x");
  });
});
