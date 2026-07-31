import { describe, expect, it } from "vitest";
import { latexToHwpEq } from "../../src/hwp/convert";

/* ─────────────────────────────────────────────────────────────
 * LaTeX → HWP 수식 스크립트 회귀 테스트.
 *
 * 케이스는 원본 D:\시험지 한글화\tests\test_render_fixes.py 의 latex_to_hwpeq
 * 회귀 검증(chk 헬퍼 호출)에서 이식했다. `name` 의 알파벳 라벨(G·I·L·N·O·O2…)과
 * 학교/문항 번호는 원본 테스트의 섹션 표기 그대로다 — 원본 실패 사례를 추적할 수 있게.
 *
 * **기대값은 원본 Python 변환기의 실제 출력을 그대로 옮긴 것**이며, 손으로 적은
 * 값이 아니다. 이식 시 전체 코퍼스(고정 249건 + 문법 퍼저 3000건)에 대해
 * 원본과 문자열 단위 완전 일치를 확인했다.
 *
 * 값이 이상해 보여도 임의로 고치지 말 것 — 대부분 한컴 렌더러의 실측 특성에
 * 맞춘 우회다(예: `\square` 가 키워드가 아니라 따옴표 리터럴 "□" 인 것).
 * ───────────────────────────────────────────────────────────── */

interface Case {
  /** 원본 테스트의 섹션 라벨 + 사유 */
  name: string;
  latex: string;
  /** 기대 HWP 수식 스크립트 */
  script: string;
  /** 본문 경로(기하 점 \mathrm{P} 보존)는 false — 원본 italicize_stat 인자 */
  italicizeStat?: boolean;
}

