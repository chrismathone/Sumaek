import { describe, expect, it } from "vitest";
import { extractPage } from "../src/segment";
import { RPM_2022 } from "../src/profiles/rpm-2022";
import type { PageDump, Span } from "../src/types";

/* ─────────────────────────────────────────────────────────────
 * 한 기준선에 공통 지시문이 둘 서는 자리.
 *
 * 좌표는 실제 지면을 본떴다 — RPM 중3-2 p.29에서 왼쪽 단 `[0146~0148]`과
 * 오른쪽 단 `[0156~0159]`가 같은 높이에서 시작한다. 단을 무시하고 줄을
 * 세우면(공통 지시문은 단을 가로지르므로 그래야 한다) 이렇게 보인다:
 *
 *   [0146~0148] 오른쪽 그림과 같이 A[0156~0159] 다음 평행사변형의 넓이를…
 *
 * 표식을 하나만 찾으면 **뒤엣것이 통째로 사라진다.** 지시문에 지면상 걸친
 * 첫 문항만 우연히 글자를 받고 나머지는 발문이 빈 채로 나간다 — 0156은
 * 받았고 0157·0158·0159는 빈 문항이었다. 여섯 권에서 열넷이 이랬다.
 * ───────────────────────────────────────────────────────────── */

const span = (s: Partial<Span> & Pick<Span, "text" | "x0" | "y0" | "x1" | "y1" | "font">): Span => ({
  size: 9.75,
  flags: 0,
  color: 0,
  ...s,
});

/** 「[0156~0159]」 — 지면은 이걸 다섯 조각으로 흘려보낸다 */
const marker = (from: string, to: string, x: number, y: number): Span[] => {
  const f = "DINPro-Bold";
  return [
    span({ text: "[", x0: x, y0: y, x1: x + 4, y1: y + 12, font: f, size: 8 }),
    span({ text: "0", x0: x + 3, y0: y, x1: x + 9, y1: y + 12, font: f, size: 8 }),
    span({ text: `${from}~`, x0: x + 8, y0: y, x1: x + 28, y1: y + 12, font: f, size: 8 }),
    span({ text: "0", x0: x + 28, y0: y, x1: x + 33, y1: y + 12, font: f, size: 8 }),
    span({ text: `${to}] `, x0: x + 33, y0: y, x1: x + 52, y1: y + 12, font: f, size: 8 }),
  ];
};

/** 문항 번호 — 이게 있어야 파서가 문항으로 인정한다 */
const number = (n: string, x: number, y: number): Span[] => [
  span({ text: "0", x0: x, y0: y, x1: x + 8, y1: y + 20, font: "DINPro-Bold", size: 14 }),
  span({ text: n, x0: x + 7, y0: y, x1: x + 29, y1: y + 20, font: "DINPro-Bold", size: 14 }),
];

const LEFT = "오른쪽 그림과 같이 다음 물음에 답하시오.";
const RIGHT = "다음 평행사변형의 넓이를 구하시오.";

const page: PageDump = {
  page: 29,
  width: 612,
  height: 792,
  spans: [
    /* 같은 기준선(y1=145)에 지시문 둘 — 왼쪽 단과 오른쪽 단 */
    ...marker("146", "148", 65, 133),
    span({ text: LEFT, x0: 121, y0: 134, x1: 300, y1: 145, font: "YDVYGOStd12" }),
    ...marker("156", "159", 386, 133),
    span({ text: RIGHT, x0: 442, y0: 134, x1: 600, y1: 145, font: "YDVYGOStd12" }),
    /* 왼쪽 단 문항 하나, 오른쪽 단 문항 둘 */
    ...number("146", 65, 180),
    span({ text: "BH의 길이", x0: 103, y0: 186, x1: 200, y1: 197, font: "YDVYMjOStd12" }),
    ...number("156", 386, 180),
    span({ text: "10", x0: 442, y0: 186, x1: 456, y1: 197, font: "EHsang-Italic", size: 8 }),
    ...number("157", 386, 240),
    span({ text: "4", x0: 442, y0: 246, x1: 449, y1: 257, font: "EHsang-Italic", size: 8 }),
  ],
  drawings: [],
  images: [],
};

describe("한 기준선에 공통 지시문이 둘", () => {
  const questions = extractPage(page, RPM_2022).questions;
  const stemOf = (n: string): string =>
    (questions.find((q) => q.printedNumber === n)?.stem ?? [])
      .map((r) => ("latex" in r ? r.latex : r.text))
      .join("");

  it("셋 다 문항으로 선다 — 전제가 성립하는지부터", () => {
    expect(questions.map((q) => q.printedNumber).sort()).toEqual(["0146", "0156", "0157"]);
  });

  it("앞 지시문이 제 구간에 붙는다", () => {
    expect(stemOf("0146")).toContain(LEFT);
  });

  /* 여기가 물어야 할 자리다 — 첫 표식만 찾으면 이 둘이 빈다 */
  it("뒤 지시문도 제 구간에 붙는다", () => {
    expect(stemOf("0156")).toContain(RIGHT);
    expect(stemOf("0157")).toContain(RIGHT);
  });

  it("남의 지시문을 받아 가지 않는다", () => {
    expect(stemOf("0146")).not.toContain(RIGHT);
    expect(stemOf("0156")).not.toContain(LEFT);
  });

  /* 「[0156~0159]」는 묶음을 가리키는 표식이지 문제의 말이 아니다 */
  it("표식은 발문에 남지 않는다", () => {
    expect(stemOf("0156")).not.toContain("0156~");
    expect(stemOf("0146")).not.toContain("0146~");
  });
});
