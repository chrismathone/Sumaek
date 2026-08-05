import {
  cleanBodyText,
  decodeHwpMath,
  joinKorean,
  joinLatex,
  attachOverline,
  isOverlineOnly,
  mergeRaised,
  radicalPiece,
  markSuperscripts,
  mergeUnbalancedMath,
  tidyBodyText,
} from "./hwp-encoding";
import { visibleSpans } from "./ink";
import type { PageDump, Run, SourceDump } from "./types";

/** 2행 분수·세로셈 표·연립방정식으로 합쳐진 span — 구조를 구조로 들고 간다 */
export type MaybeStacked = PageDump["spans"][number] & {
  stacked?: { numerator: string; denominator: string };
  /** 세로셈 나눗셈 표를 옮긴 LaTeX 배열 */
  tableLatex?: string;
  /** 연립방정식 — 큰 중괄호 오른쪽의 각 줄 */
  systemRows?: PageDump["spans"][];
};

/* ─────────────────────────────────────────────────────────────
 * 정답 별책 → 문항별 정답·해설
 *
 * RPM은 본책에 답을 싣지 않는다. 별책 『정답 및 해설』이 따로 있고, 문항
 * 번호가 본책과 100% 일치한다(실측: 0001~0275 중 1단원 구간 전부).
 *
 * 별책의 짜임은 단순하다 — 「0044 <해설> 답 ②」. 본책 파서를 쓰지 않는
 * 이유는 여기에 선택지·보기 상자·도형이 없고, 대신 본책에 없는 「답」
 * 표식(전용 폰트)이 있기 때문이다. 이쪽이 훨씬 단순한 문법이다.
 *
 * **답을 못 읽으면 비워 둔다.** 그럴듯하게 지어내면 학생이 맞는 답을 쓰고
 * 틀렸다는 채점을 받는다. 답이 없는 문항은 검수함으로 간다.
 * ───────────────────────────────────────────────────────────── */

export interface ParsedAnswer {
  printedNumber: string;
  page: number;
  /** 「답」 뒤의 내용 — 이것이 정답이다 */
  answer: Run[];
  /**
   * 「답」 앞의 내용 — 풀이. **줄 단위**로 담는다.
   *
   * 한 덩어리로 뭉치면 화면에서 「…관계를 이용한다.최대공약수가 8이고
   * A<B이므로A=8×a, B=8×b…」처럼 끝없이 이어져 읽을 수가 없다.
   * 별책에는 줄 구조가 있고, 그것이 풀이의 단계 구분이다.
   */
  explanation: Run[][];
  /**
   * 서술형 문항의 채점 기준표 (「단계 · 채점 요소 · 비율」).
   * 답 뒤에 붙어 있어서 그냥 두면 정답이 「8단계채점 요소비율1504를…60%」가
   * 된다. 버릴 자료가 아니라 **다른 칸에 들어가야 할** 자료다.
   */
  rubric: Run[];
  /**
   * 「전략」 지침 상자 — 해설에서 뺀 내용. **버리지 않고 여기 담는다.**
   * 무엇을 뺐는지 볼 수 없으면 경계가 맞는지 확인할 방법이 없다.
   */
  strategy: Run[][];
}

export interface AnswerProfile {
  /** 문항 번호 폰트·최소 크기 */
  numberFont: RegExp;
  numberMinSize: number;
  /** 「답」 표식 폰트 — 해설 본문의 「답」과 구별한다 */
  answerLabelFont: RegExp;
  /** 수식 폰트 */
  mathFont: RegExp;
  columns: number;
  lineToleranceY: number;
  /**
   * 오른쪽 여백에 단원명이 **세로로** 인쇄된다(「소/인/수/분/해」).
   * 글자 하나씩 다른 y에 놓여 있어 줄 세우기가 여기저기 끼워 넣는다 —
   * 실제로 풀이가 「$1$은 소수가 아니다.소인$21$의 약수는…」이 됐다.
   * 이 폭 안쪽만 본문으로 본다.
   */
  rightMarginPt: number;
  /**
   * 쪽 아래 러닝헤드(「02 최대공약수와 최소공배수 9」)를 잘라 내는 선.
   * 마지막 문항의 「답」 뒤에 붙어 정답이 「$2$개02 최대공약수와 최소공배수9」가
   * 됐다 — 채점이 영원히 틀리는 종류의 오염이다.
   */
  bottomMarginRatio: number;
  /**
   * 전략(지침) 상자의 **본문 글꼴**. 별책은 전략을 고딕으로, 풀이를 명조로
   * 짜 놓았다 — 눈으로 봐도 다르고 파일에도 그렇게 있다. 들여쓰기나 마침표로
   * 재는 것보다 정확하다.
   */
  strategyBodyFont: RegExp;
  /**
   * 글자가 아니라 **그림 조각**을 담은 글꼴. 밑줄 중괄호(⏟)를 「(」·「\」·
   * 「[{」·「9」 같은 조각으로 그린다. LaTeX으로 옮길 수 없고 그대로 두면
   * KaTeX가 실패한다 — 문항 0083이 그랬다. 내용이 아니므로 버린다.
   */
  decorationFont: RegExp;
  /**
   * **인라인 분수** 글꼴. 「;2&;」(=7/2)처럼 분수를 한 글자로 담는데,
   * 세로로 커서 기준선이 본문보다 아래로 내려간다(본문 611.0 : 분수 615.8).
   * 줄 세우기 허용 오차를 넘으므로 이 글꼴만 세로 겹침으로 흡수한다.
   * 수식 글꼴 전체에 적용하면 세로셈 표의 행까지 한 줄로 뭉친다.
   */
  inlineFractionFont: RegExp;
  /**
   * 구매자 식별 워터마크 (이메일 등).
   *
   * 본책 파서는 이미 걸러 내고 있었는데 **별책 파서에는 없었다.** 그래서
   * 해설 두 곳과 문항 0189의 **정답**에 구매자 이메일이 그대로 들어갔다 —
   * 정답 칸은 학생 채점 화면에 바로 나가는 자리다.
   *
   * 문항이 아니고, 저장해서도 안 되고, 화면에 나가서는 더욱 안 된다.
   */
  purchaserStamp: RegExp;
}

/** 개념원리 RPM (2022 개정) 『정답 및 해설』 — 실측값 */
export const RPM_2022_ANSWERS: AnswerProfile = {
  numberFont: /DINPro-Bold/,
  numberMinSize: 10, // 본책은 14pt, 별책은 12pt
  answerLabelFont: /OTNamoogulrim/,
  mathFont: /^EH/,
  columns: 2,
  lineToleranceY: 4,
  rightMarginPt: 35, // 세로 단원명이 x=599부터 (지면 폭 623.6)
  bottomMarginRatio: 0.925, // 본책과 같은 자리에 러닝헤드가 온다
  strategyBodyFont: /YDVYGOStd12/, // 풀이는 YDVYMjOStd12 (명조)
  decorationFont: /EHSunm/,
  inlineFractionFont: /EHboNA/,
  purchaserStamp: /[\w.+-]+@[\w-]+\.[\w.-]+/,
};

/**
 * 표·분수 합치기가 필요로 하는 최소 신호 — 별책·개념서 파서가 함께 쓴다.
 *
 * AnswerProfile 전체를 요구하면 개념서 파서(concepts.ts)가 별책 전용
 * 필드(answerLabelFont 등)까지 지어내야 한다. 실제로 읽는 세 필드만 받는다.
 */
export interface TableMergeProfile {
  mathFont: RegExp;
  inlineFractionFont: RegExp;
  decorationFont: RegExp;
}

