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

import type { Run } from "./types";

export interface DecodeResult {
  /** 디코드된 LaTeX 조각 (수식 모드 안에 들어갈 내용, $ 없음) */
  latex: string;
  /** 확신하지 못한 글리프 — 하나라도 있으면 게시 금지, 검수함으로 */
  unknown: string[];
}

/**
 * 지수 글리프. `2Û`` = 2² (p.20 문항 0135 「세 수 2Û`_3Ü`_5」 대조).
 *
 * 8만 오래 비어 있었다 — 중1-1에 나오지 않아서다. 중2-1 II단원(지수법칙)이
 * 나머지를 채웠고, 전부 지면에서 확인했다.
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
  /* 8은 EHsang 글꼴표에 `¡`로 따로 있었는데(별책 0090 「256=2⁸」), 지수를
   * 여러 글자로 묶으려면 같은 표에 있어야 한다 — 아래 SUPERSCRIPT_PART 참고. */
  ["á", "9"], // 중2-1 p.33 문항 0205 「(-3x³y^a)^b=-27x^c y⁹」
  ["â", "0"], // 중2-1 p.29 「x^10÷x⁵÷x」 — Ú`â`가 10이다
]);

/**
 * 위첨자로 올라간 **문자**(변수). 숫자 지수와는 다른 글리프 묶음이다.
 * p.24 「2Þ`_3º`_c」 = 2⁵×3ᵇ×c · p.29 「3º`_5_7¶`」 = 3ᵇ×5×7ᵈ (지면 대조).
 *
 * 중2-1 II단원(지수법칙)에서 여섯 자를 더 채웠다 — 전부 지면 대조:
 *   Å p.32 「a=3^x」 「27^{2x-1}=3^{11-x}」 · ´ p.32 「b=3^y」 p.41 「2³×2³×2³=2^y」
 *   ½ p.41 「{(5²)³}⁴=5^z」 · û p.35 「a×10^k」
 *   õ p.36 「x⁵y^B=Cx⁷y⁹」 · ë p.33 「(Ax⁴y^B z³)⁵=-32x^C y^10 z^D」
 */
const SUPERSCRIPT_LETTER: ReadonlyMap<string, string> = new Map([
  ["º", "b"],
  ["¶", "d"],
  ["Å", "x"],
  ["´", "y"],
  ["½", "z"],
  ["û", "k"],
  ["õ", "B"],
  ["ë", "D"],
]);

/**
 * 위첨자 자리의 **부호**. 지수법칙 단원의 절반이 이것 없이는 읽히지 않는다.
 *   ± p.28 「a^m × a^n = a^{m+n}」 · Ñ p.33 「x⁶÷x²=x^{6-2}=x⁴」 「a^{m-n}」
 * 둘 다 지면 대조했고, 서로 짝을 이루는 자리(덧셈/뺄셈 법칙)에서 나온다.
 */
