import { describe, expect, it } from "vitest";
import { extractConceptPages } from "../src/concepts";
import { KWR_2022, KWR_M11_CH1_TARGETS, conceptTargetKey } from "../src/profiles/kwr-2022";
import { isInvisibleInk } from "../src/ink";
import type { PageDump, SourceDump, Span } from "../src/types";

/* ─────────────────────────────────────────────────────────────
 * 개념서 파서 회귀 검사.
 *
 * 여기 박은 좌표·폰트는 전부 실제 PDF(개념원리 중1-1 교사용)에서 실측해
 * 옮긴 축소판이다. 각 검사는 실제로 한 번씩 틀렸던 것을 지킨다 —
 * 덤프 자체는 구매자 워터마크·저작권 문제로 저장소에 둘 수 없으므로
 * (handoff.md 참조) 합성 fixture로 재현한다.
 * ───────────────────────────────────────────────────────────── */

let nextY = 0;
function span(partial: Partial<Span> & { text: string }): Span {
  nextY += 1;
  return {
    x0: 120,
    y0: partial.y0 ?? nextY * 20,
    x1: partial.x1 ?? 300,
    y1: (partial.y0 ?? nextY * 20) + 10,
    font: "YDVYGOStd12",
    size: 9.26,
    flags: 0,
    color: 0,
    ...partial,
  };
}

function page(no: number, spans: Span[], drawings: PageDump["drawings"] = []): PageDump {
  return { page: no, width: 609.45, height: 807.87, spans, drawings, images: [] };
}

function dumpOf(...pages: PageDump[]): SourceDump {
  return {
    source: { fileName: "t.pdf", checksum: "x", pageCount: pages.length, extractedRange: [1, 9] },
    pages,
  };
}

/** 실측 축소판 — 소단원 + 번호 배지 + 제목 줄 + 본문 두 줄 */
function conceptPage(no: number): PageDump {
  return page(no, [
    span({ text: "소인수분해", font: "SDGyeokdongGL2-eBd", size: 27, x0: 122, y0: 52, x1: 260, y1: 79 }),
    /* 번호는 색 배지 위 **흰 글자**다 — 배지 도형이 글리프 상자를 다 덮지
     * 못해도 잡혀야 한다 (isInvisibleInk를 타면 안 되는 자리) */
    span({ text: "1", font: "DINPro-Bold", size: 19, color: 0xffffff, x0: 128.5, y0: 108, x1: 138.8, y1: 135.1 }),
    span({ text: "소수와 합성수란 무엇인가?", font: "YDVYGOStd14", size: 10.34, x0: 153.6, y0: 120.5, x1: 263, y1: 131.9 }),
    span({ text: " 핵심문제 01, 02", font: "YDVYGOStd13", size: 7.31, x0: 482, y0: 121.9, x1: 530, y1: 130.1 }),
    span({ text: "⑴ 소수：약수가 2개인 수", x0: 117.5, y0: 154, x1: 400, y1: 164 }),
    span({ text: "이어지는 설명 줄", x0: 141, y0: 170, x1: 380, y1: 180 }),
  ]);
}