/**
 * 연립방정식을 한 조각으로 합친다 — 본책 파서(segment.ts)와 같은 근거.
 *
 * 별책 해설에도 연립이 그대로 실린다. 합치지 않으면 큰 중괄호 오른쪽의 두
 * 식이 **한 줄로 이어 붙는다** — `y=x-5`와 `4x-y=-4`가 `y=x-54x-y=-4`가
 * 되어, 5와 4가 붙어 54가 된다. 렌더가 실패해 검수함으로 가긴 하지만
 * (중2-1 IV단원 해설 163건), 통과했다면 없는 식이 채점에 쓰였을 것이다.
 *
 * 가르는 근거는 괄호의 생김새다 — 폭은 글자 크기의 절반, 높이는 두 배가
 * 넘는다. 분수를 감싼 키 큰 소괄호와 갈라야 하므로 **여는 중괄호로 읽히는
 * 글리프**만 받는다.
 */
export function mergeEquationSystems(
  spans: PageDump["spans"],
  profile: TableMergeProfile,
): PageDump["spans"] {
  const math = spans.filter((s) => profile.mathFont.test(s.font));
  const inkX1 = (s: PageDump["spans"][number]): number => {
    const glyphs = [...s.text];
    if (!s.chars || s.chars.length !== glyphs.length) return s.x1;
    const boxes = s.chars.filter((_, i) => glyphs[i]!.trim() !== "");
    return boxes.length === 0 ? s.x1 : Math.max(...boxes.map((b) => b[2]));
  };
  const isBracePiece = (s: PageDump["spans"][number]): boolean => {
    if (s.text.trim().length > 2) return false;
    if (inkX1(s) - s.x0 >= s.size * 0.9) return false;
    if (s.y1 - s.y0 <= s.size * 1.6) return false;
    if (/^EHSunm/.test(s.font)) return true;
    return decodeHwpMath(s.text, s.font).latex.trim() === "\\left\\{";
  };

  /* EHSunm은 큰 중괄호를 세로로 서너 조각 내어 보낸다 — 하나로 잇는다 */
  const braces: { pieces: PageDump["spans"]; x1: number; y0: number; y1: number }[] = [];
  for (const s of math.filter(isBracePiece).sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)) {
    const last = braces[braces.length - 1];
    if (last && Math.abs(last.pieces[0]!.x0 - s.x0) <= 1 && s.y0 <= last.y1 + 2) {
      last.pieces.push(s);
      last.x1 = Math.max(last.x1, inkX1(s));
      last.y1 = Math.max(last.y1, s.y1);
      continue;
    }
    braces.push({ pieces: [s], x1: inkX1(s), y0: s.y0, y1: s.y1 });
  }

  const used = new Set<PageDump["spans"][number]>();
  const merged: PageDump["spans"] = [];
  for (const brace of braces) {
    if (brace.pieces.some((p) => used.has(p))) continue;
    const inside = math.filter((s) => {
      if (used.has(s) || brace.pieces.includes(s)) return false;
      const center = (s.y0 + s.y1) / 2;
      return (
        s.x0 >= brace.x1 - 2 &&
        s.x0 <= brace.x1 + 14 &&
        center > brace.y0 - 4 &&
        center < brace.y1 + 4
      );
    });
    if (inside.length < 2) continue;

    const rows: PageDump["spans"][] = [];
    for (const s of [...inside].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
      const center = (s.y0 + s.y1) / 2;
      const row = rows[rows.length - 1];
      const rowCenter = row ? (row[0]!.y0 + row[0]!.y1) / 2 : Number.NaN;
      if (row && Math.abs(center - rowCenter) <= s.size * 0.6) row.push(s);
      else rows.push([s]);
    }
    if (rows.length < 2) continue;

    for (const row of rows) for (const s of row) used.add(s);
    for (const p of brace.pieces) used.add(p);
    const all = rows.flat();
    merged.push({
      ...brace.pieces[0]!,
      text: rows.map((r) => r.map((s) => s.text).join("")).join(" | "),
      x0: brace.pieces[0]!.x0,
      x1: Math.max(...all.map((s) => s.x1)),
      y0: rows[0]![0]!.y0,
      y1:
        rows.reduce((sum, r) => sum + Math.max(...r.map((s) => s.y1)), 0) / rows.length,
      systemRows: rows.map((r) => [...r].sort((a, b) => a.x0 - b.x0)),
    } as PageDump["spans"][number]);
  }

  if (merged.length === 0) return spans;
  return [...spans.filter((s) => !used.has(s)), ...merged];
}

/**
 * 2행 분수를 한 조각으로 합친다 — 본책 파서와 같은 이유, 같은 근거.
 *
 * 별책에도 `-7/2` 같은 분수가 분자·분모 두 span으로 나뉘어 있고 사이의
 * 막대는 높이 0인 벡터 선분이다. 합치지 않으면 절댓값 막대 안에서 조각이
 * 흩어져 「$-$$=$, $|3|=3$, … $|$$\frac{7}{2}|$」처럼 뒤엉킨다
 * (문항 0323이 그랬다).
 */
export function mergeStackedFractions(
  spans: PageDump["spans"],
  page: PageDump,
  profile: TableMergeProfile,
): PageDump["spans"] {
  const bars = page.drawings.filter((d) => d.y1 - d.y0 < 1.5 && d.x1 - d.x0 >= 3);
  if (bars.length === 0) return spans;

  const math = spans.filter((s) => profile.mathFont.test(s.font));
  const used = new Set<PageDump["spans"][number]>();
  const merged: PageDump["spans"] = [];

  for (const bar of bars) {
    /* 좌우로 넓히지 않는다. handoff 7.6a는 「부호가 분수 밖에 찍혀
     * 분자 span이 막대보다 왼쪽에서 시작한다」를 원인으로 적어 두었는데,
     * 실제로 왼쪽을 7pt 넓혀 보니 **더 나빠졌다**(중1-1 49→52 · 중2-2
     * 13→16). 옆 수식을 물고 오면서 다른 분수의 짝을 빼앗는다.
     * 진짜 원인은 세로 판정이었다 — 아래 near() 주석 참고. */
    const within = (s: PageDump["spans"][number]): boolean =>
      s.x0 >= bar.x0 - 2 && s.x1 <= bar.x1 + 2;
    /* 가까운지는 **가운데**로 잰다. 끝점으로 재면 지수가 든 분모가
     * 탈락한다 — `10/(3×5²)`의 분모 상자는 위첨자 때문에 위로 7pt 더
     * 올라와 있어 `y0 >= bar.y1 - 4`를 못 넘겼고, 그 결과 분자 `10`이
     * 혼자 한 줄에 남았다(중2-1 별책 99건 · 중2-2 22건). 본책 파서는
     * 이미 가운데로 재고 있었다 — 두 파서가 어긋나 있었던 것이다. */
    const near = (center: number, edge: number): boolean =>
      Math.abs(center - edge) <= 16;
    const above = math
      .filter((s) => {
        const center = (s.y0 + s.y1) / 2;
        return !used.has(s) && within(s) && center < bar.y0 && near(center, bar.y0);
      })
      .sort((a, b) => b.y1 - a.y1);
    const below = math
      .filter((s) => {
        const center = (s.y0 + s.y1) / 2;
        return !used.has(s) && within(s) && center > bar.y1 && near(center, bar.y1);
      })
      .sort((a, b) => a.y0 - b.y0);

    const numerator = above[0];
    const denominator = below[0];
    if (!numerator || !denominator) continue;
    /* 가로줄이라고 다 분수 막대가 아니다. 별책 0199는 최대공약수를 뽑기
     * 전에 **구분선**을 긋는데, 그 선이 단 폭을 가로질러 위아래 아무 수나
     * 짝지어 `\frac{2}{}`를 만들고 본문의 2를 가져가 버렸다.
     * 분수 막대는 분자·분모보다 조금 넓을 뿐이다. */
    const spanWidth = Math.max(
      numerator.x1 - numerator.x0,
      denominator.x1 - denominator.x0,
    );
    if (bar.x1 - bar.x0 > spanWidth + 8) continue;
    used.add(numerator);
    used.add(denominator);
    merged.push({
      ...numerator,
      /* 원문은 그대로 보존하고(2O), 분수라는 사실은 **구조로** 들고 간다.
       * 텍스트로 다시 인코딩하면 해독표를 두 번 거치며 틀어진다. */
      text: `${numerator.text}/${denominator.text}`,
      stacked: { numerator: numerator.text, denominator: denominator.text },
      x0: Math.min(numerator.x0, denominator.x0),
      x1: Math.max(numerator.x1, denominator.x1),
      y0: numerator.y0,
      y1: (numerator.y1 + denominator.y1) / 2,
    } as PageDump["spans"][number]);
  }

  if (merged.length === 0) return spans;
  return [...spans.filter((s) => !used.has(s)), ...merged];
}

