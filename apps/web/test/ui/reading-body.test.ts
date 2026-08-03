import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadingBody } from "@/components/materials/ReadingBody";

/* ─────────────────────────────────────────────────────────────
 * 읽기 본문 렌더러 — 계약↔렌더러 정합 회귀.
 *
 * 적대 검토에서 나온 실제 결함들을 고정한다: 이웃한 수식 런의 글루 오독
 * (다행 수식이 끼면 두 수식이 통째로 사라졌다), caption·term의 `$…$`가
 * 리터럴로 나오던 것, empty 셀의 유령 text, 프로토타입 키 톤.
 * ───────────────────────────────────────────────────────────── */

const render = (body: unknown, mode: "publish" | "authoring" = "publish") =>
  renderToStaticMarkup(createElement(ReadingBody, { body, mode }));

describe("ReadingBody", () => {
  it("이웃한 수식 런은 둘 다 렌더된다 — 다행 수식이 끼어도", () => {
    const html = render([
      {
        type: "paragraph",
        runs: [
          { kind: "math", math: { latex: "\\begin{cases}x+y=3\\\\\nx-y=1\\end{cases}" } },
          { kind: "math", math: { latex: "x=2" } },
        ],
      },
    ]);
    // 글루(`$a$$b$`)로 오독되면 publish 모드에서 둘 다 빈 문자열이 된다.
    // KaTeX annotation에 원본 TeX가 남으므로 그것으로 확인한다.
    expect(html).toContain("\\end{cases}");
    expect(html).toContain("x=2");
  });

  it("caption·정의 term 속 $…$는 수식으로 렌더된다", () => {
    const html = render([
      { type: "definition", term: "$a^{n}$ 꼴", content: [{ kind: "text", text: "정의문" }] },
      {
        type: "math_table",
        caption: "$x^{2}$의 값",
        rows: [[{ kind: "text", text: "1" }]],
      },
    ]);
    expect(html).not.toContain("$a^{n}$");
    expect(html).not.toContain("$x^{2}$");
    expect(html).toContain("katex");
  });

  it("empty 셀은 kind가 뜻이다 — 유령 text를 그리지 않는다", () => {
    const html = render([
      {
        type: "math_table",
        rows: [[{ kind: "empty", text: "보이면 안 되는 값" }]],
      },
    ]);
    expect(html).not.toContain("보이면 안 되는 값");
  });

  it("프로토타입 키 톤(constructor)은 참고 톤으로 폴백한다", () => {
    const html = render([
      {
        type: "callout",
        tone: "constructor",
        content: [{ type: "paragraph", runs: [{ kind: "text", text: "본문" }] }],
      },
    ]);
    expect(html).not.toContain("undefined");
    expect(html).toContain("참고");
  });

  it("알 수 없는 블록: 검수자에게는 보이고 학생에게는 빠진다", () => {
    const body = [{ type: "mystery_block" }];
    expect(render(body, "authoring")).toContain("알 수 없는 블록");
    expect(render(body, "publish")).not.toContain("알 수 없는 블록");
  });
});
