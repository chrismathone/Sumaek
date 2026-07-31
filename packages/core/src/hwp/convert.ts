/**
 * LaTeX → HWP 수식 스크립트 변환기.
 *
 * 원본: D:\시험지 한글화\core\latex_to_hwpeq.py (읽기 전용)
 * 13단계 순차 치환 + 그룹 재귀 구조와 **치환 순서**를 그대로 옮겼다.
 * 순서를 바꾸면 결과가 달라진다 — 예: 기호 치환(8·9)이 첨자 파싱(11)보다
 * 먼저 돌아야 `45^\circ` 가 `45^{°}` 로 묶인다.
 *
 * 원본과 다른 점 — **미지원 토큰 리포팅**:
 *   원본 :1196 은 남은 `\명령` 을 정규식으로 **조용히 삭제**했다. 그래서
 *   `\lt`·`\not` 같은 미매핑 명령이 부등호·부정을 통째로 없애 의미가 뒤집힌
 *   무증상 오답이 반복 발생했고(원본 :794·:802 주석), 그때마다 사후에
 *   개별 우회를 덧댔다. 여기서는 삭제 자체는 유지하되(스크립트 문법 보존)
 *   삭제한 명령을 `unsupported` 로 **반드시 보고**한다. 호출자는 이 배열이
 *   비어있지 않으면 해당 수식을 게시하지 말고 격리해야 한다.
 */

import {
  ACCENT_MAP,
  FUNC_MAP,
  GREEK_MAP,
  KEYWORD_LABEL_QUOTE,
  ROMAN_SKIP_EXTRA,
  SYMBOL_MAP,
} from "./mappings";

export interface HwpEqResult {
  /** HWP 수식 편집기 스크립트. unsupported 가 있어도 문법상 유효하다. */
  script: string;
  /**
   * 변환하지 못해 스크립트에서 제거한 LaTeX 명령(중복 제거·정렬).
   * 비어있지 않으면 의미 손실이 발생했다는 뜻 — 게시 게이트에서 막을 것.
   */
  unsupported: string[];
}

export interface HwpEqOptions {
  /**
   * `\mathrm{P/E/V/N/Z/X/Y}` 의 로만을 벗겨 이탤릭으로 되돌릴지.
   * 표 셀처럼 사전 처리를 안 거치는 경로는 true(기본).
   * **본문**은 이미 확통 이탤릭이 처리됐고 남은 `\mathrm{P}` 는 기하 점(점 P)을
   * 위해 일부러 붙인 로만이므로 false 로 호출해 보존한다.
   */
  italicizeStat?: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * sentinel — 변환 도중 훼손되면 안 되는 문자들
 * ───────────────────────────────────────────────────────────── */

/** 리터럴 `\{` — 그룹핑 `{}` 와 구분해 보호하고 마지막에 `"{"` 로 복원 */
const SENT_LB = "\u0001";
/** 리터럴 `\}` */
const SENT_RB = "\u0002";
/**
 * `\left\{ … \right\}` 의 **구분자** 중괄호. HWP 는 맨 `LEFT {` 만 자동크기로
 * 그린다 — 따옴표 리터럴 `LEFT "{"` 는 파싱이 깨진다(실측 2026-07-31).
 * 그렇다고 변환 도중 맨 중괄호로 두면 12단계 그룹 재귀가 다시 먹으므로 sentinel.
 */
const SENT_DLB = "\u0003";
const SENT_DRB = "\u0004";
/** 짝 없는 중간 구분자 `\middle` — `\mid`→`|` 매핑이 접두 매칭해 `|dle|` 로 새던 것도 함께 막는다 */
const SENT_MID = "\u0005";

/* ─────────────────────────────────────────────────────────────
 * 치환 헬퍼 — Python re/str 시맨틱을 맞춘다
 * ───────────────────────────────────────────────────────────── */

interface SubMatch {
  /** 매치 전체 (Python m.group(0)) */
  match: string;
  /** 이름 있는 그룹 */
  groups: Record<string, string | undefined>;
  /** 번호 그룹 (1부터, 0-index 배열) */
  numbered: (string | undefined)[];
  /** 매치 시작 위치 (Python m.start()) */
  index: number;
  /** 매치 대상 전체 문자열 (Python m.string) */
  input: string;
}

/** `re.sub(pattern, func, s)` — 콜백에 offset·원문·이름그룹을 함께 넘긴다. */
function sub(s: string, re: RegExp, fn: (m: SubMatch) => string): string {
  return s.replace(re, (...args: unknown[]): string => {
    let end = args.length;
    let groups: Record<string, string | undefined> = {};
    if (typeof args[end - 1] === "object" && args[end - 1] !== null) {
      groups = args[end - 1] as Record<string, string | undefined>;
      end -= 1;
    }
    return fn({
      match: args[0] as string,
      groups,
      numbered: args.slice(1, end - 2) as (string | undefined)[],
      index: args[end - 2] as number,
      input: args[end - 1] as string,
    });
  });
}

/**
 * Python `str.replace(old, new)` — 전체 치환, `$` 특수 해석 없음.
 * (JS `replaceAll` 은 치환 문자열의 `$&` 등을 해석하므로 쓰지 않는다.)
 */
function replaceAllLiteral(s: string, find: string, repl: string): string {
  if (find === "") return s;
  return s.split(find).join(repl);
}

const ALNUM_RE = /[\p{L}\p{N}]/u;
const ALPHA_RE = /\p{L}/u;

/** Python `str.isalnum()` (한글·한자 포함) */
function isAlnum(ch: string | undefined): boolean {
  return ch !== undefined && ch !== "" && ALNUM_RE.test(ch);
}

/** Python `str.isalpha()` */
function isAlpha(ch: string | undefined): boolean {
  return ch !== undefined && ch !== "" && ALPHA_RE.test(ch);
}

/** 앞 글자가 영숫자면 공백 하나 — 키워드가 앞 글자에 붙어 식별자로 오인되는 것 방지 */
function leadSpace(input: string, index: number): string {
  return index > 0 && isAlnum(input[index - 1]) ? " " : "";
}

/** 키 길이 내림차순 정렬(안정) — 긴 명령이 짧은 명령의 접두로 잘리지 않게 */
function byKeyLengthDesc(
  map: Readonly<Record<string, string>>,
): [string, string][] {
  return Object.entries(map).sort((a, b) => b[0].length - a[0].length);
}

/* ─────────────────────────────────────────────────────────────
 * 전처리 (원본 :79-317)
 * ───────────────────────────────────────────────────────────── */

/** 유니코드 위첨자 — 원본 :71 */
const SUPERSCRIPT_MAP: Readonly<Record<string, string>> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
  "⁼": "=",
  "⁽": "(",
  "⁾": ")",
  ⁿ: "n",
  ⁱ: "i",
};
const SUPERSCRIPT_RE = new RegExp(
  "[" + Object.keys(SUPERSCRIPT_MAP).join("") + "]+",
  "g",
);

