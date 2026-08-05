import { describe, expect, it } from "vitest";
import { extractPage } from "../src/segment";
import { RPM_2022 } from "../src/profiles/rpm-2022";
import type { PageDump, Rect, Span } from "../src/types";

type Drawing = Rect & { fill: boolean };

/* ─────────────────────────────────────────────────────────────
 * 그림 라벨을 **가운데 한 점**으로 가르던 것 — RPM 중1-2 p.131 문항 0874.
 *
 * 「오른쪽 그림과 같은 원뿔대의 부피는?」은 152pt짜리 span 하나다. 그 가운데
 * (x=141.6)가 하필 유형 머리글 장식(x 98~130) 옆 12pt 안에 떨어져 **발문이
 * 통째로 그림 라벨이 됐다.** 화면에는 선택지만 다섯 개 있고 물음이 없는
 * 문항이 나갔다 — 오류는 나지 않는다.
 *
 * 그래서 한글 본문은 **양 끝까지** 선 곁에 있어야 라벨로 본다.
 *
 * 그런데 수식까지 그렇게 재면 안 된다. 그래프에 붙는 식 라벨과 치수는 선
 * 곁에 나란히 놓일 뿐 둘러싸이지 않아 한쪽 끝이 밖으로 나간다. 그것까지
 * 발문으로 돌리면 「상수 a의 값x-y+2=0은?」이 된다. 이 교재는 수식과 한글이
 * 글꼴로 갈리므로 그 선을 그대로 쓴다.
 * ───────────────────────────────────────────────────────────── */

const span = (s: Partial<Span> & Pick<Span, "text" | "x0" | "y0" | "x1" | "y1" | "font">): Span => ({
  size: 10.2,
  flags: 0,
  color: 0,
  ...s,
});

const line = (x0: number, y0: number, x1: number, y1: number, fill = false): Drawing => ({
  x0,
  y0,
  x1,
  y1,
  fill,
});

/** 개념 상자 · 유형 머리글 장식 · 원뿔대 — 셋이 clusterGap(14) 안에서 한 뭉치가 된다 */
const drawings = (): Drawing[] => [
  /* 개념 정리 상자 (단 폭을 가득 채운다) */
  line(65, 74, 302, 94, true),
  line(66, 86, 301, 140, true),
  line(65, 74, 115, 94, true),
  line(91, 76, 113, 92, true),
  /* 유형 머리글 장식 — 발문의 **가운데**가 이 곁에 떨어진다 */
  line(102, 152, 106, 155, true),
  line(109, 152, 112, 155, true),
  line(98, 159, 130, 166, true),
  line(100, 156, 128, 165, true),
  line(101, 157, 127, 164, true),
  line(102, 158, 126, 161, true),
  /* 원뿔대 */
  line(250, 190, 255, 204),
  line(256, 169, 273, 203),
  line(239, 230, 285, 237),
  line(262, 204, 285, 237),
  line(254, 171, 285, 237),
  line(239, 200, 285, 244),
  line(262, 194, 273, 237),
];

const STEM = "오른쪽 그림과 같은 원뿔대의 부피는?";

const page: PageDump = {
  page: 131,
  width: 612,
  height: 792,
  spans: [
    span({ text: "0", x0: 65.2, y0: 148, x1: 72.8, y1: 166, font: "DINPro-Bold", size: 14 }),
    span({ text: "874", x0: 72.3, y0: 148, x1: 94.1, y1: 166, font: "DINPro-Bold", size: 14 }),
    /* 발문 — 가운데는 장식 곁이지만 왼끝은 아무 선에서도 멀다 */
    span({ text: STEM, x0: 65.2, y0: 171.3, x1: 217.9, y1: 182.4, font: "YDVYMjOStd12" }),
    /* 치수 라벨 — 변 **바깥으로** 반쯤 나와 있다. 그래도 그림의 것이다. */
    span({ text: "8`cm", x0: 220, y0: 200, x1: 250, y1: 210, font: "EHsang-Plain", size: 8 }),
    span({ text: "6`cm", x0: 258, y0: 240, x1: 288, y1: 250, font: "EHsang-Plain", size: 8 }),
  ],
  drawings: drawings(),
  images: [],
};

describe("그림 라벨은 양 끝을 보고 가른다", () => {
  const q = extractPage(page, RPM_2022).questions[0];
  const stem = (q?.stem ?? []).map((r) => ("latex" in r ? r.latex : r.text)).join("");

  it("뭉치가 단을 가로지른다 — 전제가 성립하는지부터", () => {
    /* 개념 상자와 원뿔대가 한 뭉치가 되어야 이 시험이 시험이 된다.
     * 갈라지면 발문의 가운데가 어느 선 곁에도 없어 아무것도 지키지 않는다. */
    const box = q?.figureBoxes[0];
    expect(box).toBeDefined();
    expect(box!.x1 - box!.x0).toBeGreaterThan(200);
    expect(box!.y1 - box!.y0).toBeGreaterThan(150);
  });

  it("한글 발문은 가운데가 선 곁이어도 발문으로 남는다", () => {
    expect(stem).toContain(STEM);
    expect(q?.figureLabels ?? []).not.toContain(STEM);
  });

  /* **치수까지 발문으로 돌리면 안 된다.** 라벨은 변 바깥으로 반쯤 나오므로
   * 양 끝을 따지면 그림 밖으로 새어 나간다 — 수식 글꼴은 가운데로 잰다. */
  it("치수 라벨은 한쪽 끝이 나가 있어도 그림의 것이다", () => {
    expect(q?.figureLabels ?? []).toEqual(expect.arrayContaining(["8cm", "6cm"]));
    expect(stem).not.toContain("cm");
  });
});
