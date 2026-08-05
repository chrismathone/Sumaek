import { describe, expect, it } from "vitest";
import { extractPage } from "../src/segment";
import { RPM_2022 } from "../src/profiles/rpm-2022";
import type { PageDump, Rect, Span } from "../src/types";

type Drawing = Rect & { fill: boolean };

/* ─────────────────────────────────────────────────────────────
 * 그림 뭉치가 발문을 삼키던 것.
 *
 * 좌표는 실제 지면에서 그대로 옮겼다 — RPM 중1-1 p.125 문항 0918
 * 「다음 점을 오른쪽 좌표평면 위에 나타내시오.」
 *
 * 좌표평면 격자는 x=217~302에만 있는데, 그 왼쪽 답 쓰는 칸 선
 * (x=65~203)이 clusterGap(14) 안으로 들어와 **한 뭉치가 된다.** 뭉치의
 * 바깥 사각형은 그 순간 단을 가로지르고(너비 237), 그 띠에 걸친 발문이
 * 통째로 그림 라벨이 된다. 화면에는 **아무것도 없는 문항**이 나간다.
 *
 * 여섯 권에서 이렇게 빈 문항이 71개였다. 오류는 나지 않는다 — 렌더 검사도
 * 통과한다. 빈 것은 깨진 것이 아니기 때문이다.
 *
 * 그래서 판정을 바깥 사각형이 아니라 **뭉치 안의 선 하나하나**에 댄다.
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

/** 좌표평면 격자 — 지면은 9pt 칸을 촘촘히 그린다 (x 217~302, y 501~586) */
const gridDrawings = (): Drawing[] => {
  const out: Drawing[] = [];
  for (let i = 0; i < 10; i += 1) {
    for (let j = 0; j < 10; j += 1) {
      out.push(line(217 + i * 8.5, 501 + j * 8.5, 217 + (i + 1) * 8.5, 501 + (j + 1) * 8.5));
    }
  }
  return out;
};

/** 답 쓰는 칸 — 격자에서 14pt 떨어져 있어 같은 뭉치로 붙는다 */
const answerBox = (): Drawing => line(65, 537, 203, 601);

const STEM_HEAD = "다음 점을 오른쪽 좌표평";
const STEM_TAIL = "면 위에 나타내시오.";

const page = (drawings: Drawing[]): PageDump => ({
  page: 125,
  width: 612,
  height: 792,
  spans: [
    span({ text: "0", x0: 65, y0: 493, x1: 72.6, y1: 513, font: "DINPro-Bold", size: 14 }),
    span({ text: "918", x0: 72.2, y0: 493, x1: 94, y1: 513, font: "DINPro-Bold", size: 14 }),
    /* 발문 두 줄 — 둘 다 격자의 y 범위에 걸쳐 있다 */
    span({ text: STEM_HEAD, x0: 103, y0: 499, x1: 205, y1: 510, font: "YDVYMjOStd12", size: 9.75 }),
    span({ text: STEM_TAIL, x0: 65, y0: 515, x1: 147, y1: 526, font: "YDVYMjOStd12", size: 9.75 }),
    /* 그림 안의 축 이름 — 이건 그림의 것이다 */
    span({ text: "y", x0: 254, y0: 497, x1: 258, y1: 505, font: "EHsang-Italic", size: 8 }),
    span({ text: "O", x0: 252, y0: 542, x1: 258, y1: 550, font: "EHsang-Plain", size: 8 }),
    span({ text: "2", x0: 274, y0: 543, x1: 278, y1: 551, font: "EHsang-Italic", size: 8 }),
  ],
  drawings,
  images: [],
});

describe("그림 뭉치가 발문을 삼키지 않는다", () => {
  const questions = extractPage(page([...gridDrawings(), answerBox()]), RPM_2022).questions;
  const q = questions[0];
  const stem = (q?.stem ?? []).map((r) => ("latex" in r ? r.latex : r.text)).join("");

  it("뭉치의 바깥 사각형은 단을 가로지른다 — 전제가 성립하는지부터", () => {
    /* 이 전제가 깨지면 아래 검사는 아무것도 지키지 않는다. 격자와 답 칸이
     * 한 뭉치가 되어야 이 시험이 시험이 된다. */
    const box = q?.figureBoxes[0];
    expect(box).toBeDefined();
    expect(box!.x1 - box!.x0).toBeGreaterThan(200);
  });

  it("발문이 남는다", () => {
    expect(stem).toContain(STEM_HEAD);
    expect(stem).toContain(STEM_TAIL);
  });

  it("발문이 그림 라벨로 넘어가지 않는다", () => {
    expect(q?.figureLabels.join(" ") ?? "").not.toContain("나타내시오");
  });

  /* **그림 라벨까지 잃으면 안 된다.** 선에서 떨어졌다고 다 발문으로 돌려
   * 보내면 예전 결함(라벨이 발문으로 새는 것)으로 되돌아간다. */
  it("그림 안의 축 이름은 그대로 그림의 것이다", () => {
    expect(q?.figureLabels ?? []).toEqual(expect.arrayContaining(["y", "O", "2"]));
    expect(stem).not.toContain("O");
  });
});
