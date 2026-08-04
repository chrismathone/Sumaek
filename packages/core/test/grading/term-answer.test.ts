import { describe, expect, it } from "vitest";
import {
  keywordCoverage,
  matchesTermAnswer,
  normalizeTermAnswer,
} from "../../src/grading/term-answer";

/* 빈칸 채점 — 수가 아니라 **용어**를 비교한다. 여기가 느슨하면 아무 말이나
 * 정답이 되고, 빡빡하면 맞게 쓴 학생이 틀린다. 둘 다 학생이 빈칸을 그만
 * 풀게 만든다. */

describe("용어 정규화 (normalizeTermAnswer)", () => {
  it("띄어쓰기는 무시한다 — 판본마다 다르다", () => {
    expect(normalizeTermAnswer("소인수 분해")).toBe(
      normalizeTermAnswer("소인수분해"),
    );
  });

  it("말끝을 뗀다 — 음성 입력이 문장으로 받아쓴다", () => {
    expect(normalizeTermAnswer("소인수분해입니다")).toBe("소인수분해");
    expect(normalizeTermAnswer("거듭제곱이에요")).toBe("거듭제곱");
  });

  it("말끝은 한 번만 뗀다", () => {
    // 두 번 떼면 용어 자체가 깎여 나간다
    expect(normalizeTermAnswer("요요")).toBe("요");
  });

  it("문장부호·괄호·수식 기호는 버린다", () => {
    expect(normalizeTermAnswer("(밑)")).toBe("밑");
    expect(normalizeTermAnswer("$지수$.")).toBe("지수");
  });

  it("라틴 문자는 대소문자를 무시한다", () => {
    expect(normalizeTermAnswer("LCM")).toBe(normalizeTermAnswer("lcm"));
  });
});

describe("정답 판정 (matchesTermAnswer)", () => {
  it("허용 표기(alternatives)를 정답으로 받는다", () => {
    expect(matchesTermAnswer("소인수 분해", "소인수분해")).toBe(true);
    expect(matchesTermAnswer("최소공배수", "최소공배수", ["lcm"])).toBe(true);
    expect(matchesTermAnswer("LCM", "최소공배수", ["lcm"])).toBe(true);
  });

  it("빈 답은 언제나 오답이다 — 안 쓴 것을 맞았다고 하지 않는다", () => {
    expect(matchesTermAnswer("", "밑")).toBe(false);
    expect(matchesTermAnswer("   ", "밑")).toBe(false);
    expect(matchesTermAnswer("...", "밑")).toBe(false);
  });

  it("동의어를 추측하지 않는다 — 목록에 없으면 오답", () => {
    // 「약수」와 「인수」는 맥락이 정하는 문제다. 함수가 임의로 같다고 하면
    // 틀린 답이 통과한다.
    expect(matchesTermAnswer("인수", "약수")).toBe(false);
  });

  it("다른 용어를 정답으로 받지 않는다", () => {
    expect(matchesTermAnswer("합성수", "소수")).toBe(false);
  });
});

describe("자유 서술 채점 (keywordCoverage)", () => {
  it("담은 것과 빠진 것을 가른다", () => {
    const r = keywordCoverage(
      "소인수분해는 자연수를 소인수들의 곱으로 나타내는 것입니다.",
      ["소인수분해", "소인수", "거듭제곱"],
    );
    expect(r.found).toEqual(["소인수분해", "소인수"]);
    expect(r.missing).toEqual(["거듭제곱"]);
  });

  it("띄어쓰기가 달라도 찾는다", () => {
    const r = keywordCoverage("소인수 분해를 했습니다", ["소인수분해"]);
    expect(r.found).toEqual(["소인수분해"]);
  });

  it("빈 글은 아무것도 담지 않은 것이다", () => {
    const r = keywordCoverage("", ["소수"]);
    expect(r.found).toEqual([]);
    expect(r.missing).toEqual(["소수"]);
  });
});
