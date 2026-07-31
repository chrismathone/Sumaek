/**
 * HWP 수식 크기 추정 — HYhwpEQ 글꼴 메트릭 기반.
 *
 * 원본: D:\시험지 한글화\core\hwpx_writer.py
 *   _measure_hwpeq_width (:235) / _estimate_equation_size (:392)
 *
 * HWPX 는 수식 객체의 width/height 를 문서에 **직접 적어야** 한다. 값이 실제
 * 렌더 폭보다 작으면 옆 글자와 겹치고, 크면 문단이 벌어진다. 한컴이 쓰는 폰트
 * 메트릭을 그대로 구현하고, 정답 HWPX 84개에 대한 최소제곱 보정을 마지막에 건다.
 *
 * 알고리즘(원본 그대로):
 *   ① 키워드(그리스·연산자)를 알려진 폭으로 치환
 *   ② 구조 키워드(over/sqrt/LEFT …) 제거 — 렌더 폭에 기여하지 않음
 *   ③ 첨자는 50% 축소해 재귀 측정
 *   ④ 나머지 문자는 개별 폭 합산(한글 650) + 문자당 트래킹 100
 *   ⑤ 분수는 분자·분모를 0.75배로 각각 재고 max + 400
 *   ⑥ LEFT/RIGHT 1개당 1800 가산
 *   ⑦ 최종 0.8076 × w + 394, 하한 400
 * height 는 1200/2400 이진 — 분수·근호·대형연산자·행렬이 있으면 2400.
 */

import {
  HWPEQ_BINOP_SPACE,
  HWPEQ_CHAR_PAD,
  HWPEQ_CHAR_WIDTHS,
  HWPEQ_FRAC_PADDING,
  HWPEQ_FRAC_SCALE,
  HWPEQ_GLOBAL_BIAS,
  HWPEQ_GLOBAL_SCALE,
  HWPEQ_HANGUL_WIDTH,
  HWPEQ_HEIGHT_DOUBLE,
  HWPEQ_HEIGHT_SINGLE,
  HWPEQ_KEYWORD_WIDTHS,
  HWPEQ_LEFT_RIGHT_EXTRA,
  HWPEQ_MIN_WIDTH,
  HWPEQ_SUP_SUB_SCALE,
  LARGE_OP_KEYWORDS,
  STRUCT_KEYWORDS,
  SYMBOL_KEYWORDS,
} from "./mappings";

export interface EquationSize {
  /** hwpunit. HWPX `<hp:equation>` 의 width 속성에 그대로 넣는다. */
  width: number;
  /** hwpunit. 1200(1단) 또는 2400(2단). */
  height: number;
}

/** 폭 계산이 끝난 키워드 자리를 막는 표식 — 재매칭 방지 */
const CONSUMED = "\u0001";

/** 키워드 폭 미등록 시 기본값 (원본 `.get(kw, 500)`) */
const DEFAULT_KEYWORD_WIDTH = 500;
/** 첨자 문자 폭 미등록 시 기본값 */
const DEFAULT_CHAR_WIDTH = 500;

function replaceAllLiteral(s: string, find: string, repl: string): string {
  if (find === "") return s;
  return s.split(find).join(repl);
}

/** 한글 음절(U+AC00~U+D7A3) 또는 한자(U+4E00~U+9FFF) */
function isWideCjk(ch: string): boolean {
  return (ch >= "가" && ch <= "힣") || (ch >= "\u4e00" && ch <= "\u9fff");
}

/**
 * HWP 수식 스크립트의 렌더링 너비를 HYhwpEQ 폰트 메트릭으로 측정.
 *
 * @param script HWP 수식 스크립트
 * @param scale 크기 비율 (1.0=본문, 0.75=분수, 0.50=첨자)
 * @returns 너비 (hwpunit, 보정 전)
 */
export function measureHwpEqWidth(script: string, scale = 1.0): number {
  let s = script;

  // 0. XML 엔티티 디코드 — 행렬 구분자 &가 &amp; 로 들어오는 케이스 등.
  s = replaceAllLiteral(s, "&amp;", "&");
  s = replaceAllLiteral(s, "&lt;", "<");
  s = replaceAllLiteral(s, "&gt;", ">");
  s = replaceAllLiteral(s, "&quot;", '"');

  // 이스케이프 중괄호는 실제 괄호 문자 폭으로 근사(폭 테이블에 { } 가 없음).
  s = replaceAllLiteral(s, "\\{", "(");
  s = replaceAllLiteral(s, "\\}", ")");

  // 구문용 공백 제거: "10 ^{5}" → "10^{5}" (공백은 시각적 너비에 기여하지 않음)
  s = s.replace(/\s+([\^_])/g, "$1");
  s = s.replace(/([\^_])\s+/g, "$1");

  let width = 0;

  // 1. 기호 키워드 → 알려진 폭 (긴 이름 먼저)
  for (const kw of SYMBOL_KEYWORDS) {
    while (s.includes(kw)) {
      s = s.replace(kw, CONSUMED); // 문자열 패턴 = 첫 번째만 치환
      width += (HWPEQ_KEYWORD_WIDTHS[kw] ?? DEFAULT_KEYWORD_WIDTH) * scale;
    }
  }
  for (const kw of LARGE_OP_KEYWORDS) {
    while (s.includes(kw)) {
      s = s.replace(kw, CONSUMED);
      width += 1000 * scale;
    }
  }

  // 2. 구조 키워드 + 구문 공백 제거
  for (const cmd of STRUCT_KEYWORDS) {
    s = replaceAllLiteral(s, cmd + " ", "");
    s = replaceAllLiteral(s, cmd, "");
  }

  // 3. 위/아래첨자: 50% 축소 크기 (HYhwpEQ 실측 기준)
  for (const m of s.matchAll(/[\^_]\{([^{}]*)\}/g)) {
    width += measureHwpEqWidth(m[1] as string, scale * HWPEQ_SUP_SUB_SCALE);
  }
  s = s.replace(/[\^_]\{[^{}]*\}/g, "");

  for (const m of s.matchAll(/[\^_](\S)/g)) {
    const ch = m[1] as string;
    if (ch !== "{" && ch !== "}") {
      width +=
        (HWPEQ_CHAR_WIDTHS[ch] ?? DEFAULT_CHAR_WIDTH) *
        scale *
        HWPEQ_SUP_SUB_SCALE;
    }
  }
  s = s.replace(/[\^_]\S/g, "");

  // 4. 나머지 문자의 개별 폭 합산
  for (const ch of s) {
    if (ch === "{" || ch === "}" || ch === CONSUMED) continue;
    // 따옴표는 텍스트 리터럴 구분자, &는 행렬 구분자, $는 LaTeX 잔재 — 폭 0
    if (ch === '"' || ch === "&" || ch === "$") continue;
    let w = HWPEQ_CHAR_WIDTHS[ch];
    if (w === undefined) w = isWideCjk(ch) ? HWPEQ_HANGUL_WIDTH : 0;
    if (w > 0) width += (w + HWPEQ_CHAR_PAD) * scale;
  }

  return width;
}

