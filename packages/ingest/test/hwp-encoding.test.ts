import { describe, expect, it } from "vitest";
import {
  attachOverline,
  cleanBodyText,
  decodeHwpMath,
  isNameJoinOnly,
  joinLatex,
  markSuperscripts,
  mergeUnbalancedMath,
  nameMarkOnly,
  overlineLastName,
} from "../src/hwp-encoding";
import type { Run } from "../src/types";

/* ─────────────────────────────────────────────────────────────
 * 여기 적힌 기댓값은 전부 **지면을 열어 눈으로 확인한 것**이다.
 * 원문은 22개정 RPM 중1-1 학생용 PDF의 텍스트 레이어에서 그대로 가져왔고,
 * 기댓값은 같은 자리를 확대 렌더해 읽은 것이다.
 *
 * 이 표가 틀리면 3/2가 2/3이 되고, 그 오류는 화면 어디에도 드러나지 않는다.
 * 학생이 맞는 답을 쓰고 틀렸다는 채점을 받는 것으로만 나타난다. 그래서
 * "대충 맞는" 값을 넣지 않는다 — 대조하지 않은 글리프는 unknown이어야 한다.
 * ───────────────────────────────────────────────────────────── */

describe("지수 — 지면 대조", () => {
  it("2Û` 는 2² 다 (p.20 문항 0135)", () => {
    expect(decodeHwpMath("2Û`").latex).toBe("2^{2}");
  });

  it("3Ü` 는 3³ 다", () => {
    expect(decodeHwpMath("3Ü`").latex).toBe("3^{3}");
  });

  it("3Ý` 는 3⁴ 다 (p.20 문항 0137)", () => {
    expect(decodeHwpMath("3Ý`").latex).toBe("3^{4}");
  });

  it("2Þ` 는 2⁵ 다 (p.3)", () => {
    expect(decodeHwpMath("2Þ`").latex).toBe("2^{5}");
  });

  /* á·â는 오래 비어 있었다 — 중1-1에 나오지 않아서다. 배치상 8·9로
   * 보였지만 추정으로 넣지 않았고, 중2-1 지수법칙 단원에서 지면을 열어
   * 확인하니 **á는 9, â는 0이었다.** 배치 추정이 틀렸던 셈이다. */
  it("á 는 9 다 (중2-1 p.33 문항 0205 「(-3x³y^a)^b=-27x^c y⁹」)", () => {
    expect(decodeHwpMath("2á`").latex).toBe("2^{9}");
  });

  it("â 는 0 이다 (중2-1 p.29 「x¹⁰÷x⁵÷x」)", () => {
    expect(decodeHwpMath("xÚ`â`ÖxÞ`Öx").latex).toBe("x^{10}\\div x^{5}\\div x");
  });

  it("대조하지 않은 지수 글리프는 통과시키지 않고 unknown에 담는다", () => {
    /* ã는 배치상 á·â 다음 자리로 보이지만 어느 교재에서도 확인한 적이
     * 없다. 추정으로 표에 넣지 않는다. */
    const got = decodeHwpMath("2ã`");
    expect(got.unknown).toContain("ã");
  });
});

describe("여러 글자짜리 지수 — 한 덩어리로 묶는다", () => {
  /* 한 글자씩 `^{}`를 씌우면 `x^{1}^{0}`이 되어 KaTeX가 파싱에 실패한다.
   * 중2-1 II단원(지수법칙)에서만 37건이 이 꼴로 학생 화면에 빨간 글자를
   * 내보내고 있었다. */
  it("Ú`Û` 는 ¹² 다 — 지수가 두 번 서지 않는다", () => {
    expect(decodeHwpMath("yÛ`)Ý`=xÚ`Û`y").latex).toBe("y^{2})^{4}=x^{12}y");
  });

  it("부호까지 함께 묶는다 (중2-1 p.32 「27^{2x-1}=3^{11-x}」)", () => {
    expect(decodeHwpMath("27Û`Å`ÑÚ`=3Ú`Ú`ÑÅ`").latex).toBe(
      "27^{2x-1}=3^{11-x}",
    );
  });

  it("Ñ 는 지수 자리의 뺄셈이다 (중2-1 p.33 「x⁶÷x²=x^{6-2}=x⁴」)", () => {
    expect(decodeHwpMath("xß`ÖxÛ`=xß`ÑÛ`=xÝ`").latex).toBe(
      "x^{6}\\div x^{2}=x^{6-2}=x^{4}",
    );
  });

  it("± 는 지수 자리의 덧셈이다 (중2-1 p.28 「a^m×a^n=a^{m+n}」)", () => {
    expect(decodeHwpMath("aµ``_aÇ`=aµ``±Ç`", "EHsang-Italic").latex).toBe(
      "a^{m}\\times a^{n}=a^{m+n}",
    );
  });
});

