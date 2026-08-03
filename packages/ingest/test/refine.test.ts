import { describe, expect, it } from "vitest";
import {
  bodyToMixedText,
  checkRefined,
  findCopiedSpans,
  findFabricatedNumbers,
  findLeaks,
  normalizeRefinedBlocks,
  refineOutput,
} from "../src/refine";

/* ─────────────────────────────────────────────────────────────
 * 정제 게이트 — 재서술의 위험 둘(지어내기·베끼기)과 유출 차단.
 * 게이트가 못 잡는 것은 조용히 학생에게 간다 — 각 검사가 실제로 잡는지
 * 고정된 예로 확인한다.
 * ───────────────────────────────────────────────────────────── */

const sourceBody = [
  {
    type: "paragraph",
    runs: [
      { kind: "text", text: "⑴ 거듭제곱: 같은 수나 문자를 거듭하여 곱한 것을 간단히 나타낸 것" },
      { kind: "text", text: "\n" },
      { kind: "math", math: { latex: "5\\times 5\\times 5=5^{3}" } },
      { kind: "text", text: " 예 " },
      { kind: "math", math: { latex: "2\\times 2=2^{2}" } },
    ],
  },
];

function refinedWith(runs: unknown[], title = "거듭제곱 읽는 법") {
  return refineOutput.parse({
    title,
    blocks: [{ type: "paragraph", runs }],
  });
}

describe("findFabricatedNumbers — 지어내기", () => {
  it("원본에 없는 수를 잡는다 (모델이 계산해 준 2^4=16 같은 것)", () => {
    const refined = [
      {
        type: "paragraph",
        runs: [{ kind: "math", math: { latex: "2^{4}=16" } }],
      },
    ];
    const found = findFabricatedNumbers(sourceBody, refined);
    expect(found).toContain("16");
    expect(found).toContain("4");
  });

  it("원본에 있는 수는 경고하지 않는다", () => {
    const refined = [
      {
        type: "paragraph",
        runs: [
          { kind: "math", math: { latex: "5^{3}" } },
          { kind: "text", text: " 그리고 " },
          { kind: "math", math: { latex: "2^{2}" } },
        ],
      },
    ];
    expect(findFabricatedNumbers(sourceBody, refined)).toEqual([]);
  });

  it("허용 목록은 없다 — 작은 수도 원본에 없으면 잡는다 (\"답은 1\" 프리패스 방지)", () => {
    const refined = [
      { type: "paragraph", runs: [{ kind: "text", text: "답은 1입니다" }] },
    ];
    expect(findFabricatedNumbers(sourceBody, refined)).toEqual(["1"]);
  });

  it("key_point items·표 셀 속 수식까지 걷는다 — 블록 종류가 늘어도 구멍이 없어야 한다", () => {
    const refined = [
      {
        type: "key_point",
        items: [[{ kind: "math", math: { latex: "7^{9}" } }]],
      },
    ];
    const found = findFabricatedNumbers(sourceBody, refined);
    expect(found).toContain("7");
    expect(found).toContain("9");
  });
});

