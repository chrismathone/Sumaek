import { describe, expect, it } from "vitest";
import { extractPage } from "../src/segment";
import { RPM_2022 } from "../src/profiles/rpm-2022";
import type { PageDump, Rect, Span } from "../src/types";

type Drawing = Rect & { fill: boolean };

/* ─────────────────────────────────────────────────────────────
 * 보기 상자가 도형으로 오인되던 것.
 *
 * 좌표는 실제 지면에서 그대로 옮겼다 — RPM 중1-2 p.36 문항 0224
 * 「다음 보기 중 옳은 것을 모두 고르시오. ㄱ. l과 m …」.
 *
 * 상자의 둥근 테두리와 「▪보기▪」 머리 장식이 벡터 뭉치로 잡혀 도형이 되면,
 * 상자 안의 글자가 전부 그림 라벨로 빠지면서 **상자가 통째로 사라진다.**
 * 오류는 나지 않는다. 문항이 「다음 보기 중 옳은 것을 고르시오」로 끝나고
 * 고를 것이 하나도 없는 채로 학생에게 나갈 뿐이다. 여섯 권에서 157개 중
 * 38개가 이렇게 없어져 있었다.
 * ───────────────────────────────────────────────────────────── */

const span = (s: Partial<Span> & Pick<Span, "text" | "x0" | "y0" | "x1" | "y1" | "font">): Span => ({
  size: 10,
  flags: 0,
  color: 0,
  ...s,
});

const line = (x0: number, y0: number, x1: number, y1: number): Drawing => ({
  x0,
  y0,
  x1,
  y1,
  fill: false,
});

/** 문항 번호 — 이게 있어야 파서가 문항으로 인정한다 */
const number = (n: string, y: number): Span[] => [
  span({ text: "0", x0: 65, y0: y, x1: 72.6, y1: y + 20, font: "DINPro-Bold", size: 14 }),
  span({ text: n, x0: 72.2, y0: y, x1: 94, y1: y + 20, font: "DINPro-Bold", size: 14 }),
];

/** 「▪보기▪」 머리 장식 + 둥근 테두리 — 넷이 모여 벡터 뭉치가 된다 */
const boxDrawings = (): Drawing[] => [
  line(66, 483, 302, 531),
  { x0: 88, y0: 481, x1: 114, y1: 489, fill: true },
  { x0: 86, y0: 480, x1: 89, y1: 485, fill: true },
  { x0: 113, y0: 480, x1: 116, y1: 485, fill: true },
];

/* 상자 바로 옆의 진짜 도형 — 이것이 있어야 뭉치가 도형 문턱(12개)을 넘는다.
 * 실제 지면이 그렇다: 상자 오른쪽에 평행선 그림이 붙어 있고, 둘이 한
 * 뭉치가 되면서 상자까지 도형으로 먹혔다. */
const nearbyFigure = (): Drawing[] =>
  Array.from({ length: 14 }, (_, i) => line(200 + i, 540 + i, 250 + i, 585 + i));

const boxSpans = (): Span[] => [
  span({ text: "보기", x0: 90, y0: 487.6, x1: 102.8, y1: 495, font: "YDVYGOStd13", size: 7.31 }),
  span({ text: "ㄱ. ", x0: 68, y0: 502.6, x1: 83.1, y1: 512, font: "YDVYMjOStd12", size: 9.75 }),
  span({ text: "l", x0: 82.7, y0: 501.5, x1: 87.2, y1: 511, font: "EHsang-Italic" }),
  span({ text: "과 ", x0: 87.2, y0: 502.6, x1: 99.1, y1: 512, font: "YDVYMjOStd12", size: 9.75 }),
  span({ text: "m", x0: 98.7, y0: 501.5, x1: 107.8, y1: 511, font: "EHsang-Italic" }),
  span({ text: "ㄴ. ", x0: 132.5, y0: 502.6, x1: 147.6, y1: 512, font: "YDVYMjOStd12", size: 9.75 }),
  span({ text: "l", x0: 147.2, y0: 501.5, x1: 151.7, y1: 511, font: "EHsang-Italic" }),
  span({ text: "과 ", x0: 151.7, y0: 502.6, x1: 163.6, y1: 512, font: "YDVYMjOStd12", size: 9.75 }),
  span({ text: "n", x0: 163.2, y0: 501.5, x1: 169.5, y1: 511, font: "EHsang-Italic" }),
];

const page = (drawings: Drawing[]): PageDump => ({
  page: 36,
  width: 612,
  height: 792,
  spans: [
    ...number("224", 450),
    span({
      text: "다음 보기 중 옳은 것을 모두 고르시오.",
      x0: 65,
      y0: 465,
      x1: 300,
      y1: 476,
      font: "YDVYMjOStd12",
      size: 9.75,
    }),
    ...boxSpans(),
    /* 옆 도형 안의 치수 라벨 — 이것이 발문으로 새면 안 된다 */
    span({ text: "55ù", x0: 215, y0: 556, x1: 229, y1: 566, font: "EHsang-Plain", size: 8 }),
  ],
  drawings,
  images: [],
});

describe("보기 상자 — 테두리를 도형으로 오인하지 않는다", () => {
  it("상자가 벡터 뭉치로 와도 보기로 읽는다", () => {
    const [q] = extractPage(page([...boxDrawings(), ...nearbyFigure()]), RPM_2022).questions;
    expect(q?.conditionBox?.label).toBe("보기");
    expect(q?.conditionBox?.items.map((i) => i.marker)).toEqual(["ㄱ", "ㄴ"]);
  });

  it("상자 안의 글자가 그림 라벨로 새지 않는다", () => {
    const [q] = extractPage(page([...boxDrawings(), ...nearbyFigure()]), RPM_2022).questions;
    expect(q?.figureLabels ?? []).not.toContain("보기");
  });

  /* **옆의 진짜 도형까지 잃으면 안 된다.** 뭉친 뒤에 걸러 내면 그렇게 된다 —
   * 상자 몫의 선만 빼고 도형은 남겨야 한다. */
  it("옆에 붙은 진짜 도형은 그대로 도형으로 남는다", () => {
    const [q] = extractPage(
      page([...boxDrawings(), ...nearbyFigure()]),
      RPM_2022,
    ).questions;
    expect((q?.figureBoxes ?? []).length).toBeGreaterThan(0);
    /* 그 도형의 치수 라벨은 그림의 것이지 발문의 것이 아니다 */
    expect(q?.figureLabels.join(" ")).toContain("55");
  });

  /* 라벨이 없으면 상자로 볼 근거가 없다 — 가름선은 라벨이다 */
  it("라벨이 없으면 상자로 읽지 않는다", () => {
    const all = page([...boxDrawings(), ...nearbyFigure()]);
    const withoutLabel: PageDump = {
      ...all,
      spans: all.spans.filter((s) => s.text !== "보기"),
    };
    const [q] = extractPage(withoutLabel, RPM_2022).questions;
    expect(q?.conditionBox).toBeNull();
  });
});
