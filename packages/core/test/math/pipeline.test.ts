import { describe, expect, it } from "vitest";
import { fc, test as fcTest } from "@fast-check/vitest";
import {
  extractMeaningTokens,
  semanticFingerprint,
} from "../../src/math/fingerprint";
import {
  normalizeExpression,
  normalizeMixedText,
} from "../../src/math/normalize";
import { processExpression } from "../../src/math/pipeline";
import {
  renderForAuthoring,
  renderForPublish,
  hasTallMath,
} from "../../src/math/render";
import {
  checkDollarBalance,
  validateExpression,
} from "../../src/math/validate";

/* ─── 골든 코퍼스 (2Q 최소 범위의 대표 사례) ─── */

/** 게시 가능해야 하는 정상 수식 (영역별) */
const GOLDEN_VALID: Array<{ name: string; latex: string; display?: boolean }> = [
  { name: "분수", latex: "\\frac{3}{4} + \\frac{1}{2}" },
  { name: "근호", latex: "\\sqrt{2} \\times \\sqrt{8} = 4" },
  { name: "절댓값·부등식", latex: "\\left| x-2 \\right| \\le 5" },
  { name: "연립방정식", latex: "\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}", display: true },
  { name: "이차함수", latex: "y = a(x-p)^2 + q" },
  { name: "지수로그", latex: "\\log_2 8 = 3, \\quad 2^{x} = 16" },
  { name: "삼각함수", latex: "\\sin^2\\theta + \\cos^2\\theta = 1" },
  { name: "수열 합", latex: "\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}", display: true },
  { name: "극한", latex: "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1", display: true },
  { name: "적분", latex: "\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}", display: true },
  { name: "확률", latex: "P(A \\cup B) = P(A) + P(B) - P(A \\cap B)" },
  { name: "행렬", latex: "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}", display: true },
  { name: "집합", latex: "A \\subset B, \\; x \\in A \\implies x \\in B" },
  { name: "기하 각", latex: "\\angle ABC = 60^\\circ" },
  { name: "벡터", latex: "\\vec{AB} + \\vec{BC} = \\vec{AC}" },
  { name: "단위 혼합", latex: "3\\,\\mathrm{cm} \\times 4\\,\\mathrm{cm} = 12\\,\\mathrm{cm}^2" },
  { name: "순환소수", latex: "0.\\overline{3} = \\frac{1}{3}" },
  { name: "케이스 조각함수", latex: "f(x) = \\begin{cases} x^2 & (x \\ge 0) \\\\ -x & (x < 0) \\end{cases}", display: true },
];

/** 무손실 복구 후 게시 가능해야 하는 손상 사례 */
const GOLDEN_REPAIRABLE: Array<{ name: string; raw: string; expectRule: string }> = [
  { name: "JSON \\f 손상", raw: "\frac{1}{2}", expectRule: "L01_JSON_ESCAPE" },
  { name: "JSON \\t 손상", raw: "3 \times 4", expectRule: "L01_JSON_ESCAPE" },
  { name: "백슬래시 소실 sqrt", raw: "sqrt{16} = 4", expectRule: "L02_ORPHAN_CMD" },
  { name: "중복 \\left", raw: "\\left\\left( x \\right\\right)", expectRule: "L06_DUP_CMD" },
  { name: "크기구분자+left", raw: "\\Bigl\\left( \\frac{1}{2} \\Bigr\\right)", expectRule: "L07_SIZE_DELIM_TYPO" },
  { name: "over-escape 괄호", raw: "\\left\\( x \\right\\)", expectRule: "L07_SIZE_DELIM_TYPO" },
  { name: "spacing 중복", raw: "a \\;\\;\\; b", expectRule: "L09_SPACING_DEDUP" },
  { name: "유니코드 기호", raw: "3 × 4 ÷ 2 ≤ 10", expectRule: "L10_UNICODE" },
  { name: "유니코드 위첨자", raw: "x² + y³", expectRule: "L10_UNICODE" },
  { name: "dfrac 통일", raw: "\\dfrac{1}{2}", expectRule: "L13_CANONICAL_FRAC" },
];

