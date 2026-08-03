import { describe, expect, it } from "vitest";
import {
  hasStructuredBlocks,
  readingContent,
  structuredContentBlock,
} from "../src/content";

/* ─────────────────────────────────────────────────────────────
 * 읽기 블록 어휘 — 두 가지를 지킨다:
 * 1. 이미 반입된 본문(text·paragraph, latex-only 수식)이 계약을 통과한다.
 *    계약이 현실을 위반으로 만들면 기존 8건이 하루아침에 불량이 된다.
 * 2. 문항 union은 이 작업으로 변하지 않는다.
 * ───────────────────────────────────────────────────────────── */

describe("readingContent — 하위 호환", () => {
  it("반입 파이프라인이 만든 본문(paragraph + \\n 런 + latex-only 수식)이 통과한다", () => {
    const extracted = [
      {
        type: "paragraph",
        runs: [
          { kind: "text", text: "⑴ 거듭제곱: 같은 수를 거듭하여 곱한 것" },
          { kind: "text", text: "\n" },
          { kind: "math", math: { latex: "5\\times 5\\times 5=5^{3}" } },
        ],
      },
      { type: "text", text: "참고" },
    ];
    expect(readingContent.safeParse(extracted).success).toBe(true);
  });

  it("expressionId가 있어도(문항 스타일 수식) 통과한다", () => {
    const body = [
      {
        type: "paragraph",
        runs: [
          {
            kind: "math",
            math: {
              expressionId: "01890b2c-0000-7000-8000-000000000000",
              latex: "2^{4}",
            },
          },
        ],
      },
    ];
    expect(readingContent.safeParse(body).success).toBe(true);
  });
});

describe("readingContent — 구조 블록", () => {
  it("정의·핵심정리·콜아웃·단계·사선 표가 함께 통과한다", () => {
    const refined = [
      {
        type: "definition",
        term: "거듭제곱",
        content: [{ kind: "text", text: "같은 수를 여러 번 곱해 간단히 나타낸 것" }],
      },
      {
        type: "key_point",
        title: "밑과 지수",
        items: [
          [
            { kind: "math", math: { latex: "5^{3}" } },
            { kind: "text", text: " — 곱한 수 5가 밑, 곱한 횟수 3이 지수" },
          ],
        ],
      },
      {
        type: "callout",
        tone: "example",
        content: [
          {
            type: "paragraph",
            runs: [{ kind: "math", math: { latex: "2\\times 2=2^{2}" } }],
          },
        ],
      },
      {
        type: "steps",
        title: "소인수분해하는 방법",
        items: [
          { content: [{ kind: "text", text: "나누어떨어지는 소수로 나눈다" }] },
          { content: [{ kind: "text", text: "몫이 소수가 될 때까지 나눈다" }] },
        ],
      },
      {
        type: "math_table",
        rows: [
          [
            { kind: "text", text: "1", emphasis: "struck" },
            { kind: "text", text: "2", emphasis: "bold" },
          ],
        ],
        caption: "에라토스테네스의 체",
      },
    ];
    const parsed = readingContent.safeParse(refined);
    expect(parsed.success).toBe(true);
  });

  it("콜아웃 속 콜아웃은 계약이 막는다 (중첩 1단)", () => {
    const nested = [
      {
        type: "callout",
        tone: "note",
        content: [
          { type: "callout", tone: "example", content: [] },
        ],
      },
    ];
    expect(readingContent.safeParse(nested).success).toBe(false);
  });

  it("빈 latex 수식은 막는다 — 조용한 빈칸이 곧 조용한 누락이다", () => {
    const body = [
      { type: "display_math", math: { latex: "" } },
    ];
    expect(readingContent.safeParse(body).success).toBe(false);
  });

  it("표 셀: kind와 값의 일치를 계약이 강제한다", () => {
    // math 셀에 math가 없으면 거부 — 빈 display 수식이 셀을 부풀린다
    expect(
      readingContent.safeParse([
        { type: "math_table", rows: [[{ kind: "math" }]] },
      ]).success,
    ).toBe(false);
    // empty 셀의 유령 text는 parse가 벗겨 낸다
    const parsed = readingContent.parse([
      {
        type: "math_table",
        rows: [[{ kind: "empty", text: "보이면 안 되는 값" }]],
      },
    ]);
    const cell = (parsed[0] as { rows: Record<string, unknown>[][] }).rows[0]![0]!;
    expect("text" in cell).toBe(false);
    // colspan 폭주 방지
    expect(
      readingContent.safeParse([
        {
          type: "math_table",
          rows: [[{ kind: "text", text: "1", colspan: 999 }]],
        },
      ]).success,
    ).toBe(false);
  });

  it("heading·display_math·image_crop도 파싱된다 (10종 완비)", () => {
    const body = [
      { type: "heading", level: 2, runs: [{ kind: "text", text: "소제목" }] },
      { type: "display_math", math: { latex: "x^{2}" } },
      {
        type: "image_crop",
        assetId: "01890b2c-0000-7000-8000-000000000000",
        altText: "수형도",
      },
    ];
    expect(readingContent.safeParse(body).success).toBe(true);
  });

  it("빈 문자열 텍스트 런은 막는다 (줄바꿈 런은 통과)", () => {
    expect(
      readingContent.safeParse([
        { type: "paragraph", runs: [{ kind: "text", text: "" }] },
      ]).success,
    ).toBe(false);
    expect(
      readingContent.safeParse([
        { type: "paragraph", runs: [{ kind: "text", text: "\n" }] },
      ]).success,
    ).toBe(true);
  });
});

describe("hasStructuredBlocks — 평문 편집 잠금 기준", () => {
  it("text·paragraph만이면 거짓 (기존 본문은 계속 평문 편집 가능)", () => {
    expect(
      hasStructuredBlocks([
        { type: "paragraph", runs: [] },
        { type: "text", text: "x" },
      ]),
    ).toBe(false);
  });

  it("구조 블록이 하나라도 있으면 참", () => {
    expect(
      hasStructuredBlocks([
        { type: "paragraph", runs: [] },
        { type: "definition", term: "밑", content: [{ kind: "text", text: "x" }] },
      ]),
    ).toBe(true);
  });

  it("배열이 아니면(비어 있으면) 거짓", () => {
    expect(hasStructuredBlocks(null)).toBe(false);
    expect(hasStructuredBlocks(undefined)).toBe(false);
  });
});

describe("문항 union 불변", () => {
  it("문항 블록 계약은 읽기 블록을 받지 않는다", () => {
    const definitionInQuestion = {
      type: "definition",
      term: "거듭제곱",
      content: [{ kind: "text", text: "…" }],
    };
    expect(structuredContentBlock.safeParse(definitionInQuestion).success).toBe(
      false,
    );
  });
});
