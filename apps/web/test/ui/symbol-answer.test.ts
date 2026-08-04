import { describe, expect, it } from "vitest";
import {
  adaptInstructionForChoice,
  markSymbolGlyphs,
  splitInstructionLine,
  SYMBOL_MARK_CLOSE,
  SYMBOL_MARK_OPEN,
  symbolOptionsFromBodyText,
} from "@/lib/learn/symbol-answer";

const mark = (s: string) => `${SYMBOL_MARK_OPEN}${s}${SYMBOL_MARK_CLOSE}`;

/* 판별 문항의 화면 적응 — 지면 발문(써넣으시오)을 고르기 발문으로 표시
 * 전환하고, 칩은 발문이 언급한 기호만 낸다. RPM 1단원의 실제 발문 세 꼴을
 * 그대로 쓴다. */

describe("판별 문항 발문의 고르기 전환", () => {
  it("「를 ()안에 써넣으시오」가 「를 고르시오」가 되고 답 빈칸 꼬리가 사라진다", () => {
    expect(
      adaptInstructionForChoice(
        "다음 수가 소수이면 ◯, 합성수이면 △를 ()안에 써넣으시오. $11$()",
      ),
    ).toBe("다음 수가 소수이면 ◯, 합성수이면 △를 고르시오. $11$");
  });

  it("괄호 앞 띄어쓰기 변형도 흡수한다", () => {
    expect(
      adaptInstructionForChoice(
        "다음 중 두 수가 서로소이면 ◯, 서로소가 아니면 ×를 () 안에 써넣으시오. $9$, $25$",
      ),
    ).toBe("다음 중 두 수가 서로소이면 ◯, 서로소가 아니면 ×를 고르시오. $9$, $25$");
  });

  it("빈칸이 문장 끝이 아니면(진술 판별) 발문만 바뀐다", () => {
    expect(
      adaptInstructionForChoice(
        "다음 설명이 옳으면 ◯, 옳지 않으면 ×를 ()안에 써넣으시오. 모든 소수는 홀수이다.",
      ),
    ).toBe("다음 설명이 옳으면 ◯, 옳지 않으면 ×를 고르시오. 모든 소수는 홀수이다.");
  });
});

describe("칩은 발문이 언급한 기호만", () => {
  it("소수·합성수 판별 → ◯·△ (×는 없다)", () => {
    expect(
      symbolOptionsFromBodyText("다음 수가 소수이면 ◯, 합성수이면 △를 고르시오. $11$"),
    ).toEqual(["◯", "△"]);
  });

  it("진위 판별 → ◯·× (△는 없다)", () => {
    expect(
      symbolOptionsFromBodyText(
        "다음 설명이 옳으면 ◯, 옳지 않으면 ×를 고르시오. 모든 소수는 홀수이다.",
      ),
    ).toEqual(["◯", "×"]);
  });

  it("수식의 \\times는 곱셈이지 × 칩 근거가 아니다", () => {
    expect(
      symbolOptionsFromBodyText("소수이면 ◯, 합성수이면 △를 고르시오. $2\\times 3$"),
    ).toEqual(["◯", "△"]);
  });

  it("발문에서 쌍을 못 읽으면 셋 다 낸다 — 칩이 모자라 답을 못 내면 안 된다", () => {
    expect(symbolOptionsFromBodyText("알맞은 기호를 고르시오. ◯")).toEqual([
      "◯",
      "△",
      "×",
    ]);
  });
});

/* 판별 대상이 발문 뒤에 붙어 있으면 문장 꼬리처럼 묻힌다 — 「…고르시오. 11」의
 * 11이 그랬다. 줄을 가르는 자리는 발문이 끝나는 「…시오.」다. */
describe("발문과 판별 대상을 줄로 가르기", () => {
  it("「…고르시오. $11$」의 대상이 다음 줄로 간다", () => {
    expect(
      splitInstructionLine("다음 수가 소수이면 ◯, 합성수이면 △를 고르시오. $11$"),
    ).toEqual(["다음 수가 소수이면 ◯, 합성수이면 △를 고르시오.", "$11$"]);
  });

  it("대상이 문장이어도 가른다(진술 판별)", () => {
    expect(
      splitInstructionLine(
        "다음 설명이 옳으면 ◯, 옳지 않으면 ×를 고르시오. 소수의 약수는 2개이다.",
      ),
    ).toEqual([
      "다음 설명이 옳으면 ◯, 옳지 않으면 ×를 고르시오.",
      "소수의 약수는 2개이다.",
    ]);
  });

  it("발문뿐이면 가르지 않는다 — 빈 줄이 생기면 안 된다", () => {
    const only = "다음 중 소수인 것을 고르시오.";
    expect(splitInstructionLine(only)).toEqual([only]);
  });
});

/* 같은 뜻의 기호가 발문에서는 글자, 칩에서는 그림으로 나와 무게가 달랐다.
 * 여기서는 자리만 표시하고, 그리는 것은 화면(QuestionBody)의 몫이다.
 *
 * **발문이 선언한 것만** 표시한다 — 곱셈 ×를 도형으로 그리면 뜻이 뒤집힌다. */
describe("발문 속 기호 표시", () => {
  it("조건 뒤의 선언(…이면 ◯)을 표시하고 정본 글자로 통일한다", () => {
    expect(markSymbolGlyphs("소수이면 ○, 합성수이면 ▲를 고르시오.")).toBe(
      `소수이면 ${mark("◯")}, 합성수이면 ${mark("△")}를 고르시오.`,
    );
  });

  it("지면 발문(…를 ()안에 써넣으시오)의 선언도 표시한다", () => {
    expect(
      markSymbolGlyphs("옳으면 ◯, 옳지 않으면 ×를 ()안에 써넣으시오."),
    ).toBe(`옳으면 ${mark("◯")}, 옳지 않으면 ${mark("×")}를 ()안에 써넣으시오.`);
  });

  it("수식 안은 건드리지 않는다 — 거기의 ×는 곱셈이다", () => {
    expect(markSymbolGlyphs("옳으면 ◯를 고르시오. $2 \\times 3$")).toBe(
      `옳으면 ${mark("◯")}를 고르시오. $2 \\times 3$`,
    );
  });

  /* 이 갈래가 이 규칙의 이유다 — 수식 사이에 글자로 남은 곱셈 ×를 도형으로
   * 그리면 「2 곱하기 3」이 「2 틀림 3」이 된다. */
  it("선언 없는 ×는 곱셈이다 — 수식 사이에 글자로 놓여도 표시하지 않는다", () => {
    expect(markSymbolGlyphs("$2$ × $3$의 값을 구하시오.")).toBe(
      "$2$ × $3$의 값을 구하시오.",
    );
    expect(markSymbolGlyphs("옳으면 ◯를 고르시오. 2×3=6이다.")).toBe(
      `옳으면 ${mark("◯")}를 고르시오. 2×3=6이다.`,
    );
  });
});
