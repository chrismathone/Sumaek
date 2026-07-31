/**
 * 수식 파이프라인 버전·정책 상수 (골프롬프트 2O·2P).
 * 버전이 바뀌면 골든 A/B와 사람 승인 후 단계 배포한다.
 */

export const NORMALIZER_VERSION = "su-maek-normalizer/1.0.0";
export const MACRO_POLICY_VERSION = "macro-policy/1.0.0";

/** KaTeX Main-Regular에 없는 유니코드 → LaTeX (mathlab·mathg-gen 실전 목록) */
export const UNICODE_MATH_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/℃/g, "{}^\\circ\\mathrm{C}"],
  [/℉/g, "{}^\\circ\\mathrm{F}"],
  [/Ω/g, "\\Omega"],
  [/Å/g, "\\mathrm{\\AA}"],
  [/㎡/g, "\\mathrm{m}^2"],
  [/㎥/g, "\\mathrm{m}^3"],
  [/㎝/g, "\\mathrm{cm}"],
  [/㎜/g, "\\mathrm{mm}"],
  [/㎞/g, "\\mathrm{km}"],
  [/㎏/g, "\\mathrm{kg}"],
  // 승인된 수학 기호 정규화 (2O 자동 허용 목록)
  [/−/g, "-"], // U+2212 minus sign
  [/×/g, "\\times "],
  [/÷/g, "\\div "],
  [/≤/g, "\\le "],
  [/≥/g, "\\ge "],
  [/≠/g, "\\ne "],
  [/±/g, "\\pm "],
  [/∞/g, "\\infty "],
  [/√/g, "\\sqrt "],
  [/∈/g, "\\in "],
  [/∉/g, "\\notin "],
  [/⊂/g, "\\subset "],
  [/∪/g, "\\cup "],
  [/∩/g, "\\cap "],
  [/∠/g, "\\angle "],
  [/△/g, "\\triangle "],
  [/⊥/g, "\\perp "],
  [/∥/g, "\\parallel "],
  [/π/g, "\\pi "],
  [/θ/g, "\\theta "],
  [/°/g, "^\\circ "],
];

/** 유니코드 위첨자 → 명시적 지수 (2O 자동 허용) */
export const UNICODE_SUPERSCRIPT_MAP: ReadonlyArray<readonly [RegExp, string]> =
  [
    [/⁰/g, "^{0}"],
    [/¹/g, "^{1}"],
    [/²/g, "^{2}"],
    [/³/g, "^{3}"],
    [/⁴/g, "^{4}"],
    [/⁵/g, "^{5}"],
    [/⁶/g, "^{6}"],
    [/⁷/g, "^{7}"],
    [/⁸/g, "^{8}"],
    [/⁹/g, "^{9}"],
  ];

/** 다행 환경 — 인라인에 있으면 display로 승격 */
export const MULTILINE_ENV_RE =
  /\\begin\{(cases|align|aligned|array|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|Bmatrix|split|gather|gathered)\}/;

/** 선택지 세로 배치 트리거 — 키 큰 수식 (#9와 #14가 공유하는 단일 규칙) */
export const TALL_LATEX_RE =
  /\\begin\{(cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|Bmatrix|aligned|gathered|array|split)\}|\\d?frac|\\sqrt|\\sum|\\int|\\prod|\\lim/;

/** 한글 음절·자모 — math 모드에 있으면 검수 플래그 */
export const HANGUL_RE = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

/**
 * 지원 LaTeX 명령 허용 목록 (2O 지원 문법 — 버전 관리 대상).
 * 목록 밖 명령은 조용히 삭제하지 않고 위치와 함께 검수함으로 보낸다.
 */
export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  // 스타일·간격
  "displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle",
  "quad", "qquad", ",", ";", ":", "!", " ", "\\",
  // 기본 연산·분수·근호
  "frac", "dfrac", "tfrac", "cfrac", "sqrt", "pm", "mp", "cdot", "times",
  "div", "ast", "circ", "bullet", "over",
  // 절댓값·바닥·천장·괄호
  "left", "right", "lvert", "rvert", "lVert", "rVert", "lfloor", "rfloor",
  "lceil", "rceil", "langle", "rangle", "big", "Big", "bigg", "Bigg",
  "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr",
  "bigm", "Bigm", "biggm", "Biggm",
  // 지수·첨자·조합
  "binom", "dbinom", "tbinom", "overbrace", "underbrace",
  // 등식·부등식·집합·논리
  "ne", "neq", "le", "leq", "ge", "geq", "ll", "gg", "equiv", "sim", "simeq",
  "cong", "propto", "in", "notin", "ni", "subset", "supset", "subseteq",
  "supseteq", "subsetneq", "supsetneq", "cup", "cap", "setminus", "emptyset",
  "varnothing", "forall", "exists", "nexists", "land", "lor", "lnot", "neg",
  "implies", "impliedby", "iff", "therefore", "because", "mid", "nmid",
  // 함수·삼각·로그·지수
  "sin", "cos", "tan", "sec", "csc", "cot", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "max", "min", "gcd",
  "det", "deg", "arg", "operatorname",
  // 수열·합·곱·극한
  "sum", "prod", "coprod", "lim", "limsup", "liminf", "to", "rightarrow",
  "leftarrow", "Rightarrow", "Leftarrow", "Leftrightarrow", "leftrightarrow",
  "longrightarrow", "Longrightarrow", "mapsto", "infty", "cdots", "ldots",
  "dots", "vdots", "ddots",
  // 미분·적분
  "int", "iint", "iiint", "oint", "partial", "nabla", "prime", "mathrm",
  "differential",
  // 벡터·행렬
  "vec", "overrightarrow", "overleftarrow", "overleftrightarrow", "cdotp",
  "begin", "end", "hline", "vert", "Vert",
  // 장식·강조
  "hat", "widehat", "tilde", "widetilde", "bar", "overline", "underline",
  "dot", "ddot", "overset", "underset", "stackrel", "boxed", "phantom",
  "hphantom", "vphantom", "overarc", "overgroup", "smash",
  // 기하
  "angle", "measuredangle", "sphericalangle", "triangle", "square", "perp",
  "parallel", "frown", "degree",
  // 확률·통계
  "Pr", "mathbb", "mathbf", "mathcal", "mathfrak", "mathsf", "mathit",
  "bmod", "pmod", "mod", "choose",
  // 그리스 문자
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
  "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi",
  "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi",
  "varphi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi",
  "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega", "ell",
  // 텍스트 (한국어 단위·설명 혼합)
  "text", "textrm", "textbf", "textit", "textnormal", "mbox",
  // 허용 확장 (명령 단위 — 기하 호 표기 전용)
  "htmlClass",
  // 기타 실전 빈출
  "not", "AA", "underbar", "checkmark", "bigcup", "bigcap", "bigvee",
  "bigwedge", "bigoplus", "bigotimes", "approx", "fallingdotseq", "risingdotseq",
  "doteq", "coloneqq", "top", "bot", "star",
]);

/** 자원 고갈 방지 한도 (2P KaTeX 보안) */
export const MATH_LIMITS = {
  maxInputLength: 20_000,
  maxNestingDepth: 40,
  maxExpandMacros: 512,
} as const;
