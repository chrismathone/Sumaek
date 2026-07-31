/**
 * LaTeX → HWP 수식 스크립트 매핑 테이블 + HYhwpEQ 글꼴 메트릭.
 *
 * 원본(읽기 전용, 수정 금지):
 *   - D:\시험지 한글화\core\latex_to_hwpeq.py  (GREEK/SYMBOL/FUNC/ACCENT_MAP)
 *   - D:\시험지 한글화\core\hwpx_writer.py     (문자·키워드 폭, 튜닝 상수)
 *
 * 값은 실제 HWP 렌더 실측·골든셋 그리드 서치로 확정된 것이다.
 * **임의로 바꾸지 말 것** — 바꾸면 test/hwp/metrics.test.ts 의 MAPE 게이트가 깨진다.
 *
 * 객체 리터럴의 키 순서 = 원본 Python dict 의 삽입 순서.
 * convert.ts 의 8·9·10 단계가 "키 길이 내림차순 + 안정 정렬"로 순회하므로
 * 같은 길이 키끼리의 상대 순서(= 삽입 순서)가 치환 결과에 영향을 준다.
 */

/** 그리스 문자 — latex_to_hwpeq.py:347 (38개) */
export const GREEK_MAP: Readonly<Record<string, string>> = {
  "\\alpha": "alpha",
  "\\beta": "beta",
  "\\gamma": "gamma",
  "\\delta": "delta",
  "\\epsilon": "epsilon",
  "\\varepsilon": "varepsilon",
  "\\zeta": "zeta",
  "\\eta": "eta",
  "\\theta": "theta",
  "\\vartheta": "vartheta",
  "\\iota": "iota",
  "\\kappa": "kappa",
  "\\lambda": "lambda",
  "\\mu": "mu",
  "\\nu": "nu",
  "\\xi": "xi",
  "\\pi": "pi",
  "\\rho": "rho",
  "\\sigma": "sigma",
  "\\tau": "tau",
  "\\upsilon": "upsilon",
  "\\phi": "phi",
  "\\varphi": "varphi",
  "\\chi": "chi",
  "\\psi": "psi",
  "\\omega": "omega",
  // 대문자 (PascalCase — HWP 규칙: 첫 글자만 대문자)
  "\\Gamma": "Gamma",
  "\\Delta": "Delta",
  "\\Theta": "Theta",
  "\\Lambda": "Lambda",
  "\\Xi": "Xi",
  "\\Pi": "Pi",
  "\\Sigma": "Sigma",
  "\\Upsilon": "Upsilon",
  "\\Phi": "Phi",
  "\\Chi": "Chi",
  "\\Psi": "Psi",
  "\\Omega": "Omega",
};

/**
 * 연산자·기호 — latex_to_hwpeq.py:390 (105개)
 *
 * 유니코드 리터럴로 고정된 항목은 HWP 키워드가 글리프를 틀리게 그리거나
 * 통째로 증발하던 실측 결함의 우회다. 원본 주석의 근거를 함께 옮긴다.
 */
