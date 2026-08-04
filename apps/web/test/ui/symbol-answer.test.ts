import { describe, expect, it } from "vitest";
import {
  adaptInstructionForChoice,
  symbolOptionsFromBodyText,
} from "@/lib/learn/symbol-answer";

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