describe("아래첨자 — 윗자리 글꼴과 아랫자리 글꼴", () => {
  /* 중2-1 p.25 「6/7 = x₁/10 + x₂/10² + x₃/10³ + … + x_n/10ⁿ」 한 줄이
   * 근거다. 같은 `Ç`가 아래에서는 n, 위에서는 ⁿ으로 온다. */
  it("EHsang의 작은 숫자는 아래첨자다 (x₁·x₂)", () => {
    expect(decodeHwpMath("xÁ+xª+x", "EHsang-Italic").latex).toBe(
      "x_{1}+x_{2}+x",
    );
  });

  it("두 자리도 묶는다 — x₉₉ (p.25 「x₁+x₂+x₃+…+x₉₉의 값」)", () => {
    expect(decodeHwpMath("x»»", "EHsang-Italic").latex).toBe("x_{99}");
  });

  it("EHhabu의 Ç 는 아래첨자 n이다 — 같은 코드가 EHsang에서는 지수 n이다", () => {
    expect(decodeHwpMath("xÇ", "EHhabu-Italic").latex).toBe("x_{n}");
    expect(decodeHwpMath("10Ç`", "EHsang-Italic").latex).toBe("10^{n}");
  });

  it("글꼴을 모르면 아래첨자로 옮기지 않는다 — 짐작하지 않는다", () => {
    expect(decodeHwpMath("xÁ").unknown).toContain("Á");
  });
});

describe("조각으로 온 지수를 이어 붙인다", () => {
  /* 별책은 2¹¹을 span 여럿으로 쪼갠다 — `Ú`가 EHsang-Plain 혼자,
   * 뒤이어 `` `ß` ``가 EHsang-Italic로 온다. 중2-1 별책 해설 259건. */
  it("잇달은 위첨자 숫자는 한 지수다", () => {
    expect(joinLatex("a^{1}", "^{6}")).toBe("a^{16}");
  });

  it("부호 조각도 같은 지수다 (별책 p.13 문항 0193 「2^{2+3+a}」)", () => {
    expect(joinLatex(joinLatex("2^{2}", "^{+}"), "^{3}")).toBe("2^{2+3}");
  });

  it("구조가 든 지수는 잇지 않는다 — 손대면 없는 식이 만들어진다", () => {
    expect(joinLatex("a^{\\frac{1}{2}}", "^{n}")).toBe("a^{\\frac{1}{2}}^{n}");
  });

  it("한 span 안이면 해독기가 이미 묶는다", () => {
    expect(decodeHwpMath("=2Ú`Ú`_3Û`_5_7", "EHsang-Italic").latex).toBe(
      "=2^{11}\\times 3^{2}\\times 5\\times 7",
    );
  });
});

describe("연산자로 끝난 수식은 조각이다", () => {
  const math = (latex: string): Run => ({ kind: "math", raw: latex, latex, unknown: [] });

  it("`f(x)=` 뒤의 분수는 같은 식이다 (중2-1 p.124 문항 0840)", () => {
    const got = mergeUnbalancedMath([math("f(x)="), math("\\frac{x}{3}")]);
    expect(got).toHaveLength(1);
    expect(got[0]!.kind === "math" && got[0]!.latex).toBe("f(x)=\\frac{x}{3}");
  });

  it("부호로 끝나도 마찬가지다 (0840 ④ 「f(x)=-3/x」)", () => {
    const got = mergeUnbalancedMath([math("f(x)=-"), math("\\frac{3}{x}")]);
    expect(got[0]!.kind === "math" && got[0]!.latex).toBe("f(x)=-\\frac{3}{x}");
  });

  it("완결된 식끼리는 붙이지 않는다 — 나란한 두 수는 두 수다", () => {
    const got = mergeUnbalancedMath([math("2"), math("3")]);
    expect(got).toHaveLength(2);
  });
});