export const SYMBOL_MAP: Readonly<Record<string, string>> = {
  // 이스케이프 리터럴
  "\\%": "%", // 백분율: 99\% → 99% (미매핑이면 백슬래시 잔존)
  // 산술 연산
  "\\times": "TIMES",
  "\\cdot": "CDOT",
  "\\div": "DIV",
  "\\pm": "PLUSMINUS",
  "\\mp": "MINUSPLUS",
  // 관계 연산
  "\\leq": "LEQ",
  "\\le": "LEQ",
  "\\geq": "GEQ",
  "\\ge": "GEQ",
  "\\neq": "neq",
  "\\ne": "neq",
  "\\approx": "APPROX",
  "\\equiv": "EQUIV",
  // 닮음 기호: 한국 교과서는 ∽(U+223D). HWP 키워드 SIM 은 ∼(U+223C)로 렌더돼
  // 닮음 글리프가 어긋난다(2026-06-15 실측). 리터럴 ∽로 고정.
  "\\backsim": "∽",
  "\\sim": "∽",
  "\\simeq": "SIMEQ",
  "\\cong": "CONG",
  "\\propto": "PROPTO",
  "\\asymp": "ASYMP",
  "\\doteq": "DOTEQ",
  "\\prec": "PREC",
  "\\succ": "SUCC",
  "\\ll": "<<",
  "\\gg": ">>",
  // 특수 기호
  "\\infty": "inf",
  "\\partial": "partial",
  "\\nabla": "LAPLACE",
  "\\forall": "forall",
  "\\exists": "EXIST",
  "\\in": "in",
  "\\notin": "notin",
  "\\ni": "OWNS",
  "\\subset": "subset",
  "\\supset": "supset",
  "\\subseteq": "subseteq",
  "\\supseteq": "supseteq",
  "\\cup": "SMALLUNION",
  "\\cap": "SMALLINTER",
  // 공집합 ∅ — HWP eq 에 emptyset 키워드가 없어 literal 로 렌더되던 것(P(∅)가 P()로 증발).
  "\\emptyset": '"∅"',
  "\\varnothing": '"∅"',
  "\\vee": "VEE",
  "\\lor": "VEE",
  "\\wedge": "WEDGE",
  "\\land": "WEDGE",
  "\\neg": "LNOT",
  "\\lnot": "LNOT",
  "\\oplus": "OPLUS",
  "\\otimes": "OTIMES",
  "\\therefore": "therefore",
  "\\because": "because",
  "\\angle": "angle",
  "\\perp": "BOT",
  // 평행기호: HWP parallel 키워드는 세로 두 줄(││)로 렌더돼 평행처럼 안 보인다.
  // ⫽(U+2AFD) 리터럴로 고정. norm ‖(\Vert)는 세로가 맞으므로 그대로 둔다.
  "\\parallel": '"⫽"',
  "\\mid": "|", // 집합 표기 바: {x | x≤3}. 없으면 누락돼 "xx"로 붙음
  "\\vert": "|",
  "\\Vert": "PARALLEL",
  // 차집합 — "\\" 매핑은 13단계의 잔여 명령 제거에 먹혀 연산자가 통째 증발했다.
  "\\setminus": '"∖"',
  "\\triangle": "TRIANGLE",
  "\\square": '"□"',
  // 각도: CIRC 키워드는 ° 가 아니라 통째 깨져 각도 기호가 증발했다(2026-06-15).
  "\\degree": "°",
  "\\circ": "°",
  "\\bullet": "BULLET",
  // ★ 마커(귀납법 증명 (★) 등) — 키워드 미지원이라 따옴표 리터럴.
  "\\bigstar": '"★"',
  "\\star": "STAR",
  "\\diamond": "DIAMOND",
  "\\top": "TOP",
  "\\vdash": "VDASH",
  "\\models": "MODELS",
  // 화살표 — 단일선
  "\\rightarrow": "->",
  "\\leftarrow": "<-",
  "\\leftrightarrow": "<->",
  "\\to": "->",
  "\\gets": "<-",
  "\\uparrow": "uparrow",
  "\\downarrow": "downarrow",
  "\\updownarrow": "udarrow",
  "\\nearrow": "nearrow",
  "\\nwarrow": "nwarrow",
  "\\searrow": "searrow",
  "\\swarrow": "swarrow",
  "\\hookleftarrow": "hookleft",
  "\\hookrightarrow": "hookright",
  "\\mapsto": "mapsto",
  // 화살표 — 이중선
  "\\Rightarrow": "RARROW",
  "\\Leftarrow": "LARROW",
  "\\Leftrightarrow": "LRARROW",
  "\\Uparrow": "UPARROW",
  "\\Downarrow": "DOWNARROW",
  "\\Updownarrow": "UDARROW",
  // 점
  "\\ldots": "LDOTS",
  "\\cdots": "CDOTS",
  "\\vdots": "VDOTS",
  "\\ddots": "DDOTS",
  // 기타 기호
  "\\prime": "prime",
  "\\aleph": "ALEPH",
  "\\hbar": "HBAR",
  "\\imath": "IMATH",
  "\\jmath": "JMATH",
  "\\ell": "ELL",
  "\\wp": "WP",
  "\\Im": "IMAG",
  "\\Re": "REIMAGE",
  "\\dagger": "DAGGER",
  "\\ddagger": "DDAGGER",
};

