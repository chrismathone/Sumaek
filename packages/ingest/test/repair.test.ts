import { describe, expect, it } from "vitest";
import { repairLatex } from "../src/repair";

/* ─────────────────────────────────────────────────────────────
 * 여기 적힌 입력은 전부 **실제로 DB에 들어가 렌더에 실패하던 식**이다.
 * 전수검사(audit-katex) 보고서에서 그대로 가져왔고, 어느 권 몇 번인지
 * 적어 두었다. 지어낸 예는 없다.
 *
 * 후보정의 선은 하나다 — **형식만 고치고 뜻은 지어내지 않는다.** 아래
 * 마지막 묶음이 그 선을 지키는지 확인한다.
 * ───────────────────────────────────────────────────────────── */

describe("이중 지수 — KaTeX가 Double superscript로 실패하던 것", () => {
  it("2^{1}^{1} 은 2^{11} 이다 (중2-1 별책 259건)", () => {
    expect(repairLatex("2^{1}^{1}").latex).toBe("2^{11}");
  });

  it("부호가 낀 것도 합친다 (중3-2 0265 「^{2}^{20}」)", () => {
    expect(repairLatex("^{2}^{20}").latex).toBe("^{220}");
  });

  it("아래첨자도 같은 이유로 두 번 선다", () => {
    expect(repairLatex("x_{1}_{2}").latex).toBe("x_{12}");
  });

  it("구조가 든 지수는 합치지 않는다 — 없는 식을 만들지 않는다", () => {
    const got = repairLatex("a^{\\frac{1}{2}}^{n}");
    expect(got.latex).toBe("a^{\\frac{1}{2}}^{n}");
    expect(got.applied).toEqual([]);
  });
});

describe("홀로 선 지수 기호 — 뒤가 잘려 나간 자리", () => {
  it("끝에 남은 ^ 를 걷어 낸다 (중3-1 0079·0091 등 18건)", () => {
    expect(repairLatex("-1.2^").latex).toBe("-1.2");
  });

  it("괄호 앞에 홀로 선 것도 걷어 낸다", () => {
    expect(repairLatex("(a^)").latex).toBe("(a)");
  });

  /* 지수 자리에 무엇이 있었는지는 알 수 없다. 짐작해 채우지 않는다. */
  it("지수 내용을 지어내지 않는다", () => {
    expect(repairLatex("2^").latex).toBe("2");
  });
});

describe("큰 괄호 짝 — 여닫이가 서로 다른 조각으로 온다", () => {
  it("닫는 짝만 있으면 보이지 않는 여는 짝을 세운다 (중2-1 0783)", () => {
    const got = repairLatex("\\frac{12}{100}\\right)(x+y)=25760");
    expect(got.latex).toBe("\\left.\\frac{12}{100}\\right)(x+y)=25760");
  });

  it("여는 짝만 있으면 보이지 않는 닫는 짝을 세운다", () => {
    expect(repairLatex("\\left(\\frac{y}{x}").latex).toBe(
      "\\left(\\frac{y}{x}\\right.",
    );
  });

  it("짝이 맞으면 손대지 않는다", () => {
    const got = repairLatex("\\left(x\\right)");
    expect(got.applied).toEqual([]);
  });
});

describe("중괄호 짝 — 근호 가구가 한쪽만 살아남은 자리", () => {
  it("모자라면 끝에서 닫는다", () => {
    expect(repairLatex("\\sqrt{2").latex).toBe("\\sqrt{2}");
  });

  it("짝 없는 닫는 괄호는 버린다 (중3-1 1057 「}=-1」)", () => {
    expect(repairLatex("}=-1").latex).toBe("=-1");
  });

  it("이스케이프된 중괄호는 세지 않는다", () => {
    const got = repairLatex("\\{x\\}");
    expect(got.applied).toEqual([]);
  });
});

describe("고쳐서 빈 껍데기가 되면 되돌린다", () => {
  /* 빈 식이 나가면 화면에는 아무것도 없고, 검수자는 무엇이 있었는지
   * 알 수 없다. 깨진 채로 검수함에 가는 편이 낫다. */
  it("내용이 통째로 사라지면 원래 것을 돌려준다", () => {
    const got = repairLatex("^");
    expect(got.latex).toBe("^");
    expect(got.applied).toEqual([]);
  });

  it("내용이 남으면 고친 것을 돌려준다", () => {
    expect(repairLatex("x^").latex).toBe("x");
  });
});

describe("뜻은 지어내지 않는다", () => {
  it("빈 분모를 채우지 않는다", () => {
    expect(repairLatex("\\frac{1}{}").latex).toBe("\\frac{1}{}");
  });

  it("근호 범위를 짐작하지 않는다", () => {
    const got = repairLatex("\\surd 2+3");
    expect(got.latex).toBe("\\surd 2+3");
    expect(got.applied).toEqual([]);
  });

  it("멀쩡한 식은 한 글자도 건드리지 않는다", () => {
    const fine = "\\overline{AB}=\\frac{1}{2}\\times 8=4";
    const got = repairLatex(fine);
    expect(got.latex).toBe(fine);
    expect(got.applied).toEqual([]);
  });
});