describe("선분 기호 — 글자 뒤에 오는 윗줄", () => {
  it("PQÓ 는 PQ‾ 다 (중2-1 p.143 「PQ‾=6」)", () => {
    expect(decodeHwpMath("PQÓ=6", "EHsang-Plain").latex).toBe(
      "\\overline{PQ}=6",
    );
  });

  it("한 줄에 둘이 와도 각각 씌운다 (p.130 「1/2×BC‾×OA‾」)", () => {
    expect(decodeHwpMath("_BCÓ_OAÓ", "EHsang-Plain").latex).toBe(
      "\\times \\overline{BC}\\times \\overline{OA}",
    );
  });
});

describe("선분·반직선·직선 — 끝 조각이 뜻을 정한다 (중1-2 「기본 도형」)", () => {
  /* 셋이 같은 쪽에 나란히 나오고 답이 서로 다르다. 중1-2 p.9를 그려서
   * 눈으로 대조했다 — 「BA→」·「AC‾」가 한 문항 안에 같이 있다. */
  it("AÕMÓ 는 AM‾ 이다 — 이음 조각은 글자를 가르지 않는다", () => {
    expect(decodeHwpMath("AÕMÓ=8", "EHsang-Plain").latex).toBe(
      "\\overline{AM}=8",
    );
  });

  it("BÕA³ 는 반직선 BA 다 (p.9 「BA→」)", () => {
    expect(decodeHwpMath("BÕA³", "EHsang-Plain").latex).toBe(
      "\\overrightarrow{BA}",
    );
  });

  it("CA³ 는 반직선 CA 다 — 세제곱이 아니다", () => {
    expect(decodeHwpMath("CA³", "EHsang-Plain").latex).toBe(
      "\\overrightarrow{CA}",
    );
  });

  it("ABê 는 직선 AB 다", () => {
    expect(decodeHwpMath("ABê", "EHsang-Plain").latex).toBe(
      "\\overleftrightarrow{AB}",
    );
  });

  /* 여기서 갈라 두지 않으면 다른 학년의 진짜 세제곱이 반직선이 된다.
   * 반직선 이름은 두 글자 이상이라는 것이 가름선이다. */
  it("대문자 하나 뒤의 ³ 는 그대로 세제곱이다", () => {
    expect(decodeHwpMath("A³", "EHsang-Plain").latex).toBe("A^{3}");
  });

  it("등호 건너에 있는 ³ 를 끌어오지 않는다 — 세제곱을 반직선으로 만들지 않는다", () => {
    expect(decodeHwpMath("AB=x³", "EHsang-Plain").latex).toBe("AB=x^{3}");
  });
});

describe("따로 선 표시 조각 — 씌울 글자를 찾아 준다", () => {
  it("Ó 만 담긴 조각은 선분 표시다", () => {
    expect(nameMarkOnly("Ó")).toBe("overline");
    expect(nameMarkOnly("ò")).toBe("overline");
  });

  it("ê 만 담긴 조각은 직선 표시다", () => {
    expect(nameMarkOnly("ê")).toBe("overleftrightarrow");
  });

  /* 홀로 선 ³ 를 반직선으로 단정하지 않는다 — 조용히 틀리느니
   * 미해독으로 검수함에 가는 편이 낫다 */
  it("홀로 선 ³ 는 표시로 읽지 않는다", () => {
    expect(nameMarkOnly("³")).toBeNull();
  });

  it("이음 조각만 온 것은 뜻을 정하지 않는다", () => {
    expect(nameMarkOnly("Í")).toBeNull();
    expect(isNameJoinOnly("Í")).toBe(true);
    expect(isNameJoinOnly("Õ")).toBe(true);
    expect(isNameJoinOnly("Ó")).toBe(false);
  });

  it("씌울 이름은 마지막 대문자 묶음이다", () => {
    expect(overlineLastName("PQ=AB", "overleftrightarrow")).toBe(
      "PQ=\\overleftrightarrow{AB}",
    );
  });

  /* 별책 해설은 표시가 한참 밀려 따로 온다. 이음 조각을 빼고 잡으면
   * 「M̅B̅」가 「M \overline{B}」가 된다 — 중1-2 교과서문제 해설에서
   * 63건이 이 꼴로 나갔다. */
  it("이음 조각도 이름의 일부다", () => {
    expect(overlineLastName("MÕB")).toBe("\\overline{MB}");
    expect(attachOverline("MÕB", "Ó")).toBe("MÕBÓ");
  });

  it("따로 온 직선 표시를 앞 이름에 씌운다 (별책 「MN↔」)", () => {
    expect(decodeHwpMath(attachOverline("MN", "ê"), "EHsang-Plain").latex).toBe(
      "\\overleftrightarrow{MN}",
    );
  });
});

