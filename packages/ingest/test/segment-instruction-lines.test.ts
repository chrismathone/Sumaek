import { describe, expect, it } from "vitest";
import { extractPage } from "../src/segment";
import { RPM_2022 } from "../src/profiles/rpm-2022";
import type { PageDump, Run, Span } from "../src/types";

/* ─────────────────────────────────────────────────────────────
 * 공통 지시문이 **줄과 어긋나는** 세 자리.
 *
 * 이 교재는 2단인데 지시문은 단을 가로지르므로, 지시문을 찾을 때만 단을
 * 무시하고 줄을 다시 세운다. 그러면 왼쪽 단과 오른쪽 단의 글이 한 줄에
 * 섞이고, 거기서 세 가지가 어긋난다. 셋 다 지면에서 그대로 옮겼다.
 *
 * 어긋나도 **오류는 나지 않는다.** 발문이 빈 채로, 또는 옆 단의 말을 달고
 * 학생 화면까지 간다. 그래서 전수(6151문항)로만 드러났다.
 * ───────────────────────────────────────────────────────────── */

const span = (s: Partial<Span> & Pick<Span, "text" | "x0" | "y0" | "x1" | "y1" | "font">): Span => ({
  size: 9.8,
  flags: 0,
  color: 0,
  ...s,
});

/** 「[0019~0022] 」 — 지면은 표식을 다섯 조각으로 흘려보낸다 */
const marker = (from: string, to: string, x: number, y0: number, y1 = y0 + 12.9): Span[] => {
  const f = "DINPro-Bold";
  const at = (text: string, dx: number, w: number): Span =>
    span({ text, x0: x + dx, y0, x1: x + dx + w, y1, font: f, size: 9.7 });
  return [at("[", 0, 3.6), at("0", 3.2, 5.1), at(`${from}~`, 8, 20), at("0", 27.7, 5.1), at(`${to}] `, 32.4, 21.6)];
};

/** 문항 번호 — 14pt. 이게 있어야 파서가 문항으로 인정한다 */
const number = (n: string, x: number, y: number): Span[] => [
  span({ text: "0", x0: x, y0: y, x1: x + 7.6, y1: y + 17.9, font: "DINPro-Bold", size: 14 }),
  span({ text: n, x0: x + 7.1, y0: y, x1: x + 28.9, y1: y + 17.9, font: "DINPro-Bold", size: 14 }),
];

const body = (text: string, x0: number, x1: number, y1: number): Span =>
  span({ text, x0, y0: y1 - 10.4, x1, y1, font: "YDVYGOStd12" });

const page = (spans: Span[]): PageDump => ({
  page: 1,
  width: 612,
  height: 792,
  spans,
  drawings: [],
  images: [],
});

const stemsOf = (spans: Span[]): Map<string, string> => {
  const out = new Map<string, string>();
  for (const q of extractPage(page(spans), RPM_2022).questions) {
    out.set(
      q.printedNumber,
      q.stem.map((r: Run) => (r.kind === "text" ? r.text : r.latex)).join(""),
    );
  }
  return out;
};

/* ─────────────────────────────────────────────────────────────
 * ① 지시문 **안에** 대괄호가 있는 자리 — RPM 중1-1 p.9
 *
 *   [0019~0022] 다음 수를 [ ] 안의 수의 거듭제곱으로 나타내시오.
 *
 * 줄을 「[」마다 잘라 표식을 찾는다. 두 번째 「[」에서도 자르면 지시문이
 * 표식만 남고 본문이 통째로 떨어져 나간다 — 0019~0022 네 문항이 발문 없이
 * 「16[2]」 「27[3]」 처럼 숫자만 남았다.
 * ───────────────────────────────────────────────────────────── */
describe("지시문 안의 대괄호에서 자르지 않는다", () => {
  const HEAD = "다음 수를 [ ";
  const TAIL = "] 안의 수의 거듭제곱으로 나타내";
  const stems = stemsOf([
    ...marker("019", "022", 330, 108.7),
    body(HEAD, 386, 439, 121.5),
    body(TAIL, 439, 566, 121.5),
    body("시오", 330, 347, 137.1),
    body(".", 347, 351, 137.1),
    ...number("019", 330, 146.6),
    span({ text: "16", x0: 368, y0: 156, x1: 381, y1: 166, font: "EHsang-Plain", size: 8.9 }),
  ]);

  it("문항이 선다 — 전제가 성립하는지부터", () => {
    expect([...stems.keys()]).toEqual(["0019"]);
  });

  it("지시문 본문이 통째로 붙는다", () => {
    expect(stems.get("0019")).toContain(`${HEAD}${TAIL}시오.`);
  });

  it("문항 제 내용도 남는다", () => {
    expect(stems.get("0019")).toContain("16");
  });
});

