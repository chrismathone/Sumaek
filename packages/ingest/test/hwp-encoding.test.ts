import { describe, expect, it } from "vitest";
import { cleanBodyText, decodeHwpMath } from "../src/hwp-encoding";

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

  it("대조하지 않은 지수 글리프는 통과시키지 않고 unknown에 담는다", () => {
    /* á는 배치상 8일 것으로 보이지만 이 교재 1단원에 나오지 않아
     * 확인한 적이 없다. 추정으로 표에 넣지 않는다. */
    const got = decodeHwpMath("2á`");
    expect(got.unknown).toContain("á");
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
    // 홀수 길이 — 분모·분자 짝이 맞지 않는다
    const got = decodeHwpMath(";1#2;");
    expect(got.unknown.length).toBeGreaterThan(0);
    expect(got.latex).toContain(";1#2;");
  });

  it("두 자리 분수의 자리표시자가 다른 수식과 섞여도 제자리에 돌아온다", () => {
    expect(decodeHwpMath("2Û`_;1#2%;_3").latex).toBe(
      "2^{2}\\times \\frac{35}{12}\\times 3",
    );
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