describe("findCopiedSpans — 베끼기", () => {
  it("15자 이상 연속 일치를 잡는다", () => {
    const refined = [
      {
        type: "paragraph",
        runs: [
          {
            kind: "text",
            text: "거듭제곱이란 같은 수나 문자를 거듭하여 곱한 것을 간단히 나타낸 것입니다.",
          },
        ],
      },
    ];
    const spans = findCopiedSpans(sourceBody, refined);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]).toContain("같은 수나 문자를 거듭하여");
  });

  it("재서술(짧은 용어 일치만)은 잡지 않는다", () => {
    const refined = [
      {
        type: "paragraph",
        runs: [
          {
            kind: "text",
            text: "거듭제곱은 똑같은 수를 여러 번 곱할 때 쓰는 간단한 표기법입니다.",
          },
        ],
      },
    ];
    expect(findCopiedSpans(sourceBody, refined)).toEqual([]);
  });

  it("수 목록의 쉼표 텍스트런(', , , ,')은 표절이 아니다 — 글자 없는 일치는 세지 않는다", () => {
    const listSource = [
      {
        type: "paragraph",
        runs: [
          { kind: "math", math: { latex: "2" } },
          { kind: "text", text: ", " },
          { kind: "math", math: { latex: "3" } },
          { kind: "text", text: ", " },
          { kind: "math", math: { latex: "5" } },
          { kind: "text", text: ", " },
          { kind: "math", math: { latex: "7" } },
          { kind: "text", text: ", " },
          { kind: "math", math: { latex: "11" } },
          { kind: "text", text: ", " },
          { kind: "math", math: { latex: "13" } },
          { kind: "text", text: ", " },
          { kind: "math", math: { latex: "17" } },
          { kind: "text", text: ", " },
          { kind: "math", math: { latex: "19" } },
        ],
      },
    ];
    // 정제본도 수를 나열하면 ", "가 여덟 번 — 낱말이 없으니 일치가 아니다
    expect(findCopiedSpans(listSource, listSource)).toEqual([]);
  });

  it("수식은 비교하지 않는다 — 수식은 지면과 같아야 한다", () => {
    const refined = [
      {
        type: "display_math",
        math: { latex: "5\\times 5\\times 5=5^{3}" },
      },
    ];
    expect(findCopiedSpans(sourceBody, refined)).toEqual([]);
  });
});

describe("findLeaks — 유출 차단", () => {
  it("구매자 워터마크(이메일·아이디 단독)를 잡는다", () => {
    expect(
      findLeaks(
        [{ type: "text", text: "문의: st2000423@gmail.com" }],
        "제목",
        [],
      ),
    ).toHaveLength(1);
    expect(
      findLeaks([{ type: "text", text: "st2000423 소장본" }], "제목", []),
    ).toHaveLength(1);
  });

  it("출판사·교재명 노출을 잡는다 (제목 포함)", () => {
    expect(
      findLeaks([{ type: "text", text: "본문" }], "개념원리식 소인수분해", [
        "개념원리",
      ]),
    ).toHaveLength(1);
  });

  it("깨끗한 본문은 통과한다", () => {
    expect(
      findLeaks([{ type: "text", text: "소인수분해를 배웁니다" }], "소인수분해", [
        "개념원리",
      ]),
    ).toEqual([]);
  });
});

describe("checkRefined — 게이트 묶음", () => {
  it("렌더 안 되는 수식을 renderFailures로 보고한다", () => {
    const refined = refinedWith([
      { kind: "math", math: { latex: "\\notacommand{5}" } },
    ]);
    const check = checkRefined({ sourceBody, refined, leakNames: [] });
    expect(check.renderFailures).toHaveLength(1);
  });

  it("정상 초안: 차단 0 · 렌더 실패 0", () => {
    const refined = refinedWith([
      { kind: "text", text: "똑같은 수를 여러 번 곱하면 " },
      { kind: "math", math: { latex: "5^{3}" } },
      { kind: "text", text: "처럼 간단히 씁니다." },
    ]);
    const check = checkRefined({ sourceBody, refined, leakNames: ["개념원리"] });
    expect(check.blockers).toEqual([]);
    expect(check.renderFailures).toEqual([]);
  });

  it("한국어 단위 \\text{배}·≈는 렌더 실패가 아니다 — 검수 플래그와 렌더 실패를 섞지 않는다", () => {
    /* 예전 게이트는 processExpression의 status를 봤고, 그 status는 문항
     * 검수 플래그(수식 내 한글·≈)까지 묶어서 정상 수식을 반려했다. */
    const refined = refinedWith([
      { kind: "math", math: { latex: "\\frac{1}{2}\\text{배}" } },
      { kind: "text", text: " 그리고 " },
      { kind: "math", math: { latex: "\\pi \\approx 3.14" } },
    ]);
    const check = checkRefined({ sourceBody, refined, leakNames: [] });
    expect(check.renderFailures).toEqual([]);
  });

  it("display_math는 display 모드로 검사한다 — align 환경이 통과한다", () => {
    const refined = refineOutput.parse({
      title: "정리",
      blocks: [
        {
          type: "display_math",
          math: { latex: "\\begin{aligned} a &= 5 \\\\ b &= 2 \\end{aligned}" },
        },
      ],
    });
    const check = checkRefined({ sourceBody, refined, leakNames: [] });
    expect(check.renderFailures).toEqual([]);
  });

  it("text 필드 속 홀수 $는 실패다 — 산문이 수식으로 삼켜진다", () => {
    const refined = refinedWith([
      { kind: "text", text: "정가 $ 를 계산하면" },
    ]);
    const check = checkRefined({ sourceBody, refined, leakNames: [] });
    expect(check.renderFailures.some((f) => f.includes("홀수"))).toBe(true);
  });

  it("교사 주석 전사는 베끼기 경고로 잡힌다 — 주석은 본문 밖에 있어도", () => {
    const refined = refinedWith([
      {
        kind: "text",
        text: "고대 그리스의 수학자 에라토스테네스가 발견한 이 방법은 체로 거른다.",
      },
    ]);
    const withNotes = checkRefined({
      sourceBody,
      refined,
      leakNames: [],
      teacherNotes: [
        "고대 그리스의 수학자 에라토스테네스가 발견한 이 방법은 마치 체를 이용하여…",
      ],
    });
    expect(withNotes.warnings.some((w) => w.kind === "copied_span")).toBe(true);
    // 주석을 안 넘기면 구조적으로 못 잡는다 — 그것이 이 인자가 있는 이유
    const without = checkRefined({ sourceBody, refined, leakNames: [] });
    expect(without.warnings.some((w) => w.kind === "copied_span")).toBe(false);
  });

  it("제목도 지어내기 검사 대상이다", () => {
    const refined = refineOutput.parse({
      title: "1024를 만드는 법",
      blocks: [{ type: "paragraph", runs: [{ kind: "text", text: "본문" }] }],
    });
    const check = checkRefined({ sourceBody, refined, leakNames: [] });
    expect(
      check.warnings.some(
        (w) => w.kind === "fabricated_number" && w.detail.includes("1024"),
      ),
    ).toBe(true);
  });
});