/* ─────────────────────────────────────────────────────────────
 * ② 표식과 본문이 **다른 줄로 갈리는** 자리 — RPM 중2-2 p.93
 *
 * 옆 단의 14pt 문항 번호가 표식과 같은 높이에 걸리면, 줄 세우기가 큰 글자를
 * 앞세우는 바람에 표식이 그 줄로 딸려 가고 본문만 남는다:
 *
 *   줄1  [0523~0526]            0530 EG의 길이      ← 표식은 여기
 *   줄2            다음 그림에서 … x의 값을 구하시   ← 본문은 여기
 *
 * 그러면 지시문이 「[0523~0526]」 뿐이라 0523~0526 넷의 발문이 사라진다.
 *
 * **좌표를 그대로 옮겨야 재현된다.** 표식(9.7pt)의 세로 가운데가 443.85로,
 * 오른쪽 단 14pt 번호의 띠(423.9~443.9) 안에 0.05pt 차이로 든다 — 줄 세우기가
 * 위첨자로 보고 데려간다. 아래 y값을 반올림하면 이 시험은 아무것도 지키지 않는다.
 * ───────────────────────────────────────────────────────────── */
describe("표식과 본문이 갈라져도 한 줄로 읽는다", () => {
  const HEAD = "다음 그림에서 ";
  const TAIL = "의 값을 구하시";
  const stems = stemsOf([
    /* 오른쪽 단 문항 — 이 14pt 번호의 띠가 표식을 빨아들인다 */
    span({ text: "0", x0: 330.2, y0: 423.9, x1: 337.8, y1: 443.9, font: "DINPro-Bold", size: 14 }),
    span({ text: "530", x0: 337.4, y0: 423.9, x1: 359.2, y1: 443.9, font: "DINPro-Bold", size: 14 }),
    span({ text: "EG", x0: 367.8, y0: 427.8, x1: 383.5, y1: 440.8, font: "EHsang-Plain", size: 10.5 }),
    span({ text: "의 길이", x0: 383.5, y0: 429.9, x1: 413.9, y1: 441.0, font: "YDVYMjOStd12", size: 10.2 }),
    /* 왼쪽 단 지시문 — 표식과 본문 */
    ...marker("523", "526", 65.2, 436.6, 451.1),
    body(HEAD, 120.8, 177.3, 450.5),
    span({ text: "l", x0: 176.9, y0: 439.0, x1: 181.5, y1: 450.9, font: "EHsang-Italic", size: 10 }),
    span({ text: "m", x0: 189.8, y0: 439.0, x1: 198.9, y1: 450.9, font: "EHsang-Italic", size: 10 }),
    span({ text: "n", x0: 207.2, y0: 439.0, x1: 213.5, y1: 450.9, font: "EHsang-Italic", size: 10 }),
    body("일 때,", 213.5, 236.8, 450.5),
    span({ text: "x", x0: 239.4, y0: 439.0, x1: 245.4, y1: 450.9, font: "EHsang-Italic", size: 10 }),
    body(TAIL, 245.4, 301.9, 450.5),
    /* 이어지는 줄 — 여기도 오른쪽 단 번호가 같이 선다 */
    body("오", 65.2, 74.0, 474.1),
    body(".", 74.0, 78.0, 474.1),
    span({ text: "0", x0: 330.2, y0: 454.1, x1: 337.8, y1: 474.1, font: "DINPro-Bold", size: 14 }),
    span({ text: "531", x0: 337.4, y0: 454.1, x1: 359.2, y1: 474.1, font: "DINPro-Bold", size: 14 }),
    /* 왼쪽 단 첫 문항 */
    ...number("523", 65.2, 479.5),
    span({ text: "6", x0: 113, y0: 490, x1: 119, y1: 500, font: "EHsang-Plain", size: 8.9 }),
  ]);

  it("문항이 선다 — 전제가 성립하는지부터", () => {
    expect([...stems.keys()].sort()).toEqual(["0523", "0530", "0531"]);
  });

  it("표식만 남지 않고 본문이 따라온다", () => {
    expect(stems.get("0523")).toContain(HEAD);
    expect(stems.get("0523")).toContain(`${TAIL}오.`);
  });

  it("옆 단의 말은 데려오지 않는다", () => {
    expect(stems.get("0523")).not.toContain("의 길이");
  });

  it("표식은 발문에 남지 않는다", () => {
    expect(stems.get("0523")).not.toContain("0523~");
  });
});

