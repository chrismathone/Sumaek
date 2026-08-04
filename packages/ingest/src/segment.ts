import {
  cleanBodyText,
  decodeHwpMath,
  joinKorean,
  joinLatex,
  arcFirstName,
  isArcOnly,
  overlineLastName,
  radicalPiece,
  isOverlineOnly,
  mergeRaised,
  markSuperscripts,
  mergeUnbalancedMath,
} from "./hwp-encoding";
import { isInvisibleInk } from "./ink";
import type { ExtractionProfile } from "./profiles/types";
import type {
  ChoiceItem,
  RunningHead,
  ConditionItem,
  ExtractedQuestion,
  PageDump,
  PageExtraction,
  Rect,
  Run,
  Span,
  TypeContext,
} from "./types";

/* ─────────────────────────────────────────────────────────────
 * 지면 → 문항.
 *
 * 이 파일이 조심하는 것은 **조용한 누락**이다. 문항을 그럴듯하게 만들어
 * 놓고 지면의 한 줄을 흘리면, 결과물만 봐서는 알 수 없다. 그래서 모든
 * span은 셋 중 하나로 반드시 분류된다: 어떤 문항에 들어갔거나, 문항이
 * 아닌 것으로 알려진 영역(머리글·유형 머리말·쪽번호)이거나, **미분류**다.
 * 미분류가 곧 손실이고, 채점기가 그 수를 센다.
 * ───────────────────────────────────────────────────────────── */

interface IndexedSpan extends Span {
  index: number;
  /** 2행 분수로 합쳐진 span — 분자·분모 원본을 함께 들고 있는다 */
  stacked?: { numerator: IndexedSpan; denominator: IndexedSpan };
  /** 연립방정식으로 합쳐진 span — 중괄호 오른쪽의 각 줄 */
  system?: IndexedSpan[][];
  /** 이 span이 대표하는 다른 원본 span의 인덱스 (커버리지 계산용) */
  alsoIndexes?: number[];
}

/**
 * 2행 분수를 한 span으로 합친다.
 *
 * 조판기는 `110/n`을 분자·분모 두 span으로 나누고 그 사이에 가로 막대를
 * 그린다. 막대는 벡터라 텍스트 레이어에 없다. 그대로 두면 분자들이 한 줄,
 * 분모들이 다른 줄로 갈라져 「110 220 275 세 수 , , 를 … n n n」처럼
 * 뒤섞인다 — 문항 0192가 실제로 그렇게 나왔다.
 *
 * 짝을 찾는 근거는 **막대 자체**다. 처음에는 막대 없이 「위아래로 가운데
 * 맞춰 붙어 있으면 분수」라고 했는데, 그러면 줄바꿈된 선택지 ①과 ④까지
 * 분수로 묶여 `\frac{2}{2}\frac{^{3}}{^{3}}` 같은 것이 쏟아졌다. 막대는
 * 분수에만 그려진다. 합친 span은 두 조각의 중간 높이에 놓아 본문 줄에
 * 자연스럽게 얹힌다.
 */
function mergeStackedFractions(
  spans: IndexedSpan[],
  page: PageDump,
  profile: ExtractionProfile,
  figures: readonly Rect[] = [],
): IndexedSpan[] {
  const math = spans.filter((s) => profile.fonts.math.test(s.font));
  const used = new Set<number>();
  const merged: IndexedSpan[] = [];

  /* 분수 막대 — 높이 0인 가로 선분이다. 이 막대를 근거로 삼는 것이 요점:
   * 기하만으로 「위아래로 가운데 맞춰 붙어 있으면 분수」라고 하면 선택지
   * ①과 ④ 같은 줄바꿈까지 분수로 묶어 버린다(실제로 그랬다). 막대는
   * 분수에만 그려진다.
   *
   * **도형 안의 가로선은 뺀다.** 삼각형의 밑변도 높이 0인 가로 선분이라,
   * 그 위아래의 꼭짓점 라벨이 분수가 됐다 — 중2-2 문항 0002의 발문에
   * 「A/x」가 나타났다. 도형과 분수는 같은 벡터로 그려지므로 생김새로는
   * 갈리지 않고, 갈라 주는 것은 「도형 뭉치 안이냐」다. */
  const bars = page.drawings.filter(
    (d) =>
      d.y1 - d.y0 < 1.5 &&
      d.x1 - d.x0 >= 3 &&
      !figures.some(
        (f) => d.x0 >= f.x0 - 2 && d.x1 <= f.x1 + 2 && d.y0 >= f.y0 - 2 && d.y1 <= f.y1 + 2,
      ),
  );

  for (const bar of bars) {
    const within = (s: IndexedSpan): boolean =>
      s.x0 >= bar.x0 - 2 && s.x1 <= bar.x1 + 2;
    /* 위·아래는 span의 **가운데**로 가른다. 끝점으로 재면 세로로 큰
     * span이 탈락한다 — 문항 0049 선택지 ⑤의 분모 `2×2×5×5×5`는 높이가
     * 18pt(글자는 10.5pt)라 막대보다 위에서 시작해, 짝을 못 찾고 분자만
     * 홀로 남았다. 가운데가 어느 쪽인지가 분자·분모를 가르는 사실이다. */
    const near = (center: number, edge: number): boolean =>
      Math.abs(center - edge) <= 16;
    const above = math
      .filter((s) => {
        const center = (s.y0 + s.y1) / 2;
        return !used.has(s.index) && within(s) && center < bar.y0 && near(center, bar.y0);
      })
      .sort((a, b) => b.y1 - a.y1);
    const below = math
      .filter((s) => {
        const center = (s.y0 + s.y1) / 2;
        return !used.has(s.index) && within(s) && center > bar.y1 && near(center, bar.y1);
      })
      .sort((a, b) => a.y0 - b.y0);

    const numerator = above[0];
    const denominator = below[0];
    if (!numerator || !denominator) continue;
    used.add(numerator.index);
    used.add(denominator.index);
    merged.push({
      ...numerator,
      text: `${numerator.text}/${denominator.text}`,
      x0: Math.min(numerator.x0, denominator.x0),
      x1: Math.max(numerator.x1, denominator.x1),
      y0: numerator.y0,
      // 본문 줄에 얹히도록 두 조각의 가운데 높이로 놓는다
      y1: (numerator.y1 + denominator.y1) / 2,
      stacked: { numerator, denominator },
      alsoIndexes: [denominator.index],
    });
  }

  if (merged.length === 0) return spans;
  return [...spans.filter((s) => !used.has(s.index)), ...merged];
}