describe("개념 블록 추출", () => {
  it("소단원·번호·제목·상호참조를 제자리에서 읽는다", () => {
    const { concepts } = extractConceptPages(dumpOf(conceptPage(10)), KWR_2022);
    expect(concepts).toHaveLength(1);
    const c = concepts[0]!;
    expect(c.subsection).toBe("소인수분해");
    expect(c.no).toBe("1"); // 흰 글자 번호 배지 — 잉크 판정을 우회해야 잡힌다
    expect(c.title).toBe("소수와 합성수란 무엇인가?");
    expect(c.xref).toContain("핵심문제 01");
  });

  it("항목 머리가 아닌 줄은 앞 문단에 줄바꿈으로 이어진다", () => {
    const { concepts } = extractConceptPages(dumpOf(conceptPage(10)), KWR_2022);
    const paras = concepts[0]!.paragraphs;
    expect(paras).toHaveLength(1); // ⑴줄 + 이어지는 줄 = 한 문단
    expect(paras[0]!.lines).toHaveLength(2); // 줄바꿈은 보존
  });

  it("구매자 워터마크는 이메일·아이디 단독 꼴 모두 거른다", () => {
    const p = conceptPage(10);
    p.spans.push(
      span({ text: "st2000423@gmail.com", font: "Helvetica", size: 8, y0: 300 }),
      /* p.11에서 실측 — 도메인 없이 아이디만 찍히는 변형 */
      span({ text: "st2000423", font: "Helvetica", size: 8, y0: 320 }),
    );
    const { concepts } = extractConceptPages(dumpOf(p), KWR_2022);
    const all = JSON.stringify(concepts);
    expect(all).not.toContain("st2000423");
  });

  it("문제 구역 배지 뒤의 줄은 개념에 담지 않는다", () => {
    const p = conceptPage(10);
    p.spans.push(
      span({ text: "개념원리", font: "GangwonEduPowerExtraBold", size: 18, x0: 62, y0: 200, x1: 125, y1: 219 }),
      span({ text: "확인하기 문제 본문", y0: 230 }),
    );
    const { concepts } = extractConceptPages(dumpOf(p), KWR_2022);
    expect(JSON.stringify(concepts)).not.toContain("확인하기 문제 본문");
  });

  it("허용목록 밖의 쪽은 본문을 읽지 않는다", () => {
    const bad = page(12, [span({ text: "문제 쪽의 글줄", y0: 100 })]);
    const { concepts } = extractConceptPages(dumpOf(conceptPage(10), bad), KWR_2022, {
      conceptPages: [10],
    });
    expect(JSON.stringify(concepts)).not.toContain("문제 쪽의 글줄");
  });

  it("강의Plus 상자는 본문이 아니라 교사 주석으로 간다", () => {
    const p = conceptPage(10);
    p.spans.push(
      span({ text: "강의", font: "YDVYGOStd23", size: 7.5, x0: 423, y0: 156, x1: 440, y1: 165 }),
      span({ text: "소수(小數)와 착각하지 않도록 주의한다.", size: 7, x0: 420, y0: 168, x1: 500, y1: 176 }),
    );
    p.drawings.push({ x0: 416, y0: 160, x1: 502, y1: 189, fill: false });
    const { concepts } = extractConceptPages(dumpOf(p), KWR_2022);
    const c = concepts[0]!;
    expect(c.teacherNotes.join(" ")).toContain("착각하지 않도록");
    expect(JSON.stringify(c.paragraphs)).not.toContain("착각하지");
  });

  it("상자 없는 강의Plus(배지+작은 글)는 근접 캡처한다 — p.17 지도목표", () => {
    const p = conceptPage(10);
    p.spans.push(
      span({ text: "강의", font: "YDVYGOStd23", size: 7.5, x0: 393, y0: 86, x1: 410, y1: 95 }),
      span({ text: "약수와 약수의 개수를 구할 수 있게 한다.", size: 6.8, x0: 390, y0: 98, x1: 540, y1: 106 }),
    );
    const { concepts } = extractConceptPages(dumpOf(p), KWR_2022);
    expect(concepts[0]!.teacherNotes.join(" ")).toContain("약수의 개수를 구할 수 있게");
  });

  it("본문 오른쪽의 곁블록은 본문 줄과 섞지 않는다", () => {
    const p = conceptPage(10);
    p.spans.push(
      span({ text: "❶ 각 수를 소인수분해 한다.", x0: 133, y0: 200, x1: 310, y1: 210 }),
      /* 오른쪽에 나란히 선 계산 — 같은 y지만 다른 블록이다 */
      span({ text: "18=2_3Û`", font: "EHsang-Italic", size: 9.5, x0: 451, y0: 200, x1: 520, y1: 210 }),
    );
    const { concepts } = extractConceptPages(dumpOf(p), KWR_2022);
    const paras = concepts[0]!.paragraphs;
    const bodyText = JSON.stringify(paras.filter((x) => x.kind === "body"));
    expect(bodyText).toContain("소인수분해 한다");
    expect(bodyText).not.toContain("3^{2}");
    const aside = paras.find((x) => x.kind === "aside");
    expect(aside).toBeDefined();
  });
});

describe("개념 → 정본 매핑 표", () => {
  it("1단원 개념 8자리가 전부 표에 있다", () => {
    const keys = [
      ["소인수분해", "1"], ["소인수분해", "2"], ["소인수분해", "3"],
      ["소인수분해를 이용하여 약수 구하기", "1"],
      ["공약수와 최대공약수", "1"], ["공약수와 최대공약수", "2"],
      ["공배수와 최소공배수", "1"], ["공배수와 최소공배수", "2"],
    ] as const;
    for (const [sub, no] of keys) {
      expect(
        KWR_M11_CH1_TARGETS.get(conceptTargetKey(sub, no)),
        `${sub}|${no}`,
      ).toBeDefined();
    }
  });
});

describe("흰 글자 판정 (배지 캡슐)", () => {
  const base = page(1, []);

  it("여러 조각이 이어 덮은 흰 글자는 보이는 글자다 — 참고 배지", () => {
    /* p.10 실측: 캡슐이 세 조각이라 어느 하나도 두 글자를 다 덮지 못한다 */
    const s = span({ text: "참고", color: 0xffffff, x0: 133.34, y0: 257.49, x1: 145.87, y1: 265.13 });
    const p = {
      ...base,
      drawings: [
        { x0: 135.07, y0: 256.13, x1: 144.43, y1: 265.49, fill: true },
        { x0: 130.39, y0: 256.13, x1: 139.75, y1: 265.49, fill: true },
        { x0: 139.46, y0: 256.13, x1: 148.82, y1: 265.49, fill: true },
      ],
    };
    expect(isInvisibleInk(s, p)).toBe(false);
  });

  it("맨 종이 위 흰 글자는 흔적이다 — 지운다", () => {
    const s = span({ text: "4", color: 0xffffff, y0: 100 });
    expect(isInvisibleInk(s, base)).toBe(true);
  });

  it("조각 사이가 벌어져 있으면 덮은 것이 아니다", () => {
    const s = span({ text: "참고", color: 0xffffff, x0: 100, y0: 50, x1: 140, y1: 60 });
    const p = {
      ...base,
      drawings: [
        { x0: 98, y0: 49, x1: 110, y1: 61, fill: true },
        { x0: 130, y0: 49, x1: 142, y1: 61, fill: true }, // 가운데 20pt가 비었다
      ],
    };
    expect(isInvisibleInk(s, p)).toBe(true);
  });
});
