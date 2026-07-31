import {
  HANGUL_RE,
  MULTILINE_ENV_RE,
  NORMALIZER_VERSION,
  UNICODE_MATH_MAP,
  UNICODE_SUPERSCRIPT_MAP,
} from "./constants";

/* ─────────────────────────────────────────────────────────────
 * 무손실 정규화기 (골프롬프트 2O 수식 정규화 분류).
 *
 * - 자동 적용: 수학적 의미가 확실히 보존되는 변환만. 각 적용은 규칙 ID와
 *   전후 diff로 기록된다.
 * - 검수 필요: 의미를 바꿀 수 있는 보정(빈 분모 채우기, ≈→= 치환, 수식 내
 *   한글 이동, 괄호 짝 추측)은 **적용하지 않고** 플래그만 남긴다.
 *   게시 파이프라인에서는 이 플래그가 곧 게이트 실패다. 저작 화면은 이를
 *   "제안"으로 표시할 수 있다.
 * - 멱등성: normalize(normalize(x)) === normalize(x).
 * ───────────────────────────────────────────────────────────── */

export interface RepairAction {
  ruleId: string;
  /** 적용 횟수 */
  count: number;
  /** 대표 전후 예시 (처음 1건) */
  example?: { before: string; after: string };
}

export type ReviewFlagCode =
  | "EMPTY_FRAC_ARG" // 빈 분자·분모 — 임의 값으로 채우지 않는다
  | "EMPTY_SQRT_ARG"
  | "APPROX_SIGN" // ≈ / \approx — =로 임의 치환 금지 (의미 변경)
  | "HANGUL_IN_MATH" // 수식 내 한글 — 구조 변경은 사람 판단
  | "NESTED_DOLLAR" // 수식 안 $ 잔류 (제거 후에도 남는 복잡 케이스)
  | "SUSPICIOUS_TEXT_WRAPPER"; // \text{} 안에 수학 명령 — 벗기기는 제안만

export interface ReviewFlag {
  code: ReviewFlagCode;
  /** 원문 내 대략적 위치 (인덱스) */
  index: number;
  snippet: string;
  suggestion?: string;
}

export interface NormalizeResult {
  normalized: string;
  repairs: RepairAction[];
  reviewFlags: ReviewFlag[];
  normalizerVersion: string;
}

/** 규칙 적용 헬퍼 — 변경이 있으면 repairs에 기록 */
class RuleRecorder {
  readonly repairs: RepairAction[] = [];