describe("지수 6·7 — 산술로 확정한 값", () => {
  /* 이 둘은 지면을 읽어 맞춘 게 아니라 계산이 맞아떨어져 확정했다.
   * 눈으로 읽는 것보다 강한 근거다 — 착시가 끼어들 자리가 없다. */
  it("ß 는 6 이다 — 3⁵×3 = 3⁶ (p.2 「3Þ`_51=3Þ`_3_17=3ß`_17」)", () => {
    expect(decodeHwpMath("3ß`").latex).toBe("3^{6}");
    // 원문 등식이 실제로 성립하는지: 3⁵×51 = 3⁵×3×17 = 3⁶×17
    expect(3 ** 5 * 51).toBe(3 ** 6 * 17);
  });

  it("à 는 7 이다 — 2⁷ = 128 (p.3 「128=2à`」)", () => {
    expect(decodeHwpMath("128=2à`").latex).toBe("128=2^{7}");
    expect(2 ** 7).toBe(128);
  });
});

describe("위첨자 문자 — 숫자 지수와 다른 글리프 묶음", () => {
  it("º 는 위첨자 b 다 (p.24 「2Þ`_3º`_c」 = 2⁵×3ᵇ×c)", () => {
    expect(decodeHwpMath("2Þ`_3º`_c").latex).toBe("2^{5}\\times 3^{b}\\times c");
  });

  it("¶ 는 위첨자 d 다 (p.29 「3º`_5_7¶`」 = 3ᵇ×5×7ᵈ)", () => {
    expect(decodeHwpMath("3º`_5_7¶`").latex).toBe("3^{b}\\times 5\\times 7^{d}");
  });
});

describe("비(比) 기호", () => {
  it("분수가 아닌 콜론은 그대로 둔다 (p.24 문항 0167 「2 : 5 : 6」)", () => {
    const got = decodeHwpMath("2 : 5 : 6");
    expect(got.unknown).toEqual([]);
    expect(got.latex).toBe("2 : 5 : 6");
  });
});

describe("곱셈·나눗셈 — 지면 대조", () => {
  it("_ 는 곱셈이다 — 2_3Û` 는 2×3² (p.20 문항 0132 보기 ㅂ)", () => {
    expect(decodeHwpMath("2_3Û`").latex).toBe("2\\times 3^{2}");
  });

  it("Ö 는 나눗셈이다 — 4Öa 는 4÷a (p.75 문항 0534)", () => {
    expect(decodeHwpMath("4Öa").latex).toBe("4\\div a");
  });

  it("문항 0135의 세 수를 통째로 옮긴다", () => {
    // 지면: 2³×3³,  2×3⁴×7,  2²×3²×5
    expect(decodeHwpMath("2Ü`_3Ü`").latex).toBe("2^{3}\\times 3^{3}");
    expect(decodeHwpMath("2_3Ý`_7").latex).toBe("2\\times 3^{4}\\times 7");
    expect(decodeHwpMath("2Û`_3Û`_5").latex).toBe("2^{2}\\times 3^{2}\\times 5");
  });
});

