import { describe, expect, it } from "vitest";
import { extractPage } from "../src/segment";
import { RPM_2022 } from "../src/profiles/rpm-2022";
import type { PageDump, Run, Span } from "../src/types";

/* ─────────────────────────────────────────────────────────────
 * 연립방정식의 큰 중괄호.
 *
 * 좌표는 실제 지면에서 그대로 옮겼다 — RPM 중2-1 p.87 문항 0588
 * 「x, y가 자연수일 때, 연립방정식 {x+y=8 / 3x+y=16}의 해를 …」.
 * 이 배치를 못 읽으면 두 식이 `x+y=83x+y=16`으로 이어 붙는다. 렌더가
 * 실패해서 눈에 띈 것이 다행이었을 뿐, 8과 3이 붙어 83이 된 것이 진짜
 * 문제다 — 통과했다면 학생은 없는 식을 풀었을 것이다.
 * ───────────────────────────────────────────────────────────── */

const span = (s: Partial<Span> & Pick<Span, "text" | "x0" | "y0" | "x1" | "y1" | "font">): Span => ({
  size: 10.2,
  flags: 0,
  color: 0,
  ...s,
});

const page = (spans: Span[]): PageDump => ({
  page: 87,
  width: 612,
  height: 792,
  spans,
  drawings: [],
  images: [],
});

const render = (runs: Run[]): string =>
  runs.map((r) => (r.kind === "text" ? r.text : `$${r.latex}$`)).join("");

/** 문항 번호 — 이게 있어야 파서가 문항으로 인정한다 */
const number = (n: string, y: number): Span[] => [
  span({ text: "0", x0: 330.2, y0: y, x1: 337.8, y1: y + 20, font: "DINPro-Bold", size: 14 }),
  span({ text: n, x0: 337.4, y0: y, x1: 359.2, y1: y + 20, font: "DINPro-Bold", size: 14 }),
];

describe("연립방정식 — 큰 중괄호와 두 줄", () => {
  it("중괄호 오른쪽 위아래 두 식을 cases로 묶는다", () => {
    const got = extractPage(
      page([
        ...number("588", 471.6),
        span({ text: "연립방정식 ", x0: 386.1, y0: 478.1, x1: 502.1, y1: 489.2, font: "YDVYMjOStd12" }),
        span({ text: "x+y=8", x0: 509.1, y0: 468.5, x1: 546.9, y1: 481.0, font: "EHsang-Italic", size: 10.5 }),
        span({ text: "[", x0: 502.04, y0: 470.16, x1: 507.03, y1: 494.09, font: "EHboNA-Plain", size: 10.23 }),
        span({ text: "3x+y=16", x0: 509.1, y0: 484.5, x1: 557.4, y1: 497.0, font: "EHsang-Italic", size: 10.5 }),
        span({ text: "의 해를 구하시오.", x0: 557.5, y0: 478.1, x1: 570.0, y1: 489.2, font: "YDVYMjOStd12" }),
      ]),
      RPM_2022,
    );
    expect(render(got.questions[0]!.stem)).toContain(
      "$\\begin{cases}x+y=8 \\\\ 3x+y=16\\end{cases}$",
    );
  });

  it("키 큰 소괄호는 연립이 아니다 — 분수를 감싼 괄호까지 묶으면 지수가 통째로 사라진다", () => {
    /* 지면은 `(y/x)³` 한 덩어리다. 괄호는 연립의 것과 생김새가 같지만
     * (폭 5pt · 높이 24pt) 여는 **소**괄호이므로 건드리지 않는다. */
    const got = extractPage(
      page([
        ...number("161", 471.6),
        span({ text: "{", x0: 502.04, y0: 470.16, x1: 507.03, y1: 494.09, font: "EHboNA-Plain", size: 10.23 }),
        span({ text: "y", x0: 509.1, y0: 468.5, x1: 516.0, y1: 481.0, font: "EHsang-Italic", size: 10.5 }),
        span({ text: "x", x0: 509.1, y0: 484.5, x1: 516.0, y1: 497.0, font: "EHsang-Italic", size: 10.5 }),
      ]),
      RPM_2022,
    );
    expect(render(got.questions[0]!.stem)).not.toContain("begin{cases}");
  });
});