/**
 * 약수 구하기 **격자표**를 KaTeX 배열로 바꾼다.
 *
 * 소인수분해로 약수를 세는 해설은 지면에 이런 표를 그린다:
 *
 *     ×  │  1   3   3²
 *     ───┼─────────────
 *     1  │  1   3   9
 *     2  │  2   6   18
 *
 * 표라는 사실을 버리면 칸의 수가 읽는 순서대로 이어 붙어
 * `×1 3 3² 1 1 3 9 2 2 6 18`이 된다 — 무엇을 곱한 것인지 알 수가 없고,
 * 0031에서는 그 덩어리가 통째로 **정답 칸**에 들어갔다.
 *
 * 표를 알아보는 근거는 **칠한 사각형**이다. 머리 행과 첫 열에 색을 깔아
 * 두었고, 그 사각형 하나가 표의 경계와 정확히 같다. 격자선으로 찾으려면
 * 선이 몇 개인지·어디가 바깥인지를 다시 정해야 하는데, 사각형은 한 번에
 * 답을 준다.
 */
export function mergeGridTables(
  spans: PageDump["spans"],
  page: PageDump,
  profile: TableMergeProfile,
): PageDump["spans"] {
  /* 배지(「답」 표식)도 칠한 사각형이다 — 8×8pt다. 표만한 크기를 요구한다. */
  const boxes = page.drawings.filter(
    (d) => d.fill && d.x1 - d.x0 >= 40 && d.y1 - d.y0 >= 20,
  );
  if (boxes.length === 0) return spans;

  const used = new Set<PageDump["spans"][number]>();
  const merged: PageDump["spans"] = [];

  for (const box of boxes) {
    const cells = spans.filter((s) => {
      if (used.has(s)) return false;
      if (!profile.mathFont.test(s.font)) return false;
      if (profile.decorationFont.test(s.font)) return false;
      const cx = (s.x0 + s.x1) / 2;
      const cy = (s.y0 + s.y1) / 2;
      return cx > box.x0 && cx < box.x1 && cy > box.y0 && cy < box.y1;
    });
    if (cells.length < 4) continue;

    /* 행은 기준선, 열은 가운데 x로 모은다. 칸이 비어 있을 수 있으므로
     * 둘을 따로 세운 뒤 격자에 채워 넣는다. */
    const rows: number[] = [];
    const cols: number[] = [];
    for (const c of [...cells].sort((a, b) => a.y1 - b.y1)) {
      if (!rows.some((y) => Math.abs(y - c.y1) <= 5)) rows.push(c.y1);
    }
    for (const c of [...cells].sort((a, b) => a.x0 - b.x0)) {
      const cx = (c.x0 + c.x1) / 2;
      if (!cols.some((x) => Math.abs(x - cx) <= 12)) cols.push(cx);
    }
    if (rows.length < 2 || cols.length < 2) continue;

    const grid = rows.map((y) =>
      cols.map((x) =>
        cells
          .filter(
            (c) =>
              Math.abs(c.y1 - y) <= 5 && Math.abs((c.x0 + c.x1) / 2 - x) <= 12,
          )
          .sort((a, b) => a.x0 - b.x0)
          .map((c) => decodeHwpMath(markSuperscripts(c.text, c.chars), c.font).latex)
          .join("")
          .trim(),
      ),
    );

    for (const c of cells) used.add(c);
    /* 첫 열과 머리 행에만 선을 긋는다 — 지면이 그렇게 생겼다 */
    const shape = `c|${"c".repeat(cols.length - 1)}`;
    const body = grid
      .map((r) => r.map((cell) => cell || "{}").join(" & "))
      .join(" \\\\ ")
      .replace(/ \\\\ /, " \\\\ \\hline ");
    const latex = `\\begin{array}{${shape}}${body}\\end{array}`;

    const anchor = cells.reduce((a, b) => (a.y1 <= b.y1 ? a : b));
    merged.push({
      ...anchor,
      text: grid.map((r) => r.join(" ")).join(" / "),
      tableLatex: latex,
      x0: Math.min(...cells.map((c) => c.x0)),
      x1: Math.max(...cells.map((c) => c.x1)),
    } as PageDump["spans"][number]);
  }

  if (merged.length === 0) return spans;
  return [...spans.filter((s) => !used.has(s)), ...merged];
}

/**
 * 세로셈 나눗셈 표를 **KaTeX 배열**로 바꾼다.
 *
 * 소인수분해 해설은 지면에서 이렇게 생겼다:
 *
 *     3 ) 117
 *     3 )  39
 *          13
 *
 * 「)」와 그 위의 가로줄은 글자가 아니라 표를 그리는 조각(EHboNA)이다.
 * 그대로 두면 `3>^{3}^{3}117`처럼 뜻 없는 LaTeX이 되어 KaTeX가 실패하고,
 * 조각만 버리면 숫자가 이어 붙어 무슨 계산인지 알 수 없다.
 *
 * **행은 「)」 하나가 하나씩 만든다.** 조각의 세로 띠(약 21pt)가 자기 행의
 * 숫자를 품는다 — 숫자의 y로 행을 세우려 했더니 표 밖 본문 줄까지 끌려
 * 들어왔고(「따라서 117을」의 117이 사라졌다), 조각의 띠로 줄을 나누려
 * 했더니 두 행이 하나로 뭉쳤다. 띠는 **행을 가르는 선**이 아니라
 * **행에 속한 것을 고르는 그물**이다.
 *
 * 표가 어디서 끝나는지는 「)」가 알려 준다. 마지막 「)」 아래 한 행이 최종
 * 몫이고, 그 아래는 본문이다.
 */