describe("분수 — 안쪽은 분모·분자 교대다", () => {
  it(";2!; 는 1/2 다 (p.2)", () => {
    expect(decodeHwpMath(";2!;").latex).toBe("\\frac{1}{2}");
  });

  it(";6&; 는 7/6 다 — 6/7이 아니다 (p.30)", () => {
    expect(decodeHwpMath(";6&;").latex).toBe("\\frac{7}{6}");
  });

  it(";1#2%; 는 35/12 다 — 두 자리는 교대로 읽는다 (p.30)", () => {
    expect(decodeHwpMath(";1#2%;").latex).toBe("\\frac{35}{12}");
  });

  it("분자·분모가 뒤집히지 않았는지 셋을 함께 본다", () => {
    // 한 값만 보면 우연히 맞을 수 있다. 분모가 서로 다른 셋을 같이 건다.
    expect([";2!;", ";3!;", ";5!;"].map((s) => decodeHwpMath(s).latex)).toEqual([
      "\\frac{1}{2}",
      "\\frac{1}{3}",
      "\\frac{1}{5}",
    ]);
  });

  it("규칙에 맞지 않는 분수는 억지로 풀지 않고 unknown으로 남긴다", () => {
    // 분자 자리에 표에 없는 글자 — 반쪽짜리 분수를 만들지 않는다
    const got = decodeHwpMath(";1Ø2;");
    expect(got.unknown.length).toBeGreaterThan(0);
    expect(got.latex).toContain(";1Ø2;");
  });

  it("분모만·분자만 있는 것은 분수가 아니다", () => {
    // 8에 해당하는 글리프가 아직 표에 없다 — 그때 「1/12」 같은 것을 지어내면 안 된다
    expect(decodeHwpMath(";12;").unknown.length).toBeGreaterThan(0);
    expect(decodeHwpMath(";#%;").unknown.length).toBeGreaterThan(0);
  });

  /* 자릿수가 다른 분수 — 조판기가 글리프 벌을 바꾸는 자리다.
   * 아홉 자리 전부 지면(중1-1 II·III단원)을 그려서 대조했다. */
  it.each([
    [";1£2;", "\\frac{3}{12}", "p.36 −3/12"],
    [";1¢2;", "\\frac{4}{12}", "p.36 −4/12"],
    [":Á3ª:", "\\frac{12}{3}", "p.38 −12/3"],
    [";ª4¼;", "\\frac{20}{4}", "p.38 ④ 20/4"],
    [";Á6ª;", "\\frac{12}{6}", "p.39 12/6"],
    [";¢7ª;", "\\frac{42}{7}", "p.39 ⑤ −42/7"],
    [":Á4¤:", "\\frac{16}{4}", "p.39 16/4"],
    [":Á5°:", "\\frac{15}{5}", "p.46 −15/5"],
    [";ª3Á;", "\\frac{21}{3}", "p.46 21/3"],
    [";Á2°;", "\\frac{15}{2}", "p.46 −15/2"],
    [";°9¢;", "\\frac{54}{9}", "p.49 54/9"],
    [";1¦5;", "\\frac{7}{15}", "p.53 −7/15"],
    [";1»4;", "\\frac{9}{14}", "p.60 9/14"],
    [":£7¼:", "\\frac{30}{7}", "p.60 ④ 30/7"],
    [":£3°:", "\\frac{35}{3}", "p.60 ⑤ 35/3"],
    [";2»5;", "\\frac{9}{25}", "p.63 −9/25"],
    // 여는·닫는 기호가 짝이 아닌 꼴 — 실측한 네 가지를 전부 건다
    [";;ª4¼;;", "\\frac{20}{4}", "p.38 ;;…;;"],
    [":Á3¼;;", "\\frac{10}{3}", "p.53 :…;; (짝이 안 맞는다)"],
  ])("%s 는 %s 다 (%s)", (raw, expected) => {
    expect(decodeHwpMath(raw).latex).toBe(expected);
  });

  it("분수 안의 위첨자 표식은 무시한다 — 분자 글리프는 원래 폭이 0이다", () => {
    // 개념서 p.104 「a %=a/100」 · p.208 반비례 「y=a/x」
    const mark = (s: string): string =>
      s.replace(/A/g, "A").replace(/B/g, "B");
    expect(decodeHwpMath(mark(";10A0;")).latex).toBe("\\frac{a}{100}");
    expect(decodeHwpMath(mark(";[A;")).latex).toBe("\\frac{a}{x}");
    expect(decodeHwpMath(mark(";1A;")).latex).toBe("\\frac{a}{1}");
    expect(decodeHwpMath(mark(";cB;")).latex).toBe("\\frac{b}{c}");
  });

  it("¥ 는 8이다 — 마지막 한 자리 (개념서 p.89 「-8/15」)", () => {
    expect(decodeHwpMath(";1¥5;").latex).toBe("\\frac{8}{15}");
  });

  it("분수가 잇달아 와도 뒤엣것을 삼키지 않는다", () => {
    // 닫는 기호가 `;;`를 통째로 먹으면 1/3이 조용히 사라진다
    expect(decodeHwpMath(";2!;;3!;").latex).toBe("\\frac{1}{2}\\frac{1}{3}");
  });

  /* 분수 안의 문자 — 정비례·반비례가 전부 이 꼴이다.
   * 분자 자리와 분모 자리가 다른 코드로 온다는 것이 요점이다. */
  it.each([
    [";bA;", "\\frac{a}{b}", "p.128 문항 0953"],
    [";aB;", "\\frac{b}{a}", "p.128 문항 0953"],
    [";2{;", "\\frac{x}{2}", "p.135 문항 0989 y=-x/2"],
    [";[#;", "\\frac{3}{x}", "p.135 문항 0990 y=-3/x"],
    [";[};", "\\frac{y}{x}", "p.135 문항 0991 y/x=2"],
  ])("%s 는 %s 다 (%s)", (raw, expected) => {
    expect(decodeHwpMath(raw).latex).toBe(expected);
  });

  it("자릿수가 같은 옛 표기도 그대로다 — 규칙을 바꿔도 1단원이 흔들리면 안 된다", () => {
    expect([";2!;", ";6&;", ";1#2%;"].map((s) => decodeHwpMath(s).latex)).toEqual([
      "\\frac{1}{2}",
      "\\frac{7}{6}",
      "\\frac{35}{12}",
    ]);
  });

  it("두 자리 분수의 자리표시자가 다른 수식과 섞여도 제자리에 돌아온다", () => {
    expect(decodeHwpMath("2Û`_;1#2%;_3").latex).toBe(
      "2^{2}\\times \\frac{35}{12}\\times 3",
    );
  });
});