/** 함수명 — latex_to_hwpeq.py:521 (33개) */
export const FUNC_MAP: Readonly<Record<string, string>> = {
  "\\sin": "sin",
  "\\cos": "cos",
  "\\tan": "tan",
  "\\sec": "sec",
  "\\csc": "csc",
  "\\cot": "cot",
  "\\cosec": "cosec",
  "\\arcsin": "arcsin",
  "\\arccos": "arccos",
  "\\arctan": "arctan",
  "\\sinh": "sinh",
  "\\cosh": "cosh",
  "\\tanh": "tanh",
  "\\coth": "coth",
  "\\log": "log",
  "\\ln": "ln",
  "\\lg": "lg",
  "\\exp": "exp",
  "\\Exp": "Exp",
  "\\det": "det",
  "\\max": "max",
  "\\min": "min",
  "\\sup": "sup",
  "\\inf": "inf",
  "\\lim": "lim",
  "\\Lim": "Lim",
  "\\gcd": "gcd",
  "\\arg": "arg",
  "\\dim": "dim",
  "\\ker": "ker",
  "\\hom": "hom",
  "\\mod": "mod",
  "\\lcm": "lcm",
};

/**
 * 장식(accent) — latex_to_hwpeq.py:558 (16개)
 *
 * 키 순서가 곧 accent 정규식의 대안(alternation) 순서다.
 */
export const ACCENT_MAP: Readonly<Record<string, string>> = {
  "\\vec": "VEC",
  "\\bar": "BAR",
  "\\hat": "HAT",
  "\\tilde": "TILDE",
  "\\dot": "DOT",
  "\\ddot": "DDOT",
  "\\acute": "acute",
  "\\grave": "grave",
  "\\check": "check",
  "\\breve": "arch",
  "\\overarc": "arch", // 호(⌒) — 매핑이 없으면 장식이 증발하고 rm AB 만 남았다
  "\\overline": "bar",
  "\\underline": "underline",
  "\\overrightarrow": "VEC",
  "\\widehat": "HAT",
  "\\widetilde": "TILDE",
};

/**
 * 연속 대문자 런을 rm {…} 로 정자화할 때 제외할 구조 키워드.
 * latex_to_hwpeq.py:585 (_ROMAN_SKIP_EXTRA)
 *
 * 실제 제외 집합은 여기에 더해 위 4개 맵의 값 중 "전부 대문자 2자 이상"을 합친 것.
 */
export const ROMAN_SKIP_EXTRA: ReadonlySet<string> = new Set([
  "LEFT",
  "RIGHT",
  "SUM",
  "PROD",
  "COPROD",
  "INT",
  "DINT",
  "TINT",
  "OINT",
  "UNION",
  "INTER",
  "CASES",
  "MATRIX",
  "PMATRIX",
  "BMATRIX",
  "DMATRIX",
  "RM",
  "IT",
  "BOLD",
  "ROOT",
  "OF",
  "OVER",
  "ATOP",
  "SQRT",
  "BOX", // \boxed → BOX{…} 테두리 박스 (rm 으로 감싸면 "BOX" 글자로 깨짐)
]);

/**
 * HWP 연산자 키워드와 철자가 같은 점·선분 라벨.
 * latex_to_hwpeq.py:258 (_KEYWORD_LABEL_QUOTE)
 * rm {} 안에서도 HWP 가 ≥ ≤ ≠ ≫ ≪ 로 토큰화해 글자가 증발하므로 따옴표로 감싼다.
 */
export const KEYWORD_LABEL_QUOTE: ReadonlySet<string> = new Set([
  "GE",
  "LE",
  "NE",
  "GG",
  "LL",
]);

/* ══════════════════════════════════════════════════════════════
 * HYhwpEQ 글꼴 메트릭 (C:\Windows\Fonts\HYHWPEQ.TTF)
 * unitsPerEm=1024, baseUnit=1000 → hwpunit ≈ font_advance × 0.9766
 * ══════════════════════════════════════════════════════════════ */

/**
 * 기호로 렌더링되는 HWP 명령어 — hwpx_writer.py:65 (_SYMBOL_KEYWORDS)
 * 긴 이름을 먼저 배치해 부분 일치를 막는다(varepsilon 을 epsilon 보다 앞에).
 */