/** 자동 보정 금지 — 검수 격리되어야 하는 사례 (2O 사람 검토 목록) */
const GOLDEN_REVIEW: Array<{ name: string; raw: string; expectFlag: string }> = [
  { name: "빈 분모", raw: "\\frac{3}{}", expectFlag: "EMPTY_FRAC_ARG" },
  { name: "빈 분자", raw: "\\frac{}{4}", expectFlag: "EMPTY_FRAC_ARG" },
  { name: "빈 근호", raw: "\\sqrt{}", expectFlag: "EMPTY_SQRT_ARG" },
  { name: "근사 기호", raw: "\\pi \\approx 3.14", expectFlag: "APPROX_SIGN" },
  { name: "수식 내 한글", raw: "x + 2 = 가로의 길이", expectFlag: "HANGUL_IN_MATH" },
];

describe("수식 파이프라인 — 골든 코퍼스", () => {
  it.each(GOLDEN_VALID)("$name: 게시 게이트 통과", ({ latex, display }) => {
    const result = processExpression(latex, display ? "display" : "inline");
    expect(result.issues).toEqual([]);
    expect(result.reviewFlags).toEqual([]);
    expect(result.status).toBe("render_validated");
    expect(result.renderHash).toBeTruthy();
    expect(result.renderedHtml).not.toContain("katex-error");
    // 접근성: MathML 동시 출력 (2P)
    expect(result.renderedHtml).toContain("<math");
  });

  it.each(GOLDEN_REPAIRABLE)(
    "$name: 무손실 복구 후 게시 가능 + 규칙 ID 기록",
    ({ raw, expectRule }) => {
      const result = processExpression(raw, "inline");
      expect(result.status).toBe("render_validated");
      expect(result.repairs.map((r) => r.ruleId)).toContain(expectRule);
    },
  );

  it.each(GOLDEN_REVIEW)(
    "$name: 자동 보정하지 않고 검수 격리",
    ({ raw, expectFlag }) => {
      const result = processExpression(raw, "inline");
      expect(result.status).toBe("review_required");
      expect(result.reviewFlags.map((f) => f.code)).toContain(expectFlag);
      // 의미 변경 보정이 적용되지 않았는지 — 빈 인자가 채워지지 않았어야 한다
      if (expectFlag === "EMPTY_FRAC_ARG") {
        expect(result.normalizedLatex).not.toContain("\\frac{3}{1}");
        expect(result.normalizedLatex).not.toContain("\\frac{0}{4}");
      }
      if (expectFlag === "APPROX_SIGN") {
        // ≈를 =로 바꾸지 않는다 (mathg-gen과 다른 지점 — 의미 보존)
        expect(result.normalizedLatex).toMatch(/\\approx|≈/);
      }
    },
  );

  it("허용 목록 밖 명령은 조용히 삭제하지 않고 보고한다", () => {
    const report = validateExpression("\\unknowncmd{x} + \\evil{y}", false);
    expect(report.ok).toBe(false);
    expect(report.unsupportedCommands).toEqual(["evil", "unknowncmd"]);
    // 명령이 입력에서 삭제되지 않음 — 검증은 비파괴
  });

  it("불균형 중괄호·환경·구분자를 위치와 함께 보고한다", () => {
    expect(validateExpression("\\frac{1}{2", false).ok).toBe(false);
    expect(
      validateExpression("\\begin{cases} x \\end{matrix}", true).ok,
    ).toBe(false);
    expect(checkDollarBalance("본문 $x+1 계속")).not.toBeNull();
    expect(checkDollarBalance("본문 $x+1$ 정상 $$y$$")).toBeNull();
  });
});