describe("큰 괄호 글꼴 — 코드가 한 짝씩 밀려 있다", () => {
  /* 본책 p.64 문항 0471 한 줄에 세 겹이 다 나온다:
   *   1/6 × [ -20 - { 3² + ( 1/4 - 1/6 ) × 12 } ]
   * 바깥 대괄호만 다른 글꼴(EHSusic)이라 제 뜻 그대로다. */
  it("EHboNA의 { 는 소괄호다 (별책 0346 「(-3/4)+(-1/3)」)", () => {
    expect(decodeHwpMath("{", "EHboNA-Plain").latex).toBe("\\left(");
    expect(decodeHwpMath("}", "EHboNA-Plain").latex).toBe("\\right)");
  });

  it("EHboNA의 [ 는 중괄호다 (별책 p.29 「×{(-6)²…}」)", () => {
    expect(decodeHwpMath("[", "EHboNA-Plain").latex).toBe("\\left\\{");
    expect(decodeHwpMath("]", "EHboNA-Plain").latex).toBe("\\right\\}");
  });

  it("다른 글꼴의 대괄호는 제 뜻 그대로다 — 바깥 대괄호는 EHSusic이다", () => {
    expect(decodeHwpMath("[", "EHSusic-Plain").latex).toBe("[");
    expect(decodeHwpMath("]", "EHSusic-Plain").latex).toBe("]");
  });

  it("분수 안의 [ ] 는 여전히 분모의 x·y다 — 분수를 먼저 걷어내기 때문", () => {
    expect(decodeHwpMath(";[};", "EHboNB-Italic").latex).toBe("\\frac{y}{x}");
  });

  it("조각난 큰 괄호도 이어 붙는다 — \\left 짝을 깊이로 센다", () => {
    const got = mergeUnbalancedMath([
      { kind: "math", raw: "", latex: "\\left(-\\frac{3}{4}", unknown: [] },
      { kind: "math", raw: "", latex: "\\right)", unknown: [] },
    ]);
    expect(got).toHaveLength(1);
  });
});

describe("분수 글꼴의 ¹²³ — 지수가 아니라 세로셈·표 조각이다", () => {
  it("EHboNA에서 온 ²는 지수로 옮기지 않는다 (문항 0265 보기 표)", () => {
    const got = decodeHwpMath("²20", "EHboNA-Plain");
    expect(got.latex).not.toContain("^{2}");
    expect(got.unknown).toContain("²");
  });

  it("다른 글꼴의 ²는 그대로 지수다", () => {
    expect(decodeHwpMath("x²", "EHsang-Italic").latex).toBe("x^{2}");
  });
});

