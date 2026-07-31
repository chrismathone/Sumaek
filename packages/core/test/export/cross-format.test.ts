import { describe, expect, it } from "vitest";

import { CROSS_FORMAT_TARGETS, verifyCrossFormat } from "../../src/export";
import type { RenderedExpression } from "../../src/export";
import { semanticFingerprint } from "../../src/math";

/* ─────────────────────────────────────────────────────────────
 * 게시 게이트 G-09 — web·pdf·hwpx 의 수식이 같은 id·같은 의미인지.
 *
 * 이 검사가 잡으려는 실패는 전부 "조용한" 것들이다: 파일은 열리고 페이지는
 * 나오는데 인쇄본의 부등호만 슬쩍 바뀌어 있는 종류. 그래서 지문 비교는 실제
 * semanticFingerprint 로 돌려 의미가 같고 다름을 진짜로 판정하게 한다.
 * ───────────────────────────────────────────────────────────── */

/** 세 형식 모두 같은 지문으로 렌더된 수식 하나를 만든다. */
function renderedEverywhere(
  expressionId: string,
  latex: string,
): RenderedExpression[] {
  const fingerprint = semanticFingerprint(latex);
  return CROSS_FORMAT_TARGETS.map((target) => ({
    expressionId,
    target,
    semanticFingerprint: fingerprint,
  }));
}

describe("형식 간 수식 일치 — 통과", () => {
  it("세 형식이 같은 id·같은 지문이면 통과한다", () => {
    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1", "e2"],
      rendered: [
        ...renderedEverywhere("e1", "x^2 + 1"),
        ...renderedEverywhere("e2", "\\frac{a}{b}"),
      ],
    });
    expect(report.passed).toBe(true);
    expect(report.verifiedCount).toBe(2);
    expect(report.missing).toEqual([]);
    expect(report.mismatched).toEqual([]);
  });

  it("표시 전용 차이만 다르면 통과한다", () => {
    // 지문이 흡수하는 것은 표시 전용 차이뿐이다: 분수 동의어(\dfrac→\frac),
    // 괄호 크기(\left·\right), 간격, 공백. 구조 중괄호나 부등호 방향은 흡수하지
    // 않는다 — 그것까지 같다고 보면 의미가 바뀐 산출물을 통과시키게 된다.
    const web = semanticFingerprint("\\dfrac{a}{b}");
    const pdf = semanticFingerprint("\\frac{a}{b}");
    const hwpx = semanticFingerprint("\\frac{a}{b}  ");
    expect(new Set([web, pdf, hwpx]).size).toBe(1);

    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1"],
      rendered: [
        { expressionId: "e1", target: "web", semanticFingerprint: web },
        { expressionId: "e1", target: "pdf", semanticFingerprint: pdf },
        { expressionId: "e1", target: "hwpx", semanticFingerprint: hwpx },
      ],
    });
    expect(report.passed).toBe(true);
  });

  it("구조 중괄호 차이는 흡수하지 않는다 (보수적 판정)", () => {
    // x^{2} 와 x^2 는 사람 눈에 같지만 지문은 다르게 본다. 이 보수성은 의도된
    // 것이라(fingerprint.ts) 형식 간 검증도 이를 불일치로 신고한다.
    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1"],
      rendered: [
        {
          expressionId: "e1",
          target: "web",
          semanticFingerprint: semanticFingerprint("x^{2}"),
        },
        {
          expressionId: "e1",
          target: "pdf",
          semanticFingerprint: semanticFingerprint("x^{2}"),
        },
        {
          expressionId: "e1",
          target: "hwpx",
          semanticFingerprint: semanticFingerprint("x^2"),
        },
      ],
    });
    expect(report.passed).toBe(false);
    expect(report.mismatched).toHaveLength(1);
  });

  it("기대 목록이 비어 있으면 통과한다 (수식 없는 문항)", () => {
    const report = verifyCrossFormat({ expectedExpressionIds: [], rendered: [] });
    expect(report.passed).toBe(true);
    expect(report.verifiedCount).toBe(0);
  });

  it("같은 (id, target) 이 중복돼도 첫 값으로 판정한다", () => {
    const fingerprint = semanticFingerprint("x+1");
    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1"],
      rendered: [
        ...renderedEverywhere("e1", "x+1"),
        { expressionId: "e1", target: "web", semanticFingerprint: fingerprint },
      ],
    });
    expect(report.passed).toBe(true);
  });
});

