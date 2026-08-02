/* ─────────────────────────────────────────────────────────────
 * 한글(HWP) 계열 수식 폰트 인코딩 → LaTeX
 *
 * 국내 교재 PDF의 수식은 유니코드가 아니다. 조판기가 전용 수식 폰트에
 * 글리프를 얹어 쓰기 때문에, 텍스트 레이어에는 그 폰트의 코드포인트가
 * 그대로 남는다. 눈에는 2²×3³이지만 파일에는 `2Û`_3Ü``라고 적혀 있다.
 *
 * **이 표의 값은 추측이 아니라 지면 대조로 확정한 것이다.** 각 규칙마다
 * 대조에 쓴 실제 문항을 주석으로 남겼고, 테스트가 그 값을 단언한다.
 * 표를 고칠 때는 반드시 지면을 다시 열어 볼 것 — 여기서 한 글자가 틀리면
 * 3/2가 2/3이 되고, 그건 화면 어디에도 티가 나지 않은 채 학생이 틀린
 * 채점을 받는 것으로만 드러난다.
 *
 * 모르는 글리프는 **버리지 않고 unknown에 담아 올린다.** 조용히 지우면
 * `2×3`이 `23`이 되어 문항이 멀쩡해 보인다. 원칙 12(수식이 깨진 문항은
 * 게시 불가)를 지키려면 "못 읽었다"는 사실 자체가 밖으로 나가야 한다.
 * ───────────────────────────────────────────────────────────── */

export interface DecodeResult {
  /** 디코드된 LaTeX 조각 (수식 모드 안에 들어갈 내용, $ 없음) */
  latex: string;
  /** 확신하지 못한 글리프 — 하나라도 있으면 게시 금지, 검수함으로 */
  unknown: string[];
}

/**
 * 지수 글리프. `2Û`` = 2² (p.20 문항 0135 「세 수 2Û`_3Ü`_5」 대조).
 * 이 교재(RPM 중1-1)에는 ¹~⁵만 나타난다. 나머지도 같은 연속 배치일
 * 것으로 보이나 **대조하지 않았으므로 넣지 않는다** — 넣으면 검증되지
 * 않은 값이 검증된 값인 척한다.
 */
const SUPERSCRIPT: ReadonlyMap<string, string> = new Map([
  ["Ú", "1"], // Ú — Û~à가 2~7이므로 그 앞자리
  ["Û", "2"], // Û — 2² (p.20 문항 0135 「2Û`_3Ü`_5」)
  ["Ü", "3"], // Ü — 3³
  ["Ý", "4"], // Ý — 3⁴ (p.20 문항 0137 「3Ý`_5Ü`_11」)
  ["Þ", "5"], // Þ — 2⁵ (p.3 「2Þ`」)
  /* ß·à는 **산술로 확정했다.** 지면을 읽을 필요도 없었다:
   *   p.2  「3Þ`_51=3Þ`_3_17=3ß`_17」 → 3⁵×3 = 3⁶ 이므로 ß=6
   *   p.3  「128=2à`」               → 2⁷ = 128   이므로 à=7
   * 이로써 Û(2)~à(7)가 연속 배치임이 확인됐다. */
  ["ß", "6"],
  ["à", "7"],
]);

/**
 * 위첨자로 올라간 **문자**(변수). 숫자 지수와는 다른 글리프 묶음이다.
 * p.24 「2Þ`_3º`_c」 = 2⁵×3ᵇ×c · p.29 「3º`_5_7¶`」 = 3ᵇ×5×7ᵈ (지면 대조).
 * a·c에 해당하는 글리프는 1단원에 나오지 않아 넣지 않았다.
 */
const SUPERSCRIPT_LETTER: ReadonlyMap<string, string> = new Map([
  ["º", "b"],
  ["¶", "d"],
]);

/**
 * **위첨자 자리에서만** 뜻이 달라지는 글리프.
 *
 * 폭 0으로 앞 글자 위에 겹쳐 찍는 글리프인데, 부분집합 글꼴이라 코드가
 * 본문 글자와 겹친다. `b`가 그렇다 — 본문에서는 변수 b지만 겹쳐 찍히면
 * 위첨자 **a**다. 네 곳을 그려서 모두 확인했다:
 *   본책 0160 「2^a×3²×5」 · 별책 12쪽 「2^a×3²×5」 「=2³×3^a×5」 · 별책 0199 「3^a×5」
 *
 * 그래서 좌표가 「이 글자는 위첨자다」라고 말해 준 자리에서만 이 표를 본다.
 * 본문의 b까지 a로 바꾸면 문항이 통째로 망가진다.
 */