const CASES: Case[] = [
  /* ── 구조 ── */
  {
    name: "분수 \\frac → over",
    latex: "\\frac{1}{2}",
    script: "{1} over {2}",
  },
  {
    name: "분수 \\dfrac 동일 처리",
    latex: "\\dfrac{a+b}{c-d}",
    script: "{a+b} over {c-d}",
  },
  {
    name: "근호 \\sqrt → sqrt",
    latex: "\\sqrt{x}",
    script: "sqrt {x}",
  },
  {
    name: "n제곱근 \\sqrt[n] → root of",
    latex: "\\sqrt[3]{8}",
    script: "root {3} of {8}",
  },
  {
    name: "대형연산자 상·하한",
    latex: "\\sum_{i=0}^{n} i",
    script: "SUM _{i=0} ^{n} i",
  },
  {
    name: "적분 상·하한",
    latex: "\\int_{a}^{b} f(x) dx",
    script: "INT _{a} ^{b} f(x) dx",
  },
  {
    name: "이항계수 \\binom → atop",
    latex: "\\binom{n}{k}",
    script: "LEFT ( {n} atop {k} RIGHT )",
  },
  {
    name: "조건식 \\begin{cases} → CASES",
    latex: "\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}",
    script: "CASES {x+y=5 # x-y=1}",
  },
  {
    name: "행렬 \\begin{bmatrix} → BMATRIX",
    latex: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}",
    script: "BMATRIX {a & b # c & d}",
  },
  {
    name: "vmatrix → DMATRIX",
    latex: "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}",
    script: "DMATRIX {a & b # c & d}",
  },
  {
    name: "첨자는 항상 중괄호(탐욕 지수 방지)",
    latex: "(2x-5y)^2 = 4x^2-20xy+25y^2",
    script: "(2x-5y)^{2} = 4x^{2}-20xy+25y^{2}",
  },
  {
    name: "중괄호 없는 명령어 첨자 보호 45^\\circ",
    latex: "45^\\circ",
    script: "45^{°}",
  },
  {
    name: "중괄호 없는 그리스 첨자",
    latex: "x_\\alpha",
    script: "x_{alpha}",
  },

  /* ── G ── */
  {
    name: "overline 앞 공백 — 상인고 #24",
    latex: "2i\\overline{z}",
    script: "2i bar {z}",
  },
  {
    name: "overline 식 중간",
    latex: "(4+3i)z+2i\\overline{z}=5+i",
    script: "(4+3i)z+2i bar {z}=5+i",
  },

  /* ── I ── */
  {
    name: "bigstar(★) 마커 — 상인고 수1 #12",
    latex: "\\cdots\\cdots (\\bigstar)",
    script: "CDOTS CDOTS (\"★\")",
  },

  /* ── L ── */
  {
    name: "rm 키워드 앞 공백 + 단위 백틱 — 매천중 #7",
    latex: "x\\mathrm{km}",
    script: "x rm`km",
  },
  {
    name: "m 은 단위 아님(모평균 보호)",
    latex: "400\\mathrm{m}",
    script: "400 rm it {m}",
  },

  /* ── N ── */
  {
    name: "점 P(a,b) = rm P + it 좌표 — 도원중 #10",
    latex: "\\mathrm{P}\\mathit{(a, b)}",
    script: "rm P it {(a,~b)}", italicizeStat: false,
  },

  /* ── O ── */
  {
    name: "\\mathit → it {…}",
    latex: "\\mathit{(a, b)}",
    script: "it {(a,~b)}", italicizeStat: false,
  },
  {
    name: "변수+단위 백틱",
    latex: "a\\mathrm{cm}",
    script: "a rm`cm", italicizeStat: false,
  },
  {
    name: "mathrm 숫자+단위 백틱",
    latex: "5\\mathrm{cm}",
    script: "5 rm`cm", italicizeStat: false,
  },

  /* ── O2 ── */
  {
    name: "숫자+L 단위 — 범물중 #22",
    latex: "1L",
    script: "1 rm`L",
  },
  {
    name: "변수+L 단위",
    latex: "yL",
    script: "y rm`L",
  },
  {
    name: "변수+km 무공백",
    latex: "xkm",
    script: "x rm`km",
  },
  {
    name: "모평균 2m 보호(이탤릭 유지)",
    latex: "2m",
    script: "2m",
  },
  {
    name: "변수곱 ag 보호(단일기호 g 제외)",
    latex: "ag",
    script: "ag",
  },
  {
    name: "첨자 a_1L 보호",
    latex: "a_1L",
    script: "a_{1}L",
  },

  /* ── O4 ── */
  {
    name: "함수콜 2g(x) 단위 제외 — 경산여고 수2 #9",
    latex: "2g(x)",
    script: "2g(x)",
  },
  {
    name: "함수콜 aL(t) 단위 제외",
    latex: "aL(t)",
    script: "aL(t)",
  },
  {
    name: "진짜 단위 2g 는 로만",
    latex: "2g",
    script: "2 rm`g",
  },
  {
    name: "진짜 단위 5cm 는 로만",
    latex: "5cm",
    script: "5 rm`cm",
  },

  /* ── O5 ── */
  {
    name: "\\limits 는 no-op — 진명여고 수2",
    latex: "\\lim\\limits_{x \\to 0} f(x)",
    script: "lim _{x -> 0} f(x)",
  },
  {
    name: "\\sum\\limits 잔여 'its' 없음",
    latex: "\\sum\\limits_{k=1}^{n} k",
    script: "SUM _{k=1} ^{n} k",
  },

  /* ── O3 ── */
  {
    name: "lim 첨자는 연산자 아래(빈그룹 금지)",
    latex: "\\lim_{x \\to 0} \\frac{2x-8}{x^4+x+2}",
    script: "lim _{x -> 0} {2x-8} over {x^{4}+x+2}",
  },
  {
    name: "max 아래첨자",
    latex: "\\max_{x} f(x)",
    script: "max _{x} f(x)",
  },
  {
    name: "조합 좌측첨자는 빈그룹 유지 — 혜화여고 #19",
    latex: "_{n-1}\\mathrm{C}_{r-1}",
    script: "{}_{n-1}rm C_{r-1}",
  },
  {
    name: "대형연산자 하한 무회귀",
    latex: "\\sum_{k=1}^{n} k",
    script: "SUM _{k=1} ^{n} k",
  },

  /* ── O6 ── */
  {
    name: "집합 조건제시법 \\middle — 현풍고 서답형4",
    latex: "B = \\left\\{\\frac{x+a}{3} \\middle| x \\in A\\right\\}",
    script: "B = LEFT { {x+a} over {3} RIGHT | x in A RIGHT }",
  },
  {
    name: "수열 괄호 자동크기(맨 중괄호)",
    latex: "\\left\\{\\frac{n}{n+2}\\right\\}",
    script: "LEFT { {n} over {n+2} RIGHT }",
  },
  {
    name: "중첩 대괄호-중괄호",
    latex: "3\\left[x+4\\left\\{x-1\\right\\}\\right]",
    script: "3 LEFT [ x+4 LEFT { x-1 RIGHT } RIGHT ]",
  },
  {
    name: "bare \\{ \\} 는 따옴표 리터럴",
    latex: "\\{7, 13\\}",
    script: "\"{\"7,~13\"}\"",
  },
  {
    name: "절댓값 구분자",
    latex: "\\left| \\frac{a}{b} \\right|",
    script: "LEFT | {a} over {b} RIGHT |",
  },
  {
    name: "고아 \\middle 은 구분자만",
    latex: "x \\middle| y",
    script: "x | y",
  },

  /* ── KSY ── */
  {
    name: "\\lt 부등호 증발 방지 — 경상여고 #9",
    latex: "\\cos\\theta\\tan\\theta \\lt 0",
    script: "cos theta tan theta < 0",
  },
  {
    name: "\\gt 부등호",
    latex: "\\sin\\theta\\cos\\theta \\gt 0",
    script: "sin theta cos theta > 0",
  },
  {
    name: "좌표 쉼표 강제공백 — 경상여고 #11",
    latex: "\\mathrm{P}(25,3)",
    script: "rm P(25,~3)", italicizeStat: false,
  },
  {
    name: "기존 ,~ 이중틸드 금지",
    latex: "(b,~-2)",
    script: "(b,~-2)", italicizeStat: false,
  },
  {
    name: "첨자 쉼표 보존",
    latex: "a_{1,2}",
    script: "a_{1,2}", italicizeStat: false,
  },
  {
    name: "\\mathrm 뒤 소문자 변수 로만 번짐 차단",
    latex: "\\mathrm{pH} = -\\log x",
    script: "rm pH it = - log x", italicizeStat: false,
  },
  {
    name: "뒤가 전부 로만이면 it 미삽입",
    latex: "\\angle\\mathrm{A}=\\angle\\mathrm{B}",
    script: "angle rm A= angle rm B", italicizeStat: false,
  },
  {
    name: "단독 \\mathrm 은 it 미삽입",
    latex: "\\mathrm{pH}",
    script: "rm pH", italicizeStat: false,
  },

  /* ── J ── */
  {
    name: "\\boxed 빈칸 라벨 → 괄호한글",
    latex: "\\boxed{가}",
    script: "BOX{ ~ ㈎ ~ }",
  },
  {
    name: "\\boxed 식 중간 2개",
    latex: "2 - \\frac{1}{k} + \\boxed{나} < \\boxed{다}",
    script: "2 - {1} over {k} + BOX{ ~ ㈏ ~ } < BOX{ ~ ㈐ ~ }",
  },

  /* ── Q ── */
  {
    name: "sqrt 글자 앞 공백 — 중앙중 #4",
    latex: "a\\sqrt{2}+b\\sqrt{6}",
    script: "a sqrt {2}+b sqrt {6}",
  },
  {
    name: "root 글자 앞 공백",
    latex: "a\\sqrt[3]{8}",
    script: "a root {3} of {8}",
  },

  /* ── Q2 ── */
  {
    name: "행렬 키워드 앞 공백 — 상원고 서답형4",
    latex: "A\\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix}=\\begin{pmatrix} k \\\\ 1 \\end{pmatrix}",
    script: "A PMATRIX {1 # 2}=PMATRIX {k # 1}",
  },

  /* ── U ── */
  {
    name: "점좌표 선택지 로만+이탤릭 — 대륜중 #1",
    latex: "\\mathrm{B}\\mathit{(-3, 1)}",
    script: "rm B it {(-3,~1)}", italicizeStat: false,
  },

  /* ── V ── */
  {
    name: "순환소수 dot 표기 — 경명여중 #1",
    latex: "0.1\\dot{5}\\dot{7}",
    script: "0.1 dot {5} dot {7}",
  },
  {
    name: "순환마디 중간 일반숫자 보존",
    latex: "0.\\dot{3}7\\dot{5}",
    script: "0. dot {3}7 dot {5}",
  },

  /* ── 전처리 ── */
  {
    name: "유니코드 위첨자 → 지수 객체",
    latex: "N(m, 2²)",
    script: "N(m,~2^{2})",
  },
  {
    name: "유니코드 부등호 → LEQ/GEQ/neq",
    latex: "a ≤ b ≥ c ≠ d",
    script: "a LEQ b GEQ c neq d",
  },
  {
    name: "\\not\\in 의미 반전 방지",
    latex: "x \\not\\in A",
    script: "x notin A",
  },
  {
    name: "\\textcircled 숫자 → 유니코드 동그라미",
    latex: "\\textcircled{1}",
    script: "①",
  },
  {
    name: "평문 괄호 자동크기(분수 포함)",
    latex: "(\\frac{1}{2})",
    script: "LEFT ( {1} over {2} RIGHT )",
  },

  /* ── 라벨 ── */
  {
    name: "도형 라벨 연속 대문자 정자화",
    latex: "\\triangle ABC \\sim \\triangle DEF",
    script: "TRIANGLE rm {ABC} ∽ TRIANGLE rm {DEF}",
  },
  {
    name: "\\text 대문자 라벨은 rm(따옴표 아님)",
    latex: "\\text{ABCD}",
    script: "rm {ABCD}",
  },

  /* ── 공백 ── */
  {
    name: "\\quad 은 쉼표 뒤에서도 보존",
    latex: "A=1, \\quad B=2",
    script: "A=1,~~~ B=2", italicizeStat: false,
  },
  {
    name: "함수명 앞뒤 공백 보장",
    latex: "S=\\frac{1}{2}ab\\sin C",
    script: "S={1} over {2}ab sin C",
  },
];