describe("수식 파이프라인 — 자동 테스트 계약 (2Q)", () => {
  const allInputs = [
    ...GOLDEN_VALID.map((g) => g.latex),
    ...GOLDEN_REPAIRABLE.map((g) => g.raw),
  ];

  it("정규화 멱등성: normalize(normalize(x)) = normalize(x)", () => {
    for (const input of allInputs) {
      const once = normalizeExpression(input).normalized;
      const twice = normalizeExpression(once).normalized;
      expect(twice).toBe(once);
    }
  });

  it("결정성: 같은 입력·버전은 같은 정규화본·지문·렌더 해시", () => {
    for (const input of allInputs) {
      const a = processExpression(input, "inline");
      const b = processExpression(input, "inline");
      expect(a.normalizedLatex).toBe(b.normalizedLatex);
      expect(a.semanticFingerprint).toBe(b.semanticFingerprint);
      expect(a.renderHash).toBe(b.renderHash);
    }
  });

  it("의미 지문: 표시 차이는 무시, 값 차이는 구분", () => {
    // 같은 의미 — dfrac vs frac, \left 유무, 간격
    expect(semanticFingerprint("\\dfrac{1}{2}")).toBe(
      semanticFingerprint("\\frac{1}{2}"),
    );
    expect(semanticFingerprint("\\left( x \\right)")).toBe(
      semanticFingerprint("( x )"),
    );
    expect(semanticFingerprint("a \\; + \\quad b")).toBe(
      semanticFingerprint("a+b"),
    );
    // 다른 의미 — 숫자, 부등호 방향
    expect(semanticFingerprint("\\frac{1}{2}")).not.toBe(
      semanticFingerprint("\\frac{1}{3}"),
    );
    expect(semanticFingerprint("x \\le 5")).not.toBe(
      semanticFingerprint("x \\ge 5"),
    );
  });

  fcTest.prop([
    fc.stringMatching(/^[0-9a-zA-Z+\-=<>{}\\ ]{0,60}$/),
  ])("속성: 정규화가 숫자·부등호 방향을 바꾸지 않는다", (input) => {
    const before = extractMeaningTokens(input);
    const after = extractMeaningTokens(normalizeExpression(input).normalized);
    expect(after.digits).toBe(before.digits);
    expect(after.relations).toEqual(before.relations);
  });

  fcTest.prop([fc.string({ maxLength: 200 })])(
    "퍼즈: 임의 입력에서 크래시 0건",
    (input) => {
      // 크래시·무한 루프 없이 항상 결과를 반환해야 한다
      const result = processExpression(input, "inline");
      expect(result.status === "render_validated" || result.status === "review_required").toBe(true);
      const mixed = normalizeMixedText(input);
      expect(typeof mixed.normalized).toBe("string");
    },
  );

  it("악성 입력: trust 명령·외부 자원은 파싱 실패 또는 격리", () => {
    const evil = [
      "\\href{javascript:alert(1)}{x}",
      "\\url{http://evil.example}",
      "\\includegraphics{http://evil.example/x.png}",
      "\\htmlStyle{color:red}{x}",
    ];
    for (const input of evil) {
      const result = processExpression(input, "inline");
      expect(result.status).toBe("review_required");
    }
  });
});

describe("렌더 계층 — 게시 vs 저작 분리 (2P)", () => {
  it("게시 렌더는 실패 시 폴백 없이 실패를 반환한다", () => {
    const bad = renderForPublish("\\frac{1}{", false);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBeTruthy();
  });

  it("게시 렌더 성공 출력에 katex-error·원시 LaTeX 폴백이 없다", () => {
    const good = renderForPublish("\\frac{1}{2}", false);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.html).not.toContain("katex-error");
      expect(good.html).not.toContain("math-raw");
    }
  });

  it("저작 렌더는 어떤 입력에도 붉은 오류를 노출하지 않는다", () => {
    for (const input of ["\\frac{1}{", "\\left( x", "\\unknown{y}", "$$$"]) {
      const html = renderForAuthoring(input, false);
      expect(html).not.toContain("katex-error");
    }
  });

  it("키 큰 수식 감지 — 선택지 세로 배치 단일 규칙", () => {
    expect(hasTallMath("\\begin{cases} x \\\\ y \\end{cases}")).toBe(true);
    expect(hasTallMath("\\frac{1}{2}")).toBe(true);
    expect(hasTallMath("x + y = 3")).toBe(false);
  });
});

describe("혼합 텍스트 정규화", () => {
  it("구분자 표준화: \\(..\\) → $..$, \\[..\\] → $$..$$", () => {
    const result = normalizeMixedText("값은 \\(x+1\\) 이고 \\[y=2x\\] 이다");
    expect(result.normalized).toContain("$x+1$");
    expect(result.normalized).toContain("$$y=2x$$");
  });

  it("$A$$B$ 글루를 분리한다", () => {
    const result = normalizeMixedText("$a+1$$b+2$");
    expect(result.normalized).toBe("$a+1$ $b+2$");
  });

  it("인라인 다행 환경을 display로 승격한다", () => {
    const result = normalizeMixedText(
      "연립방정식 $\\begin{aligned} x&=1 \\\\ y&=2 \\end{aligned}$ 을 풀어라",
    );
    expect(result.normalized).toContain("$$\\begin{aligned}");
  });

  it("수식 내 한글은 이동시키지 않고 검수 플래그만 남긴다", () => {
    const result = normalizeMixedText("$x + 2 = 세로$");
    expect(result.reviewFlags.map((f) => f.code)).toContain("HANGUL_IN_MATH");
    // 원문 구조 보존 — 한글이 수식 밖으로 이동되지 않음
    expect(result.normalized).toContain("세로");
  });
});