const OVERSTRUCK_SUPERSCRIPT: ReadonlyMap<string, string> = new Map([["b", "a"]]);

/** 진짜 유니코드 위첨자로 들어온 경우 (개념 정리 쪽에서 나온다) */
const UNICODE_SUPERSCRIPT: ReadonlyMap<string, string> = new Map([
  ["¹", "1"],
  ["²", "2"],
  ["³", "3"],
]);

/**
 * 분수 안의 **분자** 글리프 — 숫자 자판의 shift 행이다.
 * `;2!;` = 1/2 · `;6&;` = 7/6 · `;1#2%;` = 35/12 (모두 지면 대조).
 */
const SHIFT_ROW: ReadonlyMap<string, string> = new Map([
  ["!", "1"],
  ["@", "2"],
  ["#", "3"],
  ["$", "4"],
  ["%", "5"],
  ["^", "6"],
  ["&", "7"],
  ["*", "8"],
  ["(", "9"],
  [")", "0"],
]);

/**
 * 연산 기호 — 지면에서 ×, ÷로 보이는 것들.
 *
 * 뒤에 공백을 붙이는 이유: LaTeX의 제어 낱말은 글자가 아닌 것에서 끝난다.
 * `4_x`를 `4\timesx`로 내면 `\timesx`라는 없는 명령이 되어 렌더가 실패한다
 * (숫자가 뒤에 올 때는 우연히 통과해서 더 나쁘다 — 변수 문항에서만 깨진다).
 */
const OPERATOR: ReadonlyMap<string, string> = new Map([
  ["_", "\\times "], // p.20 「2_3Û`」 = 2×3²
  ["Ö", "\\div "], // Ö — p.75 「4Öa」 = 4÷a
  ["×", "\\times "], // × (진짜 유니코드로 들어온 경우)
]);

/**
 * **같은 코드가 글꼴마다 다른 글자다.**
 *
 * 이 교재는 수식 글꼴을 여럿 섞어 쓰는데, 부분집합 글꼴이라 코드가 글꼴
 * 안에서만 뜻을 갖는다. 글꼴을 안 보고 옮겼더니 이렇게 됐다:
 *
 * - `y` — EHyak에서는 말줄임(⋯)이지만 EHsang에서는 **변수 y**다.
 *   「어떤 자연수 y의 제곱이 되도록」이 「어떤 자연수 ⋯의 제곱이」가 됐다
 *   (문항 0074·0090·0100). 학생이 읽는 발문이 뜻을 잃는다.
 * - `¾` — EHyak에서는 ≥지만 EHsang에서는 **℃**다. 0255의 답은 `x≥-4`,
 *   0214의 답은 `+7℃`인데 한 표로는 둘 중 하나가 반드시 틀린다.
 *
 * 그래서 글꼴별 표를 먼저 보고, 없으면 공통 표로 간다. 여기 있는 값은
 * 전부 해당 쪽을 그려서 눈으로 대조한 것이다.
 */
const BY_FONT: readonly { font: RegExp; map: ReadonlyMap<string, string> }[] = [
  {
    font: /^EHyak/,
    map: new Map([
      ["y", "\\cdots "], // 별책 0083 「a×a×…×a=aⁿ」
      ["¾", "\\ge "], // 별책 0255 「x≥-4」
      ["É", "\\le "], // 별책 0256 「x≤11」
    ]),
  },
  {
    font: /^EHsang/,
    map: new Map([
      ["¾", "\\degree\\mathrm{C}"], // 별책 0214 「+7 ℃, -10 ℃」
      ["Ç", "^{n}"], // 별책 0071 「2²×3×5ⁿ의 약수의 개수는」
      ["¡", "^{8}"], // 별책 0090 「256=2⁸이므로」
    ]),
  },
];

/**
 * 의미 없는 조판 부호 — 지우는 것이 맞다고 확인한 것만.
 * 백틱은 수식 폰트의 얇은 공백, U+0000~U+001F는 커닝·힌트 마크,
 * 나머지는 줄바꿈 방지용 폭 없는/얇은 공백이다.
 */