/**
 * 연립방정식을 한 span으로 합친다.
 *
 * 지면의 `{ x+y=8 / 3x+y=16 }`은 덤프에서 세 조각으로 온다 — 세로로 늘인
 * 중괄호 하나, 그 오른쪽 위의 식, 오른쪽 아래의 식. 파서는 가로로 맞닿은
 * 것만 잇고 줄이 다르면 따로 두므로, 그대로 두면 두 식이 **다른 줄의
 * 조각으로 흩어진다.** 그런데 중괄호가 짝이 안 맞는 채 끝나는 바람에
 * mergeUnbalancedMath가 둘을 이어 붙였고, 결과가 `x+y=83x+y=16`이 됐다.
 * 렌더도 실패하지만 **더 나쁜 것은 8과 3이 붙어 83이 된 것이다** — 렌더가
 * 우연히 통과했다면 학생은 없는 식을 풀었을 것이다(중2-1 IV단원 84건).
 *
 * 가르는 근거는 **중괄호의 생김새**다. 이 글꼴의 큰 중괄호는 폭이 글자
 * 크기의 절반뿐인데 높이는 두 배가 넘는다(w 5.0 · h 23.9 · size 10.2).
 * 본문의 여는 중괄호(집합 기호)는 그렇지 않다 — 높이가 글자 크기 언저리다.
 * 그래서 「좁고 길쭉한 것」만 연립의 괄호로 본다.
 */
function mergeEquationSystems(
  spans: IndexedSpan[],
  profile: ExtractionProfile,
): IndexedSpan[] {
  const math = spans.filter((s) => profile.fonts.math.test(s.font));

  /* **span 상자가 아니라 글자 상자로 잰다.**
   *
   * 괄호 span에 공백이 딸려 오는 자리가 있다(`'[ '`). span 폭으로 재면
   * 9.6pt가 되어 「좁다」는 조건에서 탈락하고, x1이 오른쪽으로 밀려 바로
   * 옆의 식이 「괄호 왼쪽」으로 보인다 — 중2-1 p.91 선택지가 통째로
   * 그랬다. 공백은 잉크가 아니다. */
  const ink = (s: IndexedSpan): { x0: number; x1: number } => {
    const glyphs = [...s.text];
    if (!s.chars || s.chars.length !== glyphs.length) return { x0: s.x0, x1: s.x1 };
    const boxes = s.chars.filter((_, i) => glyphs[i]!.trim() !== "");
    if (boxes.length === 0) return { x0: s.x0, x1: s.x1 };
    return {
      x0: Math.min(...boxes.map((b) => b[0])),
      x1: Math.max(...boxes.map((b) => b[2])),
    };
  };
  /* 「좁고 길쭉하다」만으로는 부족하다. 분수를 감싸는 **키 큰 소괄호**가
   * 같은 생김새로 온다 — `(y/x)³`의 괄호도 폭 5pt에 높이 24pt다. 그것까지
   * 받았더니 지수가 통째로 연립이 됐다(`\begin{cases}y \\ \right) \\ x³\end{cases}²`,
   * II단원 13건). 그래서 **여는 중괄호로 읽히는 글리프**만 받는다.
   * EHSunm은 큰 중괄호를 세로로 서너 조각 내어 보내는 전용 글꼴이라 통째로
   * 받고, 조각은 아래에서 하나로 잇는다. */
  const isBracePiece = (s: IndexedSpan): boolean => {
    const box = ink(s);
    if (s.text.trim().length > 2) return false;
    if (box.x1 - box.x0 >= s.size * 0.9) return false;
    if (s.y1 - s.y0 <= s.size * 1.6) return false;
    if (/^EHSunm/.test(s.font)) return true;
    return decodeHwpMath(s.text, s.font).latex.trim() === "\\left\\{";
  };

  /** 세로로 잇닿은 조각들을 한 괄호로 잇는다 (EHSunm은 `(`+`{`+`¥9` 세 조각) */
  const braces: { pieces: IndexedSpan[]; x1: number; y0: number; y1: number }[] = [];
  for (const s of math
    .filter(isBracePiece)
    .sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)) {
    const last = braces[braces.length - 1];
    if (
      last &&
      Math.abs(last.pieces[0]!.x0 - s.x0) <= 1 &&
      s.y0 <= last.y1 + 2
    ) {
      last.pieces.push(s);
      last.x1 = Math.max(last.x1, ink(s).x1);
      last.y1 = Math.max(last.y1, s.y1);
      continue;
    }
    braces.push({ pieces: [s], x1: ink(s).x1, y0: s.y0, y1: s.y1 });
  }

  const used = new Set<number>();
  const merged: IndexedSpan[] = [];

  for (const braceInk of braces) {
    const brace = braceInk.pieces[0]!;
    if (used.has(brace.index)) continue;
    /* 괄호 오른쪽에 바싹 붙어, 괄호가 덮는 세로 띠 안에 있는 수식만 본다 */
    const pieceIndexes = new Set(braceInk.pieces.map((p) => p.index));
    const inside = math.filter((s) => {
      if (used.has(s.index) || pieceIndexes.has(s.index)) return false;
      const center = (s.y0 + s.y1) / 2;
      return (
        s.x0 >= braceInk.x1 - 2 &&
        s.x0 <= braceInk.x1 + 14 &&
        center > braceInk.y0 - 4 &&
        center < braceInk.y1 + 4
      );
    });
    if (inside.length < 2) continue;

    /* 줄로 나눈다 — 세로 가운데가 글자 크기의 절반 안이면 같은 줄이다 */
    const rows: IndexedSpan[][] = [];
    for (const s of [...inside].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
      const center = (s.y0 + s.y1) / 2;
      const row = rows[rows.length - 1];
      const rowCenter = row ? (row[0]!.y0 + row[0]!.y1) / 2 : Number.NaN;
      if (row && Math.abs(center - rowCenter) <= s.size * 0.6) row.push(s);
      else rows.push([s]);
    }
    if (rows.length < 2) continue;

    for (const row of rows) for (const s of row) used.add(s.index);
    for (const p of braceInk.pieces) used.add(p.index);
    const all = rows.flat();
    merged.push({
      ...brace,
      text: rows.map((r) => r.map((s) => s.text).join("")).join(" | "),
      x0: brace.x0,
      x1: Math.max(...all.map((s) => s.x1)),
      /* 본문 줄에 얹히도록 각 줄 아래끝의 평균에 놓는다. 괄호 상자의
       * 가운데로 놓았더니 선택지 표식(①②)보다 7pt 위에 서서 **다른 줄이
       * 됐고**, 그 줄에는 표식이 없으므로 두 연립이 통째로 앞 선택지에
       * 딸려 들어갔다(p.91 0621에서 ①③⑤가 비었다). 2행 분수가 같은
       * 이유로 같은 자리를 쓴다. */
      y0: rows[0]![0]!.y0,
      y1: rows.reduce((sum, r) => sum + Math.max(...r.map((s) => s.y1)), 0) / rows.length,
      system: rows.map((r) => [...r].sort((a, b) => a.x0 - b.x0)),
      /* 대표 span의 index는 첫 조각 것이므로, 나머지 괄호 조각까지 여기
       * 적어야 커버리지가 「미분류」로 세지 않는다 — EHSunm은 괄호 하나가
       * 조각 셋이라 이걸 빠뜨리면 연립 한 개마다 둘씩 새어 나간다. */
      alsoIndexes: [
        ...braceInk.pieces.slice(1).map((p) => p.index),
        ...all.map((s) => s.index),
      ],
    });
  }

  if (merged.length === 0) return spans;
  return [...spans.filter((s) => !used.has(s.index)), ...merged];
}

