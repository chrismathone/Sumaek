/**
 * HWPX 산출물 형식 검증 — ADR-0013 §6 의 C-14 대체 검증.
 *
 * 7단계 "실제 한글 앱 재열기"는 실환경 전용이라 CI 에서 돌릴 수 없다. 그 자리를
 * 메우는 자동 검사 6종이 여기 있다.
 *
 *   ① ZIP 구조 무결성 — mimetype 첫 엔트리·무압축, 필수 파일 존재
 *   ② XML 파싱 통과 — 컨테이너 안 모든 XML
 *   ③ 수식 객체 수 = 기대 수(math_expressions 수)
 *   ④ 폭 0 객체 0건
 *   ⑤ 기준선 오차 ≤ 2 pt
 *   ⑥ 골든 문서 대비 폭·높이 편차 ≤ 3%
 *
 * 이 검사를 통과한다고 한글이 예쁘게 연다는 보장은 없다 — 그건 사람이 열어봐야
 * 안다. 여기서 잡는 것은 "확실히 깨진 것"이고, 통과는 **수동 재열기 체크리스트로
 * 넘어가도 좋다**는 뜻이다. 그 이상으로 해석하지 말 것.
 */

import { unzipSync } from "fflate";

import { findElements, parseXml } from "./parse";
import { readZipEntries } from "./read";
import { EQUATION_BASE_LINE, MIMETYPE } from "./template";
import { MIMETYPE_PATH } from "./writer";

/** HWPX 라면 반드시 있어야 하는 파일. 하나라도 없으면 한글이 열지 못한다. */
const REQUIRED_ENTRIES = [
  MIMETYPE_PATH,
  "version.xml",
  "META-INF/container.xml",
  "Contents/content.hpf",
  "Contents/header.xml",
  "Contents/section0.xml",
];

/** 기준선 허용 오차(%). ADR-0013 의 ≤ 2 pt 를 baseLine 백분율로 환산한 값. */
export const BASELINE_TOLERANCE = 2;
/** 골든 문서 대비 폭·높이 허용 편차. */
export const GOLDEN_DEVIATION_TOLERANCE = 0.03;

export type HwpxIssueCode =
  | "zip_structure"
  | "xml_parse"
  | "equation_count"
  | "zero_width"
  | "baseline"
  | "golden_deviation";

/**
 * `fatal` 은 산출물을 폐기한다(document_exports.status = failed).
 * `review` 는 사람이 봐야 하지만 파일 자체는 열린다(review_required).
 */
export type HwpxIssueSeverity = "fatal" | "review";

export interface HwpxValidationIssue {
  readonly code: HwpxIssueCode;
  readonly severity: HwpxIssueSeverity;
  readonly message: string;
}

export interface HwpxValidationMetrics {
  readonly equationCount: number;
  /** 수식 폭의 최솟값(hwpunit). 0 이면 ④ 위반. */
  readonly minEquationWidth: number;
  /** 골든과 대조한 수식 수. 골든이 없으면 0. */
  readonly goldenComparedCount: number;
  /** 골든 대비 폭 편차의 최댓값(비율). 골든이 없으면 0. */
  readonly maxWidthDeviation: number;
}

export interface HwpxValidationReport {
  /** `passed` 만 게시 게이트 G-08 을 통과한다. */
  readonly status: "passed" | "review_required" | "failed";
  readonly issues: readonly HwpxValidationIssue[];
  readonly metrics: HwpxValidationMetrics;
}

export interface HwpxValidationInput {
  readonly bytes: Uint8Array;
  /**
   * 기대 수식 개수 — 보통 이 문서에 딸린 `math_expressions` 의 수.
   * 주지 않으면 ③ 을 건너뛴다(개수를 모르면 검사할 수 없다는 뜻이지,
   * 통과했다는 뜻이 아니다).
   */
  readonly expectedEquationCount?: number;
  /**
   * 골든 문서에서 뽑은 (script, width, height) 실측. 같은 script 가 있으면
   * 폭·높이를 대조한다. 없으면 ⑥ 을 건너뛴다.
   */
  readonly golden?: readonly {
    readonly script: string;
    readonly width: number;
    readonly height: number;
  }[];
}

