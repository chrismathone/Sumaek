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
export function decodeHwpMath(raw: string): DecodeResult {
  const unknown: string[] = [];
  const fractions: string[] = [];

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
    const sup =
      SUPERSCRIPT.get(ch) ??
      SUPERSCRIPT_LETTER.get(ch) ??
      UNICODE_SUPERSCRIPT.get(ch);
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

/** 표가 다룰 수 있는 글리프인지 — 프로파일 자가진단용 */
export function isKnownGlyph(ch: string): boolean {
  return (
    SUPERSCRIPT.has(ch) ||
    SUPERSCRIPT_LETTER.has(ch) ||
    UNICODE_SUPERSCRIPT.has(ch) ||
    OPERATOR.has(ch) ||
    SHIFT_ROW.has(ch) ||
    PASSTHROUGH.test(ch) ||
    DROPPABLE_ONE.test(ch)
  );
}