  apply(
    ruleId: string,
    input: string,
    fn: (s: string) => string,
  ): string {
    const output = fn(input);
    if (output !== input) {
      const existing = this.repairs.find((r) => r.ruleId === ruleId);
      if (existing) {
        existing.count += 1;
      } else {
        this.repairs.push({
          ruleId,
          count: 1,
          example: {
            before: truncate(input, 80),
            after: truncate(output, 80),
          },
        });
      }
    }
    return output;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/* ── L01·L02: JSON escape 손상 복구 (mathg-gen fixLatexEscaping 이식) ── */
function restoreJsonEscapes(s: string): string {
  return s
    .replace(/\t(?=[a-zA-Z])/g, "\\t")
    .replace(/\f(?=[a-zA-Z])/g, "\\f")
    .replace(/\x08(?=[a-zA-Z])/g, "\\b")
    .replace(/\r(?=[a-zA-Z])/g, "\\r")
    .replace(/\n(?=[a-zA-Z][a-z]{2,})/g, "\\n");
}

function restoreOrphanCommands(s: string): string {
  return s
    .replace(/(?<![a-zA-Z\\])sqrt(?=\s*\{?\d|\s*\{)/g, "\\sqrt")
    .replace(/(?<![a-zA-Z\\])dfrac(?=\s*\{)/g, "\\dfrac")
    .replace(/(?<![a-zA-Z\\])frac(?=\s*\{)/g, "\\frac")
    .replace(/(?<![a-zA-Z\\])pm(?=\s|\\|\$)/g, "\\pm")
    .replace(/(?<![a-zA-Z\\])times(?=\s|\\|\$)/g, "\\times")
    .replace(/(?<![a-zA-Z\\])cdot(?=\s|\\|\$)/g, "\\cdot");
}

/* ── L06~L09: 모델 typo 무손실 정리 (mathg-gen cleanMalformedLatex에서
 *    의미 변경 규칙(≈→=, 빈 분수 채우기)을 제외하고 이식) ── */
function collapseDuplicateCommands(s: string): string {
  return s
    .replace(/\\left(?=\s*\\left\b)/g, "")
    .replace(/\\right(?=\s*\\right\b)/g, "")
    .replace(/\\frac(?=\\frac\b)/g, "")
    .replace(/\\sqrt(?=\\sqrt\b)/g, "")
    .replace(/\\boxed(?=\\boxed\b)/g, "");
}

function fixSizeDelimiterTypos(s: string): string {
  return s
    .replace(/\\(?:bigg?|Bigg?)[lrm]?(?=\\(?:left|right)\b)/g, "")
    .replace(/\\left\\\(/g, "\\left(")
    .replace(/\\right\\\)/g, "\\right)")
    .replace(/\\left\\\[/g, "\\left[")
    .replace(/\\right\\\]/g, "\\right]");
}

function dedupeSpacing(s: string): string {
  return s
    .replace(/(\\;){2,}/g, "\\;")
    .replace(/(\\,){2,}/g, "\\,")
    .replace(/(\\quad){2,}/g, "\\quad")
    .replace(/(\\qquad){2,}/g, "\\qquad");
}

/* ── L10·L11: 승인된 유니코드 정규화 ── */
function normalizeUnicode(s: string): string {
  let out = s;
  for (const [re, repl] of UNICODE_MATH_MAP) out = out.replace(re, repl);
  for (const [re, repl] of UNICODE_SUPERSCRIPT_MAP) out = out.replace(re, repl);
  return out;
}

/* ── L13: canonical 표기 통일 ── */
function canonicalizeFrac(s: string): string {
  // \dfrac → \frac: 저장 canonical은 \frac. 표시 크기는 렌더 계층의 책임.
  return s.replace(/\\dfrac(?![a-zA-Z])/g, "\\frac");
}

/* ── 수식 내부(inner) 무손실 정규화 ── */
function normalizeInner(inner: string, rec: RuleRecorder): string {
  let s = inner;
  s = rec.apply("L06_DUP_CMD", s, collapseDuplicateCommands);
  s = rec.apply("L07_SIZE_DELIM_TYPO", s, fixSizeDelimiterTypos);
  s = rec.apply("L09_SPACING_DEDUP", s, dedupeSpacing);
  s = rec.apply("L10_UNICODE", s, normalizeUnicode);
  s = rec.apply("L13_CANONICAL_FRAC", s, canonicalizeFrac);
  // 수식 안 잔류 unescaped $ 제거 (겹친 구분자 정리 — 자동 허용)
  s = rec.apply("L05_NESTED_DOLLAR", s, (x) => x.replace(/(?<!\\)\$/g, ""));
  // 앞뒤 공백 정리
  s = rec.apply("L16_TRIM", s, (x) => x.trim().replace(/[ \t]{2,}/g, " "));
  return s;
}

const INLINE_MATH_RE = /(?<!\$)\$(?!\$)((?:[^$\\]|\\.)*)(?<!\$)\$(?!\$)/g;

/* ── 검수 플래그 탐지 (적용하지 않는다) ── */
function detectReviewFlags(mathInner: string, baseIndex: number): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const push = (
    code: ReviewFlagCode,
    index: number,
    snippet: string,
    suggestion?: string,
  ) => {
    const flag: ReviewFlag = { code, index, snippet: truncate(snippet, 60) };
    if (suggestion !== undefined) flag.suggestion = suggestion;
    flags.push(flag);
  };

  for (const m of mathInner.matchAll(/\\frac\{([^{}]*)\}\{\}/g)) {
    push("EMPTY_FRAC_ARG", baseIndex + (m.index ?? 0), m[0], `\\frac{${m[1]}}{?}`);
  }
  for (const m of mathInner.matchAll(/\\frac\{\}\{([^{}]*)\}/g)) {
    push("EMPTY_FRAC_ARG", baseIndex + (m.index ?? 0), m[0], `\\frac{?}{${m[1]}}`);
  }
  for (const m of mathInner.matchAll(/\\sqrt\{\s*\}/g)) {
    push("EMPTY_SQRT_ARG", baseIndex + (m.index ?? 0), m[0]);
  }
  for (const m of mathInner.matchAll(/\\approx\b|≈/g)) {
    push(
      "APPROX_SIGN",
      baseIndex + (m.index ?? 0),
      m[0],
      "근사 기호가 맞는지, =여야 하는지 사람 확인 필요",
    );
  }
  const hangul = mathInner.match(HANGUL_RE);
  if (hangul) {
    push(
      "HANGUL_IN_MATH",
      baseIndex + (hangul.index ?? 0),
      mathInner,
      "한글을 수식 밖 텍스트 런으로 분리할지 확인",
    );
  }
  // \text{} 안에 수학 명령 — 모델이 잘못 감쌌을 가능성. 벗기기는 제안만.
  for (const m of mathInner.matchAll(
    /\\(?:text|mathrm|mbox)\{\s*(\\[a-zA-Z]+[^{}]*)\}/g,
  )) {
    push("SUSPICIOUS_TEXT_WRAPPER", baseIndex + (m.index ?? 0), m[0], m[1]);
  }
  return flags;
}

/**
 * 단일 수식(구분자 없는 LaTeX 원문)의 무손실 정규화.
 * MathExpression.raw_source → normalized_latex 변환의 표준 진입점.
 */
export function normalizeExpression(raw: string): NormalizeResult {
  const rec = new RuleRecorder();
  let s = raw;
  s = rec.apply("L01_JSON_ESCAPE", s, restoreJsonEscapes);
  s = rec.apply("L02_ORPHAN_CMD", s, restoreOrphanCommands);
  s = normalizeInner(s, rec);
  return {
    normalized: s,
    repairs: rec.repairs,
    reviewFlags: detectReviewFlags(s, 0),
    normalizerVersion: NORMALIZER_VERSION,
  };
}

/**
 * 혼합 텍스트(`$...$`/`$$...$$` 포함 문단)의 구분자·수식 정규화.
 * 구조화 블록 반입(OCR 마크다운 → StructuredContent) 단계에서 사용.
 */
export function normalizeMixedText(content: string): NormalizeResult {
  const rec = new RuleRecorder();
  let out = content;

  // L01·L02 — 전역 (수식 밖 손상도 복구 대상)
  out = rec.apply("L01_JSON_ESCAPE", out, restoreJsonEscapes);

  // L03 — 구분자 표준화
  out = rec.apply("L03_DELIMITER_STD", out, (s) =>
    s
      .replace(/\\\(([\s\S]*?)\\\)/g, (_m, p1: string) => `$${p1}$`)
      .replace(/\\\[([\s\S]*?)\\\]/g, (_m, p1: string) => `$$${p1}$$`),
  );

  // L04 — $A$$B$ 글루 분리 (최대 5회 반복 안정화)
  out = rec.apply("L04_GLUE_SPLIT", out, (s) => {
    let cur = s;
    for (let i = 0; i < 5; i++) {
      const next = cur.replace(
        /\$([^$\n]+)\$\$([^$\n]+)\$/g,
        (_m, a: string, b: string) => `$${a}$ $${b}$`,
      );
      if (next === cur) break;
      cur = next;
    }
    return cur;
  });

  // L14 — 다행 환경 인라인 → display 승격
  out = rec.apply("L14_ENV_PROMOTE", out, (s) =>
    s.replace(INLINE_MATH_RE, (match, inner: string) =>
      MULTILINE_ENV_RE.test(inner) ? `$$${inner}$$` : match,
    ),
  );

  // 수식 inner 정규화 + 플래그 수집
  const reviewFlags: ReviewFlag[] = [];
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner: string, offset: number) => {
    const normalized = normalizeInner(inner, rec);
    reviewFlags.push(...detectReviewFlags(normalized, offset));
    return `$$${normalized}$$`;
  });
  out = out.replace(INLINE_MATH_RE, (_m, inner: string, offset: number) => {
    const normalized = normalizeInner(inner, rec);
    reviewFlags.push(...detectReviewFlags(normalized, offset));
    return `$${normalized}$`;
  });

  return {
    normalized: out,
    repairs: rec.repairs,
    reviewFlags,
    normalizerVersion: NORMALIZER_VERSION,
  };
}
