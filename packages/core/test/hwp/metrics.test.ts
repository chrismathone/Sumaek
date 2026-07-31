import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { estimateEquationSize } from "../../src/hwp/metrics";

/* ─────────────────────────────────────────────────────────────
 * 수식 크기 추정기 회귀 테스트.
 *
 * 골든셋은 정답 HWPX(조암중 해제본 Contents/section0.xml)에서 뽑은 84개 수식의
 * **실측** (script, width, height) 이다. 한컴이 실제로 문서에 적은 값이므로
 * 이보다 나은 정답은 없다.
 *
 * 원본 게이트: D:\시험지 한글화\tests\test_equation_metrics.py
 *   width MAPE ≤ 8% / median ≤ 6% / p95 ≤ 20% / height 정확도 ≥ 95% / zero-width 0건
 * 원본 v5 튠 달성치는 MAPE 6.54%, median 4.18%, p95 18.59%.
 *
 * 이 게이트가 깨지면 mappings.ts 의 폰트 메트릭·튜닝 상수를 건드렸다는 뜻이다.
 * ───────────────────────────────────────────────────────────── */

interface GoldenSample {
  script: string;
  width: number;
  height: number;
}

const FIXTURE = fileURLToPath(
  new URL("./fixtures/golden_equations.json", import.meta.url),
);
const SAMPLES = JSON.parse(readFileSync(FIXTURE, "utf-8")) as GoldenSample[];

/** 각 표본의 상대 오차 |추정 - 실측| / 실측 */
const RELATIVE_ERRORS = SAMPLES.map((s) => {
  const est = estimateEquationSize(s.script);
  return Math.abs(est.width - s.width) / Math.max(s.width, 1);
});
const SORTED_ERRORS = [...RELATIVE_ERRORS].sort((a, b) => a - b);
const HEIGHT_OK = SAMPLES.filter(
  (s) => estimateEquationSize(s.script).height === s.height,
).length;

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;

describe("estimateEquationSize — 골든셋 84개 회귀", () => {
  it("골든셋이 84개 그대로다", () => {
    // 개수가 바뀌면 아래 임계값들의 근거(원본 튠 결과)가 무효가 된다.
    expect(SAMPLES.length).toBe(84);
  });

  it("height 정확도 95% 이상 (1200/2400 이진값)", () => {
    const acc = HEIGHT_OK / SAMPLES.length;
    expect(acc, `height 정확도 ${pct(acc)}`).toBeGreaterThanOrEqual(0.95);
  });

  it("width 평균 상대 오차(MAPE) 8% 이하", () => {
    const mape =
      RELATIVE_ERRORS.reduce((a, b) => a + b, 0) / RELATIVE_ERRORS.length;
    expect(mape, `width MAPE ${pct(mape)}`).toBeLessThanOrEqual(0.08);
  });

  it("width 중간값 오차 6% 이하", () => {
    const median = SORTED_ERRORS[Math.floor(SORTED_ERRORS.length / 2)] as number;
    expect(median, `width median ${pct(median)}`).toBeLessThanOrEqual(0.06);
  });

  it("width 95 백분위 오차 20% 이하", () => {
    const p95 = SORTED_ERRORS[
      Math.floor(SORTED_ERRORS.length * 0.95)
    ] as number;
    expect(p95, `width p95 ${pct(p95)}`).toBeLessThanOrEqual(0.2);
  });

  it("zero-width 0건 (0폭 수식은 옆 글자와 겹친다)", () => {
    const zero = SAMPLES.filter(
      (s) => estimateEquationSize(s.script).width <= 0,
    );
    expect(zero.map((s) => s.script)).toEqual([]);
  });

  it("모든 수식 width >= 400 hwpunit", () => {
    for (const s of SAMPLES) {
      const { width } = estimateEquationSize(s.script);
      expect(width, `${JSON.stringify(s.script)}`).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("estimateEquationSize — 자주 쓰는 패턴", () => {
  it("분수는 2단 높이(2400)", () => {
    expect(estimateEquationSize("{a} over {b}").height).toBe(2400);
  });

  it("선형식은 1단 높이(1200)", () => {
    expect(estimateEquationSize("x + y + z").height).toBe(1200);
  });

  it("근호는 2단 높이", () => {
    expect(estimateEquationSize("sqrt {x+1}").height).toBe(2400);
  });

  it("대형 연산자는 2단 높이", () => {
    expect(estimateEquationSize("SUM _{i=1} ^{n} a _{i}").height).toBe(2400);
  });

  it("한글이 섞여도 폭이 나온다", () => {
    const { width } = estimateEquationSize('"의 곱의 계수의 합"을 a');
    expect(width).toBeGreaterThan(0);
  });

  it("SQUARE 는 심볼 키워드 한 덩어리로 센다(6글자 분해 회귀 방지)", () => {
    // 정답 샘플에서 SQUARE 단독 폭은 약 850 hwpunit. 6글자로 분해되면 4000+.
    expect(estimateEquationSize("SQUARE").width).toBeLessThan(2500);
  });

  it("첨자는 50% 축소로 계산한다", () => {
    // 같은 문자라도 첨자로 들어가면 본문보다 좁아야 한다.
    const inline = estimateEquationSize("xnn").width;
    const scripted = estimateEquationSize("x_{nn}").width;
    expect(scripted).toBeLessThan(inline);
  });

  it("LEFT/RIGHT 자동크기 괄호는 폭을 크게 늘린다", () => {
    const plain = estimateEquationSize("(x)").width;
    const auto = estimateEquationSize("LEFT ( x RIGHT )").width;
    expect(auto).toBeGreaterThan(plain);
  });
});