describe("형식 간 수식 일치 — 누락", () => {
  it("한 형식에서 수식이 통째로 빠지면 잡는다", () => {
    const fingerprint = semanticFingerprint("\\sqrt{2}");
    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1"],
      rendered: [
        { expressionId: "e1", target: "web", semanticFingerprint: fingerprint },
        { expressionId: "e1", target: "pdf", semanticFingerprint: fingerprint },
      ],
    });
    expect(report.passed).toBe(false);
    expect(report.missing).toEqual([
      { expressionId: "e1", missingTargets: ["hwpx"] },
    ]);
    expect(report.verifiedCount).toBe(0);
  });

  it("어느 형식에도 없는 수식은 세 형식 모두 누락으로 보고한다", () => {
    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1"],
      rendered: [],
    });
    expect(report.missing[0]?.missingTargets).toEqual(["web", "pdf", "hwpx"]);
  });

  it("검사 대상 형식을 좁히면 그 형식만 본다", () => {
    const fingerprint = semanticFingerprint("x");
    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1"],
      rendered: [
        { expressionId: "e1", target: "web", semanticFingerprint: fingerprint },
      ],
      targets: ["web"],
    });
    expect(report.passed).toBe(true);
  });
});

describe("형식 간 수식 일치 — 의미 불일치", () => {
  it("HWPX 변환이 의미를 바꾸면 잡는다", () => {
    // 실제 위험 사례: 부등호가 \le → < 로 떨어지는 손실.
    const intended = semanticFingerprint("a \\le b");
    const degraded = semanticFingerprint("a < b");
    expect(intended).not.toBe(degraded);

    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1"],
      rendered: [
        { expressionId: "e1", target: "web", semanticFingerprint: intended },
        { expressionId: "e1", target: "pdf", semanticFingerprint: intended },
        { expressionId: "e1", target: "hwpx", semanticFingerprint: degraded },
      ],
    });
    expect(report.passed).toBe(false);
    expect(report.mismatched).toHaveLength(1);
    expect(report.mismatched[0]?.expressionId).toBe("e1");
    expect(report.mismatched[0]?.fingerprints.hwpx).toBe(degraded);
    expect(report.mismatched[0]?.fingerprints.web).toBe(intended);
  });

  it("불일치한 수식은 확인 수에 넣지 않는다", () => {
    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1", "e2"],
      rendered: [
        ...renderedEverywhere("e1", "x+1"),
        { expressionId: "e2", target: "web", semanticFingerprint: "A" },
        { expressionId: "e2", target: "pdf", semanticFingerprint: "A" },
        { expressionId: "e2", target: "hwpx", semanticFingerprint: "B" },
      ],
    });
    expect(report.verifiedCount).toBe(1);
    expect(report.passed).toBe(false);
  });
});

describe("형식 간 수식 일치 — 초과", () => {
  it("기대 목록에 없는 수식이 산출물에 있으면 잡는다", () => {
    const report = verifyCrossFormat({
      expectedExpressionIds: ["e1"],
      rendered: [
        ...renderedEverywhere("e1", "x"),
        ...renderedEverywhere("e-stale", "y"),
      ],
    });
    expect(report.passed).toBe(false);
    expect(report.unexpected).toEqual([
      { expressionId: "e-stale", targets: ["web", "pdf", "hwpx"] },
    ]);
  });

  it("누락·불일치·초과가 겹쳐도 각각 보고한다", () => {
    const report = verifyCrossFormat({
      expectedExpressionIds: ["missing", "mismatch"],
      rendered: [
        { expressionId: "mismatch", target: "web", semanticFingerprint: "A" },
        { expressionId: "mismatch", target: "pdf", semanticFingerprint: "A" },
        { expressionId: "mismatch", target: "hwpx", semanticFingerprint: "B" },
        ...renderedEverywhere("stale", "z"),
      ],
    });
    expect(report.missing).toHaveLength(1);
    expect(report.mismatched).toHaveLength(1);
    expect(report.unexpected).toHaveLength(1);
    expect(report.passed).toBe(false);
  });
});