describe("findLeaks — 우회 변형", () => {
  it("런 경계로 쪼갠 워터마크·교재명도 잡는다 (렌더러는 붙여서 그린다)", () => {
    expect(
      findLeaks(
        [
          { type: "paragraph", runs: [
            { kind: "text", text: "문의: buyer2024@" },
            { kind: "text", text: "school.kr" },
          ] },
        ],
        "제목",
        [],
      ),
    ).toHaveLength(1);
    expect(
      findLeaks(
        [
          { type: "paragraph", runs: [
            { kind: "text", text: "이 단원은 개념" },
            { kind: "text", text: "원리 교재에서" },
          ] },
        ],
        "제목",
        ["개념원리"],
      ),
    ).toHaveLength(1);
  });

  it("대소문자·구분자 변형을 잡는다", () => {
    expect(findLeaks([{ type: "text", text: "ST2000423 소장" }], "제목", []))
      .toHaveLength(1);
    expect(findLeaks([{ type: "text", text: "st-2000423" }], "제목", []))
      .toHaveLength(1);
    expect(findLeaks([{ type: "text", text: "Visang 교재" }], "제목", ["VISANG"]))
      .toHaveLength(1);
  });

  it("차단 사유에 워터마크 원문을 싣지 않는다 — 로그도 유출 경로다", () => {
    const leaks = findLeaks(
      [{ type: "text", text: "st2000423@gmail.com" }],
      "제목",
      [],
    );
    expect(leaks[0]).not.toContain("gmail");
  });
});

describe("normalizeRefinedBlocks — 저장본 = 검사본", () => {
  it("고아 명령(sqrt{)을 복구해 저장한다 — 화면 렌더에는 그 복구가 없다", () => {
    const normalized = normalizeRefinedBlocks([
      { type: "display_math", math: { latex: "sqrt{2}" } },
    ] as never) as { math: { latex: string } }[];
    expect(normalized[0]!.math.latex).toContain("\\sqrt");
  });
});

describe("bodyToMixedText — 프롬프트에 싣는 추출본", () => {
  it("문단·수식·줄바꿈이 읽을 수 있는 혼합 텍스트가 된다", () => {
    const text = bodyToMixedText(sourceBody);
    expect(text).toContain("$5\\times 5\\times 5=5^{3}$");
    expect(text).toContain("\n");
    expect(text).toContain("⑴ 거듭제곱");
  });
});