/**
 * `2²`·`x³` 등 유니코드 위첨자를 `2^{2}`·`x^{3}` 지수로.
 * OCR 이 위첨자 문자를 그대로 주면 HWP 가 작은 글자로 렌더할 뿐 지수 객체가 아니다.
 * 연속 위첨자(²³)는 한 지수 `^{23}` 로 묶는다.
 */
function normalizeUnicodeSuperscripts(s: string): string {
  return s.replace(SUPERSCRIPT_RE, (run) =>
    "^{" + [...run].map((c) => SUPERSCRIPT_MAP[c] ?? c).join("") + "}",
  );
}

/** `\textcircled{…}` → 유니코드 동그라미 문자 — 원본 :88 */
const CIRCLED_RE = /\\textcircled\s*\{\s*([^}]+?)\s*\}/g;
const CIRCLED_HANGUL_CONS = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ";
const CIRCLED_HANGUL_SYL = "가나다라마바사아자차카타파하";

function normalizeCircled(s: string): string {
  return s.replace(CIRCLED_RE, (_m, raw: string) => {
    const v = raw.trim();
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1); // ①~⑳
    }
    if ([...v].length === 1) {
      const ci = CIRCLED_HANGUL_CONS.indexOf(v);
      if (ci >= 0) return String.fromCharCode(0x3260 + ci); // ㉠~
      const si = CIRCLED_HANGUL_SYL.indexOf(v);
      if (si >= 0) return String.fromCharCode(0x326e + si); // ㉮~
    }
    return v;
  });
}

/**
 * 단위 목록 — 원본 :116
 * 긴 단위 먼저(min 이 m 보다, cm 이 m 보다 우선).
 * 단일문자 m·t·s·h·L 은 제외 — 확통 모평균 m, 변수 t·s·h·L 을 단위로 오인하면 안 된다.
 */
const UNITS = [
  "kcal",
  "min",
  "km",
  "cm",
  "mm",
  "kg",
  "mg",
  "mL",
  "dL",
  "kL",
  "g",
  "°",
  "℃",
  "℉",
  "ℓ",
];
/** 숫자 직결 꼬리(1L·25L)에선 L 도 단위가 확실하다 — 원본 :124 */
const NUM_TAIL_UNITS = [...UNITS, "L"];
const MULTI_UNITS = NUM_TAIL_UNITS.filter((u) => u.length >= 2);
/** 변수 뒤 무공백 단위(xkm·yL) — 다문자 단위 + L·ℓ 한정 — 원본 :141 */
const VAR_TAIL_UNITS = [
  ...UNITS.filter((u) => u.length >= 2 && /^[\x00-\x7F]*$/.test(u)),
  "L",
  "ℓ",
];

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const alt = (units: string[]): string => units.map(esc).join("|");

/** 숫자 뒤 단위. 단위 뒤에 `(` 가 오면 함수 호출(2g(x))이지 단위가 아니다 — 원본 :128 */
const UNIT_RE = new RegExp(
  "(\\d)[\\s`]*(" + alt(NUM_TAIL_UNITS) + ")(?![A-Za-z0-9(])",
  "g",
);
/** 분수·근호 닫는 `}` 뒤 단위. 단일문자 L·g·° 는 첨자 뒤 변수일 수 있어 제외 — 원본 :135 */
const BRACE_UNIT_RE = new RegExp(
  "(\\})[\\s`]*(" + alt(MULTI_UNITS) + ")(?![A-Za-z0-9])",
  "g",
);
/** 단일 변수 글자 뒤 무공백 단위 — 원본 :142 */
const VAR_UNIT_RE = new RegExp(
  "(?<![A-Za-z])([A-Za-z])[\\s`]*(" + alt(VAR_TAIL_UNITS) + ")(?![A-Za-z0-9(])",
  "g",
);
/**
 * 접두 없는 단독 다문자 단위(`cm^{2}`·`20\pi cm`) — 원본 :150.
 * 원본과 다른 점: 함수 문맥 제외 lookahead 추가 — 원본은 `\min`(최솟값)의
 * `min`을 분(minute) 단위로 오인해 로만체화하는 잠재 결함이 있었다
 * (이식 검증에서 발견). FUNC_MAP 적용 후라 백슬래시는 이미 사라졌으므로,
 * 뒤에 여는 괄호·첨자가 오는 함수 호출 형태(`min (a,b)`·`min _{x}`)를
 * 단위 매칭에서 제외한다. 단위 뒤에는 괄호·첨자가 오지 않는다.
 */
const STANDALONE_UNIT_RE = new RegExp(
  "(?<![A-Za-z0-9`}\\\\])(?<!rm )(" +
    alt(MULTI_UNITS) +
    ")(?![A-Za-z0-9])(?!\\s*[(_])",
  "g",
);

/**
 * 수식 내 단위를 `rm`<단위>`(정자 + 1/4칸)로 — 원본 :160
 * HWP 수식은 라틴 문자를 기본 이탤릭으로 렌더하므로 단위(kg, cm …)도 기울어진다.
 */