/** 문자열에서 첫 번째 `{content}` 추출 → [content, 나머지] (원본 _extract_latex_brace) */
function extractBrace(input: string): [string, string] {
  const s = input.replace(/^\s+/, "");
  if (s === "" || s[0] !== "{") return ["", s];
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "{") depth += 1;
    else if (s[i] === "}") {
      depth -= 1;
      if (depth === 0) return [s.slice(1, i), s.slice(i + 1)];
    }
  }
  return [s.slice(1), ""];
}

/** 문자열 끝에서 역방향으로 `{content}` 추출 → [content, 앞부분] (원본 _extract_brace_reverse) */
function extractBraceReverse(input: string): [string, string] {
  const s = input.replace(/\s+$/, "");
  if (s === "" || s[s.length - 1] !== "}") return [s, ""];
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    if (s[i] === "}") depth += 1;
    else if (s[i] === "{") {
      depth -= 1;
      if (depth === 0) {
        return [s.slice(i + 1, -1), s.slice(0, i).replace(/\s+$/, "")];
      }
    }
  }
  return [s.slice(1), ""];
}

function countMatches(s: string, re: RegExp): number {
  return [...s.matchAll(re)].length;
}

/**
 * HWP 수식 스크립트의 렌더 크기를 추정한다.
 *
 * @param script `latexToHwpEq` 가 만든 HWP 수식 스크립트
 */
export function estimateEquationSize(script: string): EquationSize {
  const hasFraction = script.includes("over") || script.includes("atop");
  const hasSqrt = script.includes("sqrt") || script.includes("root");

  let width: number;
  const fracMatch = hasFraction ? /\b(over|atop)\b/.exec(script) : null;
  if (fracMatch) {
    // 분수 구조 파싱: prefix {분자} over {분모} suffix
    const before = script.slice(0, fracMatch.index).replace(/\s+$/, "");
    const after = script
      .slice(fracMatch.index + fracMatch[0].length)
      .replace(/^\s+/, "");

    const [numContent, prefix] = before.endsWith("}")
      ? extractBraceReverse(before)
      : [before, ""];
    const [denContent, suffix] = after.startsWith("{")
      ? extractBrace(after)
      : [after, ""];

    // 분수 내용은 축소 렌더링, 분수선 양쪽 여백은 상수(튜닝 파라미터).
    const numW = measureHwpEqWidth(numContent, HWPEQ_FRAC_SCALE);
    const denW = measureHwpEqWidth(denContent, HWPEQ_FRAC_SCALE);
    const fracW = Math.max(numW, denW) + HWPEQ_FRAC_PADDING;

    const prefixW = prefix.trim() ? measureHwpEqWidth(prefix) : 0;
    const suffixW = suffix.trim() ? measureHwpEqWidth(suffix) : 0;

    width = prefixW + fracW + suffixW;
  } else {
    width = measureHwpEqWidth(script);
  }

  // LEFT/RIGHT 자동 크기 괄호 가산 — 구조 키워드로 제거된 폭을 복원.
  width += countMatches(script, /\b(LEFT|RIGHT)\b/g) * HWPEQ_LEFT_RIGHT_EXTRA;

  // 이항 연산자 주변 여백 (튠 결과 0으로 수렴 — 구조 보존용).
  width += countMatches(script, /[=+\-<>]/g) * HWPEQ_BINOP_SPACE;

  // 정답 84개 최소제곱 보정 — 체계적 편향 제거.
  width = HWPEQ_GLOBAL_SCALE * width + HWPEQ_GLOBAL_BIAS;
  const finalWidth = Math.max(Math.trunc(width), HWPEQ_MIN_WIDTH);

  // 높이: 한컴은 2단/1단 이진으로만 사용한다(정답 84개 분석).
  const twoLine =
    hasFraction ||
    hasSqrt ||
    /\b(SUM|INT|OINT|PROD|COPROD|UNION|INTER|BIGUNION|BIGINTER)\b/.test(
      script,
    ) ||
    /\bmatrix\b|\{array\}/.test(script) ||
    script.toLowerCase().includes("pile");

  return {
    width: finalWidth,
    height: twoLine ? HWPEQ_HEIGHT_DOUBLE : HWPEQ_HEIGHT_SINGLE,
  };
}
