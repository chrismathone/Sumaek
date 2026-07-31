/* ─────────────────────────────────────────────────────────────
 * 단답 정규화 (골프롬프트 2N 채점과 증거).
 * 수치, 분수, 동치식, 단위, 조건을 분리해 정규화한다.
 * 원문은 절대 덮어쓰지 않는다 — 정규화 결과는 채점 근거의 일부다.
 * ───────────────────────────────────────────────────────────── */

export interface NormalizedAnswer {
  /** 원문 그대로 (보존) */
  raw: string;
  /** 공백·전각·기호 정리 후 텍스트 */
  cleaned: string;
  /** 유리수로 해석 가능하면 분자/분모 (기약분수로 약분) */
  rational: { num: bigint; den: bigint } | null;
  /** 분리된 단위 (예: cm, kg, 개, 명, 원) */
  unit: string | null;
  /** 해석 형태 */
  form: "integer" | "decimal" | "fraction" | "mixed_number" | "expression" | "text";
  /** 해석이 모호해 사람 확인이 필요한 경우 */
  ambiguous: boolean;
  ambiguityReason?: string;
}

const FULLWIDTH_DIGITS = /[０-９]/g;
const KOREAN_UNITS =
  /(?:cm²|cm³|m²|m³|km²|mm|cm|km|m|kg|g|L|mL|초|분|시간|일|개|명|마리|원|점|살|번|째|도|°|%|㎡|㎥|㎝|㎜|㎞|㎏)$/;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function makeRational(num: bigint, den: bigint): { num: bigint; den: bigint } | null {
  if (den === 0n) return null;
  const sign = den < 0n ? -1n : 1n;
  const n = num * sign;
  const d = den * sign;
  const g = gcd(n, d);
  return g === 0n ? { num: 0n, den: 1n } : { num: n / g, den: d / g };
}

/** 소수 문자열 → 유리수 (예: "0.75" → 3/4) */
function decimalToRational(s: string): { num: bigint; den: bigint } | null {
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const [, sign, whole, frac] = m;
  const fracDigits = frac ?? "";
  const den = 10n ** BigInt(fracDigits.length);
  const num = BigInt(whole ?? "0") * den + BigInt(fracDigits || "0");
  return makeRational(sign === "-" ? -num : num, den);
}

/**
 * 학생 단답 원문의 정규화. 결정론적.
 * 지원: 정수, 소수, 분수(a/b, \frac{a}{b}), 대분수("1 3/4"), 단위 접미,
 * 전각 숫자, 천 단위 콤마, 유니코드 마이너스.
 */
export function normalizeShortAnswer(raw: string): NormalizedAnswer {
  let s = raw
    .replace(FULLWIDTH_DIGITS, (c) => String(c.charCodeAt(0) - 0xff10))
    .replace(/−/g, "-") // U+2212
    .replace(/／/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  // LaTeX 분수 표기 → a/b
  s = s.replace(
    /\\d?frac\{(-?\d+)\}\{(-?\d+)\}/g,
    (_m, a: string, b: string) => `${a}/${b}`,
  );
  // 수식 구분자 제거 (학생이 $ 포함 입력)
  s = s.replace(/\$/g, "").trim();

  const base: Omit<NormalizedAnswer, "rational" | "form" | "unit"> = {
    raw,
    cleaned: s,
    ambiguous: false,
  };

  // 단위 분리 (숫자 뒤 단위 접미) — KOREAN_UNITS는 $ 앵커 포함
  let unit: string | null = null;
  let valuePart = s;
  const unitMatch = s.match(
    new RegExp(`^(-?[\\d.,/ ]+?)\\s*${KOREAN_UNITS.source}`),
  );
  if (unitMatch) {
    valuePart = (unitMatch[1] ?? "").trim();
    unit = s.slice((unitMatch[1] ?? "").length).trim();
  }

  // 천 단위 콤마 제거 — "1,000" 형태만 (좌표 "(1, 2)"와 구분)
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(valuePart)) {
    valuePart = valuePart.replace(/,/g, "");
  }

  // 대분수 "1 3/4"
  const mixed = valuePart.match(/^(-?)(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const [, sign, whole, num, den] = mixed;
    const d = BigInt(den ?? "1");
    if (d !== 0n) {
      const n = BigInt(whole ?? "0") * d + BigInt(num ?? "0");
      return {
        ...base,
        rational: makeRational(sign === "-" ? -n : n, d),
        unit,
        form: "mixed_number",
      };
    }
  }

  // 분수 "a/b"
  const frac = valuePart.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (frac) {
    const r = makeRational(BigInt(frac[1] ?? "0"), BigInt(frac[2] ?? "1"));
    if (r === null) {
      return {
        ...base,
        rational: null,
        unit,
        form: "fraction",
        ambiguous: true,
        ambiguityReason: "분모가 0입니다",
      };
    }
    return { ...base, rational: r, unit, form: "fraction" };
  }

  // 정수·소수
  if (/^-?\d+$/.test(valuePart)) {
    return {
      ...base,
      rational: makeRational(BigInt(valuePart), 1n),
      unit,
      form: "integer",
    };
  }
  if (/^-?\d+\.\d+$/.test(valuePart)) {
    return {
      ...base,
      rational: decimalToRational(valuePart),
      unit,
      form: "decimal",
    };
  }

  // ± 포함 — 복수 해 표기. 자동 확정 금지 대상.
  if (/±|\\pm/.test(s)) {
    return {
      ...base,
      rational: null,
      unit,
      form: "expression",
      ambiguous: true,
      ambiguityReason: "± 복수 해 표기 — 채점 기준 확인 필요",
    };
  }

  // 수식·텍스트 — 문자 변수를 포함하면 expression
  const form = /[a-zA-Z\\^_{}()]/.test(valuePart) ? "expression" : "text";
  return { ...base, rational: null, unit, form };
}

/** 식 문자열의 보수적 정규화 — 공백·표기 통일만. 대수적 변형은 하지 않는다. */
export function canonicalizeExpressionText(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/\\d?frac(?![a-zA-Z])/g, "\\frac")
    .replace(/\\left|\\right/g, "")
    .replace(/\\cdot/g, "*")
    .replace(/\\times/g, "*")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\\div/g, "/")
    .replace(/−/g, "-")
    .toLowerCase();
}