function romanizeUnits(s: string): string {
  s = s.replace(UNIT_RE, "$1 rm`$2");
  s = s.replace(BRACE_UNIT_RE, "$1 rm`$2");
  s = s.replace(VAR_UNIT_RE, "$1 rm`$2");
  return s.replace(STANDALONE_UNIT_RE, "rm`$1");
}

/**
 * `<글자/숫자> rm <단위>` 의 일반 공백을 백틱(1/4칸)으로 — 원본 :177
 * `\mathrm{}` 로 감싸진 단위는 romanizeUnits 경로를 안 타서 백틱이 없었다.
 */
const RM_UNIT_RE = new RegExp(
  "([A-Za-z0-9])\\s+rm\\s+(" + alt(NUM_TAIL_UNITS) + ")(?![A-Za-z0-9])",
  "g",
);
function backtickRmUnits(s: string): string {
  return s.replace(RM_UNIT_RE, "$1 rm`$2");
}

/** 확통 연산자·확률변수의 `\mathrm` 을 벗겨 이탤릭으로(순열 `\mathrm{P}_` 제외) — 원본 :157 */
const STAT_ITALIC_RE = /\\mathrm\{([XYPEVNZ])\}(?!\s*_)/g;

/** 단위만 감싼 `\text{g}` 를 평문으로 — 원본 :275 */
const TEXT_UNIT_RE = new RegExp(
  "\\\\text\\s*\\{\\s*(" + alt(UNITS) + ")\\s*\\}",
  "g",
);
function unwrapTextUnits(s: string): string {
  return s.replace(TEXT_UNIT_RE, "$1");
}

/**
 * 쉼표 뒤 강제 띄어쓰기(`,~`) — 원본 :188
 *
 * HWP 수식은 `(2,3)`·`P(25,3)` 의 쉼표 뒤 공백을 시각적으로 무시한다.
 * 괄호 안(좌표·인자) 쉼표는 공백 유무와 무관하게 `,~` 로, 괄호 밖은 공백이
 * 있을 때만 `,~` 로 처리한다(아래첨자 `a_{1,2}` 의 쉼표는 보존).
 */
function spaceValueCommas(s: string): string {
  const out: string[] = [];
  let paren = 0;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i] as string;
    if (c === "(") {
      paren += 1;
      out.push(c);
      i += 1;
    } else if (c === ")") {
      if (paren > 0) paren -= 1;
      out.push(c);
      i += 1;
    } else if (c === ",") {
      let j = i + 1;
      while (j < n && " \t`".includes(s[j] as string)) j += 1;
      const hadSpace = j > i + 1;
      if (hadSpace) {
        // 종전 동작 유지: 공백을 ~ 로, 뒤따르는 ~(\quad 의 ~~)는 그대로 흘려보낸다.
        out.push(",~");
        i = j;
      } else if (j < n && s[j] === "~") {
        // 이미 `,~` 면 중복 삽입 금지(`(b,~-2)` → `,~~` 회귀 방지).
        out.push(",");
        i = j;
      } else if (paren > 0) {
        // 괄호 안 공백 없는 쉼표 → `,~` (좌표 `P(25,3)`).
        out.push(",~");
        i = j;
      } else {
        out.push(",");
        i = j;
      }
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out.join("");
}

/**
 * 베이스 없는 선행 첨자(`_{n-1}C`)에 빈그룹 베이스 `{}` 삽입 — 원본 :242
 * 대형 연산자 하한(`SUM _{k=1}`)과 극한형(`lim _{x->0}`)은 삽입 금지 —
 * 삽입하면 첨자가 연산자 아래가 아니라 우측으로 붙어 깨진다.
 */
const LEAD_SUBSCRIPT_RE = /(^|[+\-=<>(\s])_\{/g;
const BIG_OP_KEYWORDS = ["SUM", "PROD", "INT", "UNION", "INTER"];
const BELOW_OP_LOWER_RE = /(?<![A-Za-z])(?:lim|max|min|sup|inf|gcd|det)$/;

function leadSubscriptRepl(m: SubMatch): string {
  const sep = m.numbered[0] ?? "";
  if (sep !== "" && /^\s+$/.test(sep)) {
    const prefix = m.input.slice(0, m.index).trimEnd();
    if (
      BIG_OP_KEYWORDS.some((k) => prefix.endsWith(k)) ||
      BELOW_OP_LOWER_RE.test(prefix)
    ) {
      return m.match;
    }
  }
  return sep + "{}_{";
}

/** 순환소수 — 원본 :284. 교과서 표준은 순환마디 양끝 숫자 위 점(0.15̇7̇). */
const REPEAT_DECIMAL_RE = /\.((?:\\dot\s*\{\s*\d\s*\}|\d)+)/g;
const DOT_TOKEN_RE = /\\dot\s*\{\s*(\d)\s*\}|(\d)/g;

function normalizeRepeatingDecimal(s: string): string {
  return s.replace(REPEAT_DECIMAL_RE, (whole: string, run: string) => {
    if (!run.includes("\\dot")) return whole;
    let out = ".";
    for (const t of run.matchAll(DOT_TOKEN_RE)) {
      const dotted = t[1];
      out += dotted !== undefined ? " dot {" + dotted + "}" : (t[2] as string);
    }
    return out;
  });
}

/**
 * 평문 `(...)` 중 분수·근호 등 키 큰 내용을 담은 쌍을 `\left(...\right)` 로 — 원본 :312
 * 균형 괄호를 스택으로 매칭하고, 삽입은 인덱스 큰 쪽부터 적용해 오프셋 안전.
 */
const TALL_DELIM_RE =
  /\\(?:d|t)?frac|\\cfrac|\\sqrt|\\binom|\\sum|\\prod|\\int|\\iint|\\iiint|\\oint|\\bigcup|\\bigcap|\\bigoplus|\\bigotimes/;

function autosizeParens(s: string): string {
  if (!s.includes("(")) return s;
  const stack: [number, boolean][] = [];
  const inserts: [number, string][] = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === "(") {
      stack.push([i, s.slice(Math.max(0, i - 5), i).endsWith("\\left")]);
    } else if (c === ")" && stack.length > 0) {
      const [oidx, isLeft] = stack.pop() as [number, boolean];
      const isRight = s.slice(Math.max(0, i - 6), i).endsWith("\\right");
      if (!isLeft && !isRight && TALL_DELIM_RE.test(s.slice(oidx + 1, i))) {
        inserts.push([oidx, "\\left"], [i, "\\right"]);
      }
    }
  }
  for (const [idx, text] of [...inserts].sort((a, b) => b[0] - a[0])) {
    s = s.slice(0, idx) + text + s.slice(idx);
  }
  return s;
}