const DROPPABLE_CLASS =
  "[`\\u0000-\\u001f\\u2006\\u2009\\u200a\\u200b-\\u200d\\ufeff]";
/** 전역 플래그는 lastIndex를 남긴다 — 치환용과 검사용을 나눠 둔다 */
const DROPPABLE = new RegExp(DROPPABLE_CLASS, "g");
const DROPPABLE_ONE = new RegExp(DROPPABLE_CLASS);

/** 분수: `;` 또는 `:`로 감싸이고 안쪽이 분모·분자 교대 */
const FRACTION = /;([^;:\s]{2,8});|:([^;:\s]{2,8}):/g;

/** 분수 자리표시자 — 사설 사용 영역이라 본문·수식과 충돌하지 않는다 */
const PH_OPEN = "\uE000";
const PH_CLOSE = "\uE001";


/** 위첨자 표식 — 좌표로 알아낸 사실을 해독기까지 나르는 통로 */
const SUP_OPEN = "\uE002";
const SUP_CLOSE = "\uE003";

/**
 * 좌표를 보고 **위첨자 글자에 표를 해 둔다.**
 *
 * 이 교재의 위첨자는 세 가지 꼴로 온다:
 *  1. 전용 글리프 — `Û`(²), `º`(ᵇ). 해독표가 안다.
 *  2. 작게 떠 있는 별도 span — 크기가 8할 아래다. 파서가 이미 본다.
 *     (별책 0199의 위첨자 c·d가 5.3pt로 이렇게 온다)
 *  3. **폭 0인 글자** — 앞 글자 위에 겹쳐 찍는다. 본문 글자와 코드가 같아
 *     (위첨자 `a`가 `b`로 온다) 글자만 봐서는 영영 알 수 없다.
 *
 * 3번 때문에 발문 `2^a×3^b×5`가 `2b×3^b×5`가 됐다(0160·0162·0163·0199).
 * KaTeX는 아무 오류 없이 그려 내므로 **렌더 검사로는 잡히지 않는다.**
 *
 * 원문은 건드리지 않는다(원칙 2O) — 표식을 단 **사본**을 해독기에 준다.
 */
export function markSuperscripts(
  text: string,
  chars: readonly [number, number, number, number][] | undefined,
): string {
  const glyphs = [...text];
  if (!chars || chars.length !== glyphs.length) return text;

  let out = "";
  let open = false;
  glyphs.forEach((ch, i) => {
    const box = chars[i]!;
    /* 가르는 것은 **폭**이다. 높이로는 못 가른다 — PyMuPDF의 글자 상자는
     * 글리프의 잉크가 아니라 **줄 높이**를 준다(0160의 여덟 글자가 전부
     * y 216.27~228.73이다). 겹쳐 찍는 위첨자는 다음 글자를 밀지 않으므로
     * 폭이 0이고, 그것이 지면에서 위에 떠 있다는 유일한 증거다.
     *
     * 아스키 글자·숫자로 한정하는 이유: 폭 0인 것 중에는 전용 위첨자
     * 글리프(U+00DB 등)와 세로셈 표를 그리는 조각(U+00B3 등)도 있는데,
     * 그것들은 해독표가 이미 알고 있다. 여기서 또 감싸면 지수가 두 겹이
     * 된다. */
    const isSup = box[2] - box[0] < 0.01 && /[A-Za-z0-9]/.test(ch);
    if (isSup !== open) {
      out += isSup ? SUP_OPEN : SUP_CLOSE;
      open = isSup;
    }
    out += ch;
  });
  return open ? out + SUP_CLOSE : out;
}

/**
 * 분수 한 덩어리를 푼다.
 *
 * 안쪽 글자는 **분모·분자 교대**로 놓여 있다 — 지면에서 분모가 먼저 오는
 * 자리에 찍히기 때문이다. `;2!;`는 분모 2 · 분자 1 → 1/2,
 * `;1#2%;`는 분모 "12" · 분자 "35" → 35/12. (셋 다 지면 대조)
 *
 * 규칙에 맞지 않으면 null을 돌려 원문을 그대로 남긴다. 억지로 푸는 것보다
 * 못 풀었다고 말하는 편이 낫다.
 */