interface Line {
  /** 기준선 (span 아래끝) */
  y: number;
  /** 줄이 차지한 세로 띠 — 위첨자를 흡수할 때 쓴다 */
  top: number;
  bottom: number;
  /** 줄의 대표 글자 크기 (가장 큰 것) */
  size: number;
  column: number;
  spans: IndexedSpan[];
}

/** 인접한 같은 폰트·같은 크기의 span을 붙인다 — 「0」+「131」 → 「0131」 */
function mergeAdjacent(spans: IndexedSpan[]): IndexedSpan[][] {
  const groups: IndexedSpan[][] = [];
  for (const span of spans) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (
      prev &&
      prev.font === span.font &&
      Math.abs(prev.size - span.size) < 0.05 &&
      span.x0 - prev.x1 < 1.2
    ) {
      last!.push(span);
      continue;
    }
    groups.push([span]);
  }
  return groups;
}

const groupText = (g: IndexedSpan[]): string => g.map((s) => s.text).join("");

/** 문항 번호 후보인가 — 제어문자를 털고 본다 (「0」+「187 \b」 꼴이 온다) */
function questionNumberOf(
  group: IndexedSpan[],
  profile: ExtractionProfile,
): string | null {
  const head = group[0]!;
  if (!profile.fonts.questionNumber.font.test(head.font)) return null;
  if (head.size < profile.fonts.questionNumber.minSize) return null;
  const text = cleanBodyText(groupText(group)).trim();
  return profile.patterns.questionNumber.test(text) ? text : null;
}

/**
 * 쪽마다 단 수를 알아낸다.
 *
 * 이 교재는 쪽 종류에 따라 단이 다르다 — 「유형 익히기」는 2단이지만
 * 「개념 익히기」는 2단 안에 다시 2열 격자가 들어가 사실상 4단이다.
 * 프로파일에 2단이라고 못 박아 두었더니 격자 쪽에서 **한 줄에 놓인 두
 * 문항 중 뒤엣것을 통째로 흘렸다**(0002·0004·0006 …).
 *
 * 문항 번호가 찍힌 x좌표를 모아 뭉치면 그것이 곧 단의 시작점이다.
 * 조판이 무엇이든 번호는 단 머리에 온다.
 */
function detectColumnEdges(
  spans: IndexedSpan[],
  profile: ExtractionProfile,
  pageWidth: number,
): number[] {
  const xs: number[] = [];
  const sorted = [...spans].sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0);
  for (const group of mergeAdjacent(sorted)) {
    if (questionNumberOf(group, profile) !== null) xs.push(group[0]!.x0);
  }

  const clusters: number[] = [];
  for (const x of xs.sort((a, b) => a - b)) {
    const last = clusters[clusters.length - 1];
    if (last === undefined || x - last > 25) clusters.push(x);
  }

  if (clusters.length < 2) {
    const width = pageWidth / profile.layout.columns;
    return Array.from({ length: profile.layout.columns }, (_, i) => i * width);
  }
  /* 번호가 찍힌 x는 단의 **왼쪽 끝**이다. 앞 단과의 중점으로 경계를 잡으면
   * 경계가 왼쪽으로 밀려 선택지 ③이 옆 단으로 넘어간다 — 실제로 그랬다.
   * 번호 x 바로 앞을 경계로 삼는다. */
  return clusters.map((x, i) => (i === 0 ? 0 : x - 6));
}

/**
 * 줄의 앞쪽에서, **큰 틈이 나오기 전까지**의 span만 취한다.
 *
 * 단을 무시하고 세운 줄에는 옆 단의 내용이 같은 기준선으로 딸려 온다.
 * 글자 사이 틈은 몇 pt지만 단 사이 틈은 수십 pt다. 문항 번호를 만나도 끊는다
 * — 거기서부터는 다른 문항이다.
 */
function takeContiguous(
  spans: IndexedSpan[],
  profile: ExtractionProfile,
): IndexedSpan[] {
  const out: IndexedSpan[] = [];
  /* 병합 **그룹** 단위로 본다. 문항 번호는 「000」+「3」처럼 쪼개져 오므로
   * span 하나씩 보면 어느 쪽도 네 자리가 아니어서 번호인 줄 모르고 지나친다
   * — 그렇게 문항 0003이 지시문에 먹혔다. */
  for (const group of mergeAdjacent(spans)) {
    const prev = out[out.length - 1];
    if (prev && group[0]!.x0 - prev.x1 > 25) break;
    if (questionNumberOf(group, profile) !== null) break;
    out.push(...group);
  }
  return out;
}

function boundsOf(spans: { x0: number; y0: number; x1: number; y1: number }[]): Rect {
  return {
    x0: Math.min(...spans.map((s) => s.x0)),
    y0: Math.min(...spans.map((s) => s.y0)),
    x1: Math.max(...spans.map((s) => s.x1)),
    y1: Math.max(...spans.map((s) => s.y1)),
  };
}

/**
 * span을 줄로 묶는다.
 *
 * 아래끝(y1)을 기준선으로 쓰되, **위첨자를 놓치지 않는 것이 요점이다.**
 * `2^a×3^b`의 a·b는 크기가 절반이고 6pt쯤 위에 앉는다. 기준선만 보면
 * 다른 줄로 갈라지고, 줄 순서상 앞으로 튀어 「ab세 수 2×3」처럼 된다 —
 * 실제로 그렇게 뽑혔다. 작고 윗줄에 걸친 span은 그 줄의 세로 띠 안에
 * 들어오면 같은 줄로 흡수한다.
 */