const SUPERSCRIPT_SIGN: ReadonlyMap<string, string> = new Map([
  ["±", "+"],
  ["Ñ", "-"],
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

/**
 * 유니코드 위첨자 꼴로 들어온 글자 — **분수 글꼴에서는 위첨자가 아니다.**
 *
 * 실측(본책 네 단원 + 별책 + 개념서 두 덤프)에서 `¹²³`는 **한 번도 예외 없이**
 * EHboNA에 폭 0으로 왔다. 그 글꼴에서 이것들은 세로셈의 괄호·윗줄, 표의
 * 괘선 조각이지 지수가 아니다 (markSuperscripts의 주석이 이미 그렇게 적고
 * 있었는데, 이 표는 반대로 지수로 옮기고 있었다).
 *
 * 그래서 문항 0265·0316의 보기 표에서 괘선 조각이 `^{2}`가 되고, 뒤따르는
 * 「20」이 다시 `^{20}`이 되어 `^{2}^{20}`이 됐다 — KaTeX가 이중 위첨자로
 * 파싱에 실패해 학생 화면에 빨간 글자가 나간다.
 *
 * 분수 글꼴에서는 표에서 빼고 **unknown으로 올린다.** 조용히 지우지 않는
 * 이유는 늘 같다 — 못 읽었다는 사실이 밖으로 나가야 한다.
 */
const UNICODE_SUPERSCRIPT: ReadonlyMap<string, string> = new Map([
  ["¹", "1"],
  ["²", "2"],
  ["³", "3"],
]);
/** 이 글꼴에서 온 `¹²³`는 지수가 아니라 세로셈·표 조각이다 */
const FRACTION_FONT = /EHboNA/;

/**
 * LaTeX가 뜻을 가지는 글자 — 못 읽은 글리프가 이것이면 날것으로 못 내보낸다.
 *
 * 백슬래시·중괄호는 여기 없다. 해독기가 만들어 낸 명령이 그 글자를 쓰므로
 * 걸러 내면 멀쩡한 식이 부서진다. 여기 담는 것은 **미해독 글리프로 온**
 * 글자뿐이고, 그 판정은 부르는 자리에서 이미 끝나 있다.
 */
const LATEX_SPECIAL = /[$^_&#%~]/;

/** 도형 안의 글자를 담는 글꼴 — 코드가 실제 글자보다 0x1F 작다 */
const FIGURE_LABEL_FONT = /KSC(ms-UHC|pc-EUC)/;

/**
 * 이름 위에 씌우는 **끝 조각**과 그 뜻.
 *
 * 셋이 한 쪽에 같이 나오고 답이 서로 다르다 — 선분 AC‾, 반직선 AC→,
 * 직선 AC↔는 중1-2 「기본 도형」에서 서로 다른 것을 묻는다. 하나로
 * 뭉뚱그리면 문항이 조용히 틀린 문항이 된다.
 */
const NAME_MARK: ReadonlyMap<string, string> = new Map([
  ["Ó", "overline"],
  ["ò", "overline"],
  ["³", "overrightarrow"],
  ["ê", "overleftrightarrow"],
]);

/**
 * **근호(√)는 글자가 아니라 가구다.**
 *
 * 조판기는 `√289`를 세 조각으로 앉힌다 — 갈고리+윗줄 시작(EHRoot `14`),
 * 근호 안의 수(EHsang `289`), 윗줄 끝(EHRoot `6`). 여는 조각은 폭이
 * 5~6pt이고 닫는 조각은 **폭이 0이다**(윗줄은 그림이라 글자 폭이 없다).
 * 그 폭이 여는 쪽과 닫는 쪽을 가르는 유일한 근거다.
 *
 * 두 글꼴이 쓰인다. EHRoot는 근호 전용이라 그 글꼴의 조각은 전부 근호다.
 * EHboNA는 분수·큰 괄호도 함께 나르므로 **관찰한 코드만** 받는다 — 그
 * 글꼴의 세로셈 조각(¹²³)까지 폭 0이라, 생김새만으로 가르면 그것들이
 * 닫는 근호가 되어 없는 √가 생긴다.
 *
 * 지면 대조: 중3-1 p.9 「√289」·「√0.7²」 · p.10 「√((-a)²)=a」 ·
 * p.11 「√((-14)²)」.
 */
const RADICAL_FONT = /^EHRoot/;
const RADICAL_BONA_OPEN = new Set(["'", '"', "®", "¾", "¿"]);
const RADICAL_BONA_CLOSE = new Set([
  "`", "Ã", "Â", "¨", "Ä", "§", "É", "Å", "a", "¶", "Ð", "·",
]);

/**
 * 이 조각이 근호의 어느 쪽인가 — 아니면 null.
 *
 * `firstWidth`는 **첫 글자의 폭**이다. span 폭이 아니라 첫 글자로 재는
 * 이유: 여는 조각은 `!%`·`14`처럼 갈고리(폭 6)와 폭 0인 윗줄 시작이 한
 * span에 함께 온다. span 폭으로 재면 둘을 못 가른다.
 *
 * ## 두 글꼴이 다르게 온다 — **한쪽은 끝을 알 수 없다**
 *
 * EHRoot는 근호가 끝나는 자리에 폭 0(또는 1.2pt)짜리 마감 조각을 둔다.
 * 중3-1 p.9 「√289」가 `14`(갈고리) · `289` · `6`(마감)으로 온다. 그래서
 * 여닫이를 정확히 옮길 수 있다 — `\sqrt{289}`.
 *
 * EHboNA는 **마감 조각이 없다.** 갈고리 뒤 11.3pt 자리에 폭 0인 조각이
 * 하나 더 오는데, 그것은 윗줄의 **시작점**이지 끝이 아니다(갈고리와의
 * 간격이 근호 안 내용의 길이와 무관하게 늘 같다 — p.11에서 416.7→428.0,
 * 469.5→480.8로 둘 다 11.3). 윗줄은 글리프를 가로로 늘여 그리므로 그
 * 길이가 텍스트 층에 남지 않고, 벡터 도형으로도 오지 않는다.
 *
 * 그래서 EHboNA 근호는 **끝을 지어내지 않는다.** `\surd`(√ 기호만)로
 * 옮기고 미해독으로 올려 검수함에 보낸다. `\sqrt{…}`로 묶으면 어디까지가
 * 근호 안인지를 파서가 **꾸며 내는** 것이고, 지면의 `√((-6a)²)+√((-a)²)`이
 * `√((-6a)²+√((-a)²))`이 되어도 화면은 멀쩡해 보인다.
 */
export function radicalPiece(
  text: string,
  font: string,
  firstWidth: number | undefined,
): { latex: string; certain: boolean } | null {
  if (firstWidth === undefined) return null;
  const first = [...text][0];
  if (first === undefined) return null;
  /* **어느 글꼴이든 `\sqrt{…}`로 묶지 않는다.**
   *
   * EHRoot에는 마감 조각이 있어 한동안 `\sqrt{289}`로 옮겼는데, 여는 조각과
   * 닫는 조각이 **한 span에 함께 오는 자리**(`!%`·`14`)가 있어서 짝이
   * 어긋났다 — `\sqrt{}(-9a)^{2}}`처럼 빈 근호와 떠도는 중괄호가 생기고
   * 렌더가 깨진다(다섯 권 합쳐 358건). 중괄호를 쓰는 한 조각이 흩어질 때마다
   * 균형이 무너지고, 그 균형을 파서가 추측으로 맞추면 **근호 안의 범위를
   * 지어내는 것**이다.
   *
   * 그래서 √ 기호만 남기고(`\surd`) 범위는 비워 둔 채 미해독으로 올린다.
   * 화면에는 지면과 비슷하게 나가고, 문항은 검수함으로 가고, 무엇을 못
   * 읽었는지가 밖으로 드러난다. */
  if (RADICAL_FONT.test(font)) {
    return { latex: firstWidth > 2 ? "\\surd " : "", certain: false };
  }
  if (!/^EHboNA/.test(font)) return null;
  if (RADICAL_BONA_OPEN.has(first)) return { latex: "\\surd ", certain: false };
  if (RADICAL_BONA_CLOSE.has(first)) return { latex: "", certain: false };
  return null;
}

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
 * **작은 숫자 한 벌.** 조판기가 본문 크기보다 작게 찍는 숫자는 전부 이 벌이다.
 * 처음에는 분수의 분자에서만 만나 FRACTION_NUMERATOR라 불렀는데, 중2-1
 * p.25 「x₁+x₂+x₃+…+x₉₉」에서 **아래첨자로도 같은 코드**가 왔다
 * (`xÁ`=x₁ · `xª`=x₂ · `x£`=x₃ · `x»»`=x₉₉). 자리를 정하는 것은 글자가
 * 아니라 글꼴과 좌표이고, 이 표는 「그 자리에 있는 숫자가 몇이냐」만 안다.
 *
 * 아래는 분자 자리에서 확인한 기록이다 — 자릿수가 다를 때 쓰는 두 번째 벌.
 *
 * 조판기는 분자와 분모의 자릿수가 같으면 shift 행(`;1#2%;` = 35/12)을 쓰고,
 * 다르면 이쪽 벌을 쓴다. 가운데 맞춤을 위해 좌우 여백이 다른 글자가 필요해서다.
 * 그래서 `;1¢2;`(4/12)와 `;1#2%;`(35/12)가 같은 책에 함께 나온다.
 *
 * **아홉 자리를 전부 지면에서 확인했다** (중1-1 II·III단원):
 *   ¼ p.38 「20/4」 · Á p.38 「12/3」 · ª p.39 「12/6」 · £ p.36 「3/12」
 *   ¢ p.36 「4/12」 · ° p.46 「15/5」 · ¤ p.39 「16/4」 · ¦ p.53 「7/15」
 *   » p.60 「9/14」
 * 여러 자리가 서로 맞물려 확인됐다 — p.39 「42/7」이 ¢=4와 ª=2를 동시에,
 * p.49 「54/9」가 °=5와 ¢=4를 동시에 건다.
 *
 * 8만 RPM 본책 II~IV단원에 나오지 않아 한동안 비어 있었는데, 개념서
 * p.89 「-8/15」에서 확인해 채웠다(`;1¥5;`). 코드가 연속 배치가 아니라
 * (¼=BC·Á=C1·ª=AA·¥=A5) 빈자리를 추론으로 메울 수는 없었다.
 */
const SMALL_DIGIT: ReadonlyMap<string, string> = new Map([
  ["¼", "0"],
  ["Á", "1"],
  ["ª", "2"],
  ["£", "3"],
  ["¢", "4"],
  ["°", "5"],
  ["¤", "6"],
  ["¦", "7"],
  ["¥", "8"], // 개념서 p.89 「(-5/3)×(-8/15)」
  ["»", "9"],
]);

/**
 * 분수 안의 **문자**. 정비례·반비례(IV단원)의 `y=a/x` 꼴이 전부 이 표기다.
 *
 * 분자 자리 문자와 분모 자리 문자가 **서로 다른 코드**로 온다. 분모의
 * a·b는 평문 그대로인데 x만 `[`로 오고, 분자는 전부 다른 벌이다.
 * 그래서 글자만 보고 위아래를 정할 수 없다 — 코드가 자리를 말해 준다.
 *
 * 지면 대조 (본책 IV단원):
 *   p.128 문항 0953 「a/b」=`;bA;` · 「b/a」=`;aB;`
 *   p.135 문항 0989 「x/2」=`;2{;` · 0990 「3/x」=`;[#;` · 0991 「y/x」=`;[};`
 */
const FRACTION_NUMERATOR_LETTER: ReadonlyMap<string, string> = new Map([
  ["A", "a"],
  ["B", "b"],
  /* c는 중2-1에서 나왔다 — p.18 「0.ȧbċ=abc/999」=`;9A9B9C;`(분모 999,
   * 분자 abc가 한 자씩 번갈아 온다) · p.148 「c/b」=`;bC;`·「c/a」=`;aC;` */
  ["C", "c"],
  ["{", "x"],
  ["}", "y"],
]);

/**
 * 분모 자리의 x·y. a·b는 평문으로 오므로 표에 넣을 것이 없다.
 * `[`·`]`가 짝을 이룬다 — p.88 문항 0667 「x/y」=`;]{;` · p.83 문항 0630 「2/y」=`;]@;`.
 */
const FRACTION_DENOMINATOR_LETTER: ReadonlyMap<string, string> = new Map([
  ["[", "x"],
  ["]", "y"],
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
/**
 * 위·아래첨자 조각 — **글꼴별**.
 *
 * 왜 글꼴을 봐야 하나: `Ç`는 EHsang(상, 윗자리 글꼴)에서 지수 n이지만
 * EHhabu(하, 아랫자리 글꼴)에서는 아래첨자 n이다. 중2-1 p.25 한 줄이
 * 둘을 나란히 보여 준다 — 「x_n/10ⁿ」에서 아래의 n은 EHhabu, 위의 n은
 * EHsang이다. 글꼴을 뭉치면 x^n/10^n이 되어 문항이 뜻을 잃는다.
 *
 * 작은 숫자(SMALL_DIGIT)가 아래첨자로도 오는 것은 같은 쪽에서 확인했다:
 * 「x₁+x₂+x₃+…+x₉₉」 = `xÁ`+`xª`+`x£`+…+`x»»`. 분수 안에서는 분자였던
 * 바로 그 코드다 — 분수는 1)단계에서 이미 걷어 내므로 겹치지 않는다.
 */
const SUPERSCRIPT_BY_FONT: readonly { font: RegExp; map: ReadonlyMap<string, string> }[] = [
  {
    font: /^EHsang/,
    map: new Map([
      ["Ç", "n"], // 별책 0071 「2²×3×5ⁿ의 약수의 개수는」
      ["¡", "8"], // 별책 0090 「256=2⁸이므로」
      /* 개념원리 중1-1 p.17 「A=aµ`_bÇ`」 — 지면은 A=a^m×b^n
       * (a, b는 서로 다른 소수, m, n은 자연수). Ç(^n)와 짝을 이룬다. */
      ["µ", "m"],
    ]),
  },
];

const SUBSCRIPT_BY_FONT: readonly { font: RegExp; map: ReadonlyMap<string, string> }[] = [
  {
    /* 아랫자리 전용 글꼴. 중2-1 p.25 「x_n」·p.103 「(x₁, y₁), (x₂, y₂)」 */
    font: /^EHhabu/,
    map: new Map([...SMALL_DIGIT, ["Ç", "n"]]),
  },
  {
    /* 윗자리 글꼴이 아래첨자 숫자까지 함께 나르는 자리가 있다 —
     * 같은 p.25의 x₁·x₂가 `xÁ`·`xª`로 EHsang-Italic에 왔다.
     * 지수 숫자는 Ú~â로 코드가 따로라 겹치지 않는다. */
    font: /^EHsang/,
    map: SMALL_DIGIT,
  },
];

const BY_FONT: readonly { font: RegExp; map: ReadonlyMap<string, string> }[] = [
  {
    font: /^EHyak/,
    map: new Map([
      ["y", "\\cdots "], // 별책 0083 「a×a×…×a=aⁿ」
      ["¾", "\\ge "], // 별책 0255 「x≥-4」
      ["É", "\\le "], // 별책 0256 「x≤11」
      /* 개념원리 중1-1 p.10 참고② 「a+0일 때, aÚ`=a로 정한다」 —
       * 지면은 a≠0이다. EHsang의 +는 진짜 덧셈이므로 EHyak에만 둔다. */
      ["+", "\\ne "],
      /* 중2-2는 도형이라 합동·닮음 기호가 쏟아진다 — 둘 다 지면 대조:
       * ª 본책 p.8 「△ABD≡△ACD」 · » 본책 p.74 「△ABC∽△DEF」 */
      ["ª", "\\equiv "],
      ["»", "\\backsim "],
    ]),
  },
  {
    /* 아랫자리 글꼴의 도(°) — 중2-2 본책 p.9 「58°」·「55°」.
     * EHsang에서는 같은 자리를 `ù`가 맡는데 그쪽은 이미 표에 있다. */
    font: /^EHhabu/,
    map: new Map([["ù", "\\degree "]]),
  },
  {
    /* 도형 기호 전용 글꼴 — 중2-2 본책 p.8 「△ABC」·p.40 「□ABCD」 */
    font: /^NPSUSP/,
    map: new Map([
      ["s", "\\triangle "],
      ["f", "\\square "],
    ]),
  },
  {
    font: /^EHsang/,
    map: new Map([
      ["¾", "\\degree\\mathrm{C}"], // 별책 0214 「+7 ℃, -10 ℃」
      /* 본책 p.81 「ùF」 — 지면은 °F(화씨)다. ¾(℃)와 짝을 이루는 글리프로,
       * 도 기호만 담당하고 단위 글자는 뒤에 따로 온다. */
      ["ù", "\\degree "],
      /* 본책 p.34 「~후, ~전」 — 지면은 물결표(∼)다. **그냥 통과시키면 안 된다** —
       * LaTeX에서 `~`는 줄바꿈 없는 공백이라 아무 오류 없이 사라진다.
       * 「출발 ∼후」가 「출발  후」가 되고 화면에는 표시가 남지 않는다. */
      ["~", "\\sim "],
      /* 본책 p.75 문항 0528 「x %」·0529 「a %」 — 백분율이다.
       * 분수 안에서는 같은 `%`가 분자 5지만(SHIFT_ROW), 그 표는 분수 안에서만
       * 본다. 밖에서 만난 `%`는 그대로 백분율이다. */
      ["%", "\\%"],
    ]),
  },
  {
    /* ── 큰 괄호 글꼴 — **코드가 한 짝씩 밀려 있다.**
     *
     * 이 글꼴에서 `{`는 중괄호가 아니라 **소괄호**이고, `[`가 중괄호다.
     * 그대로 통과시키면 LaTeX의 `{ }`는 묶음 기호라 **화면에서 사라진다** —
     * 지면의 `(-3/4)+(-1/3)`이 `-3/4+-1/3`으로 나가고, 렌더는 멀쩡히
     * 성공한다. 별책 해설에만 707쌍이 이렇게 있었다.
     *
     * 확정 근거는 본책 p.64 문항 0471 한 줄이다. 세 겹이 한꺼번에 나온다:
     *   지면  1/6 × [ -20 - { 3² + ( 1/4 - 1/6 ) × 12 } ]
     *   덤프  ;6!; _ [EHSusic -20- [EHboNA 3Û`+ {EHboNA ;4!; - 1/6
     *         }EHboNA _12 ]EHboNA ]EHSusic
     * 바깥 대괄호는 **다른 글꼴**(EHSusic)이라 제 뜻 그대로다 — 그래서
     * 이 표는 EHboNA에만 건다. 별책 p.27 0346 「(-3/4)+(-1/3)」·0357
     * 「(+5/30)」, p.29 「×{(-6)²…}」에서 각각 따로 확인했다.
     *
     * `\left`·`\right`로 내는 이유: 분수를 감싸는 자리라 지면도 키를 키운
     * 괄호를 쓴다. 짝이 안 맞으면 KaTeX가 실패해 **눈에 띈다** — 조용히
     * 괄호만 사라지는 것보다 낫다. */
    font: /^EHboNA/,
    map: new Map([
      ["{", "\\left("],
      ["}", "\\right)"],
      ["[", "\\left\\{"],
      ["]", "\\right\\}"],
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

/**
 * 폭이 있는 특수 공백 (전각·엔·엠 등) — 보통 공백으로 바꾼다.
 * KaTeX는 이 코드포인트들의 글자 폭을 몰라 「No character metrics」를
 * 뿜는다. **지우면 안 된다** — 숫자 나열 「1 2 3」이 「123」으로 붙는다.
 */
const WIDE_SPACE = new RegExp(
  "[\\u00a0\\u2000-\\u2005\\u2007\\u2008\\u202f\\u205f\\u3000]",
  "g",
);

/**
 * 분수 한 덩어리.
 *
 * **여는 기호와 닫는 기호가 짝을 이루지 않는다.** 실측한 꼴은 넷이다
 * (중1-1 전 단원 761건):
 *   `;…;` 730 · `;;…;;` 15 · `:…:` 14 · **`:…;;` 2** (p.53 문항 0397)
 * 그래서 양쪽을 각각 `[;:]{1,2}`로 받는다. 짝을 맞춰 읽으려 했더니
 * `;;ª4¼;;`(20/4)와 `:Á3¼;;`가 통째로 안 풀렸다.
 *
 * 닫는 기호의 뒤보기는 **바로 뒤에 또 분수가 오는 경우**를 위한 것이다.
 * `;2!;;3!;`에서 닫는 기호가 `;;`를 삼키면 뒤 분수의 여는 기호가 사라져
 * 1/2만 남고 1/3이 조용히 없어진다. 이 교재에는 그런 자리가 없지만
 * (위 실측에 `;`…`;;` 꼴이 0건), 다른 교재에서 나면 알 길이 없는 손실이다.
 */
const FRACTION = /[;:]{1,2}([^;:\s]{2,8})[;:]{1,2}(?![^;:\s]{2,8}[;:])/g;

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
 * **가르는 것은 자리가 아니라 글자의 종류다.** 평문 숫자는 분모로, 분자
 * 전용 글리프(shift 행·SMALL_DIGIT)는 분자로 간다. 각자 나온 순서를
 * 지킨다. `;2!;`는 분모 2·분자 1 → 1/2, `;1#2%;`는 분모 "12"·분자 "35"
 * → 35/12, `;ª4¼;`는 분모 "4"·분자 "20" → 20/4.
 *
 * 처음에는 **교대**로 읽었다(짝수 번째가 분모, 홀수 번째가 분자). 자릿수가
 * 같은 동안은 그 규칙과 결과가 같아서 1단원 전체가 통과했지만, 자릿수가
 * 다른 분수(`;1¢2;`=4/12 · `;ª4¼;`=20/4)에서 길이가 홀수가 되어 전부
 * 못 푼 채 unknown으로 나갔다. 지면 여덟 자리를 대조해 보니 조판기는
 * 자릿수가 다를 때 글리프 벌을 바꿀 뿐 순서 규칙은 없었다
 * (p.36 3/12·4/12 · p.38 12/3·20/4 · p.39 12/6·16/4·42/7 · p.46 21/3·15/2
 *  · p.49 54/9 · p.53 7/15 · p.60 9/14·30/7·35/3).
 *
 * 규칙에 맞지 않으면 null을 돌려 원문을 그대로 남긴다. 억지로 푸는 것보다
 * 못 풀었다고 말하는 편이 낫다.
 */
function decodeFraction(inner: string): string | null {
  const chars = [...inner];
  if (chars.length < 2) return null;
  let denominator = "";
  let numerator = "";
  for (const ch of chars) {
    /* 좌표가 붙여 준 위첨자 표식은 분수 안에서 **뜻이 없다.**
     *
     * 분자 글리프는 앞 글자에 겹쳐 찍히느라 폭이 0인데, markSuperscripts가
     * 그걸 보고 위첨자로 표를 해 둔다. 분수 안에서는 그 표가 오히려
     * 방해가 된다 — `;10A0;`(a/100)의 A가 표식에 싸여 들어와 분수 전체가
     * 안 풀렸다(개념서 p.104·156, 반비례 y=a/x도 같은 이유로 전부 실패).
     * 분수 안에 진짜 지수가 오는 경우는 지면에서 확인한 바 없다. */
    if (ch === SUP_OPEN || ch === SUP_CLOSE) continue;
    /* 평문 숫자·소문자는 그 자리에서 자기 자신이다 — 분모로 간다
     * (p.128 「a/b」의 b, 「b/a」의 a). */
    if (/[0-9a-z]/.test(ch)) {
      denominator += ch;
      continue;
    }
    const d = FRACTION_DENOMINATOR_LETTER.get(ch);
    if (d !== undefined) {
      denominator += d;
      continue;
    }
    const n =
      SHIFT_ROW.get(ch) ??
      SMALL_DIGIT.get(ch) ??
      FRACTION_NUMERATOR_LETTER.get(ch);
    if (n === undefined) return null;
    numerator += n;
  }
  /* 한쪽이 비면 분수가 아니다 — 8에 해당하는 글리프처럼 표에 없는 글자가
   * 섞였을 때 조용히 반쪽짜리 분수를 만들지 않게 막는다. */
  if (denominator === "" || numerator === "") return null;
  return `\\frac{${numerator}}{${denominator}}`;
}

/**
 * 이 표가 다룰 수 있다고 확인한 평문 문자 — 그대로 통과시킨다.
 * `:`가 들어 있는 이유: 분수를 걷어낸 뒤 남은 콜론은 비(比) 기호다
 * (p.24 문항 0167 「2 : 5 : 6」). 분수 해독에 실패한 `;…;`는 이미
 * unknown에 기록됐으므로 여기를 지나가도 조용히 묻히지 않는다.
 */
const PASSTHROUGH = /[0-9A-Za-z+\-=<>(),.:\s/|[\]{}']/;

/**
 * 수식 폰트 문자열 한 조각을 LaTeX으로 옮긴다.
 *
 * 결정론적이다 — 같은 입력은 언제나 같은 출력. 시각·난수를 읽지 않는다.
 */
export function decodeHwpMath(raw: string, font?: string): DecodeResult {
  const unknown: string[] = [];
  /** 이미 LaTeX으로 확정한 조각 — 뒤 단계가 다시 건드리지 못하게 치워 둔다 */
  const resolved: string[] = [];
  const stash = (latex: string): string => {
    resolved.push(latex);
    return `${PH_OPEN}${resolved.length - 1}${PH_CLOSE}`;
  };
  /* 글꼴을 모르면 글꼴별 표는 건너뛴다 — 짐작해서 고르면 반은 틀린다 */
  const byFont = font ? BY_FONT.find((f) => f.font.test(font))?.map : undefined;
  const supFont = font
    ? SUPERSCRIPT_BY_FONT.find((f) => f.font.test(font))?.map
    : undefined;
  const subFont = font
    ? SUBSCRIPT_BY_FONT.find((f) => f.font.test(font))?.map
    : undefined;

  /* 0) 그림 라벨 글꼴은 **코드가 통째로 밀려 있다.**
   *
   * 도형 안의 「A」·「cm」·「40°」가 이 글꼴로 오는데, 코드가 실제 글자보다
   * 0x1F 작다. 중2-2 본책에서 947번 나온다. 밀려 있다는 근거는 지면 대조다:
   *   `DN` = cm · `\x15\x11±` = 40° · `\x12\x14\x11±` = 130°
   * 숫자가 U+0011~U+001A로 오는 것이 특히 중요하다 — 그 구간은 아래에서
   * **조판 부호로 지워지는 자리**라, 밀어 주지 않으면 도형의 치수가 통째로
   * 사라진다. 그래서 어떤 단계보다 먼저 한다. */
  let work = FIGURE_LABEL_FONT.test(font ?? "")
    ? [...raw]
        .map((ch) => {
          const code = ch.codePointAt(0)!;
          if (code >= 0x03 && code <= 0x5a) return String.fromCodePoint(code + 0x1f);
          return ch === "±" ? "°" : ch;
        })
        .join("")
    : raw;

  /* 1) 분수를 먼저 걷어내 자리표시자로 바꾼다. 분수 안에 지수·곱셈이
   *    섞이는 경우가 없음을 지면에서 확인했으므로 순서상 안전하다. */
  work = work.replace(FRACTION, (whole: string, inner: string) => {
    const latex = decodeFraction(inner);
    if (latex === null) {
      unknown.push(whole);
      return whole;
    }
    return stash(latex);
  });

  // 2) 조판 부호 제거 · 특수 공백 정규화
  work = work.replace(DROPPABLE, "").replace(WIDE_SPACE, " ");

  /* 2-1) 선분·반직선·직선 기호. 지면의 가로줄과 화살표가 덤프에서는 **폭 0인
   *      장식 글리프**로 온다. 두 갈래다:
   *
   *        이음 조각  Õ · Í   — 이름 글자 **사이**에 낀다
   *        끝 조각    Ó · ò   선분   AC‾  (중2-1 p.143 「PQ‾=6」)
   *                   ³       반직선 AB→ (중1-2 p.9)
   *                   ê       직선   AB↔ (중1-2 「위치 관계」)
   *
   *      **끝 조각이 무엇이냐가 뜻을 정한다.** 중1-2 「기본 도형」은 한 쪽에서
   *      셋을 나란히 쓰고 답이 서로 다르다 — 뭉뚱그리면 선분과 반직선이 같은
   *      것이 된다. p.9를 그려서 눈으로 확인했다: `AÕMÓ`는 A와 M에 각각 줄을
   *      긋는 것이 아니라 **둘 위로 이어진 한 줄**(AM‾)이다. 이전 표는 이음
   *      조각을 끝 조각으로 잘못 알아 `\overline{A}\overline{M}`을 냈다.
   *
   *      LaTeX 명령을 만들어야 하므로 자리표시자로 치워 둔다 — 3)단계의
   *      글자별 통과 검사는 역슬래시를 모른다. */
  /* 윗줄 글리프가 제 자리를 벗어난 것을 먼저 되돌린다. 폭이 0이라
   * 뒤따르는 글자와 x가 같고, 정렬에서 밀려 `PB=Ó`처럼 등호 뒤로 가는
   * 일이 잦다(별책 해설). 윗줄은 선분 이름 위에 그어지므로 바로 앞의
   * 대문자 묶음이 임자다.
   *
   * **`³`와 `ê`는 이 되돌리기에 넣지 않는다.** `³`는 다른 책에서 진짜
   * 세제곱이라, 사이를 건너뛰게 하면 `AB=x³`가 반직선 AB가 된다. */
  work = work.replace(/([A-Z][A-ZÕÍ]{0,4})([^A-ZÕÍÓò]*)([Óò])/g, "$1$3$2");
  /* 표시와 이름 사이에 공백이 흘러드는 자리가 있다 — 별책 해설의 「AD↔」가
   * `AD ê`로 온다(중1-2 0098 등). 공백을 건너뛰지 않으면 그 자리만 날글자로
   * 남는다. `³`는 여기서도 빼 둔다 — 「AB 3」이 반직선이 되면 안 된다. */
  work = work.replace(
    /([A-Z][A-ZÕÍ]{0,4})[ \u2009]*([Óòê])/g,
    (whole: string, body: string, end: string) => {
      const letters = body.replace(/[ÕÍ]/g, "");
      return stash(`\\${NAME_MARK.get(end)!}{${letters}}`);
    },
  );
  work = work.replace(
    /([A-Z][A-ZÕÍ]{0,4})([Óò³ê])/g,
    (whole: string, body: string, end: string) => {
      const letters = body.replace(/[ÕÍ]/g, "");
      /* 세제곱과 갈라야 한다 — 반직선 이름은 두 글자 이상이다(AB→). */
      if (end === "³" && letters.length < 2) return whole;
      return stash(`\\${NAME_MARK.get(end)!}{${letters}}`);
    },
  );
  /* 호(弧) 기호는 **글자 앞**에 온다 — `µAB` = ⌒AB (중3-2 「원의 성질」).
   * 선분의 윗줄과 달리 위치가 안정적이라 그대로 읽으면 된다. */
  /* 조판이 호 기호와 이름 사이에 공백을 흘리는 자리가 있다 —
   * 중1-2 p.87 「µ BC=4µAC」. 공백을 건너뛰지 않으면 그 한 곳만 미해독이
   * 되어 같은 문항 안에서 ⌒BC는 깨지고 ⌒AC는 멀쩡한 꼴이 된다. */
  work = work.replace(/µ\s*([A-Z]{1,3})/g, (_m, letters: string) =>
    stash(`\\overgroup{${letters}}`),
  );
  /* 호 기호가 **글자 뒤**에 오는 자리도 있다 — 중1-2 「원과 부채꼴」의
   * `ABµ`·`ADµ`가 그렇다. 선분 표시와 같은 사정이다: 폭이 0이라 조판이
   * 앞뒤 어느 쪽에도 흘릴 수 있다. 대문자가 앞설 때만 읽으므로 다른 권의
   * `aµ`(=a^m)와 헷갈리지 않는다. */
  work = work.replace(/([A-Z]{1,3})[  ]*µ/g, (_m, letters: string) =>
    stash(`\\overgroup{${letters}}`),
  );
  /* 도(°)는 LaTeX 명령이라 자리표시자로 치워 둔다 — 3)단계의 글자별
   * 통과 검사는 역슬래시를 모른다 */
  work = work.replace(/°/g, () => stash("\\degree "));

  /**
   * 이 글자가 위첨자 글리프면 그 내용, 아니면 undefined.
   *
   * **근호·분수 글꼴에는 위첨자가 없다.** 그 글꼴의 글리프는 전부 가구이고,
   * 같은 코드가 EHsang에서 가지는 뜻(`¶`=위첨자 d)을 그대로 얹으면 근호
   * 조각이 `^{d}`가 되어 `'^{d}'^{d}` 꼴로 렌더에 실패한다 — 중3 별책
   * 해설에서 20건이 이 꼴로 남아 있었다. 코드는 글꼴 안에서만 뜻이 있다.
   */
  const furnitureFont = font !== undefined && /^(EHRoot|EHboNA)/.test(font);
  const superscriptOf = (ch: string): string | undefined =>
    furnitureFont
      ? undefined
      : (supFont?.get(ch) ??
        SUPERSCRIPT.get(ch) ??
        SUPERSCRIPT_LETTER.get(ch) ??
        SUPERSCRIPT_SIGN.get(ch) ??
        /* 분수 글꼴의 ¹²³는 세로셈·표 조각이다 — 지수로 옮기지 않는다 */
        (font !== undefined && FRACTION_FONT.test(font)
          ? undefined
          : UNICODE_SUPERSCRIPT.get(ch)));

  // 3) 남은 글자를 하나씩 옮긴다
  let out = "";
  let inPlaceholder = false;
  let inSuperscript = false;
  const chars = [...work];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
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
    const sup = superscriptOf(ch);
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
      /* **잇달아 오는 위첨자 글리프는 한 지수다.**
       *
       * 한 글자씩 `^{}`를 씌우면 `xÚ`â``(x¹⁰)가 `x^{1}^{0}`이 된다. 이건
       * KaTeX가 「double superscript」로 파싱에 실패하는 꼴이라 학생 화면에
       * 빨간 글자가 나간다 — 중2-1 II단원 지수법칙에서만 37건이 그랬다.
       * 부호(±·Ñ)까지 함께 묶어야 `27Û`Å`ÑÚ``가 27^{2x-1}이 된다. */
      let group = sup;
      while (i + 1 < chars.length) {
        const next = superscriptOf(chars[i + 1]!);
        if (next === undefined) break;
        group += next;
        i += 1;
      }
      out += `^{${group}}`;
      continue;
    }
    /* 아래첨자도 같은 규칙으로 묶는다 — `x»»`가 x_{99}다 */
    const sub = subFont?.get(ch);
    if (sub !== undefined && subFont !== undefined) {
      let group = sub;
      while (i + 1 < chars.length) {
        const next = subFont.get(chars[i + 1]!);
        if (next === undefined) break;
        group += next;
        i += 1;
      }
      out += `_{${group}}`;
      continue;
    }
    const op = OPERATOR.get(ch);
    if (op !== undefined) {
      out += op;
      continue;
    }
    /* **근호 글꼴의 `'`는 따옴표가 아니다.** 통과 목록은 EHsang 같은 본문
     * 수식 글꼴을 전제로 만든 것이라, 가구 글꼴에까지 적용하면 근호 조각이
     * 따옴표·괄호로 새어 나간다(`'^{d}'^{d}`). 분수 글꼴은 숫자를 실어
     * 나르므로 숫자·괄호는 통과시킨다. */
    const passable = furnitureFont
      ? /^(EHboNA)/.test(font ?? "") && /[0-9(),.\s]/.test(ch)
      : PASSTHROUGH.test(ch);
    if (passable) {
      out += ch;
      continue;
    }
    unknown.push(ch);
    /* 못 읽은 글자를 지우지 않는다 — 검수자가 빠진 자리를 볼 수 있어야 한다.
     *
     * 다만 **LaTeX가 뜻을 가지는 글자는 날것으로 내보내지 않는다.** 중3-1의
     * 근호 글꼴(EHRoot)은 `^`가 177회, `$`·`#`·`!`·`%`가 뒤를 잇는다. 그대로
     * 나가면 KaTeX가 `^`를 위첨자 연산자로 읽어 식 전체가 렌더에 실패한다 —
     * 못 읽은 글자 하나 때문에 멀쩡한 나머지까지 화면에서 사라진다.
     *
     * □로 바꾸면 셋이 동시에 지켜진다: 화면은 그려지고, 검수자는 빈자리를
     * 보고, unknown에 남았으니 문항은 검수 게이트에 그대로 걸린다. */
    /* 근호·분수 글꼴에서 온 못 읽는 글리프도 자리표시자로 낸다. 그 글꼴의
     * 글리프는 **가구지 글자가 아니라서**, 날것으로 내보내면 `'`처럼 뜻이
     * 있는 글자로 읽히거나 뒤따르는 조각을 위첨자로 말아 넣는다. */
    const furniture = font !== undefined && /^(EHRoot|EHboNA)/.test(font);
    out += LATEX_SPECIAL.test(ch) || furniture ? "\\square " : ch;
  }

  // 4) 자리표시자 되돌리기
  const restore = new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, "g");
  out = out.replace(restore, (_m, i: string) => resolved[Number(i)] ?? "");

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
  /* **잇달아 붙는 위·아래첨자는 한 덩어리다.**
   *
   * 별책은 `2¹¹`을 span 여럿으로 쪼개 보낸다 — `Ú`가 EHsang-Plain 혼자,
   * 뒤이어 `` `ß` ``가 EHsang-Italic로 온다. 각 조각은 제대로 `^{1}`·`^{6}`이
   * 되지만 그대로 이으면 `^{1}^{6}`이고, KaTeX는 이것을 「double superscript」로
   * 보고 파싱에 실패한다. 화면에는 빨간 글자가, 채점에는 없는 수가 나간다
   * (중2-1 별책 해설 259건이 이 꼴이었다). 한 글자 안에서 묶는 일은
   * decodeHwpMath가 이미 하고, 조각을 넘나드는 자리는 여기가 마지막이다. */
  for (const mark of ["^", "_"] as const) {
    /* **간단한 조각일 때만 잇는다.** 숫자·글자·부호로만 된 것은 한 지수가
     * 쪼개진 것이다 — `2^{2}` + `^{+}` + `^{3}` + `^{a}`가 2^{2+3+a}다
     * (별책 p.13 문항 0193). 안에 중괄호나 LaTeX 명령이 든 것은 구조가
     * 있다는 뜻이라 손대지 않는다. 이 함수는 **좌표가 맞닿은 조각**끼리만
     * 부르므로, 여기서 만나는 두 지수는 원래 하나였다고 볼 근거가 있다. */
    const tail = new RegExp(`\\${mark}\\{([0-9A-Za-z+\\-]+)\\}$`).exec(left);
    const head = new RegExp(`^\\${mark}\\{([0-9A-Za-z+\\-]+)\\}`).exec(right);
    if (tail && head) {
      return (
        left.slice(0, -tail[0].length) +
        `${mark}{${tail[1]}${head[1]}}` +
        right.slice(head[0].length)
      );
    }
  }
  const needsSpace = /\\[a-zA-Z]+$/.test(left) && /^[a-zA-Z]/.test(right);
  return left + (needsSpace ? " " : "") + right;
}

/**
 * **좌표가 「이것도 위첨자」라고 말해 준 조각**을 앞의 지수 안에 넣는다.
 *
 * 조판기는 지수 `2+3+a`를 네 조각으로 쪼개 보낸다(`2` · `+` · `3` · `+a`).
 * 조각마다 따로 `^{}`를 씌우면 `2^{2}^{+}^{3}^{+}^{a}`가 되고, KaTeX는
 * 이것을 「double superscript」로 보고 파싱에 실패한다(중2-1 별책 해설).
 *
 * joinLatex의 숫자 규칙과 나누어 둔 이유: 이쪽은 **글자 상자가 위첨자라고
 * 말해 준** 조각들이라 한 지수임이 구조로 확실하다. 그쪽은 글리프표만 보고
 * 판단하는 자리라 숫자일 때만 잇는다.
 */
/**
 * 폭 0인 **윗줄 글리프만** 담은 조각인가 — 앞 글자에 씌우는 표시다.
 *
 * 선분 기호는 두 꼴로 온다. `PQÓ`처럼 글자 뒤에 붙어 오기도 하고
 * (중2-1), `AB` + `Ó`처럼 **span이 따로 서기도** 한다(중2-2 본책 p.9,
 * 도형 단원이라 526번). 따로 선 것은 앞 조각에 붙여 읽어야 한다 —
 * 혼자서는 씌울 글자가 없어 미해독으로 나간다.
 */
export function isOverlineOnly(text: string): boolean {
  return /^[ÓÕò]+$/.test(text);
}

/**
 * 따로 선 조각이 **이름 위에 씌우는 표시뿐**이면 그 LaTeX 명령, 아니면 null.
 *
 * 끝 조각이 뜻을 정한다 — `Ó`·`ò`는 선분, `ê`는 직선이다. 이음 조각(`Õ`·`Í`)만
 * 온 조각은 혼자서 아무것도 정하지 못하므로 여기서 걸러지지 않고
 * isNameJoinOnly가 조용히 넘긴다. 뒤따르는 끝 조각이 일을 마무리한다.
 *
 * **반직선(`³`)은 일부러 뺐다.** 다른 책에서 진짜 세제곱으로 오는 글자라,
 * 홀로 선 것을 반직선으로 단정하면 조용히 틀린다. 붙어 온 것만
 * (대문자 둘 이상 뒤) 해독기가 읽고, 홀로 선 것은 미해독으로 검수함에 간다.
 */
export function nameMarkOnly(text: string): string | null {
  const end = /^[ÕÍ]*([Óòê])[ÕÍ]*$/.exec(text)?.[1];
  return end === undefined ? null : (NAME_MARK.get(end) ?? null);
}

/** 이음 조각만 담긴 조각인가 — 혼자서는 뜻이 없어 그냥 흘려보낸다 */
export function isNameJoinOnly(text: string): boolean {
  return /^[ÕÍ]+$/.test(text);
}

/**
 * 따로 선 윗줄 글리프를 앞 조각의 **마지막 대문자 뒤**에 끼워 넣는다.
 *
 * 그냥 뒤에 붙이면 안 된다 — 폭이 0이라 뒤따르는 글자와 x가 같고, 정렬에서
 * 밀려 `PB=` 다음에 오는 일이 잦다(별책 해설 312건). 그대로 이으면
 * `PB=Ó`가 되어 씌울 글자를 못 찾는다. 윗줄은 선분 이름 위에 그어지므로
 * 마지막 대문자 묶음이 그 이름이다.
 */
export function attachOverline(text: string, mark: string): string {
  /* 이음 조각(Õ·Í)도 이름의 일부다 — 빼고 잡으면 `MÕB`에서 `B`만
   * 데려가 「M̅B̅」가 「M \overline{B}」가 된다 */
  const at = /([A-Z][A-ZÕÍ]{0,4})([^A-ZÕÍ]*)$/.exec(text);
  if (!at) return text + mark;
  return `${text.slice(0, at.index)}${at[1]}${mark}${at[2]}`;
}

/**
 * 이미 LaTeX이 된 조각의 **마지막 선분 이름**에 윗줄을 씌운다.
 *
 * 조각이 span 경계를 넘어 조립된 뒤에야 윗줄 글리프가 오는 자리가 있다
 * (`CB=` · `Ó`). 그때는 원문으로 되돌아갈 수 없으므로 결과 쪽에서 씌운다.
 * 이미 `\overline{AB}`인 자리는 건드리지 않는다 — 대문자 바로 뒤가 `}`면
 * 그것이 이미 씌워졌다는 표시다.
 */
export function overlineLastName(latex: string, command = "overline"): string {
  return latex.replace(
    /([A-Z][A-ZÕÍ]{0,4})([^A-ZÕÍ}]*)$/,
    (_m, name: string, tail: string) =>
      `\\${command}{${name.replace(/[ÕÍ]/g, "")}}${tail}`,
  );
}

/** 호(弧) 기호만 담긴 조각인가 — 뒤따르는 두 글자 위에 씌운다 */
export function isArcOnly(text: string): boolean {
  return /^µ+$/.test(text);
}

/**
 * 뒤따르는 조각의 **첫 선분 이름**에 호를 씌운다.
 *
 * 호 기호는 글자 앞에 오는데, 조판기가 그것만 따로 span으로 내보내는
 * 자리가 있다(중3-2 「원의 성질」 68건). 한 span 안에 있으면 해독기가
 * 바로 읽지만, 따로 서면 씌울 글자가 없어 미해독으로 나간다.
 */
export function arcFirstName(latex: string): string {
  return latex.replace(/^([^A-Z]*)([A-Z]{1,3})/, "$1\\overgroup{$2}");
}

export function mergeRaised(latex: string, inner: string): string {
  const tail = /\^\{([^{}]*)\}$/.exec(latex);
  if (tail) return `${latex.slice(0, -tail[0].length)}^{${tail[1]}${inner}}`;
  return `${latex}^{${inner}}`;
}

/**
 * 중괄호가 짝을 못 맞춘 깊이. 음수는 0으로 보지 않고 그대로 돌려준다
 * (닫는 괄호가 먼저 온 것도 조각났다는 뜻이다).
 */
function braceDepth(latex: string): number {
  let depth = 0;
  for (let i = 0; i < latex.length; i += 1) {
    /* `\left(`·`\right)`도 짝을 이뤄야 한다 — 큰 괄호 글꼴이 내는 꼴이라
     * 여기서 세지 않으면 조각난 괄호가 안 붙는다 */
    if (latex.startsWith("\\left", i)) {
      depth += 1;
      i += 4;
      continue;
    }
    if (latex.startsWith("\\right", i)) {
      depth -= 1;
      i += 5;
      continue;
    }
    const ch = latex[i]!;
    if (ch === "\\") {
      i += 1; // 이스케이프된 \{ \} 는 글자다
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return depth;
}

/**
 * **짝이 안 맞는 수식 조각을 도로 붙인다.**
 *
 * 한 수식이 두 조각으로 저장되는 일이 있다. 조판기가 2행 분수를 별개
 * 덩어리로 앉히기 때문이다 — 별책 0346의 지면은
 * `{-3/4}+{-1/3}={-9/12}+{-4/12}` 한 줄인데, 마지막 4/12만 2행 분수라
 * 그 앞뒤로 12pt·2pt 틈이 벌어진다. 파서는 가로로 맞닿은 조각만 이어
 * 붙이므로 `…+{-` · `4/12` · `}` 세 조각이 된다.
 *
 * 내용은 다 있지만 **각 조각이 혼자서는 LaTeX으로 성립하지 않는다.**
 * `{-`도 `}`도 KaTeX에서 파싱에 실패하고, 화면에는 빨간 글자가 나간다.
 * 실제로 중1-1 II~IV단원에서 이렇게 136면이 깨졌다(1단원은 2행 분수가
 * 거의 없어 드러나지 않았다).
 *
 * 가르는 근거는 **중괄호 깊이**다. 앞 조각이 열린 채로 끝났으면 그것은
 * 문장이 아니라 조각이다 — 틈이 얼마나 벌어졌든 같은 수식이다. 사이에
 * 한글이 끼어들면 붙이지 않는다(그건 진짜로 끊긴 것이다).
 *
 * **쉼표는 예외다.** 순서쌍 `{-1, -2/3}`의 쉼표는 조판기가 한글 글꼴로
 * 찍어서 텍스트 조각이 된다. 열린 중괄호 안의 구두점은 수식의 일부다 —
 * 여기서 끊으면 `{-1`과 `-2/3}` 둘 다 KaTeX에서 실패한다. 정비례·반비례
 * 단원의 좌표 문항이 거의 다 이 꼴이다.
 */
export function mergeUnbalancedMath(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  /** 수식 안에 들어가도 되는 텍스트 — 구두점과 공백뿐이다 */
  const isInnerPunctuation = (text: string): boolean => /^[\s,.]+$/.test(text);
  /* **등호로 끝난 수식은 문장이 아니라 조각이다.**
   *
   * `f(x)=` 다음에 `x/3`이 따로 서는 일이 잦다 — 2행 분수라 앞뒤로 틈이
   * 벌어져 파서가 잇지 못한다. 중괄호는 멀쩡히 닫혀 있으니 깊이 규칙에도
   * 걸리지 않는다. 내용은 다 있고 화면에도 이어져 보이지만, 저장된 것은
   * 두 수식이라 변형 출제·정답 대조가 `f(x)=`만 보게 된다.
   * 연산자로 끝났으면 그 뒤는 반드시 같은 식이다. */
  const endsOpen = (latex: string): boolean =>
    /(?:[=+\-<>≤≥×÷]|\\times|\\div|\\pm|\\ge|\\le|\\ne)\s*$/.test(latex);
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i]!;
    const last = out[out.length - 1];
    const open =
      last?.kind === "math" &&
      (braceDepth(last.latex) !== 0 || endsOpen(last.latex));
    if (open && run.kind === "math") {
      last.raw += run.raw;
      last.latex = joinLatex(last.latex, run.latex);
      last.unknown = [...last.unknown, ...run.unknown];
      continue;
    }
    /* 구두점 하나만으로는 붙이지 않는다 — **뒤에 수식이 이어질 때만**
     * 안쪽 쉼표다. 그렇지 않으면 문장 끝의 마침표를 수식에 밀어 넣는다. */
    if (
      open &&
      run.kind === "text" &&
      isInnerPunctuation(run.text) &&
      runs[i + 1]?.kind === "math"
    ) {
      last.raw += run.text;
      last.latex += run.text.trimEnd();
      continue;
    }
    out.push(run.kind === "math" ? { ...run, unknown: [...run.unknown] } : { ...run });
  }
  return out;
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
    SUPERSCRIPT_SIGN.has(ch) ||
    UNICODE_SUPERSCRIPT.has(ch) ||
    OPERATOR.has(ch) ||
    BY_FONT.some((f) => f.map.has(ch)) ||
    SUPERSCRIPT_BY_FONT.some((f) => f.map.has(ch)) ||
    SUBSCRIPT_BY_FONT.some((f) => f.map.has(ch)) ||
    SHIFT_ROW.has(ch) ||
    SMALL_DIGIT.has(ch) ||
    FRACTION_NUMERATOR_LETTER.has(ch) ||
    FRACTION_DENOMINATOR_LETTER.has(ch) ||
    PASSTHROUGH.test(ch) ||
    DROPPABLE_ONE.test(ch)
  );
}