function decodeFraction(inner: string): string | null {
  const chars = [...inner];
  if (chars.length < 2 || chars.length % 2 !== 0) return null;
  let denominator = "";
  let numerator = "";
  for (let i = 0; i < chars.length; i += 2) {
    const d = chars[i]!;
    const n = SHIFT_ROW.get(chars[i + 1]!);
    if (!/[0-9]/.test(d) || n === undefined) return null;
    denominator += d;
    numerator += n;
  }
  return `\\frac{${numerator}}{${denominator}}`;
}

/**
 * 이 표가 다룰 수 있다고 확인한 평문 문자 — 그대로 통과시킨다.
 * `:`가 들어 있는 이유: 분수를 걷어낸 뒤 남은 콜론은 비(比) 기호다
 * (p.24 문항 0167 「2 : 5 : 6」). 분수 해독에 실패한 `;…;`는 이미
 * unknown에 기록됐으므로 여기를 지나가도 조용히 묻히지 않는다.
 */
const PASSTHROUGH = /[0-9A-Za-z+\-=<>(),.:\s/|[\]{}]/;

/**
 * 수식 폰트 문자열 한 조각을 LaTeX으로 옮긴다.
 *
 * 결정론적이다 — 같은 입력은 언제나 같은 출력. 시각·난수를 읽지 않는다.
 */
export function decodeHwpMath(raw: string, font?: string): DecodeResult {
  const unknown: string[] = [];
  const fractions: string[] = [];
  /* 글꼴을 모르면 글꼴별 표는 건너뛴다 — 짐작해서 고르면 반은 틀린다 */
  const byFont = font ? BY_FONT.find((f) => f.font.test(font))?.map : undefined;

  /* 1) 분수를 먼저 걷어내 자리표시자로 바꾼다. 분수 안에 지수·곱셈이
   *    섞이는 경우가 없음을 지면에서 확인했으므로 순서상 안전하다. */
  let work = raw.replace(FRACTION, (whole, a?: string, b?: string) => {
    const latex = decodeFraction(a ?? b ?? "");
    if (latex === null) {
      unknown.push(whole);
      return whole;
    }
    fractions.push(latex);
    return `${PH_OPEN}${fractions.length - 1}${PH_CLOSE}`;
  });

  // 2) 조판 부호 제거
  work = work.replace(DROPPABLE, "");

  // 3) 남은 글자를 하나씩 옮긴다
  let out = "";
  let inPlaceholder = false;
  let inSuperscript = false;
  for (const ch of work) {
    if (ch === PH_OPEN) {
      inPlaceholder = true;
      out += ch;
      continue;
    }
    if (ch === PH_CLOSE) {
      inPlaceholder = false;
      out += ch;
      continue;
    }
    if (inPlaceholder) {
      out += ch;
      continue;
    }
    /* 좌표가 알려 준 위첨자 — 글리프표보다 확실한 근거다 */
    if (ch === SUP_OPEN) {
      inSuperscript = true;
      out += "^{";
      continue;
    }
    if (ch === SUP_CLOSE) {
      inSuperscript = false;
      out += "}";
      continue;
    }
    const sup =
      SUPERSCRIPT.get(ch) ??
      SUPERSCRIPT_LETTER.get(ch) ??
      UNICODE_SUPERSCRIPT.get(ch);
    if (inSuperscript) {
      /* 이미 위첨자 안이다 — `^{}`를 또 씌우지 않는다 */
      out += sup ?? OVERSTRUCK_SUPERSCRIPT.get(ch) ?? ch;
      continue;
    }
    /* 글꼴별 표가 공통 표보다 앞선다 — 같은 코드의 뜻을 가르는 것이 글꼴이다 */
    const scoped = byFont?.get(ch);
    if (scoped !== undefined) {
      out += scoped;
      continue;
    }
    if (sup !== undefined) {
      out += `^{${sup}}`;
      continue;
    }
    const op = OPERATOR.get(ch);
    if (op !== undefined) {
      out += op;
      continue;
    }
    if (PASSTHROUGH.test(ch)) {
      out += ch;
      continue;
    }
    unknown.push(ch);
    out += ch; // 지우지 않는다 — 검수자가 원문을 볼 수 있어야 한다
  }

  // 4) 자리표시자 되돌리기
  const restore = new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, "g");
  out = out.replace(restore, (_m, i: string) => fractions[Number(i)] ?? "");

  return { latex: out.trim(), unknown };
}