describe("조각난 수식 잇기", () => {
  const math = (latex: string): Run => ({ kind: "math", raw: latex, latex, unknown: [] });

  it("중괄호가 열린 채 끝난 조각은 다음 수식 조각과 붙인다", () => {
    /* 별책 0346 — 지면은 `{-3/4}+{-1/3}={-9/12}+{-4/12}` 한 줄인데
     * 마지막 4/12만 2행 분수라 앞뒤로 틈이 벌어져 세 조각이 됐다. */
    const got = mergeUnbalancedMath([
      math("{-\\frac{3}{4}}+{-\\frac{1}{3}}={-\\frac{9}{12}}+{-"),
      math("\\frac{4}{12}"),
      math("}"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.kind === "math" && got[0]!.latex).toBe(
      "{-\\frac{3}{4}}+{-\\frac{1}{3}}={-\\frac{9}{12}}+{-\\frac{4}{12}}",
    );
  });

  it("짝이 맞는 조각끼리는 붙이지 않는다 — 원래 두 수식일 수 있다", () => {
    expect(mergeUnbalancedMath([math("2+3"), math("5-1")])).toHaveLength(2);
  });

  it("열린 중괄호 안의 쉼표는 수식의 일부다 — 순서쌍 (문항 1043 선택지)", () => {
    const got = mergeUnbalancedMath([
      math("{-1"),
      { kind: "text", text: ", " },
      math("-\\frac{2}{3}}"),
    ]);
    expect(got).toHaveLength(1);
    // 쉼표 뒤 공백은 넣지 않는다 — 수식 모드에서 TeX가 알아서 벌린다
    expect(got[0]!.kind === "math" && got[0]!.latex).toBe("{-1,-\\frac{2}{3}}");
  });

  it("뒤에 수식이 없으면 구두점을 삼키지 않는다 — 문장 끝 마침표", () => {
    const got = mergeUnbalancedMath([math("{-1"), { kind: "text", text: ". " }]);
    expect(got).toHaveLength(2);
  });

  it("사이에 한글이 들어오면 붙이지 않는다 — 거기는 진짜로 끊긴 자리다", () => {
    const got = mergeUnbalancedMath([
      math("{-"),
      { kind: "text", text: "그러므로 " },
      math("}"),
    ]);
    expect(got).toHaveLength(3);
  });

  it("닫는 괄호가 먼저 온 조각도 앞엣것에 붙인다", () => {
    const got = mergeUnbalancedMath([math("}=-\\frac{13}{12}"), math("+1")]);
    expect(got).toHaveLength(1);
  });

  it("이스케이프한 중괄호는 깊이로 세지 않는다", () => {
    expect(mergeUnbalancedMath([math("\\{a\\}"), math("b")])).toHaveLength(2);
  });

  it("원래 배열을 건드리지 않는다", () => {
    const runs = [math("{-"), math("1}")];
    mergeUnbalancedMath(runs);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.kind === "math" && runs[0]!.latex).toBe("{-");
  });
});

describe("모르는 글리프", () => {
  it("지우지 않는다 — 지우면 2×3이 23으로 보인다", () => {
    const got = decodeHwpMath("2¾3");
    expect(got.unknown).toContain("¾");
    expect(got.latex).toContain("¾");
  });

  it("아는 글리프만 있으면 unknown은 비어 있다", () => {
    expect(decodeHwpMath("2Û`_3Ü`_5").unknown).toEqual([]);
  });
});

describe("결정론", () => {
  it("같은 입력은 언제나 같은 출력이다", () => {
    const input = "2Û`_;1#2%;_3Ý`";
    const runs = Array.from({ length: 5 }, () => decodeHwpMath(input).latex);
    expect(new Set(runs).size).toBe(1);
  });

  it("전역 정규식의 lastIndex가 결과를 흔들지 않는다", () => {
    // isKnownGlyph/DROPPABLE이 전역 플래그를 공유하면 호출 순서에 따라
    // 결과가 달라진다. 같은 값을 연달아 넣어 그 흔들림을 잡는다.
    const a = decodeHwpMath("2Û`");
    const b = decodeHwpMath("2Û`");
    expect(a).toEqual(b);
  });
});

describe("본문 문자열 청소", () => {
  it("제어문자 마크를 털어 낸다 — DB에 실려 들어가면 안 된다", () => {
    expect(cleanBodyText("구하시오.")).toBe("구하시오.");
  });

  it("한글은 건드리지 않는다", () => {
    expect(cleanBodyText("다음 중 두 수가 서로소인 것은?")).toBe(
      "다음 중 두 수가 서로소인 것은?",
    );
  });
});

describe("같은 코드가 글꼴마다 다른 글자다", () => {
  /* 이 표는 전부 지면을 그려서 눈으로 대조한 값이다. 글꼴을 안 보고
   * 옮겼더니 발문의 변수 y가 말줄임(⋯)이 되고, 답 `x≥-4`와 `+7℃`가
   * 한 표로는 둘 중 하나가 반드시 틀렸다. */
  it("EHyak의 y는 말줄임이지만 EHsang의 y는 변수다", () => {
    expect(decodeHwpMath("4, 8, 12, y", "EHyak-Plain").latex).toContain("\\cdots");
    expect(decodeHwpMath("y", "EHsang-Italic").latex).toBe("y");
  });

  it("EHyak의 ¾·É는 부등호, EHsang의 ¾는 섭씨다", () => {
    expect(decodeHwpMath("x\u00be-4", "EHyak-Plain").latex).toBe("x\\ge -4");
    expect(decodeHwpMath("x\u00c911", "EHyak-Plain").latex).toBe("x\\le 11");
    expect(decodeHwpMath("+7\u00be", "EHsang-Italic").latex).toBe("+7\\degree\\mathrm{C}");
  });

  it("글꼴을 모르면 글꼴별 표를 쓰지 않는다 — 짐작하지 않는다", () => {
    expect(decodeHwpMath("y").latex).toBe("y");
  });

  it("EHsang의 Ç·¡는 위첨자 n·8이다", () => {
    expect(decodeHwpMath("5\u00c7", "EHsang-Italic").latex).toBe("5^{n}");
    expect(decodeHwpMath("256=2\u00a1", "EHsang-Italic").latex).toBe("256=2^{8}");
  });
});

describe("겹쳐 찍은 위첨자", () => {
  /* 폭 0인 글리프는 앞 글자 위에 겹쳐 찍힌다. 코드가 본문 글자와 같아
   * (위첨자 a가 b로 온다) 글자만 봐서는 영영 알 수 없고, KaTeX는 아무
   * 오류 없이 `2b`를 그려 낸다 — 렌더 검사로는 잡히지 않는 종류다.
   * 상자는 본책 0160의 실측값이다. */
  const boxes = (widths: number[]): [number, number, number, number][] => {
    let x = 0;
    return widths.map((w) => {
      const box: [number, number, number, number] = [x, 216.27, x + w, 228.73];
      x += w;
      return box;
    });
  };

  it("폭 0인 글자를 위첨자로 표시한다", () => {
    // "2" + 폭 0인 "b"  →  2^a
    const marked = markSuperscripts("2b", boxes([5.25, 0]));
    expect(decodeHwpMath(marked, "EHsang-Italic").latex).toBe("2^{a}");
  });

  it("폭이 있는 b는 그대로 변수 b다", () => {
    const marked = markSuperscripts("2b", boxes([5.25, 5.25]));
    expect(decodeHwpMath(marked, "EHsang-Italic").latex).toBe("2b");
  });

  it("본책 0160의 발문 조각을 지면대로 옮긴다", () => {
    // 「2^a×3²×5」 — 폭 0인 b · 백틱 · _ · 3 · 폭 0인 Û · 백틱 · _ · 5
    const marked = markSuperscripts(
      "b`_3\u00db`_5",
      boxes([0, 2.62, 10.5, 5.25, 0, 2.62, 10.5, 5.25]),
    );
    expect(decodeHwpMath(marked, "EHsang-Italic").latex).toBe(
      "^{a}\\times 3^{2}\\times 5",
    );
  });

  it("글자 상자가 없으면 원문을 그대로 둔다 — 없는 근거로 판단하지 않는다", () => {
    expect(markSuperscripts("2b", undefined)).toBe("2b");
  });

  it("상자 개수가 글자 수와 어긋나면 손대지 않는다", () => {
    expect(markSuperscripts("2b", boxes([5.25]))).toBe("2b");
  });
});