function toLines(
  spans: IndexedSpan[],
  profile: ExtractionProfile,
  columnOf: (s: Span) => number,
): Line[] {
  const lines: Line[] = [];
  /* 큰 글자부터 넣어 줄의 띠를 먼저 세운다. 작은 위첨자가 먼저 들어와
   * 자기만의 줄을 만들어 버리면 흡수할 대상이 없다. */
  const sorted = [...spans].sort((a, b) => b.size - a.size || a.y1 - b.y1 || a.x0 - b.x0);
  for (const span of sorted) {
    const column = columnOf(span);
    const center = (span.y0 + span.y1) / 2;
    const line = lines.find((l) => {
      if (l.column !== column) return false;
      if (Math.abs(l.y - span.y1) <= profile.layout.lineToleranceY) return true;
      // 위첨자·아래첨자: 작고, 줄의 세로 띠 안에 든다
      if (span.size < l.size * 0.8 && center > l.top && center < l.bottom) return true;
      /* 문항 번호만 있는 줄에는 아무것도 흡수시키지 않는다.
       *
       * 번호는 글자가 커서(14pt) 세로 띠가 넓다. 아래 분수 규칙이 그 띠에
       * 걸린 분수를 끌어들이면 줄의 바닥이 본문까지 내려가고, 그 다음엔
       * 위첨자 규칙이 본문 전체를 빨아들인다. 그러면 줄의 첫 덩어리가
       * 번호가 아니라 「0가은이는…」이 되어 **문항 하나가 통째로 앞 문항의
       * 발문이 된다**(중2-1 p.110 0752). 번호는 혼자 서야 한다. */
      if (l.spans.every((s) => profile.fonts.questionNumber.font.test(s.font))) {
        return false;
      }
      /* 인라인 분수는 크기가 같아도 **기준선이 아래로 내려간다**. 별책
       * 파서는 이미 이렇게 하고 있었는데 본책 파서에는 없어서, 문항 0049
       * 선택지 ④가 `$\times$$\times$…` 다음에 분수 다섯 개가 오는 꼴로
       * 순서째 뒤집혔다. 세로로 겹치면 같은 줄로 본다. */
      return (
        profile.fonts.inlineFraction.test(span.font) &&
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
  return lines.sort((a, b) => a.column - b.column || a.y - b.y);
}

/**
 * 한 줄의 span을 본문 조각으로 옮긴다 — 수식 폰트면 해독, 아니면 한글.
 *
 * 수식은 **인접한 것끼리 한 덩어리로 묶는다.** 조판기는 한 수식을 여러
 * span으로 쪼개 놓는다: `2³×3³`이 「2」(Italic) + 「Ü`」(Plain) + 「_3Ü`」로
 * 세 조각이다. 폰트가 다르다고 따로 두면 `$2$$^{3}$`처럼 파편이 된다.
 *
 * 묶는 기준은 **x가 이어지는가**다 — 조판기가 붙여 놓은 것은 좌표가 붙어
 * 있다. 크기가 작고 위로 올라앉은 조각은 위첨자로 본다 (`2^a`의 a).
 */
function toRuns(spans: IndexedSpan[], profile: ExtractionProfile): Run[] {
  const runs: Run[] = [];
  const isMath = (s: IndexedSpan): boolean => profile.fonts.math.test(s.font);
  const ordered = [...spans].sort((a, b) => a.x0 - b.x0);

  let i = 0;
  while (i < ordered.length) {
    const head = ordered[i]!;

    if (isMath(head)) {
      const cluster: IndexedSpan[] = [head];
      let j = i + 1;
      while (j < ordered.length) {
        const next = ordered[j]!;
        if (!isMath(next)) break;
        if (next.x0 - cluster[cluster.length - 1]!.x1 > 1.5) break;
        cluster.push(next);
        j += 1;
      }

      /* 덩어리의 기준 크기·기준선. 위첨자는 이보다 작고 위에 있다. */
      const baseSize = Math.max(...cluster.map((c) => c.size));
      const baseY1 = Math.max(...cluster.map((c) => c.y1));

      let raw = "";
      let latex = "";
      const unknown: string[] = [];
      /** 호 기호가 따로 서서 씌울 글자를 기다리는 중인가 */
      let pendingArc = false;
      for (const span of cluster) {
        if (isArcOnly(span.text)) {
          raw += span.text;
          pendingArc = true;
          continue;
        }
        /* 윗줄 글리프만 담긴 조각 — 씌울 글자를 찾아 준다. 앞의 조각과
         * 이미 이어졌으면 그 결과에, 이 덩어리가 윗줄로 시작하면 바로 앞
         * 수식 조각에 씌운다. 혼자서는 아무 뜻이 없고, 그냥 두면 화면에
         * 낯선 글자가 나가면서 선분 표시는 사라진다. */
        /* 근호는 글자가 아니라 가구다 — 폭으로 여닫이를 가린다.
         * `\sqrt{`와 `}`가 서로 다른 조각에 있으므로 중괄호 깊이가
         * 맞을 때까지 mergeUnbalancedMath가 이어 준다. */
        const radical = radicalPiece(
          span.text,
          span.font,
          span.chars?.[0] ? span.chars[0][2] - span.chars[0][0] : undefined,
        );
        if (radical !== null) {
          raw += span.text;
          latex =
            radical.latex === "}"
              ? latex + radical.latex
              : joinLatex(latex, radical.latex);
          /* 끝을 모르는 근호는 미해독으로 올린다 — 검수함으로 가야 한다 */
          if (!radical.certain) unknown.push(span.text);
          continue;
        }
        if (isOverlineOnly(span.text)) {
          raw += span.text;
          if (latex !== "") {
            latex = overlineLastName(latex);
          } else {
            const owner = [...runs].reverse().find((r) => r.kind === "math");
            if (owner?.kind === "math") owner.latex = overlineLastName(owner.latex);
          }
          continue;
        }
        if (span.system) {
          /* `\begin{cases}`는 왼쪽에 큰 중괄호를 세우고 줄을 왼끝으로
           * 맞춘다 — 지면 그대로다. 줄 사이는 `\\`로 가른다. */
          const rows = span.system.map((row) =>
            row
              .map((s) => decodeHwpMath(markSuperscripts(s.text, s.chars), s.font))
              .reduce(
                (acc, d) => {
                  unknown.push(...d.unknown);
                  return { latex: joinLatex(acc.latex, d.latex) };
                },
                { latex: "" },
              ).latex,
          );
          raw += span.text;
          latex = joinLatex(
            latex,
            `\\begin{cases}${rows.join(" \\\\ ")}\\end{cases}`,
          );
          continue;
        }
        if (span.stacked) {
          const top = decodeHwpMath(span.stacked.numerator.text, span.stacked.numerator.font);
          const bottom = decodeHwpMath(span.stacked.denominator.text, span.stacked.denominator.font);
          raw += span.text;
          unknown.push(...top.unknown, ...bottom.unknown);
          latex = joinLatex(latex, `\\frac{${top.latex}}{${bottom.latex}}`);
          continue;
        }
        const decoded = decodeHwpMath(markSuperscripts(span.text, span.chars), span.font);
        raw += span.text;
        unknown.push(...decoded.unknown);
        if (decoded.latex === "") continue;
        const raised =
          span.size < baseSize * 0.8 && span.y1 < baseY1 - baseSize * 0.1;
        /* 앞에 호 기호가 따로 서 있었으면 이 조각의 첫 선분 이름에 씌운다 */
        const piece = pendingArc ? arcFirstName(decoded.latex) : decoded.latex;
        pendingArc = false;
        /* 위첨자 조각은 앞의 지수 안으로 넣는다 — 조각마다 `^{}`를 씌우면
         * `^{2}^{+}^{3}`이 되어 KaTeX가 이중 위첨자로 실패한다 */
        latex = raised ? mergeRaised(latex, piece) : joinLatex(latex, piece);
      }
      if (latex !== "") runs.push({ kind: "math", raw, latex, unknown });
      i = j;
      continue;
    }

    const text = cleanBodyText(head.text);
    i += 1;
    if (text.trim() === "") continue;
    const last: Run | undefined = runs[runs.length - 1];
    if (last?.kind === "text") last.text = joinKorean(last.text, text);
    else runs.push({ kind: "text", text });
  }
  /* 2행 분수는 앞뒤로 틈이 벌어져 따로 떨어진다 — 그런데 그 앞이 `{-`로
   * 열린 채 끝났으면 같은 수식이다. 중괄호 깊이로 붙인다. */
  return mergeUnbalancedMath(runs);
}

/** 조각 배열을 마커 기준으로 쪼갠다 (①②③ 선택지, ㄱㄴㄷ 보기) */
function splitByMarker(
  spans: IndexedSpan[],
  profile: ExtractionProfile,
  isMarker: (s: IndexedSpan) => string | null,
): { marker: string; spans: IndexedSpan[] }[] {
  const out: { marker: string; spans: IndexedSpan[] }[] = [];
  for (const span of spans) {
    const marker = isMarker(span);
    if (marker) {
      out.push({ marker, spans: [] });
      continue;
    }
    out[out.length - 1]?.spans.push(span);
  }
  return out;
}

/** 벡터 도형을 뭉치로 묶는다 — 밑줄·괄호 같은 장식은 걸러 낸다 */
function figureClusters(page: PageDump, area: Rect, profile: ExtractionProfile): Rect[] {
  const inside = page.drawings.filter(
    (d) => d.x0 >= area.x0 - 4 && d.x1 <= area.x1 + 4 && d.y0 >= area.y0 && d.y1 <= area.y1,
  );
  const clusters: { rect: Rect; count: number }[] = [];
  for (const d of inside) {
    const hit = clusters.find(
      (c) =>
        d.x0 <= c.rect.x1 + profile.figures.clusterGap &&
        d.x1 >= c.rect.x0 - profile.figures.clusterGap &&
        d.y0 <= c.rect.y1 + profile.figures.clusterGap &&
        d.y1 >= c.rect.y0 - profile.figures.clusterGap,
    );
    if (hit) {
      hit.rect = boundsOf([hit.rect, d]);
      hit.count += 1;
    } else {
      clusters.push({ rect: { ...d }, count: 1 });
    }
  }

  /* **한 번 훑는 것으로는 부족하다.**
   *
   * 선분을 만나는 순서에 따라 한 도형이 여러 뭉치로 갈린다 — 왼쪽 변을
   * 먼저 만나 뭉치 A가 서고, 오른쪽 변이 뭉치 B가 된 뒤, 그 둘을 잇는
   * 밑변이 A에만 붙는 식이다. 갈린 뭉치는 각각 12개를 못 넘겨 도형으로
   * 인정받지 못하고, 그러면 그 안의 치수 라벨이 발문으로 샌다(중2-2 도형
   * 단원). 겹치는 뭉치가 없어질 때까지 이어 붙인다. */
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < clusters.length && !merged; i += 1) {
      for (let j = i + 1; j < clusters.length && !merged; j += 1) {
        const a = clusters[i]!.rect;
        const b = clusters[j]!.rect;
        const gap = profile.figures.clusterGap;
        if (
          a.x0 <= b.x1 + gap &&
          a.x1 >= b.x0 - gap &&
          a.y0 <= b.y1 + gap &&
          a.y1 >= b.y0 - gap
        ) {
          clusters[i] = {
            rect: boundsOf([a, b]),
            count: clusters[i]!.count + clusters[j]!.count,
          };
          clusters.splice(j, 1);
          merged = true;
        }
      }
    }
  }

  return clusters
    .filter(
      (c) =>
        c.count >= profile.figures.minDrawings &&
        c.rect.x1 - c.rect.x0 >= profile.figures.minWidth &&
        c.rect.y1 - c.rect.y0 >= profile.figures.minHeight,
    )
    .map((c) => c.rect);
}

export function extractPage(page: PageDump, profile: ExtractionProfile): PageExtraction {
  /* 인덱스는 **거르기 전에** 매긴다 — 커버리지 계산이 `page.spans`의 자리를
   * 가리키므로, 걸러 낸 뒤에 매기면 번호가 밀려 엉뚱한 span을 짚는다. */
  const indexed: IndexedSpan[] = page.spans
    .map((s, index) => ({ ...s, index }))
    .filter((s) => !isInvisibleInk(s, page));

  const topLimit = page.height * profile.layout.topMarginRatio;
  const bottomLimit = page.height * profile.layout.bottomMarginRatio;

  const edges = detectColumnEdges(indexed, profile, page.width);
  const columnWidth = page.width / edges.length;
  /* 폭이 한 단을 넘는 span(여러 단에 걸친 지시문)은 시작점이 속한 단에
   * 넣는다. 중앙으로 판단하면 「[0007~0010] 다음 …」 같은 공통 지시문이
   * 엉뚱한 단으로 간다. */
  const columnOf = (s: Span): number => {
    const probe = s.x1 - s.x0 > columnWidth ? s.x0 + 1 : (s.x0 + s.x1) / 2;
    let column = 0;
    for (let i = 0; i < edges.length; i += 1) if (probe >= edges[i]!) column = i;
    return column;
  };

  /* 머리글·꼬리말은 문항이 아니다. 여기서 갈라 두지 않으면 첫 문항이
   * 쪽 번호와 단원명을 삼킨다. */
  const margin: IndexedSpan[] = [];
  const body: IndexedSpan[] = [];
  for (const span of indexed) {
    /* 구매자 워터마크는 본문 한가운데에도 찍힌다 — 여백 규칙으로는 안 잡힌다.
     * 실제로 문항 0205 발문 끝에 이메일 주소가 붙어 나왔다. */
    if (profile.patterns.purchaserStamp.test(span.text)) margin.push(span);
    else if (span.y1 < topLimit || span.y0 > bottomLimit) margin.push(span);
    else body.push(span);
  }

  /* 도형 뭉치는 쪽 단위로 미리 잡는다. 문항을 먼저 만들고 나서 잡으면
   * 도형 안의 치수 라벨(「90 cm」 「120 cm」)이 이미 발문에 섞여 버린 뒤다 —
   * 문항 0148이 그랬다. 라벨은 그림의 일부이지 발문이 아니다. */
  const pageFigures = figureClusters(
    page,
    { x0: 0, y0: topLimit, x1: page.width, y1: bottomLimit },
    profile,
  );

  /* 연립을 먼저 합친다 — 그 안에 2행 분수가 들어 있으면 분수 쪽이 먼저
   * 가져가 버려 연립의 한 줄이 비기 때문이다 */
  const prepared = mergeStackedFractions(
    mergeEquationSystems(body, profile),
    page,
    profile,
    pageFigures,
  );
  const lines = toLines(prepared, profile, columnOf);

  /* 공통 지시문은 **단을 가로지른다.** 단으로 나눈 뒤에 찾으면
   * 「다음 수가 소수이면 ◯」과 「안에 써넣으시오.」가 서로 다른 단으로
   * 갈라져 가운데 토막이 사라진다 — 실제로 그렇게 잘렸다.
   * 그래서 단 구분 없이 한 번 더 줄을 세워 지시문만 먼저 건진다. */
  const fullWidthLines = toLines(prepared, profile, () => 0);
  const instructionSpans = new Set<number>();
  const sharedInstructions: { from: number; to: number; runs: Run[] }[] = [];
  for (let i = 0; i < fullWidthLines.length; i += 1) {
    const line = fullWidthLines[i]!;
    const text = cleanBodyText(line.spans.map((s) => s.text).join("")).trim();
    const range = profile.patterns.sharedInstruction.exec(text);
    if (!range) continue;

    /* 같은 기준선에는 **옆 절반의 문항도 있다.** 단을 무시하고 줄을 세웠으니
     * 그대로 쓰면 「… ◯, 합성수이면 △를 ( ) 0019 16 0020 27 안에 써넣으시오」가
     * 된다. 지시문은 왼쪽에서 오른쪽으로 이어지다 큰 틈에서 끝난다 —
     * 그 틈에서 자른다. */
    /* 지시문이 오른쪽 절반에 있으면 같은 기준선의 **왼쪽 절반**이 줄의 앞을
     * 차지한다. 줄머리부터 자르면 엉뚱한 절반을 지시문으로 읽는다.
     * 「[」가 있는 span에서 시작한다. */
    const startIdx = line.spans.findIndex((s) => s.text.includes("["));
    const own = takeContiguous(
      startIdx >= 0 ? line.spans.slice(startIdx) : line.spans,
      profile,
    );
    const instructionX = own[0]?.x0 ?? 0;
    const runs = toRuns(own, profile);
    for (const s of own) instructionSpans.add(s.index);
    /* 「[0001~0006]」은 지면에서 묶음을 가리키는 표식이지 문제의 말이 아니다.
     * 학생 화면에 그대로 나가면 없는 문제 번호를 찾게 만든다. */
    const head = runs[0];
    if (head?.kind === "text") {
      head.text = head.text.replace(profile.patterns.sharedInstruction, "").trimStart();
    }
    /* 지시문이 다음 줄로 넘어가는 일이 잦다 (「… ( ) / 안에 써넣으시오.」).
     * 문항 번호로 시작하지 않는 바로 다음 줄까지만 이어 받는다. */
    /* 이미 문장이 끝났으면 이어받지 않는다.
     *
     * 「다음 수의 약수를 모두 구하시오.」는 그 자체로 완결이다. 그런데도 다음
     * 줄을 붙이다가 **첫 문항의 수를 지시문에 삼켰고**, 그 지시문이 0032~0035
     * 넷 모두에 붙어 네 문항이 전부 같은 수를 묻는 꼴이 됐다. 결과만 보면
     * 멀쩡해 보이고, 재현 검사에서 네 문항의 답이 똑같이 나와서야 드러났다. */
    const ended = /[.?!]$/.test(cleanBodyText(own.map((s) => s.text).join("")).trim());
    const next = ended ? undefined : fullWidthLines[i + 1];
    if (next) {
      // 이어지는 줄도 지시문이 시작한 x 언저리에서부터 읽는다
      const nextOwn = takeContiguous(
        next.spans.filter((s) => s.x0 >= instructionX - 12),
        profile,
      );
      /* 문항 번호가 **줄 어디에라도** 있으면 그 줄은 이미 문항의 것이다.
       * 「맨 앞에만 없으면 된다」로 봤더니 문항 0003이 지시문에 먹혔다. */
      const hasNumber = mergeAdjacent(
        next.spans.filter((s) => s.x0 >= instructionX - 12),
      ).some((g) => questionNumberOf(g, profile) !== null);
      const nextText = cleanBodyText(nextOwn.map((s) => s.text).join("")).trim();
      if (!hasNumber && !profile.patterns.sharedInstruction.test(nextText)) {
        runs.push(...toRuns(nextOwn, profile));
        for (const s of nextOwn) instructionSpans.add(s.index);
        i += 1;
      }
    }
    sharedInstructions.push({
      from: Number(range[1]),
      to: Number(range[2]),
      runs,
    });
  }

  /** 이 쪽 러닝헤드에서 읽은 계층 */
  const runningHead: RunningHead = {};

  /* 러닝헤드는 **여백에 있다.** 아래쪽 러닝헤드(짝수 쪽의 대단원, 홀수 쪽
   * 아래의 중단원)는 여백으로 먼저 걸러져 줄 루프에 닿지 않는다 —
   * 그래서 p.3의 「01 소인수분해」 하나가 단원 끝까지 끌려가 0207까지
   * 중단원 01로 만들었다. 여백에서 직접 읽는다. */
  const readRunningHead = (spans: IndexedSpan[]): void => {
    /* 여백 span을 기준선으로 묶는다 — 러닝헤드는 한 줄이다 */
    const rows = new Map<number, IndexedSpan[]>();
    for (const span of spans) {
      const key = [...rows.keys()].find((y) => Math.abs(y - span.y1) <= 4);
      if (key === undefined) rows.set(span.y1, [span]);
      else rows.get(key)!.push(span);
    }
    for (const row of rows.values()) {
      row.sort((a, b) => a.x0 - b.x0);
      const text = cleanBodyText(row.map((s) => s.text).join("")).trim();
      const chapter = /([IVX]+\s*[.·]\s*[가-힣][가-힣\s]*)/.exec(text);
      if (chapter && !runningHead.chapter) {
        runningHead.chapter = chapter[1]!.replace(/\s+/g, " ").trim();
      }
      const unitNo = row.find(
        (s) => profile.fonts.unitNumber.test(s.font) && /^\d{1,2}$/.test(s.text.trim()),
      );
      if (!unitNo || runningHead.unit) continue;
      const title = row
        .filter((s) => s.x0 > unitNo.x0 && /[가-힣]/.test(s.text))
        .map((s) => cleanBodyText(s.text))
        .join("")
        .trim();
      if (title !== "") runningHead.unit = { number: unitNo.text.trim(), title };
    }
  };
  readRunningHead(margin);
  const questions: ExtractedQuestion[] = [];
  /** 문항이 아닌 것으로 **분류에 성공한** span — 미분류와 구별해야 한다 */
  const nonQuestion = new Set<number>();
  /* 2행 분수로 합쳐진 span은 원본 둘을 대표한다. 대표 인덱스만 세면
   * 분모 쪽이 「미분류」로 남아 없는 누락이 있다고 보고된다. */
  const markNonQuestion = (s: IndexedSpan): void => {
    nonQuestion.add(s.index);
    for (const i of s.alsoIndexes ?? []) nonQuestion.add(i);
  };
  for (const s of margin) markNonQuestion(s);
  for (const i of instructionSpans) nonQuestion.add(i);

  let typeContext: TypeContext | null = null;
  /** 바로 앞 줄이 머리글이었나 — 두 줄로 넘어간 유형 제목을 잇는 데 쓴다 */
  let prevWasHeader = false;
  let pendingTextbookRef: string | null = null;

  /** 현재 문항이 모으는 줄들 */
  let current: { number: string; column: number; lines: Line[] } | null = null;

  /* 도형 뭉치는 쪽 단위로 미리 잡는다. 문항을 먼저 만들고 나서 잡으면
   * 도형 안의 치수 라벨(「90 cm」 「120 cm」)이 이미 발문에 섞여 버린 뒤다 —
   * 문항 0148이 그랬다. 라벨은 그림의 일부이지 발문이 아니다. */
  const flush = (): void => {
    if (!current) return;
    const built = buildQuestion(
      current,
      typeContext,
      page,
      profile,
      columnWidth,
      pageFigures,
    );
    const n = Number(built.printedNumber);
    const shared = sharedInstructions.find((i) => n >= i.from && n <= i.to);
    if (shared) {
      /* 지시문과 문항 본문 사이를 띄운다 — 안 띄우면 「말하시오.2⁵」가 된다.
       * **마지막 조각에만** 붙인다. 모든 조각에 붙였더니 줄바꿈으로 쪼개진
       * 낱말 사이가 벌어져 「구하 시오」 「아니 면」이 됐다. */
      const head = shared.runs.map((r, i) =>
        r.kind === "text" && i === shared.runs.length - 1
          ? { ...r, text: `${r.text.trimEnd()} ` }
          : r,
      );
      built.stem = [...head, ...built.stem];
    }
    questions.push(built);
    current = null;
  };

  for (const line of lines) {
    /* 단이 바뀌면 문항은 거기서 끝난다. 이걸 빠뜨리면 왼쪽 단 마지막
     * 문항이 오른쪽 단 머리말(유형 설명 상자)까지 삼킨다 — 실제로 그랬다. */
    if (current && line.column !== current.column) flush();

    const lineText = cleanBodyText(line.spans.map((s) => s.text).join("")).trim();
    /* 러닝헤드(「20 I. 소인수분해」)는 여백 비율만으로는 놓치는 쪽이 있다
     * — 쪽 번호가 y0=791.3에서 시작해 여백선을 걸친다. 쪽 번호 폰트가
     * 들어 있으면 그 줄은 통째로 문항이 아니다. */
    if (
      line.spans.some((s) => profile.fonts.pageNumber.test(s.font)) ||
      profile.patterns.runningHead.test(lineText)
    ) {
      /* 버리기 전에 **계층을 읽는다.** 짝수 쪽은 대단원(「20 I. 소인수분해」),
       * 홀수 쪽은 중단원(「02 최대공약수와 최소공배수 21」)을 싣는다.
       * 「중단원 마무리」 쪽에는 유형 머리글이 아예 없어서, 이 줄이 그
       * 문항들의 유일한 계층 단서다 — 그냥 버렸더니 51문항이 아무 개념에도
       * 걸리지 않았다. */
      const chapter = /([IVX]+\s*[.·]\s*[가-힣][가-힣\s]*)/.exec(lineText);
      if (chapter) runningHead.chapter = chapter[1]!.replace(/\s+/g, " ").trim();
      const unitNo = line.spans.find(
        (s) => profile.fonts.unitNumber.test(s.font) && /^\d{1,2}$/.test(s.text.trim()),
      );
      if (unitNo) {
        const title = line.spans
          .filter((s) => s.x0 > unitNo.x0 && /[가-힣]/.test(s.text))
          .map((s) => cleanBodyText(s.text))
          .join("")
          .trim();
        if (title !== "") {
          runningHead.unit = { number: unitNo.text.trim(), title };
        }
      }
      for (const s of line.spans) markNonQuestion(s);
      continue;
    }

    /* ── 공통 지시문 줄 → 문항이 아니라 번호 구간에 걸어 둔다.
     * 지시문이 다음 줄로 넘어가기도 하므로(「… ( ) / 안에 써넣으시오.」)
     * 뒤이어 오는 줄 중 문항 번호로 시작하지 않는 것을 이어 붙인다. */
    if (instructionSpans.has(line.spans[0]!.index)) {
      flush();
      continue;
    }

    const groups = mergeAdjacent(line.spans);
    const first = groups[0]!;

    // ── 문항 번호로 시작하는 줄 → 새 문항
    const number = questionNumberOf(first, profile);
    if (number !== null) {
      flush();
      current = { number, column: line.column, lines: [] };
      for (const s of first) markNonQuestion(s); // 번호 자체는 본문이 아니다
      const rest = line.spans.filter((s) => !first.includes(s));
      if (rest.length > 0) current.lines.push({ ...line, spans: rest });
      continue;
    }

    // ── 유형 머리글 (라벨·번호·제목·교과서 참조) → 문항이 아니라 맥락
    const fontsInLine = new Set(line.spans.map((s) => s.font));
    const isTypeHeader = [...fontsInLine].some(
      (f) =>
        profile.fonts.typeLabel.test(f) ||
        profile.fonts.typeNumber.test(f) ||
        profile.fonts.typeTitle.test(f),
    );
    const refText = cleanBodyText(line.spans.map((s) => s.text).join(""));
    const isTextbookRef = profile.patterns.textbookRef.test(refText);

    if (isTypeHeader || isTextbookRef) {
      /* 「유형」 라벨이 붙은 줄만 출제 유형이다. 같은 제목 폰트를 쓰지만
       * 라벨이 없는 줄은 **소단원 머리글**이다(「소수와 합성수」 「공약수와
       * 최대공약수」). 둘을 구별하지 않으면 소단원 머리글이 번호를 못 찾아
       * 통째로 버려지고, 「개념 익히기」 118문항이 개념 없이 남는다. */
      const hasTypeLabel = [...fontsInLine].some((f) =>
        profile.fonts.typeLabel.test(f),
      );

      /* 제목·번호는 **이 줄에서만** 모은다. 줄을 넘겨 누적했더니 서로 다른
       * 머리글 셋이 「소수와 합성수 소인수분해 소인수분해를 이용하여 약수
       * 구하기」 한 덩어리로 붙었다. */
      let lineNumber: string | null = null;
      let lineTitle = "";
      for (const group of groups) {
        const text = cleanBodyText(groupText(group)).trim();
        const font = group[0]!.font;
        if (profile.fonts.typeNumber.test(font) && /^\d{1,2}$/.test(text)) {
          lineNumber = text;
        } else if (profile.fonts.typeTitle.test(font) && text !== "") {
          lineTitle = lineTitle === "" ? text : `${lineTitle} ${text}`;
        }
      }
      if (isTextbookRef) pendingTextbookRef = refText.trim();

      /* TS가 이 지점의 typeContext를 null로 좁혀 버린다 (flush 클로저가 같은
       * 변수를 잡고 있어 흐름 분석이 끊긴다). 선언 타입을 그대로 쓴다. */
      const previous = typeContext as TypeContext | null;
      if (lineTitle !== "") {
        /* 유형 제목이 두 줄로 넘어가는 것이 있다 (「유형 04 최대공약수의 활용
         * / 일정한 양을 가능한 한 많은 사람에게 나누어 주기」). 바로 앞 줄도
         * 머리글이었고 이 줄엔 번호·라벨이 없으면 앞 제목의 뒷부분이다 —
         * 새 머리글로 보면 「한 많은 사람에게 나누어 주기」만 남는다. */
        if (previous !== null && prevWasHeader && !hasTypeLabel && lineNumber === null) {
          typeContext = { ...previous, title: `${previous.title} ${lineTitle}` };
        } else {
          typeContext = {
            /* 「유형」 라벨이 붙은 것만 출제 유형이다. 라벨 없이 제목만
             * 있는 줄은 소단원 머리글이다 — 개념 익히기 쪽이 그렇다. */
            kind: hasTypeLabel ? "type" : "section",
            number: lineNumber ?? "",
            title: lineTitle,
            textbookRef: pendingTextbookRef,
          };
        }
      } else if (lineNumber !== null && previous !== null) {
        // 번호만 따로 온 줄 — 바로 앞 머리글의 번호다
        typeContext = { ...previous, number: lineNumber };
      }
      prevWasHeader = true;
      for (const s of line.spans) markNonQuestion(s);
      continue;
    }
    prevWasHeader = false;

    /* ── 유형 설명 상자: 유형 머리글 뒤·첫 문항 앞의 줄들.
     * 개념 설명이지 문항이 아니다. 문항에 붙이면 발문이 오염된다. */
    if (!current) {
      for (const s of line.spans) markNonQuestion(s);
      continue;
    }

    current.lines.push(line);
  }
  flush();

  /* 커버리지 — 이 계산이 이 파일의 존재 이유다.
   * span 하나하나가 「문항에 들어갔다」거나 「문항이 아니라고 판단했다」
   * 중 하나로 설명돼야 한다. 설명되지 않은 것이 곧 조용한 누락이다. */
  const consumed = new Set<number>();
  for (const q of questions) for (const i of q.consumedSpanIndexes) consumed.add(i);
  const unaccounted = indexed.filter(
    (s) => !consumed.has(s.index) && !nonQuestion.has(s.index),
  );

  return {
    page: page.page,
    runningHead,
    questions,
    unaccounted,
    accountedNonQuestion: nonQuestion.size,
  };
}

function buildQuestion(
  current: { number: string; column: number; lines: Line[] },
  typeContext: TypeContext | null,
  page: PageDump,
  profile: ExtractionProfile,
  columnWidth: number,
  pageFigures: Rect[],
): ExtractedQuestion {
  const stem: Run[] = [];
  const choices: ChoiceItem[] = [];
  let conditionBox: { label: string; items: ConditionItem[] } | null = null;
  const consumed: number[] = [];

  type Mode = "stem" | "choices" | "condition";
  let mode: Mode = "stem";

  const markerOf = (s: IndexedSpan): string | null => {
    const t = s.text.trim();
    if (profile.patterns.choiceMarker.test(t)) return t;
    return null;
  };
  const conditionMarkerOf = (s: IndexedSpan): string | null => {
    const m = /^([ㄱ-ㅎ]|\([가-힣]\))\.?\s*$/.exec(s.text.trim());
    return m ? m[1]! : null;
  };

  /* 이 문항 영역에 걸친 도형. 그 안의 글자는 치수·꼭짓점 라벨이므로
   * 발문에서 뺀다 (그림의 대체 텍스트를 만들 때 다시 쓴다). */
  const figureBoxes = pageFigures.filter((f) =>
    current.lines.some((l) =>
      l.spans.some((s) => s.x0 >= f.x0 && s.x1 <= f.x1 && s.y0 >= f.y0 && s.y1 <= f.y1),
    ),
  );
  /* 치수 라벨은 그림의 **가장자리에 걸쳐** 놓인다(「90 cm」가 변 바깥으로
   * 반쯤 나온다). 완전 포함으로 보면 절반이 발문으로 새어 문항 0148처럼
   * 「오른쪽 90cm그림과 같이」가 된다. 글자의 중심이 그림 안이면 그림의
   * 것으로 본다. */
  const insideFigure = (s: IndexedSpan): boolean => {
    /* 도형 라벨 글꼴이면 기하를 볼 것도 없다 — 그 글꼴이 곧 「그림 안」이다.
     * 선이 성긴 도형은 벡터 뭉치로 안 잡혀 상자가 서지 않는다. */
    if (profile.fonts.figureLabel.test(s.font)) return true;
    const cx = (s.x0 + s.x1) / 2;
    const cy = (s.y0 + s.y1) / 2;
    return figureBoxes.some(
      (f) => cx >= f.x0 - 6 && cx <= f.x1 + 6 && cy >= f.y0 - 4 && cy <= f.y1 + 4,
    );
  };
  const figureLabels: string[] = [];

  for (let line of current.lines) {
    for (const s of line.spans) consumed.push(s.index, ...(s.alsoIndexes ?? []));

    const labelled = line.spans.filter(insideFigure);
    for (const s of labelled) {
      const t = cleanBodyText(s.text).trim();
      if (t !== "") figureLabels.push(t);
    }
    line = { ...line, spans: line.spans.filter((s) => !insideFigure(s)) };
    if (line.spans.length === 0) continue;

    const hasChoiceMarker = line.spans.some((s) => markerOf(s) !== null);
    const labelSpan = line.spans.find(
      (s) =>
        profile.fonts.conditionLabel.test(s.font) &&
        profile.patterns.conditionLabel.test(s.text.trim()) &&
        s.size < 8.5,
    );

    if (labelSpan) {
      conditionBox = { label: labelSpan.text.trim(), items: [] };
      mode = "condition";
      continue;
    }
    if (hasChoiceMarker) mode = "choices";

    if (mode === "choices" && hasChoiceMarker) {
      for (const part of splitByMarker(line.spans, profile, markerOf)) {
        choices.push({
          marker: part.marker,
          order: choices.length + 1,
          runs: toRuns(part.spans, profile),
        });
      }
      continue;
    }

    if (mode === "condition" && conditionBox) {
      const parts = splitByMarker(line.spans, profile, conditionMarkerOf);
      if (parts.length > 0) {
        for (const part of parts) {
          conditionBox.items.push({
            marker: part.marker,
            runs: toRuns(part.spans, profile),
          });
        }
        continue;
      }
    }

    if (mode === "choices") {
      // 선택지 줄바꿈 — 마지막 선택지에 이어 붙인다
      const last = choices[choices.length - 1];
      if (last) {
        last.runs.push(...toRuns(line.spans, profile));
        continue;
      }
    }

    stem.push(...toRuns(line.spans, profile));
  }

  const allSpans = current.lines.flatMap((l) => l.spans);
  const columnLeft = current.column * columnWidth;
  const bbox: Rect =
    allSpans.length > 0
      ? boundsOf(allSpans)
      : { x0: columnLeft, y0: 0, x1: columnLeft + columnWidth, y1: 0 };

  /* 발문은 여러 줄이 한 문단으로 이어진다. 줄이 바뀌는 자리에서도 수식이
   * 조각날 수 있으므로(2행 분수가 줄 끝에 걸린 경우) 문단 단위로 한 번 더
   * 붙인다. 선택지·보기도 각각 한 덩어리다. */
  return {
    printedNumber: current.number,
    page: page.page,
    column: current.column,
    bbox,
    stem: mergeUnbalancedMath(stem),
    choices:
      choices.length > 0
        ? choices.map((c) => ({ ...c, runs: mergeUnbalancedMath(c.runs) }))
        : null,
    conditionBox: conditionBox
      ? {
          ...conditionBox,
          items: conditionBox.items.map((i) => ({
            ...i,
            runs: mergeUnbalancedMath(i.runs),
          })),
        }
      : null,
    figureBoxes,
    figureLabels,
    typeContext,
    consumedSpanIndexes: consumed,
  };
}
