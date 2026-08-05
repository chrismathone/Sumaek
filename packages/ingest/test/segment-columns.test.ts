import { describe, expect, it } from "vitest";
import { extractPage } from "../src/segment";
import { RPM_2022 } from "../src/profiles/rpm-2022";
import type { PageDump, Run, Span } from "../src/types";

/* ─────────────────────────────────────────────────────────────
 * 부스러기 하나가 단을 하나 더 만들던 것 — RPM 중1-1 p.70.
 *
 * 쪽마다 단 수를 문항 번호의 x좌표로 알아낸다(쪽 종류에 따라 2단·4단이라
 * 프로파일에 못 박을 수 없다). 그 x를 모으려고 인접 span을 붙이는데,
 * 「틈이 1.2pt보다 좁으면 붙인다」로만 봤더니 **뒤로 가는 것도 붙었다** —
 * 옆 단 끝의 부스러기(x=373) 다음에 오는 왼쪽 단 다음 줄 번호(x=57)는
 * 틈이 -320pt라 그 조건을 통과한다.
 *
 * 그래서 「0511」이 x=373에 있는 것으로 잡혀 그 쪽이 3단이 됐고, 오른쪽
 * 단이 x=367에서 두 쪽으로 갈렸다. 문항 0513은 발문을 통째로 잃고,
 * 0514·0515는 왼쪽 토막만 남았다 — 「어떤 유리수에 니 그 결과가」.
 *
 * 이런 부스러기(제어문자 \b가 번호 글꼴로 찍힌 것)는 이 교재에 흔하다.
 * ───────────────────────────────────────────────────────────── */

const span = (s: Partial<Span> & Pick<Span, "text" | "x0" | "y0" | "x1" | "y1" | "font">): Span => ({
  size: 10.2,
  flags: 0,
  color: 0,
  ...s,
});

/** 문항 번호 — 「0」과 「511 」이 따로 오고, 뒤에 부스러기가 붙기도 한다 */
const number = (n: string, x: number, y: number, crumbAt?: number): Span[] => [
  span({ text: "0", x0: x, y0: y, x1: x + 7.6, y1: y + 20, font: "DINPro-Bold", size: 14 }),
  span({ text: `${n} `, x0: x + 7.1, y0: y, x1: x + 35.9, y1: y + 20, font: "DINPro-Bold", size: 14 }),
  ...(crumbAt === undefined
    ? []
    : [span({ text: "\b", x0: crumbAt, y0: y, x1: crumbAt + 3.2, y1: y + 20, font: "DINPro-Bold", size: 14 })]),
];

const body = (text: string, x0: number, x1: number, y1: number): Span =>
  span({ text, x0, y0: y1 - 11.1, x1, y1, font: "YDVYMjOStd12" });

const LEFT = "왼쪽 단 문항의 발문이다. 값을 구하시오.";
const RIGHT_HEAD = "다음 안에 알맞은 수를 ";
const RIGHT_TAIL = "구하시오. 이어지는 오른쪽 끝까지의 글이다.";

/* 왼쪽 단은 x=57, 오른쪽 단은 x=321.7에서 시작한다 (실측) */
const page: PageDump = {
  page: 70,
  width: 623.62,
  height: 841.89,
  spans: [
    ...number("510", 56.7, 59.5),
    body(LEFT, 103, 287, 95.8),
    /* 오른쪽 단 첫 문항 */
    ...number("513", 321.7, 59.5),
    body(RIGHT_HEAD, 321.7, 430, 95.8),
    body(RIGHT_TAIL, 430, 558, 95.8),
    /* **부스러기.** 오른쪽 단 끝에 있고, 정렬하면 바로 다음이 왼쪽 단 번호다. */
    ...number("514", 321.7, 310.1, 373.3),
    ...number("511", 56.7, 325.3),
  ],
  drawings: [],
  images: [],
};

describe("부스러기가 단을 하나 더 만들지 않는다", () => {
  const questions = extractPage(page, RPM_2022).questions;
  const stemOf = (n: string): string =>
    (questions.find((q) => q.printedNumber === n)?.stem ?? [])
      .map((r: Run) => (r.kind === "text" ? r.text : r.latex))
      .join("");

  it("문항 넷이 선다 — 전제가 성립하는지부터", () => {
    expect(questions.map((q) => q.printedNumber).sort()).toEqual(["0510", "0511", "0513", "0514"]);
  });

  it("단은 둘이다", () => {
    expect(new Set(questions.map((q) => q.column))).toEqual(new Set([0, 1]));
  });

  /* 여기가 물어야 할 자리다 — 단이 셋이 되면 오른쪽 단이 갈려 발문이 잘린다 */
  it("오른쪽 단 발문이 끝까지 온다", () => {
    expect(stemOf("0513")).toContain(RIGHT_HEAD);
    expect(stemOf("0513")).toContain(RIGHT_TAIL);
  });

  it("왼쪽 단은 그대로다", () => {
    expect(stemOf("0510")).toContain(LEFT);
  });
});