export function mergeDivisionTables(
  spans: PageDump["spans"],
  profile: TableMergeProfile,
): PageDump["spans"] {
  const brackets = spans
    .filter((s) => profile.inlineFractionFont.test(s.font) && s.text.includes(">"))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  if (brackets.length === 0) return spans;

  /* 한 표의 「)」는 한 행(약 14pt) 간격으로, 거의 같은 x에 이어진다. x가
   * **조금씩 오른쪽으로 밀리는** 것까지 봐 줘야 한다 — 나뉘는 수의 자릿수가
   * 줄면 오른끝을 맞추느라 표가 움직인다(200 → 50에서 한 자리, 약 4.7pt).
   *
   * 표는 **나란히 서기도 한다**(0053은 48과 64를 한 줄에 놓는다). 그래서
   * 바로 앞 조각에만 이으면 안 된다 — y로 훑으면 두 표의 조각이 번갈아
   * 나와 서로를 끊는다. 각 조각은 **자기 열의** 사슬을 찾아 붙는다. */
  const tables: PageDump["spans"][] = [];
  for (const bracket of brackets) {
    const chain = tables.find((t) => {
      const prev = t[t.length - 1]!;
      const gap = bracket.y0 - prev.y0;
      return gap > 5 && gap < 25 && Math.abs(bracket.x0 - prev.x0) < 12;
    });
    if (chain) chain.push(bracket);
    else tables.push([bracket]);
  }

  const used = new Set<PageDump["spans"][number]>();
  const merged: PageDump["spans"] = [];

  /* 한 span이 여러 칸을 담기도 한다 — 개념서는 「12  24  30」을 통째로
   * 한 span에 싣는다. 그대로 한 칸이 되면 수식 모드가 공백을 눌러
   * 「122430」으로 보인다. 글자 상자를 따라 공백에서 가른다. */
  /** 조각 → 원본 — 조각이 표에 들어가면 원본도 소비된 것으로 표시한다.
   * 빠뜨리면 원본 span이 본문에 남아 같은 수가 두 번 나온다. */
  const parentOf = new Map<PageDump["spans"][number], PageDump["spans"][number]>();
  const splitTokens = (s: PageDump["spans"][number]): PageDump["spans"] => {
    const glyphs = [...s.text];
    if (!s.chars || s.chars.length !== glyphs.length || !/\S\s+\S/.test(s.text)) {
      return [s];
    }
    const parts: PageDump["spans"] = [];
    let cur: (PageDump["spans"][number] & { chars: [number, number, number, number][] }) | null = null;
    glyphs.forEach((ch, i) => {
      const box = s.chars![i]!;
      if (ch.trim() === "") {
        cur = null;
        return;
      }
      if (cur) {
        cur.text += ch;
        cur.x1 = Math.max(cur.x1, box[2]);
        cur.chars.push(box);
      } else {
        cur = { ...s, text: ch, x0: box[0], x1: box[2], chars: [box] };
        parts.push(cur);
      }
    });
    if (parts.length <= 1) return [s];
    for (const part of parts) parentOf.set(part, s);
    return parts;
  };

  /** 이 「)」의 칸에 들어갈 숫자들 — 아직 다른 표가 가져가지 않은 것만 */
  const cellsIn = (
    x: number,
    top: number,
    bottom: number,
  ): PageDump["spans"] =>
    spans
      .filter((s) => {
        if (used.has(s)) return false;
        if (!profile.mathFont.test(s.font)) return false;
        if (profile.inlineFractionFont.test(s.font)) return false;
        const cy = (s.y0 + s.y1) / 2;
        /* 창을 넓게 잡으면 **옆에 나란히 선 표**의 수를 집어 온다 —
         * 0053의 48 표가 64 표의 자리를 먹어 「6」이 「46」이 됐다. */
        return cy > top && cy < bottom && s.x0 > x - 38 && s.x0 < x + 42;
      })
      .flatMap(splitTokens);

  for (const table of tables) {
    /* 행 간격 — 「)」가 하나뿐이면 지면의 기본 행높이를 쓴다 */
    const pitch =
      table.length > 1 ? table[1]!.y0 - table[0]!.y0 : (table[0]!.y1 - table[0]!.y0) * 0.66;

    const rows: { x: number; spans: PageDump["spans"] }[] = [];
    for (const bracket of table) {
      const cells = cellsIn(bracket.x0, bracket.y0, bracket.y1);
      if (cells.length === 0) continue;
      for (const s of cells) {
        used.add(s);
        const parent = parentOf.get(s);
        if (parent) used.add(parent);
      }
      rows.push({ x: bracket.x0, spans: cells });
    }
    if (rows.length === 0) continue;

    /* 마지막 「)」 **아래 한 행**이 최종 몫이다. 그 아래 본문 줄과는 몇 pt
     * 차이라, 고정 여유가 아니라 행 간격으로 끊어야 갈린다. */
    const tail = table[table.length - 1]!;
    const quotient = cellsIn(tail.x0, tail.y1, tail.y1 + pitch).filter(
      /* 몫은 나뉘는 수 아래에 선다. 왼쪽에 있으면 표가 아니라 본문이다. */
      (s) => (s.x0 + s.x1) / 2 > tail.x0,
    );
    if (quotient.length > 0) {
      for (const s of quotient) {
        used.add(s);
        const parent = parentOf.get(s);
        if (parent) used.add(parent);
      }
      rows.push({ x: tail.x0, spans: quotient });
    }

    const cell = (list: PageDump["spans"]): string =>
      decodeHwpMath(
        [...list].sort((a, b) => a.x0 - b.x0).map((s) => s.text).join(""),
        list[0]?.font,
      ).latex.trim();
    /* 나누는 수와 나뉘는 수는 **가운데로** 가른다. 「3 」처럼 뒤에 공백이
     * 붙은 span은 오른끝이 「)」를 넘어서, 끝점으로 가르면 어느 칸에도
     * 들지 못하고 통째로 사라진다. */
    const isLeft = (s: PageDump["spans"][number], x: number): boolean =>
      (s.x0 + s.x1) / 2 < x;

    /* 나뉘는 수는 **하나가 아닐 수 있다.** 세 수의 최소공배수를 구할 때는
     * `x ) 4×x  5×x  6×x`처럼 나란히 선다. 오른쪽을 통째로 이으면
     * `4×x5×x`가 되어 어느 수를 나눈 것인지 사라진다(0164·0165).
     * 그래서 오른쪽의 x를 모아 열을 세우고, 행마다 그 열에 채워 넣는다. */
    /* 열 씨앗의 병합 반경은 **7pt**다. 14pt로 두면 개념서의 세 수 표
     * (「12 24 30」 — 열 간격 15pt)가 한 열로 합쳐져 「122430」이 된다.
     * 오른끝 맞춤이라 자릿수에 따라 중심이 ±3pt쯤 흔들리는 것은 7pt가
     * 흡수한다 (실측). */
    const rightCols: number[] = [];
    for (const row of rows) {
      for (const s of row.spans) {
        if (isLeft(s, row.x)) continue;
        const cx = (s.x0 + s.x1) / 2;
        if (!rightCols.some((x) => Math.abs(x - cx) <= 7)) rightCols.push(cx);
      }
    }
    rightCols.sort((a, b) => a - b);

    /* 칸 배정은 **가장 가까운 열 하나**에만 한다. 창(±14pt)으로 거르면
     * 개념서처럼 열 간격이 15pt까지 좁혀진 표에서 한 수가 두 열에 다
     * 들어가 「9 15」가 「9 & 915」로 겹쳐 적힌다 (개념원리 p.30 실측). */
    const nearestCol = (s: PageDump["spans"][number]): number => {
      const c = (s.x0 + s.x1) / 2;
      let best = 0;
      for (let i = 1; i < rightCols.length; i += 1) {
        if (Math.abs(rightCols[i]! - c) < Math.abs(rightCols[best]! - c)) best = i;
      }
      return best;
    };
    const body = rows.map((row) => [
      cell(row.spans.filter((s) => isLeft(s, row.x))),
      ...rightCols.map((x, i) =>
        cell(
          row.spans.filter(
            (s) =>
              !isLeft(s, row.x) &&
              Math.abs((s.x0 + s.x1) / 2 - x) <= 14 &&
              nearestCol(s) === i,
          ),
        ),
      ),
    ]);
    /* 세로셈의 한 행은 「나누는 수 ) 나뉘는 수」다 — **등식이 들어올 자리가
     * 없다.** 0164·0165는 같은 x에 `4×x=2²` 같은 정렬 블록을 쌓아 두는데,
     * 그것이 표로 잡혀 정답 칸에 엉뚱한 배열이 들어갔다. */
    if (body.some((row) => row.some((c) => c.includes("=")))) continue;

    for (const bracket of table) used.add(bracket);
    /* 「)」와 짝을 이루는 가로줄 조각(같은 글꼴, 바로 오른쪽)도 함께 버린다 */
    const bottom = Math.max(...rows.flatMap((r) => r.spans.map((s) => s.y1)));
    for (const s of spans) {
      if (
        profile.inlineFractionFont.test(s.font) &&
        s.x0 > table[0]!.x0 - 2 &&
        s.x0 < tail.x0 + 40 &&
        s.y0 >= table[0]!.y0 - 3 &&
        s.y1 <= bottom + 3
      ) {
        used.add(s);
      }
    }

    /* `{r|l}`의 세로줄이 나눗셈 기호 자리를 대신하고, `\hline`이 각 행 아래
     * 가로줄을 대신한다. 지면과 획이 같지는 않지만 읽는 사람은 같은 것을
     * 본다 — 나누는 수 · 나뉘는 수 · 몫이 제자리에 선다. */
    /* 빈 칸(마지막 몫 줄의 나누는 수 자리)은 `{}`로 적는다. 비워 두면
     * `\hline  & 13`처럼 공백이 겹쳐, 조판 정렬이 남은 것과 구별되지 않는다. */
    const latex = `\\begin{array}{r|${"l".repeat(rightCols.length)}}${body
      .map((row) => row.map((c) => c || "{}").join(" & "))
      .join(" \\\\ \\hline ")}\\end{array}`;

    /* 표는 **첫 행의 기준선**에 세운다. 표 전체 높이로 세우면 나란히 선 두
     * 표가 행 수가 다를 때(0053의 48은 다섯 줄, 64는 여섯 줄) 서로 다른
     * 줄로 갈라져, 지면에서는 나란한 것이 풀이에서는 위아래가 된다. */
    const cells = rows.flatMap((r) => r.spans);
    const anchor = cells.reduce((a, b) => (a.y1 <= b.y1 ? a : b));
    merged.push({
      ...anchor,
      text: body.map((row) => row.join(")")).join(" "),
      tableLatex: latex,
      x0: Math.min(...cells.map((s) => s.x0)),
      x1: Math.max(...cells.map((s) => s.x1)),
    } as PageDump["spans"][number]);
  }

  if (merged.length === 0) return spans;
  return [...spans.filter((s) => !used.has(s)), ...merged];
}