/**
 * 한글 문장 안에 섞인 조판 부호만 털어 낸다 (수식 아님).
 * 본문 span은 디코드 대상이 아니지만 U+0008 같은 마크를 그대로 두면
 * 문항 본문에 제어문자가 실려 저장된다.
 */
export function cleanBodyText(raw: string): string {
  return raw.replace(DROPPABLE, "").replace(/[ \t]+/g, " ");
}

/**
 * 조각을 다 이어 붙인 뒤의 마무리 손질.
 *
 * 조판기는 줄을 오른쪽 끝까지 채우려고 낱말 사이를 벌린다. 그 공백이
 * span 텍스트에 그대로 실려 와서, 이어 붙이면 「공약수는   (2+1)×(1+1)」처럼
 * 한가운데가 뻥 뚫린다 — 지면에서는 양쪽 정렬이라 자연스럽지만 화면에서는
 * 그냥 이상하다.
 *
 * 여는 괄호 앞·닫는 괄호와 문장부호 뒤의 군더더기 공백도 함께 턴다.
 */
export function tidyBodyText(text: string): string {
  /* **끝의 공백을 지우지 않는다.** 조각 하나만 놓고 보면 군더더기 같지만,
   * 그 공백이 다음 수식 조각과의 띄어쓰기다 — trim을 넣었더니 「과 」가
   * 「과」가 되어 화면에 「16과81의」로 붙어 나왔다. */
  return text
    .replace(/[ \t]{2,}/g, " ") // 양쪽 정렬이 벌려 놓은 공백
    .replace(/[ \t]+([,.)\]}%])/g, "$1") // 문장부호 앞 공백
    .replace(/([([{])[ \t]+/g, "$1"); // 여는 괄호 뒤 공백
}

/**
 * 두 LaTeX 조각을 잇는다 — 필요한 자리에만 공백을 넣는다.
 *
 * `\times`는 글자가 아닌 것에서 끝나는 제어 낱말이라 뒤에 공백을 둔다.
 * 그런데 `decodeHwpMath`가 조각을 다듬으며 `trim()`을 하고, 그 뒤에 다음
 * 조각을 그냥 붙이면 `8\times` + `a` = `8\timesa`가 된다. 없는 명령이므로
 * KaTeX가 파싱에 실패하고 **화면에 빨간 글자로 그대로** 나온다 —
 * 실제로 해설 6건이 그랬다(문항 0206·0207 등).
 *
 * 조각을 이어 붙이는 자리에서는 반드시 이 함수를 쓴다.
 */
export function joinLatex(left: string, right: string): string {
  if (left === "") return right;
  const needsSpace = /\\[a-zA-Z]+$/.test(left) && /^[a-zA-Z]/.test(right);
  return left + (needsSpace ? " " : "") + right;
}

/**
 * 한글 조각 잇기 — 문장이 끝난 자리에 공백을 넣는다.
 *
 * 조판기는 줄바꿈으로 문장을 나누므로 span에는 공백이 없다. 그대로 이으면
 * 「이 문장을 이용한다.최대공약수가 8이고」 「말하시오.2⁵」처럼 붙어 버린다.
 * 화면에서 바로 보이는 종류의 흠이다.
 *
 * 마침표 **뒤에만** 넣는다. 아무 데나 넣으면 「최대」+「공약수」가
 * 「최대 공약수」가 되어 오히려 나빠진다.
 */
export function joinKorean(left: string, right: string): string {
  if (left === "" || right === "") return left + right;
  const needsSpace = /[.!?]$/.test(left) && /^[^\s.,)\]}]/.test(right);
  return left + (needsSpace ? " " : "") + right;
}

/** 표가 다룰 수 있는 글리프인지 — 프로파일 자가진단용 */
export function isKnownGlyph(ch: string): boolean {
  return (
    SUPERSCRIPT.has(ch) ||
    SUPERSCRIPT_LETTER.has(ch) ||
    UNICODE_SUPERSCRIPT.has(ch) ||
    OPERATOR.has(ch) ||
    BY_FONT.some((f) => f.map.has(ch)) ||
    SHIFT_ROW.has(ch) ||
    PASSTHROUGH.test(ch) ||
    DROPPABLE_ONE.test(ch)
  );
}