/* ─────────────────────────────────────────────────────────────
 * 구조 패턴 (원본 :673-731)
 * ───────────────────────────────────────────────────────────── */

/** `{content}` — 3단계 중첩까지 허용 (원본 _brace_group) */
function braceGroup(name: string): string {
  const L0 = "[^{}]*";
  const L1 = "(?:[^{}]|\\{" + L0 + "\\})*";
  const L2 = "(?:[^{}]|\\{" + L1 + "\\})*";
  const L3 = "(?:[^{}]|\\{" + L2 + "\\})*";
  return "\\{(?<" + name + ">" + L3 + ")\\}";
}

/** `{content}` 또는 단일 문자 (원본 _brace_group_or_char) */
function braceGroupOrChar(name: string): string {
  const L0 = "[^{}]*";
  const L1 = "(?:[^{}]|\\{" + L0 + "\\})*";
  const L2 = "(?:[^{}]|\\{" + L1 + "\\})*";
  const L3 = "(?:[^{}]|\\{" + L2 + "\\})*";
  return (
    "(?:\\{(?<" + name + ">" + L3 + ")\\}|(?<" + name + "_c>[^\\s{}\\\\]))"
  );
}

/** braceGroupOrChar 결과에서 값 추출 (원본 _get_match) */
function getMatch(m: SubMatch, name: string): string {
  return m.groups[name] ?? m.groups[name + "_c"] ?? "";
}

const MIDDLE_RE = new RegExp(
  "\\\\middle\\s*(\\\\\\||\\\\lVert|\\\\rVert|\\\\langle|\\\\rangle|[|()\\[\\]./" +
    SENT_LB +
    SENT_RB +
    "])",
  "g",
);

const FRAC_PATTERN = new RegExp(
  "\\\\[dt]?frac\\s*" + braceGroup("num") + "\\s*" + braceGroup("den"),
  "g",
);
const SQRT_N_PATTERN = new RegExp(
  "\\\\sqrt\\s*\\[([^\\]]+)\\]\\s*" + braceGroup("body"),
  "g",
);
const SQRT_PATTERN = new RegExp("\\\\sqrt\\s*" + braceGroup("body"), "g");

const BIG_OP_PATTERN = new RegExp(
  "\\\\(sum|prod|coprod|int|iint|iiint|oint|bigcup|bigcap)" +
    "(?:\\s*_\\s*" +
    braceGroupOrChar("lo") +
    ")?" +
    "(?:\\s*\\^\\s*" +
    braceGroupOrChar("hi") +
    ")?",
  "g",
);

/** ACCENT_MAP 키 순서 = 대안 순서 (원본 :690) */
const ACCENT_PATTERN = new RegExp(
  "\\\\(" +
    Object.keys(ACCENT_MAP)
      .map((k) => esc(k.slice(1)))
      .join("|") +
    ")\\s*" +
    braceGroup("body"),
  "g",
);

const L_DELIM =
  "(\\\\langle|\\\\rangle|\\\\\\||[(\\[{|." + SENT_LB + SENT_RB + "])";
const R_DELIM =
  "(\\\\langle|\\\\rangle|\\\\\\||[)\\]}|." + SENT_LB + SENT_RB + "])";
/**
 * body 는 `\left`/`\right` 를 품지 않는 **최내곽**만 매칭 — 비탐욕 `(.*?)` 은
 * 중첩 `\left(\left(…\right)^2\right)` 에서 쌍이 어긋난다. 치환은 고정점까지 반복.
 */
const LEFTRIGHT_PATTERN = new RegExp(
  "\\\\left\\s*" +
    L_DELIM +
    "\\s*((?:(?!\\\\left|\\\\right).)*?)\\s*\\\\right\\s*" +
    R_DELIM,
  "gs",
);

const SUPERSCRIPT_PATTERN = new RegExp(
  "\\^\\s*" + braceGroupOrChar("sup"),
  "g",
);
const SUBSCRIPT_PATTERN = new RegExp("_\\s*" + braceGroupOrChar("sub"), "g");

const TEXT_PATTERN = new RegExp("\\\\text\\s*" + braceGroup("txt"), "g");
const MATHRM_PATTERN = new RegExp("\\\\mathrm\\s*" + braceGroup("txt"), "g");
const MATHBF_PATTERN = new RegExp("\\\\mathbf\\s*" + braceGroup("txt"), "g");
const MATHIT_PATTERN = new RegExp("\\\\mathit\\s*" + braceGroup("txt"), "g");
const BOXED_PATTERN = new RegExp(
  "\\\\(?:boxed|fbox)\\s*" + braceGroup("boxed"),
  "g",
);
const BINOM_PATTERN = new RegExp(
  "\\\\binom\\s*" + braceGroup("top") + "\\s*" + braceGroup("bot"),
  "g",
);
const ENV_PATTERN =
  /\\begin\{(cases|pmatrix|bmatrix|vmatrix|matrix)\}\s*(.*?)\s*\\end\{\1\}/gs;

const MATHRM_NEXT_STYLE = /^\\(?:math(?:rm|it|bf|bb)|text|boxed|fbox)\b/;