export function parseAnswerPage(
  page: PageDump,
  profile: AnswerProfile,
  /**
   * 앞 쪽에서 **답을 아직 못 받은 채** 끝난 항목. 넘겨주면 이 쪽 첫 번호가
   * 나오기 전까지의 글이 그 항목에 이어 붙는다.
   *
   * 해설이 단 끝을 넘어가면 「답」 배지가 다음 쪽 첫 단에 홀로 남는다.
   * 쪽마다 따로 읽으면 그 배지 앞에 항목이 없어 통째로 버려지고, 문항은
   * **해설은 있는데 답만 빈** 상태가 된다 (0288·0655 등 23건 실측).
   * 학생 채점에 바로 쓰이는 자리라 비면 그 문항은 못 낸다.
   */
  carry?: ParsedAnswer | null,
): ParsedAnswer[] {
  const columnWidth = page.width / profile.columns;
  const columnOf = (x: number): number =>
    Math.min(profile.columns - 1, Math.max(0, Math.floor(x / columnWidth)));

  /* 줄 세우기 — 본책과 같은 이유로 아래끝을 기준선으로 쓴다 */
  interface Line {
    y: number;
    /** 줄이 차지한 세로 띠 — 위첨자를 흡수할 때 쓴다 */
    top: number;
    bottom: number;
    /** 줄의 대표 글자 크기 (가장 큰 것) */
    size: number;
    column: number;
    spans: (typeof page.spans)[number][];
  }
  const lines: Line[] = [];
  const bodyRight = page.width - profile.rightMarginPt;
  /* 큰 글자부터 넣어 줄의 세로 띠를 먼저 세운다 — 본책 파서와 같은 이유다.
   * 작은 위첨자가 먼저 들어와 자기만의 줄을 만들면 흡수할 대상이 없다. */
  const prepared = mergeGridTables(
    mergeDivisionTables(
      mergeStackedFractions(
        /* 연립을 먼저 합친다 — 그 안에 2행 분수가 들어 있으면 분수 쪽이
         * 먼저 가져가 연립의 한 줄이 빈다 */
        mergeEquationSystems(visibleSpans(page), profile),
        page,
        profile,
      ),
      profile,
    ),
    page,
    profile,
  );
  const ordered = [...prepared].sort(
    (a, b) => b.size - a.size || a.y1 - b.y1 || a.x0 - b.x0,
  );
  for (const span of ordered) {
    if (span.text.trim() === "") continue;
    if (span.x0 >= bodyRight) continue; // 세로 단원명 — 본문이 아니다
    if (span.y0 > page.height * profile.bottomMarginRatio) continue; // 러닝헤드
    if (profile.decorationFont.test(span.font)) continue; // 괄호 그림 조각
    /* 구매자 워터마크는 여백이 아니라 **풀이 한가운데**에도 찍힌다.
     * 문항 0189에서는 정답 칸에 들어갔다 — 채점 화면에 바로 나가는 자리다. */
    if (profile.purchaserStamp.test(span.text)) continue;
    const column = columnOf((span.x0 + span.x1) / 2);
    const center = (span.y0 + span.y1) / 2;
    const line = lines.find((l) => {
      if (l.column !== column) return false;
      if (Math.abs(l.y - span.y1) <= profile.lineToleranceY) return true;
      /* 위첨자·아래첨자 — 작고, 줄의 세로 띠 안에 든다.
       * 이걸 안 하면 `3^a×5^b`의 a·b가 자기들끼리 한 줄이 되어 그 줄이
       * 전략과 풀이 사이를 끊는다 — 문항 0096의 전략이 반만 잡혔다. */
      if (span.size < l.size * 0.8 && center > l.top && center < l.bottom) return true;
      /* 분수 글꼴(EHboNA)은 크기가 같아도 **기준선이 아래로 내려간다** —
       * 본문 y1=611.0인데 `;2&;`(=7/2)는 615.8이다. 허용 오차를 넘어
       * 다른 줄로 갈라지면 |−7/2| 같은 식이 조각나 뒤로 밀린다
       * (문항 0323이 그랬다). 세로로 겹치면 같은 줄로 본다. */
      /* 같은 글꼴이 **세로셈 나눗셈 기호**(`>`)에도 쓰인다. 그 조각은 두 줄
       * 높이라 겹침만 보면 표의 두 행을 하나로 묶는다(문항 0027이 그랬다).
       * 높이로도 갈리지 않는다 — 분수도 두 줄 높이다. 기호 자체로 가른다. */
      return (
        profile.inlineFractionFont.test(span.font) &&
        !span.text.includes(">") &&
        span.y0 < l.bottom &&
        span.y1 > l.top + (l.bottom - l.top) * 0.3
      );
    });
    if (line) {
      line.spans.push(span);
      line.top = Math.min(line.top, span.y0);
      line.bottom = Math.max(line.bottom, span.y1);
    } else {
      lines.push({
        y: span.y1,
        top: span.y0,
        bottom: span.y1,
        size: span.size,
        column,
        spans: [span],
      });
    }
  }
  for (const line of lines) line.spans.sort((a, b) => a.x0 - b.x0);
  lines.sort((a, b) => a.column - b.column || a.y - b.y);

  /* ── 어디가 진짜 줄바꿈인가 ────────────────────────────────
   *
   * 조판의 줄바꿈은 두 종류다. 대부분은 **폭이 차서** 넘어간 것이고
   * (「…관계를 이 / 용한다」처럼 낱말 중간에서도 끊긴다), 일부는 글쓴이가
   * 의도한 **단계 구분**이다. 앞엣것을 줄바꿈으로 살리면 낱말이 쪼개지고,
   * 뒤엣것을 뭉개면 풀이가 한 줄로 이어져 읽을 수가 없다.
   *
   * 구분하는 단서는 **줄이 어디서 끝났는가**다. 오른쪽 끝까지 찼으면
   * 넘어간 것이고, 한참 못 미치면 거기서 끊은 것이다. 단의 오른쪽 끝은
   * 그 단에서 가장 멀리 간 줄로 잰다 — 쪽마다 여백이 조금씩 다르다. */
  const columnRight = new Map<number, number>();
  for (const line of lines) {
    const right = Math.max(...line.spans.map((s) => s.x1));
    columnRight.set(line.column, Math.max(columnRight.get(line.column) ?? 0, right));
  }
  /** 이 줄에서 끊긴 것인가 (다음 줄과 이어지지 않는가) */
  const endsHere = (line: Line): boolean => {
    const right = Math.max(...line.spans.map((s) => s.x1));
    const edge = columnRight.get(line.column) ?? right;
    return edge - right > 12;
  };
  /* ── 「전략」 지침 상자 ────────────────────────────────────
   *
   * 별책은 풀이 앞에 「전략 …임을 이용한다.」로 접근법을 귀띔한다. 이건
   * 문항의 해설이 아니라 **교재 편집자가 학생에게 주는 힌트**여서 우리
   * 해설에는 넣지 않는다.
   *
   * 지우는 것이 내용만의 문제가 아니다. 이 상자 안에는 밑줄 중괄호(⏟)를
   * 그리는 조각 글리프가 들어 있다(EHSunm-Plain의 `(`·`\`·`[{`·`9`).
   * 글자가 아니라 그림이라 LaTeX으로 옮길 수 없고, 그대로 두면 KaTeX가
   * 실패한다 — 남아 있던 렌더 실패 1건이 바로 이것이었다(문항 0083).
   *
   * 경계는 **문장 하나**다. 처음에는 「들여쓰기가 끝날 때까지」로 잡았는데,
   * 그러면 전략 아래 딸린 **세로셈 표까지 지운다**(문항 0197의
   * 2²×3 / 3×5 / 2×3×5). 그 표는 힌트가 아니라 풀이다.
   * 전략은 「…을 이용한다.」 한 문장이고, 마침표에서 끝난다. */
  const isStrategyLabel = (line: Line): boolean =>
    line.spans.some((s) => cleanBodyText(s.text).trim() === "전략");

  /**
   * 이 줄의 한글이 **전략 글꼴**인가.
   *
   * 별책은 전략과 풀이를 글꼴로 갈라 놓았다 — 전략은 고딕(YDVYGOStd12),
   * 풀이는 명조(YDVYMjOStd12). 눈으로 봐도 다르고, 파일에도 그렇게 있다.
   * 들여쓰기나 마침표로 재는 것보다 이쪽이 정확하다.
   *
   * 전략이 두 줄인 문항이 있고(0096: 「…뿐이므로 / …꼴임을 이용한다.」)
   * 전략 아래에 세로셈 표가 붙는 문항이 있다(0197). 표에는 한글이 없으므로
   * 이 판정으로 자연히 갈린다 — 표는 풀이로 남는다.
   */
  const hasStrategyKorean = (line: Line): boolean => {
    const korean = line.spans.filter((s) => /[가-힣]/.test(s.text));
    if (korean.length === 0) return false;
    return korean.some((s) => profile.strategyBodyFont.test(s.font));
  };

  /** 줄이 새 단계로 시작하는가 — ∴·따라서·즉은 언제나 새 줄이다 */
  const startsNew = (line: Line): boolean =>
    /^\s*(∴|따라서|즉|그러므로)/.test(
      cleanBodyText(line.spans.map((s) => s.text).join("")).trim(),
    );

  const out: ParsedAnswer[] = [];
  /* 넘겨받은 항목은 out에 담지 않는다 — 앞 쪽이 이미 내놓았고, 여기서는
   * 같은 객체에 이어 쓰기만 한다. */
  let current: ParsedAnswer | null = carry ?? null;
  let inAnswer = false;
  /** 답 뒤에 붙는 곁다리 상자 — 여기서부터는 정답이 아니다 */
  let answerClosed = false;
  let inRubric = false;
  /* 답 뒤에 붙는 곁다리 상자의 머리글. 「RPM 비법 노트」는 「RPM」과
   * 「비법 노트」가 별개 span으로 와서 앞쪽만 잡으면 정답이 「122RPM」이 된다. */
  const ASIDE = /^(참고|다른 풀이|전략|주의|보충|RPM|.*비법\s*노트)$/;
  /* 쪽 참조 머리글(「본책 9~11쪽」 「본문 10~14쪽」)이 마지막 문항의 답 뒤에
   * 붙는다. 정답이 「$6$본책9~11쪽본문 10~14쪽」이 됐다. */
  const PAGE_REF = /^(본책|본문)/;
  /**
   * 서술형 채점 기준표의 머리글. 표는 「단계 | 채점 요소 | 비율」 순으로
   * 오므로 첫 칸인 「단계」부터 잡아야 한다 — 「채점 요소」만 보면 그 앞의
   * 「단계」가 답에 남아 정답이 「8단계」가 된다.
   */
  const RUBRIC_HEAD = /^(단계|채점\s*요소|비율|단계별\s*배점)$/;
  /** 곁다리 상자 라벨의 자리 — 이 아래는 정답이 아니다 */
  const asideMarks = prepared
    .filter((s) => ASIDE.test(cleanBodyText(s.text).trim()))
    .map((s) => ({ column: columnOf((s.x0 + s.x1) / 2), y: s.y1 }));

  /** 마지막으로 담은 span의 오른쪽 끝 — 수식 조각을 붙일지 판단한다 */
  let lastX1 = Number.NEGATIVE_INFINITY;
  /** 마지막으로 담은 **본문 크기의** 조각. 위첨자 판정의 기준이 된다. */
  let lastSize = 0;

  /**
   * 조각 하나를 담는다.
   *
   * 수식은 **좌표가 이어지면 앞 조각에 붙인다.** 조판기는 한 수식을 여러
   * span으로 쪼개 놓는데(`5` + `Ü`` = 5³), 따로 담으면 정답이
   * `$5$$^{3}$`처럼 두 조각으로 저장된다. 본책 파서가 이미 같은 이유로
   * 같은 처리를 한다.
   */
  const push = (
    runs: Run[],
    text: string,
    isMath: boolean,
    raw: string,
    x0: number,
    x1: number,
    /** 글꼴 — 같은 코드도 글꼴이 다르면 다른 글자다 (EHyak의 `y`는 ⋯) */
    font: string,
    /** 글자별 상자 — 겹쳐 찍은 위첨자를 가리는 유일한 근거 */
    chars: PageDump["spans"][number]["chars"],
    /** 글자 크기 — 앞 조각보다 뚜렷이 작으면 위첨자다 */
    size: number,
    stacked?: { numerator: string; denominator: string },
    table?: string,
    /** 연립방정식 — 큰 중괄호 오른쪽의 각 줄 */
    systemRows?: PageDump["spans"][],
  ): void => {
    const adjacent = x0 - lastX1 < 1.5;
    lastX1 = x1;
    /* 위첨자는 **바로 앞 조각과 견줘서** 작은 것이다. 줄의 최대 크기와
     * 견주면 12pt 문항 번호가 기준이 되어 같은 줄의 9.3pt 본문 수가 몽땅
     * 위첨자가 된다 — 0048의 「27은 일의 자리」가 「^{27}은」이 됐다. */
    /* **근호 조각은 기준 크기를 바꾸지 않는다.** 근호는 안의 내용 높이에
     * 맞춰 글리프를 늘여 그리므로 size가 본문보다 크고, 그것을 기준으로
     * 삼으면 뒤따르는 내용이 통째로 위첨자가 된다. 가구는 글자가 아니다. */
    const isRadical =
      radicalPiece(raw, font, chars?.[0] ? chars[0][2] - chars[0][0] : undefined) !==
      null;
    const raised = adjacent && !isRadical && size < lastSize * 0.8;
    if (!raised && !isRadical) lastSize = size;
    /* 표는 앞 조각에 붙이지 않는다 — 한 덩어리로 서야 모양이 산다 */
    if (table) {
      runs.push({ kind: "math", raw, latex: table, unknown: [] });
      return;
    }
    /* 연립도 마찬가지다 — `\begin{cases}`가 왼쪽에 큰 중괄호를 세운다 */
    if (systemRows) {
      const unknown: string[] = [];
      const body = systemRows
        .map((row) =>
          row
            .map((s) => {
              const d = decodeHwpMath(markSuperscripts(s.text, s.chars), s.font);
              unknown.push(...d.unknown);
              return d.latex;
            })
            .reduce((acc, part) => joinLatex(acc, part), ""),
        )
        .join(" \\\\ ");
      runs.push({
        kind: "math",
        raw,
        latex: `\\begin{cases}${body}\\end{cases}`,
        unknown,
      });
      return;
    }
    if (isMath) {
      /* 근호는 글자가 아니라 가구다 — 첫 글자의 폭으로 여닫이를 가린다.
       * 여는 조각과 닫는 조각이 서로 다른 span이라 이어 붙여야 √가 된다. */
      const radical = radicalPiece(
        raw,
        font,
        chars?.[0] ? chars[0][2] - chars[0][0] : undefined,
      );
      /* **별책에서는 확실한 근호만 옮긴다.**
       *
       * 끝을 모르는 EHboNA 근호까지 `\surd`로 바꿔 봤더니 해설이 통째로
       * 뒤엉켰다 — `=\surd x=¹^{3^{2}}^{+…}`처럼 뒤따르는 조각이 위첨자로
       * 말려 들어간다. 본책은 한 줄에 수식 하나꼴이라 괜찮았지만 해설은
       * 조각이 훨씬 잘게 나뉜다. 확실하지 않은 것은 손대지 않고 미해독으로
       * 두어 검수함으로 보낸다 — 어설프게 옮기면 사람도 못 고친다. */
      if (radical !== null && radical.certain) {
        const flag: string[] = [];
        const last = runs[runs.length - 1];
        if (last?.kind === "math") {
          last.raw += raw;
          last.latex =
            radical.latex === "}"
              ? last.latex + radical.latex
              : joinLatex(last.latex, radical.latex);
          last.unknown.push(...flag);
        } else {
          runs.push({ kind: "math", raw, latex: radical.latex, unknown: flag });
        }
        return;
      }
      /* 윗줄 글리프는 혼자서는 아무 뜻이 없다 — 씌울 글자를 찾아 준다.
       *
       * 맞닿았는지는 보지 않는다. 폭이 0이라 뒤따르는 글자와 x가 같고,
       * 정렬에서 한참 밀려 「OC‾=OD‾, ∠CPO」가 `OC‾=OD` · `, ∠` · `Ó` ·
       * `CPO`로 오기도 한다(별책 도형 해설). 사이에 한글이 끼어도 **읽는
       * 순서상 바로 앞의 수식**이 임자다. 그냥 두면 화면에 낯선 글자가
       * 나가고 선분 표시는 사라진다.
       *
       * previous가 text일 수 있으므로 뒤에서부터 수식을 찾는다. */
      if (isOverlineOnly(raw)) {
        const owner = [...runs].reverse().find((r) => r.kind === "math");
        if (owner?.kind === "math") {
          const rewritten = decodeHwpMath(attachOverline(owner.raw, raw), font);
          owner.raw += raw;
          owner.latex = rewritten.latex;
          owner.unknown.push(...rewritten.unknown);
          return;
        }
      }
      const decoded = stacked
        ? (() => {
            const top = decodeHwpMath(stacked.numerator, font);
            const bottom = decodeHwpMath(stacked.denominator, font);
            return {
              /* `\f`는 폼피드다. 백슬래시를 하나만 쓰면 `\frac`이 아니라
               * 「폼피드 + rac」이 되어 화면에 `rac{7}{2}`가 나간다. */
              latex: `\\frac{${top.latex}}{${bottom.latex}}`,
              unknown: [...top.unknown, ...bottom.unknown],
            };
          })()
        : decodeHwpMath(markSuperscripts(raw, chars), font);
      if (decoded.latex === "") return;
      /* 지면에서 작게 떠 있는 조각은 위첨자다. 본책 파서는 이미 이렇게
       * 하는데 별책 파서에는 없어서, 0199 해설의 `5^c×7^d`가 `5c×7d`로
       * 내려앉았다. */
      const latex = raised ? `^{${decoded.latex}}` : decoded.latex;
      const last = runs[runs.length - 1];
      if (last?.kind === "math" && adjacent) {
        last.raw += raw;
        /* 위첨자 조각은 앞의 지수 **안으로** 들어간다 — 따로 씌우면
         * `^{2}^{+}^{3}`이 되어 KaTeX가 파싱에 실패한다 */
        last.latex = raised
          ? mergeRaised(last.latex, decoded.latex)
          : joinLatex(last.latex, latex);
        last.unknown.push(...decoded.unknown);
        return;
      }
      runs.push({ kind: "math", raw, latex, unknown: decoded.unknown });
      return;
    }
    if (text.trim() === "") return;
    const last = runs[runs.length - 1];
    if (last?.kind === "text") last.text = joinKorean(last.text, text);
    else runs.push({ kind: "text", text });
  };

  /** 지금 풀이를 담고 있는 줄. 새 줄을 시작할 때마다 갈아 끼운다. */
  let explanationLine: Run[] | null = null;
  const explanationTarget = (): Run[] => {
    if (!explanationLine) {
      explanationLine = [];
      current!.explanation.push(explanationLine);
    }
    return explanationLine;
  };

  /** 「전략」 상자를 지나는 중인가 — 한글이 풀이 글꼴로 바뀌면 끝난다 */
  let inStrategy = false;
  /** 지금 담고 있는 전략 줄. **조각을 담을 때** 만든다 — 줄 단위로 미리
   * 만들면 번호를 처리하기 전이라 앞 문항에 붙는다(실제로 그랬다). */
  let strategyLine: Run[] | null = null;
  const strategyTarget = (): Run[] => {
    if (!strategyLine) {
      strategyLine = [];
      current!.strategy.push(strategyLine);
    }
    return strategyLine;
  };

  for (const line of lines) {
    if (inStrategy && !hasStrategyKorean(line)) {
      inStrategy = false;
      strategyLine = null;
    }
    /* 문항 번호와 「전략」이 **같은 기준선에 온다**(0083: 번호 y=591,
     * 전략 y=588). 줄째로 건너뛰면 문항 자체가 사라진다 — 실제로 그랬다.
     * 상태만 세우고 건너뛰기는 span 단위로 한다. */
    if (isStrategyLabel(line)) {
      inStrategy = true;
      explanationLine = null;
      strategyLine = null;
    }
    if (inStrategy) strategyLine = null; // 줄이 바뀌었다 — 다음 조각에서 새로 만든다

    /* 앞 줄이 오른쪽 끝을 못 채웠거나 이 줄이 ∴·따라서로 시작하면
     * 거기서 끊긴 것이다 — 다음 조각은 새 줄에 담는다. */
    if (startsNew(line)) explanationLine = null;

    /* 곁다리 상자(「다른 풀이」·「참고」)는 **라벨 아래 전부**를 덮는다.
     *
     * 라벨을 만나는 순서로만 보면 늦다. 0164의 「다른 풀이」 라벨은 7pt라
     * 옆의 두 줄짜리 괄호 조각(10pt) 줄에 위첨자로 흡수되고, 그 줄은 표보다
     * **뒤에** 처리된다 — 그 사이에 세로셈이 통째로 **정답 칸**으로 들어갔다.
     * 정답 칸은 학생 채점에 바로 쓰이는 자리다.
     *
     * 그래서 순서가 아니라 **자리**로 끊는다. 라벨이 어디 있는지는 줄을
     * 세우기 전에 이미 알 수 있다. */
    if (
      inAnswer &&
      asideMarks.some((m) => m.column === line.column && line.y >= m.y - 2)
    ) {
      answerClosed = true;
    }

    for (const span of line.spans) {
      const cleaned = cleanBodyText(span.text);

      // 문항 번호 — 새 항목의 시작
      if (
        profile.numberFont.test(span.font) &&
        span.size >= profile.numberMinSize
      ) {
        // 번호는 두 span으로 쪼개져 온다. 직전 항목이 번호만 받은 상태면 이어 붙인다.
        const digits = cleaned.trim();
        if (/^\d{1,4}$/.test(digits)) {
          if (current && current.explanation.length === 0 && current.answer.length === 0 &&
              current.printedNumber.length + digits.length <= 4) {
            current.printedNumber += digits;
          } else {
            current = { printedNumber: digits, page: page.page, answer: [], explanation: [], rubric: [], strategy: [] };
            inAnswer = false;
            answerClosed = false;
            inRubric = false;
            explanationLine = null;
            /* 번호는 「전략」보다 **앞에** 온다(같은 기준선). 여기서 무조건
             * 끄면 방금 줄 단위로 세운 상태가 지워져 전략이 그대로 들어온다.
             * 이 줄에 전략 라벨이 있었는지로 다시 정한다. */
            inStrategy = isStrategyLabel(line);
            lastX1 = Number.NEGATIVE_INFINITY;
            out.push(current);
          }
          continue;
        }
      }

      if (!current) continue;
      /* 전략 상자 안의 글자는 해설에 담지 않는다 — 대신 strategy에 모아
       * 무엇을 뺐는지 볼 수 있게 한다 (번호는 위에서 이미 처리됐다). */
      if (inStrategy) {
        if (cleanBodyText(span.text).trim() !== "전략") {
          push(strategyTarget(), cleanBodyText(span.text), profile.mathFont.test(span.font), span.text, span.x0, span.x1, span.font, span.chars, span.size);
        }
        continue;
      }

      // 「답」 표식 — 여기서부터가 정답이다
      if (profile.answerLabelFont.test(span.font) && cleaned.includes("답")) {
        inAnswer = true;
        continue;
      }

      /* 「답 ①」 뒤에 「참고 2=2¹이다.」 같은 상자가 이어진다. 그대로 두면
       * 정답이 「①참고2=2^{1}이다.」가 된다 — 객관식은 기호만 뽑아 살아남지만
       * 단답형은 그대로 오답 판정으로 이어진다. */
      if (inAnswer && (ASIDE.test(cleaned.trim()) || PAGE_REF.test(cleaned.trim()))) {
        answerClosed = true;
      }

      /* 서술형 채점 기준표 — 답 뒤에 이어 붙는다. 답에 섞이면 정답이
       * 「8단계채점 요소비율1504를 소인수분해 하기60 %」가 된다.
       * 버리지 않고 rubric으로 돌린다. */
      if (inAnswer && RUBRIC_HEAD.test(cleaned.trim())) inRubric = true;

      if (inAnswer && answerClosed && !inRubric) continue;

      const target = inRubric
        ? current.rubric
        : inAnswer
          ? current.answer
          : explanationTarget();
      push(
        target,
        cleaned,
        profile.mathFont.test(span.font),
        span.text,
        span.x0,
        span.x1,
        span.font,
        span.chars,
        span.size,
        (span as MaybeStacked).stacked,
        (span as MaybeStacked).tableLatex,
        (span as MaybeStacked).systemRows,
      );
    }
    /* 이 줄이 오른쪽 끝을 못 채웠다면 여기서 끊긴 것이다 */
    if (!inAnswer && !inRubric && endsHere(line)) explanationLine = null;
  }

  /* 이어 붙이기가 끝난 뒤 텍스트 조각을 손질한다 — 양쪽 정렬이 벌려 놓은
   * 공백이 「공약수는   (2+1)×(1+1)」처럼 한가운데를 뚫어 놓는다. */
  for (const entry of out) {
    for (const group of [entry.answer, ...entry.explanation, ...entry.strategy, entry.rubric]) {
      for (const run of group) {
        if (run.kind === "text") run.text = tidyBodyText(run.text);
      }
    }
  }

  /* 번호가 네 자리로 완성되지 않은 것은 버린다 — 쪽 번호·각주가 섞인 것이다 */
  return out.filter((a) => /^\d{4}$/.test(a.printedNumber));
}

