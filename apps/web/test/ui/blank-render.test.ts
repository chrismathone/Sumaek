import { describe, expect, it } from "vitest";
import { applyBlanks, BLANK_OPEN } from "@/lib/learn/blank-render";

/* 빈칸 심기 — 여기가 틀리면 화면에 칸이 **안 생긴다.** 채점은 DB의 정답
 * 목록으로 도므로, 심지 못한 칸도 채점 대상에는 남는다. 즉 학생은 보이지도
 * 않는 칸 때문에 영영 다 맞히지 못한다. 실제로 3단계가 그 상태였다. */

const hasToken = (json: unknown, position: number): boolean =>
  JSON.stringify(json).includes(`${BLANK_OPEN}${position}:`);

describe("빈칸 심기 (applyBlanks)", () => {
  it("정의의 용어(단일 문자열)를 뚫는다", () => {
    const body = [{ type: "definition", term: "소수", content: [] }];
    const r = applyBlanks(body, [{ position: 1, answer: "소수" }]);
    expect(hasToken(r.body, 1)).toBe(true);
    expect(r.missing).toEqual([]);
  });

  /* 이 스펙이 이 파일의 존재 이유다 — 3단계 정답은 문장 전체이고, 그 문장에
   * 수식이 끼면 글자가 런 여러 개로 쪼개져 어느 한 문자열에도 통째로 들어
   * 있지 않다. 문자열만 훑던 시절 정의 내용이 하나도 안 뚫렸다. */
  it("수식이 낀 문장(런 여러 개)을 통째로 뚫는다", () => {
    const body = [
      {
        type: "definition",
        term: "소수",
        content: [
          { kind: "text", text: "1보다 큰 자연수 가운데 약수가 " },
          { kind: "math", math: { latex: "1" } },
          { kind: "text", text: "과 자기 자신뿐인 수입니다." },
        ],
      },
    ];
    const answer = "1보다 큰 자연수 가운데 약수가 $1$과 자기 자신뿐인 수입니다.";
    const r = applyBlanks(body, [{ position: 1, answer }]);
    expect(hasToken(r.body, 1)).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("핵심 항목(런 배열의 배열)도 항목마다 뚫는다", () => {
    const body = [
      {
        type: "key_point",
        items: [
          [{ kind: "text", text: "1은 소수도 합성수도 아닙니다." }],
          [{ kind: "text", text: "짝수인 소수는 2뿐입니다." }],
        ],
      },
    ];
    const r = applyBlanks(body, [
      { position: 1, answer: "1은 소수도 합성수도 아닙니다." },
      { position: 2, answer: "짝수인 소수는 2뿐입니다." },
    ]);
    expect(hasToken(r.body, 1)).toBe(true);
    expect(hasToken(r.body, 2)).toBe(true);
  });

  it("수식 원문(latex)에는 표식을 넣지 않는다 — 넣으면 KaTeX가 깨진다", () => {
    const body = [{ type: "display_math", math: { latex: "2x=6" } }];
    const r = applyBlanks(body, [{ position: 1, answer: "2x=6" }]);
    expect(hasToken(r.body, 1)).toBe(false);
    expect(r.missing).toHaveLength(1);
  });

  it("못 찾은 답은 조용히 버리지 않고 missing으로 돌려준다", () => {
    const body = [{ type: "text", text: "아무 글" }];
    const r = applyBlanks(body, [{ position: 1, answer: "없는 말" }]);
    expect(r.missing.map((m) => m.position)).toEqual([1]);
  });

  it("긴 답을 먼저 뚫는다 — 짧은 답이 긴 답의 일부를 먼저 먹지 않게", () => {
    const body = [{ type: "text", text: "소인수분해는 소인수의 곱이다." }];
    const r = applyBlanks(body, [
      { position: 1, answer: "소인수" },
      { position: 2, answer: "소인수분해" },
    ]);
    // 둘 다 자리를 잡아야 한다 (짧은 것이 긴 것을 삼켰다면 하나가 missing이 된다)
    expect(r.missing).toEqual([]);
  });
});