export const SYMBOL_KEYWORDS: readonly string[] = [
  // latex_to_hwpeq 가 생성하는 대문자 키워드
  "PLUSMINUS",
  "MINUSPLUS",
  "SMALLUNION",
  "SMALLINTER",
  "APPROX",
  "PROPTO",
  "LAPLACE",
  "BULLET",
  "TRIANGLE",
  "DIAMOND",
  "SQUARE",
  "EQUIV",
  "SIMEQ",
  "ASYMP",
  "DOTEQ",
  "TIMES",
  "CDOT",
  "EXIST",
  "WEDGE",
  "LNOT",
  "OPLUS",
  "OTIMES",
  "VDASH",
  "MODELS",
  "PREC",
  "SUCC",
  "CONG",
  "OWNS",
  "CIRC",
  "STAR",
  "DIV",
  "LEQ",
  "GEQ",
  "SIM",
  "VEE",
  "BOT",
  "TOP",
  // 소문자 그리스 문자
  "varepsilon",
  "vartheta",
  "varphi",
  "epsilon",
  "upsilon",
  "lambda",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "mu",
  "nu",
  "xi",
  "pi",
  "rho",
  "sigma",
  "tau",
  "phi",
  "chi",
  "psi",
  "omega",
  // 기타 소문자 키워드
  "partial",
  "therefore",
  "because",
  "forall",
  "exists",
  "emptyset",
  "subseteq",
  "supseteq",
  "subset",
  "supset",
  "notin",
  "parallel",
  "infty",
  "prime",
  "dprime",
  "angle",
  "nabla",
  "bullet",
  "approx",
  "propto",
  "equiv",
  "neq",
  "leq",
  "geq",
  "sim",
  "cdot",
  "times",
  "div",
  "pm",
  "mp",
  "inf",
  "in",
];

/** 대형 연산자(1문자 넓은 기호) — hwpx_writer.py:92 */
export const LARGE_OP_KEYWORDS: readonly string[] = [
  "SUM",
  "PROD",
  "OINT",
  "DINT",
  "TINT",
  "INT",
];

/**
 * 구조 명령어(렌더 폭에 기여하지 않음) — hwpx_writer.py:97
 * LEFT/RIGHT 는 자동크기 괄호 명령이고 실제 괄호 문자는 뒤에 따로 온다.
 */
export const STRUCT_KEYWORDS: readonly string[] = [
  "eqalign",
  "matrix",
  "cases",
  "pile",
  "array",
  "sqrt",
  "root",
  "of",
  "over",
  "atop",
  "from",
  "left",
  "right",
  "LEFT",
  "RIGHT",
  "roman",
  "bold",
  "ital",
  "to",
  // 꾸밈 명령어 (문자 위/아래 기호, 폭에 기여하지 않음)
  "DOT",
  "DDOT",
  "HAT",
  "BAR",
  "VEC",
  "TILDE",
  "OVERLINE",
  "UNDERLINE",
  "ACUTE",
  "GRAVE",
];

/** 문자별 advance 폭(hwpunit) — hwpx_writer.py:112 (_HWPEQ_CHAR_WIDTHS) */
export const HWPEQ_CHAR_WIDTHS: Readonly<Record<string, number>> = {
  " ": 333,
  "0": 583,
  "1": 583,
  "2": 583,
  "3": 583,
  "4": 583,
  "5": 583,
  "6": 583,
  "7": 583,
  "8": 583,
  "9": 583,
  a: 500,
  b: 541,
  c: 500,
  d: 541,
  e: 541,
  f: 375,
  g: 541,
  h: 541,
  i: 291,
  j: 291,
  k: 541,
  l: 291,
  m: 833,
  n: 541,
  o: 541,
  p: 541,
  q: 541,
  r: 416,
  s: 500,
  t: 375,
  u: 541,
  v: 541,
  w: 791,
  x: 583,
  y: 583,
  z: 458,
  A: 750,
  B: 666,
  C: 666,
  D: 708,
  E: 666,
  F: 625,
  G: 708,
  H: 750,
  I: 375,
  J: 458,
  K: 750,
  L: 625,
  M: 916,
  N: 750,
  O: 708,
  P: 625,
  Q: 708,
  R: 666,
  S: 625,
  T: 750,
  U: 750,
  V: 708,
  W: 958,
  X: 666,
  Y: 666,
  Z: 625,
  "+": 833,
  "-": 833,
  "=": 833,
  "<": 833,
  ">": 833,
  "(": 500,
  ")": 500,
  "[": 500,
  "]": 500,
  "|": 583,
  "/": 333,
  ".": 291,
  ",": 291,
  ";": 333,
  ":": 333,
  "*": 500,
  "!": 416,
  "?": 500,
  "~": 791,
  "#": 833,
};