describe("latexToHwpEq — 원본 회귀 케이스", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const got = latexToHwpEq(c.latex, {
        italicizeStat: c.italicizeStat ?? true,
      });
      expect(got.script).toBe(c.script);
    });
  }

  it("케이스 수가 이식 기준(25건) 이상", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 원본이 문자열 동등이 아니라 "이런 문자열이 나오면 안 된다"로 검증하던
 * 항목들. 실패 시 무엇이 깨졌는지가 기대값보다 사유에서 더 잘 드러난다.
 * ───────────────────────────────────────────────────────────── */

describe("latexToHwpEq — 렌더 파손 가드", () => {
  const script = (latex: string, italicizeStat = true): string =>
    latexToHwpEq(latex, { italicizeStat }).script;

  it("G: accent 키워드가 앞 글자에 붙어 식별자로 오인되지 않는다", () => {
    // `2i\overline{z}` → `2ibar` 가 되면 HWP 가 "2ibar" 를 식별자로 렌더한다.
    expect(script("2i\\overline{z}")).not.toContain("2ibar");
    expect(script("(4+3i)z+2i\\overline{z}=5+i")).not.toContain("2ibar");
  });

  it("Q: sqrt/root 키워드도 글자 앞에서 분리된다", () => {
    expect(script("a\\sqrt{2}+b\\sqrt{6}")).not.toContain("asqrt");
    expect(script("a\\sqrt{2}+b\\sqrt{6}")).not.toContain("bsqrt");
    expect(script("(a+b\\sqrt{c})\\mathrm{cm}^2")).not.toContain("bsqrt");
    expect(script("a\\sqrt[3]{8}")).not.toContain("aroot");
  });

  it("Q2: 행렬 키워드가 앞 글자에 붙지 않는다(APMATRIX 방지)", () => {
    const qm = script(
      "A\\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix}=\\begin{pmatrix} k \\\\ 1 \\end{pmatrix}",
    );
    expect(qm).not.toContain("APMATRIX");
    expect(qm).toContain("A PMATRIX");
  });

  it("O5: \\limits 잔여 'its' 가 남지 않고 no-op 이다", () => {
    expect(script("\\lim\\limits_{x \\to 0} f(x)")).not.toContain("its");
    expect(script("\\sum\\limits_{k=1}^{n} k")).not.toContain("its");
    expect(script("\\lim\\limits_{x \\to 0} f")).toBe(
      script("\\lim_{x \\to 0} f"),
    );
  });

  it("O3: 극한형 연산자 첨자에는 빈그룹 베이스를 넣지 않는다", () => {
    // `lim {}_{x->0}` 이면 첨자가 lim 아래가 아니라 우측에 붙어 깨진다.
    for (const latex of [
      "\\lim_{x \\to 0} \\frac{2x-8}{x^4+x+2}",
      "\\max_{x} f(x)",
      "\\min_{n} a_n",
      "\\sup_{x} f",
      "\\lim_{x \\to \\infty} \\frac{f(x)}{x}",
      "\\sum_{k=1}^{n} k",
    ]) {
      expect(script(latex)).not.toContain("{}_{");
    }
    // 반대로 베이스 없는 조합 좌측첨자는 빈그룹이 있어야 렌더된다.
    expect(script("_{n-1}\\mathrm{C}_{r-1}")).toContain("{}_{n-1}");
  });

  it("O6: \\mid 매핑이 \\middle 을 접두 매칭해 'dle' 로 새지 않는다", () => {
    expect(script("\\left\\{x \\middle| x>0\\right\\}")).not.toContain("dle");
    expect(
      script("\\left\\{\\frac{x+a}{5} \\,\\middle|\\, x \\in A\\right\\}"),
    ).not.toContain("dle");
  });

  it("O6: \\left\\{ 구분자는 맨 중괄호(자동크기)여야 한다", () => {
    // 따옴표 리터럴 `LEFT "{"` 는 파싱이 깨져 `" … ÿ)` 로 렌더된다.
    expect(script("\\left\\{\\frac{n}{n+2}\\right\\}")).not.toContain('"{"');
  });

  it("O4: 함수 호출 뒤 g/L 은 단위로 로만화하지 않는다", () => {
    expect(script("y=g(x)\\{3f(x)-2g(x)\\}")).not.toContain("rm`g");
    expect(script("a_1L")).not.toContain("rm`L");
  });

  it("I: \\bigstar 가 증발하지 않는다", () => {
    expect(script("\\cdots\\cdots (\\bigstar)")).toContain("★");
  });

  it("J: BOX 키워드가 rm 으로 감싸이지 않는다", () => {
    const j1 = script("\\boxed{가}");
    expect(j1).toContain("BOX{");
    expect(j1).not.toContain("rm {BOX}");
    expect(script("2 - \\frac{1}{k} + \\boxed{나} < \\boxed{다}")).toContain(
      "BOX{",
    );
  });

  it("L: rm 키워드가 앞 글자에 붙지 않는다(xrm 방지)", () => {
    expect(script("x\\mathrm{km}")).not.toContain("xrm");
    expect(script("x\\mathrm{km}")).toContain("x rm`km");
  });

  it("V: 순환소수는 bar 가 아니라 dot 로 표기한다", () => {
    const v1 = script("0.1\\dot{5}\\dot{7}");
    expect(v1).toContain("dot {5}");
    expect(v1).toContain("dot {7}");
    expect(v1).not.toContain("bar");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 원본에 없던 동작 — 미지원 토큰 리포팅.
 *
 * 원본(latex_to_hwpeq.py:1196)은 남은 `\명령` 을 정규식으로 조용히 삭제했다.
 * 그 결과 `\lt`(부등호 증발)·`\not`(∉→∈ 의미 반전) 같은 무증상 오답이 반복
 * 발생했고, 발견될 때마다 개별 우회를 덧대는 식으로 대응해 왔다.
 * 여기서는 삭제는 유지하되(스크립트 문법 보존) 삭제한 명령을 반드시 보고한다.
 * ───────────────────────────────────────────────────────────── */

describe("latexToHwpEq — 미지원 토큰 리포팅", () => {
  it("매핑에 없는 명령을 unsupported 로 보고한다", () => {
    const r = latexToHwpEq("\\foo{1}");
    expect(r.unsupported).toEqual(["\\foo"]);
    // 스크립트 자체는 여전히 유효한 HWP 문법이어야 한다.
    expect(r.script).toBe("{1}");
  });

  it("여러 미지원 명령을 중복 없이 정렬해 보고한다", () => {
    const r = latexToHwpEq("\\qux x \\foo y \\qux z");
    expect(r.unsupported).toEqual(["\\foo", "\\qux"]);
  });

  it("중첩 그룹 안쪽의 미지원 명령도 보고한다(재귀 수집)", () => {
    const r = latexToHwpEq("\\frac{\\foo}{\\sqrt{\\bar2}}");
    expect(r.unsupported).toContain("\\foo");
  });

  it("\\cfrac 은 미지원으로 보고된다(frac 패턴이 [dt]?frac 만 다룸)", () => {
    expect(latexToHwpEq("\\cfrac{1}{2}").unsupported).toContain("\\cfrac");
  });

  it("정상 변환되는 수식은 unsupported 가 비어 있다", () => {
    for (const c of CASES) {
      const r = latexToHwpEq(c.latex, {
        italicizeStat: c.italicizeStat ?? true,
      });
      expect(r.unsupported, `${c.name}: ${c.latex}`).toEqual([]);
    }
  });

  it("순수 조판 명령은 의미 손실이 없으므로 보고하지 않는다", () => {
    // 렌더 크기만 바꾸는 명령 — 삭제해도 수식의 뜻이 바뀌지 않는다.
    expect(latexToHwpEq("\\displaystyle\\frac{1}{2}").unsupported).toEqual([]);
  });

  it("호출자가 격리 판단에 쓸 수 있게 script 와 함께 반환한다", () => {
    const r = latexToHwpEq("x \\unknowncmd y");
    expect(r.unsupported.length).toBeGreaterThan(0);
    expect(typeof r.script).toBe("string");
  });
});

describe("수맥 수정: min 함수/단위 구분 (원본 잠재 결함)", () => {
  it("\\min 함수는 로만체화하지 않는다", () => {
    expect(latexToHwpEq("\\min(a, b)").script).toBe("min (a,~b)");
    expect(latexToHwpEq("\\min_{x} f(x)").script).toBe("min _{x} f(x)");
  });
  it("분(minute) 단위 min은 여전히 로만체화한다", () => {
    expect(latexToHwpEq("20 min").script).toBe("20 rm`min");
  });
});