/** 산출물을 실제로 열어보고 6종 검사를 돌린다. 예외를 던지지 않고 보고서로 답한다. */
export function validateHwpx(input: HwpxValidationInput): HwpxValidationReport {
  const issues: HwpxValidationIssue[] = [];
  const fail = (code: HwpxIssueCode, message: string): void => {
    issues.push({ code, severity: "fatal", message });
  };
  const review = (code: HwpxIssueCode, message: string): void => {
    issues.push({ code, severity: "review", message });
  };

  // ① ZIP 구조 ---------------------------------------------------------------
  let entries: ReturnType<typeof readZipEntries> = [];
  let files: Record<string, Uint8Array> = {};
  try {
    entries = readZipEntries(input.bytes);
    files = unzipSync(input.bytes);
  } catch (error) {
    fail("zip_structure", `ZIP 을 읽지 못했다: ${describeError(error)}`);
    return report(issues, emptyMetrics());
  }

  if (entries.length === 0) {
    fail("zip_structure", "ZIP 엔트리가 하나도 없다");
    return report(issues, emptyMetrics());
  }

  const first = entries[0] as (typeof entries)[number];
  if (first.name !== MIMETYPE_PATH) {
    fail("zip_structure", `첫 엔트리가 mimetype 이 아니다 (${first.name})`);
  } else {
    if (first.method !== 0) {
      fail("zip_structure", `mimetype 이 무압축이 아니다 (method=${first.method})`);
    }
    const value = new TextDecoder("utf-8").decode(first.data);
    if (value !== MIMETYPE) {
      fail("zip_structure", `mimetype 내용이 다르다 (${JSON.stringify(value)})`);
    }
  }

  for (const required of REQUIRED_ENTRIES) {
    if (!(required in files)) fail("zip_structure", `필수 파일 누락: ${required}`);
  }

  // ② XML 파싱 ---------------------------------------------------------------
  const parsed = new Map<string, ReturnType<typeof parseXml>>();
  const decoder = new TextDecoder("utf-8");
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.endsWith(".xml") && !path.endsWith(".hpf") && !path.endsWith(".rdf")) {
      continue;
    }
    try {
      parsed.set(path, parseXml(decoder.decode(bytes)));
    } catch (error) {
      fail("xml_parse", `${path} 파싱 실패: ${describeError(error)}`);
    }
  }

  const section = parsed.get("Contents/section0.xml");
  if (!section) {
    // 본문을 못 읽으면 나머지 검사는 의미가 없다. 여기서 멈추는 편이 정직하다.
    return report(issues, emptyMetrics());
  }

  const equations = findElements(section, "hp:equation");

  // ③ 수식 개수 --------------------------------------------------------------
  if (
    input.expectedEquationCount !== undefined &&
    equations.length !== input.expectedEquationCount
  ) {
    fail(
      "equation_count",
      `수식 객체 수가 기대와 다르다: 문서 ${equations.length}개, 기대 ${input.expectedEquationCount}개`,
    );
  }

  // ④ 폭 0 / ⑤ 기준선 --------------------------------------------------------
  let minEquationWidth = Number.POSITIVE_INFINITY;
  for (const equation of equations) {
    const size = findElements(equation, "hp:sz")[0];
    const width = Number(size?.attrs["width"] ?? Number.NaN);
    const script = scriptOf(equation);

    if (!Number.isFinite(width) || width <= 0) {
      fail("zero_width", `폭이 0 이거나 없는 수식: ${JSON.stringify(script)}`);
      minEquationWidth = 0;
    } else {
      minEquationWidth = Math.min(minEquationWidth, width);
    }

    const baseLine = Number(equation.attrs["baseLine"] ?? Number.NaN);
    if (!Number.isFinite(baseLine)) {
      fail("baseline", `기준선이 없는 수식: ${JSON.stringify(script)}`);
    } else if (Math.abs(baseLine - EQUATION_BASE_LINE) > BASELINE_TOLERANCE) {
      fail(
        "baseline",
        `기준선 오차 초과: ${baseLine} (기대 ${EQUATION_BASE_LINE} ±${BASELINE_TOLERANCE}) — ${JSON.stringify(script)}`,
      );
    }
  }

  // ⑥ 골든 대비 편차 ---------------------------------------------------------
  let goldenComparedCount = 0;
  let maxWidthDeviation = 0;
  if (input.golden && input.golden.length > 0) {
    const goldenByScript = new Map(input.golden.map((g) => [g.script, g]));
    for (const equation of equations) {
      const expected = goldenByScript.get(scriptOf(equation));
      if (!expected) continue;
      goldenComparedCount += 1;

      const size = findElements(equation, "hp:sz")[0];
      const width = Number(size?.attrs["width"] ?? Number.NaN);
      const height = Number(size?.attrs["height"] ?? Number.NaN);
      if (!Number.isFinite(width) || expected.width <= 0) continue;

      const deviation = Math.abs(width - expected.width) / expected.width;
      maxWidthDeviation = Math.max(maxWidthDeviation, deviation);
      if (deviation > GOLDEN_DEVIATION_TOLERANCE) {
        // 폭 추정이 어긋난 것은 레이아웃이 밀린다는 뜻이지 파일이 깨진 것은
        // 아니다 — 사람이 보고 판단할 일이라 review 로 둔다.
        review(
          "golden_deviation",
          `골든 대비 폭 편차 ${(deviation * 100).toFixed(1)}% ` +
            `(문서 ${width}, 골든 ${expected.width}) — ${JSON.stringify(expected.script)}`,
        );
      }
      if (Number.isFinite(height) && height !== expected.height) {
        review(
          "golden_deviation",
          `골든 대비 높이 불일치 (문서 ${height}, 골든 ${expected.height}) — ` +
            JSON.stringify(expected.script),
        );
      }
    }
  }

  return report(issues, {
    equationCount: equations.length,
    minEquationWidth: Number.isFinite(minEquationWidth) ? minEquationWidth : 0,
    goldenComparedCount,
    maxWidthDeviation,
  });
}

function scriptOf(equation: ReturnType<typeof parseXml>): string {
  const script = findElements(equation, "hp:script")[0];
  if (!script) return "";
  return script.children
    .map((child) => ("text" in child ? child.text : ""))
    .join("");
}

function emptyMetrics(): HwpxValidationMetrics {
  return {
    equationCount: 0,
    minEquationWidth: 0,
    goldenComparedCount: 0,
    maxWidthDeviation: 0,
  };
}

function report(
  issues: readonly HwpxValidationIssue[],
  metrics: HwpxValidationMetrics,
): HwpxValidationReport {
  const status = issues.some((i) => i.severity === "fatal")
    ? "failed"
    : issues.length > 0
      ? "review_required"
      : "passed";
  return { status, issues, metrics };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