export function parseAnswers(
  dump: SourceDump,
  profile: AnswerProfile,
): Map<string, ParsedAnswer> {
  const byNumber = new Map<string, ParsedAnswer>();
  /* 답을 못 받은 채 쪽이 끝나면 다음 쪽으로 넘긴다. **답이 이미 있으면
   * 넘기지 않는다** — 새 대단원이 시작하는 쪽의 머리글이 멀쩡한 항목에
   * 달라붙지 않게 하는 최소한의 울타리다. */
  let carry: ParsedAnswer | null = null;
  for (const page of dump.pages) {
    const parsedPage = parseAnswerPage(page, profile, carry);
    for (const parsed of parsedPage) {
      // 같은 번호가 두 번 나오면 앞엣것을 남긴다 (뒤는 「다시 풀기」 참조다)
      if (!byNumber.has(parsed.printedNumber)) byNumber.set(parsed.printedNumber, parsed);
    }
    const last: ParsedAnswer | null = parsedPage[parsedPage.length - 1] ?? carry;
    carry = last && last.answer.length === 0 ? last : null;
  }
  /* 조각난 수식을 도로 붙인다 — **쪽을 다 읽은 뒤**에 한다. 쪽 안에서 하면
   * 다음 쪽으로 이어진 해설의 마지막 조각을 아직 못 본 상태다. */
  for (const entry of byNumber.values()) {
    entry.answer = mergeUnbalancedMath(entry.answer);
    entry.rubric = mergeUnbalancedMath(entry.rubric);
    entry.explanation = entry.explanation.map(mergeUnbalancedMath);
    entry.strategy = entry.strategy.map(mergeUnbalancedMath);
  }
  return byNumber;
}

/** 조각들을 사람이 읽을 한 줄로 (검수 화면·로그용) */
export function renderRuns(runs: Run[]): string {
  return runs
    .map((r) => (r.kind === "text" ? r.text : `$${r.latex}$`))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