/** 키워드별 렌더 폭(hwpunit) — hwpx_writer.py:158 (_HWPEQ_KEYWORD_WIDTHS) */
export const HWPEQ_KEYWORD_WIDTHS: Readonly<Record<string, number>> = {
  alpha: 500,
  beta: 554,
  gamma: 444,
  delta: 554,
  epsilon: 444,
  varepsilon: 444,
  zeta: 304,
  eta: 500,
  theta: 554,
  vartheta: 500,
  iota: 276,
  kappa: 526,
  lambda: 276,
  mu: 833,
  nu: 554,
  xi: 500,
  pi: 554,
  rho: 526,
  sigma: 390,
  tau: 394,
  upsilon: 388,
  phi: 554,
  varphi: 500,
  chi: 526,
  psi: 721,
  omega: 526,
  neq: 1000,
  leq: 1000,
  geq: 1000,
  sim: 1000,
  approx: 1000,
  equiv: 1000,
  simeq: 1000,
  asymp: 1000,
  doteq: 1000,
  cong: 1000,
  times: 811,
  cdot: 1000,
  div: 811,
  pm: 811,
  mp: 811,
  cdots: 1000,
  ldots: 1000,
  wedge: 1000,
  vee: 1000,
  oplus: 1000,
  otimes: 1000,
  infty: 1000,
  inf: 1000,
  in: 1000,
  partial: 541,
  nabla: 1000,
  forall: 1000,
  exists: 1000,
  emptyset: 1000,
  angle: 1000,
  prime: 276,
  dprime: 400,
  bullet: 1000,
  therefore: 1000,
  because: 1000,
  circ: 1000,
  star: 1000,
  subset: 1000,
  supset: 1000,
  subseteq: 1000,
  supseteq: 1000,
  notin: 1000,
  parallel: 500,
  lnot: 785,
  prec: 1000,
  succ: 1000,
  owns: 1000,
  vdash: 1000,
  models: 1000,
  PLUSMINUS: 811,
  MINUSPLUS: 811,
  SMALLUNION: 1000,
  SMALLINTER: 1000,
  APPROX: 1000,
  PROPTO: 1000,
  LAPLACE: 1000,
  BULLET: 1000,
  TRIANGLE: 1000,
  DIAMOND: 1000,
  SQUARE: 600,
  EQUIV: 1000,
  SIMEQ: 1000,
  ASYMP: 1000,
  DOTEQ: 1000,
  TIMES: 811,
  CDOT: 1000,
  EXIST: 1000,
  WEDGE: 1000,
  LNOT: 785,
  OPLUS: 1000,
  OTIMES: 1000,
  VDASH: 1000,
  MODELS: 1000,
  PREC: 1000,
  SUCC: 1000,
  CONG: 1000,
  OWNS: 1000,
  CIRC: 1000,
  STAR: 1000,
  DIV: 811,
  LEQ: 1000,
  GEQ: 1000,
  SIM: 1000,
  VEE: 1000,
  BOT: 1000,
  TOP: 1000,
};

/* ── 튜닝 상수 (정답 HWPX 84개 그리드 서치·최소제곱) — hwpx_writer.py:134-156 ── */

/** 한글 음절·한자 기본 폭. HWP 가 본문 폰트(7) 메트릭을 참조한다. */
export const HWPEQ_HANGUL_WIDTH = 650;

/** LEFT/RIGHT 자동크기 괄호 1개당 추가 가산량. */
export const HWPEQ_LEFT_RIGHT_EXTRA = 1800;

/** 분수 분자·분모 축소 비율. */
export const HWPEQ_FRAC_SCALE = 0.75;

/** 분수선 양쪽 여백. */
export const HWPEQ_FRAC_PADDING = 400;

/** 이항 연산자 주변 여백 — 튠 결과 char-level 트래킹에 흡수돼 0으로 수렴. */
export const HWPEQ_BINOP_SPACE = 0;

/** 가시 문자당 추가 트래킹(HYhwpEQ 내재 자간 근사). */
export const HWPEQ_CHAR_PAD = 100;

/** 전체 선형 보정: actual ≈ SCALE × estimate + BIAS (84개 정답 최소제곱). */
export const HWPEQ_GLOBAL_SCALE = 0.8076;
export const HWPEQ_GLOBAL_BIAS = 394;

/** 위/아래첨자 축소 비율 — hwpx_writer.py:278 */
export const HWPEQ_SUP_SUB_SCALE = 0.5;

/** 폭 하한(hwpunit) — 0폭 수식은 옆 글자와 겹친다. */
export const HWPEQ_MIN_WIDTH = 400;

/** 1단/2단 이진 높이 — 한컴은 이 두 값만 사용한다(정답 84개 분석). */
export const HWPEQ_HEIGHT_SINGLE = 1200;
export const HWPEQ_HEIGHT_DOUBLE = 2400;