/* ─────────────────────────────────────────────────────────────
 * ③ 지시문 둘이 **잇달아 선** 자리 — RPM 중3-2 p.47
 *
 *   줄1  ...............................  [0262~0264] 오른쪽 그림에서 원
 *   줄2  [0257~0258] 다음 그림에서 …두            D          ← 옆 단 라벨
 *   줄3  ...............................  O는 삼각형의 내접원이다.
 *   줄4  점 A, B가 접점일 때 x의 값을 구하시오.
 *
 * 앞엣것이 줄2에서 옆 단 라벨 「D」를 이어받으면 **줄2를 다 읽은 것으로 치고
 * 건너뛰었다.** 그 줄에 있던 [0257~0258]이 통째로 사라져 두 문항이 발문
 * 없이 나갔다. 이어받을 범위를 지시문 블록의 오른끝까지로 좁히고, 줄을
 * 건너뛰지 않는다.
 * ───────────────────────────────────────────────────────────── */
describe("옆 단 지시문이 낀 줄을 건너뛰지 않는다", () => {
  const RIGHT_HEAD = "오른쪽 그림에서 원 ";
  const RIGHT_TAIL = "O는 삼각형의 내접원이다.";
  const LEFT_HEAD = "다음 그림에서 접선이고 두 ";
  const LEFT_TAIL = "점 A, B가 접점일 때 x의 값을 구하시오.";
  const stems = stemsOf([
    /* 줄1 — 오른쪽 단 지시문 */
    ...marker("262", "264", 330, 305.1),
    body(RIGHT_HEAD, 386, 470, 317.9),
    /* 줄2 — 왼쪽 단 지시문 + 오른쪽 단 그림 라벨 하나 */
    ...marker("257", "258", 65, 310.9),
    body(LEFT_HEAD, 121, 305, 323.7),
    span({ text: "D", x0: 429, y0: 313.5, x1: 436, y1: 323.7, font: "EHsang-Plain", size: 10 }),
    /* 줄3 — 오른쪽 단 지시문이 이어지는 줄 */
    body(RIGHT_TAIL, 330, 470, 333.2),
    /* 줄4 — 왼쪽 단 지시문이 이어지는 줄 */
    body(LEFT_TAIL, 65, 257, 339.0),
    ...number("257", 65, 348.6),
    span({ text: "10", x0: 154, y0: 371.8, x1: 175, y1: 382, font: "EHsang-Plain", size: 8 }),
    ...number("262", 330, 387.7),
    span({ text: "AB", x0: 368, y0: 395, x1: 383, y1: 405.6, font: "EHsang-Plain", size: 10 }),
  ]);

  it("두 문항이 선다 — 전제가 성립하는지부터", () => {
    expect([...stems.keys()].sort()).toEqual(["0257", "0262"]);
  });

  /* 여기가 물어야 할 자리다 — 줄을 건너뛰면 이 지시문이 통째로 사라진다 */
  it("뒤에 선 지시문도 제 구간에 붙는다", () => {
    expect(stems.get("0257")).toContain(LEFT_HEAD);
    expect(stems.get("0257")).toContain(LEFT_TAIL);
  });

  it("앞 지시문은 옆 단 라벨이 아니라 제 아랫줄을 이어받는다", () => {
    expect(stems.get("0262")).toContain(RIGHT_HEAD);
    expect(stems.get("0262")).toContain(RIGHT_TAIL);
    expect(stems.get("0262")).not.toContain("D");
  });

  it("서로의 말을 가져가지 않는다", () => {
    expect(stems.get("0257")).not.toContain("내접원");
    expect(stems.get("0262")).not.toContain("접선");
  });
});