/** 빈칸 라벨용 괄호한글 단일문자: 가→㈎ … (U+320E~) — 원본 :908 */
const PAREN_HANGUL = new Map<string, string>(
  [..."가나다라마바사아자차카타파하"].map((ch, i) => [
    ch,
    String.fromCharCode(0x320e + i),
  ]),
);

/** 연속 대문자 런(도형 라벨) — 원본 :583 */
const ROMAN_LABEL_RE = /(?<![A-Za-z])([A-Z]{2,})(?![A-Za-z])/g;

/** `rm` 이후 단일 소문자 변수 탐색 — 원본 :651 */
const ROMAN_BLEED_SCAN =
  /(?<![A-Za-z])(?:rm|it)(?![A-Za-z])|(?<![A-Za-z0-9_`{])[a-z](?![A-Za-z0-9_])/g;

/**
 * 라벨 정자화에서 제외할 키워드 = 구조 키워드 + 각 맵의 "전부 대문자 2자 이상" 값.
 * 원본 :592 __init__ 이 하던 계산.
 */
const ROMAN_SKIP: ReadonlySet<string> = (() => {
  const skip = new Set(ROMAN_SKIP_EXTRA);
  for (const mp of [SYMBOL_MAP, FUNC_MAP, ACCENT_MAP, GREEK_MAP]) {
    for (const v of Object.values(mp)) {
      if (/^[A-Z]{2,}$/.test(v)) skip.add(v);
    }
  }
  return skip;
})();

/**
 * 도형 라벨(연속 대문자 2자+)을 `rm {…}` 로 정자화 — 원본 :602
 * HWP 기본이 이탤릭이라 변수(x, a, 단일 대문자)는 그대로 두고 선분/삼각형/
 * 사각형 라벨(AB, ABC, ABCD)만 정자로. `"..."` 리터럴 구간은 이미 정자라 제외.
 */
function applyRomanLabels(script: string): string {
  const quotedSpans: [number, number][] = [];
  let qs = -1;
  for (let i = 0; i < script.length; i += 1) {
    if (script[i] === '"') {
      if (qs < 0) qs = i;
      else {
        quotedSpans.push([qs, i]);
        qs = -1;
      }
    }
  }
  const inQuote = (pos: number): boolean =>
    quotedSpans.some(([a, b]) => a < pos && pos < b);

  return sub(script, ROMAN_LABEL_RE, (m) => {
    const run = m.numbered[0] as string;
    if (ROMAN_SKIP.has(run)) return run;
    const start = m.index;
    if (inQuote(start)) return run; // 따옴표 리터럴 안 = 이미 정자
    const prev = m.input.slice(Math.max(0, start - 4), start);
    // 이미 rm/it/bold 로 감싸진 라벨은 중복 적용 방지.
    if (
      prev.endsWith("rm {") ||
      prev.endsWith("rm ") ||
      prev.endsWith("it {") ||
      prev.endsWith("bold")
    ) {
      return run;
    }
    // HWP 연산자 키워드와 충돌하는 라벨(GE=≥ 등)은 rm {} 안에서도 토큰화돼 증발한다.
    if (KEYWORD_LABEL_QUOTE.has(run)) return 'rm {"' + run + '"}';
    return "rm {" + run + "}";
  });
}

/**
 * `rm` 이후 단일 소문자 변수를 `it {x}` 로 감싸 정자 번짐을 끊는다 — 원본 :655
 * HWP 의 `rm` 은 명시적 `it` 이 나올 때까지 뒤 전체에 적용된다.
 */
function stopRomanBleed(script: string): string {
  const out: string[] = [];
  let last = 0;
  let roman = false;
  for (const m of script.matchAll(ROMAN_BLEED_SCAN)) {
    const style = m[0];
    const idx = m.index;
    if (style === "rm" || style === "it") {
      roman = style === "rm";
      continue;
    }
    if (!roman) continue;
    out.push(script.slice(last, idx));
    out.push("it {" + style + "}");
    last = idx + style.length;
  }
  out.push(script.slice(last));
  return out.join("");
}

/**
 * 13단계에서 삭제해도 의미 손실이 없는 순수 조판 명령 — 리포팅 제외.
 * 그 외 남은 모든 `\명령` 은 unsupported 로 보고한다.
 */
const INTENTIONALLY_DROPPED: ReadonlySet<string> = new Set([
  "\\displaystyle",
  "\\textstyle",
  "\\scriptstyle",
  "\\scriptscriptstyle",
  "\\nonumber",
  "\\notag",
]);

/* ─────────────────────────────────────────────────────────────
 * 변환기
 * ───────────────────────────────────────────────────────────── */

class Converter {
  private readonly unsupported = new Set<string>();

  convert(latex: string, italicizeStat: boolean): HwpEqResult {
    // 전처리: 앞뒤 공백·$ 제거
    let s = latex
      .trim()
      .replace(/^\$+/, "")
      .replace(/\$+$/, "")
      .trim();

    // 유니코드 위첨자(2²·x³)를 지수 객체로.
    s = normalizeUnicodeSuperscripts(s);

    // 유니코드 부등호 → LaTeX 명령 (LEQ/GEQ 키워드로 정상 변환 + 연산자 간격).
    s = replaceAllLiteral(s, "≤", " \\leq ");
    s = replaceAllLiteral(s, "≥", " \\geq ");
    s = replaceAllLiteral(s, "≠", " \\neq ");

    // `\lt` `\gt` — SYMBOL_MAP 에 없어 13단계에서 조용히 삭제되면 부등호가 통째 증발한다.
    s = s.replace(/\\lt(?![a-zA-Z])/g, "<");
    s = s.replace(/\\gt(?![a-zA-Z])/g, ">");

    // `\not` 부정 — 뒤 명령만 치환되고 `\not` 이 삭제되면 ∉→∈ 로 **의미가 뒤집힌다**.
    s = s.replace(/\\not\s*\\in\b/g, "\\notin");
    s = s.replace(/\\not\s*=/g, "\\neq");
    s = s.replace(/\\not\s*\\equiv\b/g, " NOT EQUIV ");
    s = s.replace(/\\not\s*\\subset\b/g, " NOT SUBSET ");
    s = s.replace(/\\not\s*(\\[a-zA-Z]+|[<>])/g, " NOT $1");

    // `\limits`/`\nolimits` 제거 — HWP 는 이미 연산자 아래/위로 렌더하므로 no-op.
    // 안 지우면 `\lim\limits` 가 "lim lim its" 로 깨진다.
    s = s.replace(/\\(?:no)?limits(?![a-zA-Z])/g, "");

    // 단위 `\text{g}` → 평문 g (뒤 romanizeUnits 가 rm`g 로 처리).
    s = unwrapTextUnits(s);

    if (italicizeStat) s = s.replace(STAT_ITALIC_RE, "$1");

    s = normalizeRepeatingDecimal(s);
    s = normalizeCircled(s);

    // 리터럴 중괄호 `\{ \}` 를 sentinel 로 보호.
    s = replaceAllLiteral(s, "\\{", SENT_LB);
    s = replaceAllLiteral(s, "\\}", SENT_RB);

    // displaymath 환경 제거
    for (const env of ["\\[", "\\]", "\\(", "\\)"]) {
      s = replaceAllLiteral(s, env, "");
    }
    for (const envName of ["equation", "align", "gather", "displaymath"]) {
      s = s.replace(new RegExp("\\\\begin\\{" + envName + "\\*?\\}", "g"), "");
      s = s.replace(new RegExp("\\\\end\\{" + envName + "\\*?\\}", "g"), "");
    }

    // 부등호 보호: bare `<` `>` 를 공백으로 감싼다. HWP 에서 `<-` 는 ←, `->` 는 →로
    // 오인식되므로 `x<-3` 이 화살표로 깨진다. 화살표 토큰은 이 시점 이후에 생성된다.
    s = replaceAllLiteral(s, "<", " < ");
    s = replaceAllLiteral(s, ">", " > ");

    // 분수·근호 든 평문 괄호를 \left(...\right) 로 → 괄호 자동크기.
    s = autosizeParens(s);

    s = s.trim();
    let result = this.convertExpr(s);

    // sentinel 복원: 리터럴 중괄호 → 따옴표 리터럴(escaped `\{` 는 인접 문자와
    // 붙으면 파싱이 깨지는 반면 따옴표형은 항상 안정적 — 실측 확정).
    result = replaceAllLiteral(result, SENT_LB, '"{"');
    result = replaceAllLiteral(result, SENT_RB, '"}"');
    // LEFT/RIGHT 구분자 중괄호는 맨 중괄호로(자동크기), 짝 없는 \middle 은 제거.
    result = replaceAllLiteral(result, SENT_DLB, "{");
    result = replaceAllLiteral(result, SENT_DRB, "}");
    result = replaceAllLiteral(result, SENT_MID, "");

    result = applyRomanLabels(result);
    result = stopRomanBleed(result);
    result = romanizeUnits(result);
    result = backtickRmUnits(result);

    // 베이스 없는 선행 첨자(`_{n-1}C`)는 HWP 가 빈 렌더한다 — 빈 그룹 베이스 삽입.
    result = sub(result, LEAD_SUBSCRIPT_RE, leadSubscriptRepl);
    // 조합/순열 `rm C` 의 로만이 다음 선행첨자까지 번지는 것 차단.
    result = result.replace(
      /(rm\s+[A-Z](?:_\{[^{}]*\})?)\s*([+\-=<>])\s*\{\}_/g,
      "$1 $2 it {}_",
    );

    result = spaceValueCommas(result);

    // 후처리: 다중 공백 정리
    result = result.replace(/ {2,}/g, " ").trim();

    // 한글 음절 사이 공백 → `~`(HWP 전각 공백). 일반 공백은 시각적으로 죽는다.
    // `\text{한글 구절}` 은 이미 따옴표 리터럴이라 공백이 보존되므로 따옴표 **밖**만 변환.
    const parts = result.split(/("[^"]*")/);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = (parts[i] as string).replace(/(?<=[가-힣]) (?=[가-힣])/g, "~");
    }
    result = parts.join("");

    return {
      script: result,
      unsupported: [...this.unsupported].sort(),
    };
  }

  /** `\boxed{...}` 내용 — 빈칸 라벨 (가)/가 는 괄호한글 단일문자(작은 박스)로 */
  private boxedInner(body: string): string {
    const b = (body || "").trim();
    const m = /^\(?\s*([가-힣])\s*\)?$/.exec(b);
    const label = m?.[1];
    if (label !== undefined && PAREN_HANGUL.has(label)) {
      return PAREN_HANGUL.get(label) as string;
    }
    return this.convertExpr(b);
  }

  /** 재귀적으로 LaTeX 표현식을 변환 (원본 _convert_expr) */
  private convertExpr(input: string): string {
    if (!input) return "";
    let s = input;

    // 0-. `\middle<구분자>` 선치환 — 기호매핑(9)의 `\mid`→`|` 가 `\middle` 을
    //     접두 매칭해 `|dle|` 로 새는 것을 막는다.
    s = sub(s, MIDDLE_RE, (m) => SENT_MID + (m.numbered[0] ?? ""));

    // 0. 행렬/조건식 환경
    s = sub(s, ENV_PATTERN, (m) => {
      const env = m.numbered[0] as string;
      const envMap: Record<string, string> = {
        cases: "CASES",
        pmatrix: "PMATRIX",
        bmatrix: "BMATRIX",
        vmatrix: "DMATRIX",
        matrix: "MATRIX",
      };
      const hwpEnv = envMap[env] as string;
      // `\\` → ` # ` (행 구분자)
      const content = this.convertExpr(
        (m.numbered[1] as string).replace(/\\\\/g, " # "),
      );
      // 키워드 앞이 영숫자면 공백 보장 — `A\begin{pmatrix}…` 가 "APMATRIX" 로 붙으면
      // literal + 다글자 대문자 오로만화로 깨진다.
      return leadSpace(m.input, m.index) + hwpEnv + " {" + content + "}";
    });

    // 0.5 `\boxed{...}`/`\fbox{...}` → BOX{ ~ … ~ }
    s = sub(
      s,
      BOXED_PATTERN,
      (m) => "BOX{ ~ " + this.boxedInner(m.groups["boxed"] ?? "") + " ~ }",
    );

    // 1. \text, \mathrm, \mathbf, \mathit
    s = sub(s, TEXT_PATTERN, (m) => {
      const txt = m.groups["txt"] ?? "";
      // 도형 라벨(순수 대문자)은 정자 로만 `rm {…}`. 따옴표 리터럴은 HWP 가
      // **이탤릭**으로 렌더해 도형 이름이 기운다. 단어·혼합은 종전대로 리터럴.
      if (txt !== "" && /^[A-Za-z]+$/.test(txt) && txt === txt.toUpperCase()) {
        const inner = KEYWORD_LABEL_QUOTE.has(txt) ? '"' + txt + '"' : txt;
        return leadSpace(m.input, m.index) + "rm {" + inner + "}";
      }
      return '"' + txt + '"';
    });

    // `\mathrm{X}` → `rm X`. HWP rm 은 명시적 it 전까지 뒤 전체로 번지므로,
    // 뒤에 이탤릭 대상(소문자 변수)이 이어지면 `it` 를 끼워 로만 스코프를 닫는다.
    // 제외: ① 첨자/프라임은 로만 베이스에 붙으므로 끊으면 안 됨, ② 다음이 또 다른
    // 스타일 명령이면 그쪽이 스코프 관리, ③ 명령어 제거 후 소문자가 없으면 불필요.
    s = sub(s, MATHRM_PATTERN, (m) => {
      const base =
        leadSpace(m.input, m.index) + "rm " + (m.groups["txt"] ?? "");
      const tail = m.input.slice(m.index + m.match.length);
      const tstrip = tail.replace(/^[ \t]+/, "");
      const noCmd = tstrip.replace(/\\[a-zA-Z]+/g, "");
      if (
        tstrip !== "" &&
        !"_^'}".includes(tstrip[0] as string) &&
        !MATHRM_NEXT_STYLE.test(tstrip) &&
        /[a-z]/.test(noCmd)
      ) {
        return base + " it ";
      }
      return base;
    });

    s = sub(
      s,
      MATHBF_PATTERN,
      (m) => leadSpace(m.input, m.index) + "bold " + (m.groups["txt"] ?? ""),
    );
    // `\mathit{(a,b)}` → `it {(a,b)}` — 그룹 중괄호로 it 스코프를 명시(rm 번짐 차단).
    s = sub(
      s,
      MATHIT_PATTERN,
      (m) =>
        leadSpace(m.input, m.index) + "it {" + (m.groups["txt"] ?? "") + "}",
    );

    // 2. \binom{n}{k}
    s = sub(
      s,
      BINOM_PATTERN,
      (m) =>
        "LEFT ( {" +
        this.convertExpr(m.groups["top"] ?? "") +
        "} atop {" +
        this.convertExpr(m.groups["bot"] ?? "") +
        "} RIGHT )",
    );

    // 3. \frac{a}{b}
    s = sub(
      s,
      FRAC_PATTERN,
      (m) =>
        "{" +
        this.convertExpr(m.groups["num"] ?? "") +
        "} over {" +
        this.convertExpr(m.groups["den"] ?? "") +
        "}",
    );

    // 4. \sqrt[n]{x} / \sqrt{x} — sqrt·root 키워드도 앞 글자에 붙으면
    //    `a\sqrt{2}` → `asqrt {2}` 로 식별자 오인된다.
    s = sub(
      s,
      SQRT_N_PATTERN,
      (m) =>
        leadSpace(m.input, m.index) +
        "root {" +
        this.convertExpr(m.numbered[0] ?? "") +
        "} of {" +
        this.convertExpr(m.groups["body"] ?? "") +
        "}",
    );
    s = sub(
      s,
      SQRT_PATTERN,
      (m) =>
        leadSpace(m.input, m.index) +
        "sqrt {" +
        this.convertExpr(m.groups["body"] ?? "") +
        "}",
    );

    // 5. 대형 연산자
    s = sub(s, BIG_OP_PATTERN, (m) => {
      const op = (m.numbered[0] as string).toUpperCase();
      const opMap: Record<string, string> = {
        SUM: "SUM",
        PROD: "PROD",
        COPROD: "COPROD",
        INT: "INT",
        IINT: "DINT",
        IIINT: "TINT",
        OINT: "OINT",
        BIGCUP: "UNION",
        BIGCAP: "INTER",
      };
      const lo = getMatch(m, "lo");
      const hi = getMatch(m, "hi");
      let out = opMap[op] ?? op;
      if (lo) out += " _{" + this.convertExpr(lo) + "}";
      if (hi) out += " ^{" + this.convertExpr(hi) + "}";
      return out;
    });

    // 6. \left( ... \right) — 최내곽부터 고정점까지 반복(안쪽→바깥쪽).
    for (;;) {
      const next = sub(s, LEFTRIGHT_PATTERN, (m) => {
        const left = m.numbered[0] as string;
        const body = m.numbered[1] as string;
        const right = m.numbered[2] as string;
        const delimMap: Record<string, string> = {
          "(": "(",
          ")": ")",
          "[": "[",
          "]": "]",
          // 중괄호 구분자는 **맨 `{`/`}`** 여야 자동크기로 그려진다(따옴표 리터럴
          // `LEFT "{"` 는 렌더 깨짐 — 실측 2026-07-31).
          [SENT_LB]: SENT_DLB,
          [SENT_RB]: SENT_DRB,
          "{": SENT_DLB,
          "}": SENT_DRB,
          "\\langle": "langle",
          "\\rangle": "rangle",
          "\\|": "parallel",
          "|": "|",
          ".": "",
        };
        const lStr = delimMap[left] ?? left;
        const rStr = delimMap[right] ?? right;
        let inner = this.convertExpr(body);
        // `\middle|` → `RIGHT |`(자동크기 중간 구분자). 여는 LEFT 가 있을 때만 승격.
        inner = replaceAllLiteral(inner, SENT_MID, lStr ? " RIGHT " : "");
        // 앞에 공백을 둬 인접 글자(`P\left(`)가 키워드에 붙어 `PLEFT` 가 되지 않게 한다.
        if (lStr && rStr) return ` LEFT ${lStr} ${inner} RIGHT ${rStr}`;
        if (lStr) return ` LEFT ${lStr} ${inner}`;
        if (rStr) return `${inner} RIGHT ${rStr}`;
        return inner;
      });
      if (next === s) break;
      s = next;
    }

    // 고아 \left/\right 제거: OCR 이 짝을 놓쳐 비대칭이면 위 패턴이 매칭에 실패해
    // `\left` 가 잔존하고, 9단계에서 `\le` 가 'le' 를 먹어 "LEQft" 로 깨진다.
    s = s.replace(/\\(?:left|right)(?![a-zA-Z])/g, "");

    // 7. accent: \vec{A} → VEC {A}
    s = sub(s, ACCENT_PATTERN, (m) => {
      const cmd = "\\" + (m.numbered[0] as string);
      const hwpAccent = ACCENT_MAP[cmd] ?? (m.numbered[0] as string).toUpperCase();
      // accent 키워드도 앞 글자에 붙으면 literal 이 된다(`2i\overline{z}` → `2ibar`).
      return (
        leadSpace(m.input, m.index) +
        hwpAccent +
        " {" +
        this.convertExpr(m.groups["body"] ?? "") +
        "}"
      );
    });

    // 7.5 중괄호 없는 명령어 첨자 보호: `45^\circ` → `45^{\circ}`.
    //     기호 치환(8·9)이 첨자 파싱(11)보다 먼저 돌아 `45^ CIRC` 의 첫 글자만
    //     첨자로 잡혀 "45^{C}IRC" 로 깨지는 것을 막는다.
    s = s.replace(/([_^])\s*\\([a-zA-Z]+)/g, "$1{\\$2}");

    // 8·9·10. 그리스 문자 → 기호/연산자 → 함수명.
    //   알파벳으로 시작/끝나는 키워드형은 **앞뒤 공백 보장** — 안 그러면
    //   `\sin\theta`→`sintheta`, `X\le 1`→`XLEQ 1` 처럼 붙어 식별자로 오인되고
    //   연속대문자 로만화에 걸려 깨진다. 연산자형(->, <, |, %)은 그대로 둔다
    //   (공백이 화살표 토큰을 깰 수 있음). HWP 수식은 여분 공백을 무시한다.
    for (const map of [GREEK_MAP, SYMBOL_MAP, FUNC_MAP]) {
      for (const [latexCmd, hwpName] of byKeyLengthDesc(map)) {
        let repl = hwpName;
        if (
          repl &&
          (isAlpha(repl[0]) || isAlpha(repl[repl.length - 1]))
        ) {
          repl = " " + repl + " ";
        }
        s = replaceAllLiteral(s, latexCmd, repl);
      }
    }

    // 11. 상첨자/하첨자 — 항상 중괄호로 묶는다. 무중괄호 `^` 는 구분자 없이
    //     뒤따르는 연산자·괄호까지 탐욕적으로 삼킨다(`6xy^2)÷` 실측 2026-06-02).
    s = sub(
      s,
      SUPERSCRIPT_PATTERN,
      (m) => "^{" + this.convertExpr(getMatch(m, "sup")).trim() + "}",
    );
    s = sub(
      s,
      SUBSCRIPT_PATTERN,
      (m) => "_{" + this.convertExpr(getMatch(m, "sub")).trim() + "}",
    );

    // 12. { } 내부 재귀 처리 (단순 그룹)
    s = s.replace(
      /\{([^{}]+)\}/g,
      (_m, inner: string) => "{" + this.convertExpr(inner) + "}",
    );

    // 13. HWP 공백 문자 및 남은 LaTeX 명령어 정리
    s = replaceAllLiteral(s, "\\,", "`");
    s = replaceAllLiteral(s, "\\;", "~");
    s = replaceAllLiteral(s, "\\!", "");
    s = replaceAllLiteral(s, "\\qquad", "~~~~");
    s = replaceAllLiteral(s, "\\quad", "~~");
    // 제어 공백 `\␣`·`\:` — 좌표 `(,\ a)` 등에서 누수돼 `\a` 로 렌더되던 문제.
    s = replaceAllLiteral(s, "\\ ", "`");
    s = replaceAllLiteral(s, "\\:", "~");
    s = replaceAllLiteral(s, "\\\\", "");
    // 남은 알 수 없는 명령어 — **삭제하되 반드시 보고한다**(원본은 침묵 삭제).
    s = s.replace(/\\[a-zA-Z]+/g, (cmd: string) => {
      if (!INTENTIONALLY_DROPPED.has(cmd)) this.unsupported.add(cmd);
      return "";
    });

    return s;
  }
}

/**
 * LaTeX 수식을 HWP 수식 스크립트로 변환한다.
 *
 * @example
 * latexToHwpEq("\\frac{1}{2}")  // { script: "{1} over {2}", unsupported: [] }
 * latexToHwpEq("\\foo{1}")      // { script: "{1}", unsupported: ["\\foo"] }
 */
export function latexToHwpEq(
  latex: string,
  options: HwpEqOptions = {},
): HwpEqResult {
  const italicizeStat = options.italicizeStat ?? true;
  return new Converter().convert(latex, italicizeStat);
}
