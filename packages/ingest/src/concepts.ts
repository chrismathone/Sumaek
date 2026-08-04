import {
  cleanBodyText,
  decodeHwpMath,
  joinKorean,
  joinLatex,
  markSuperscripts,
  tidyBodyText,
} from "./hwp-encoding";
import { visibleSpans } from "./ink";
import {
  mergeDivisionTables,
  mergeGridTables,
  mergeStackedFractions,
  type MaybeStacked,
} from "./answers";
import type { ConceptExtractionProfile } from "./profiles/kwr-2022";
import type { PageDump, Run, SourceDump } from "./types";

/* ─────────────────────────────────────────────────────────────
 * 개념서 지면 → 개념 블록.
 *
 * 문항 파서(segment.ts)와 다른 점: 여기에는 문항 번호도 선택지도 없다.
 * 대신 「소단원 > 개념 N > 본문」의 계층과, 본문 곁에 떠 있는 상자들
 * (교사용 강의Plus 주석, 그림 상자)이 있다.
 *
 * 지키는 것:
 *  1. **줄 구조를 보존한다.** 지면의 줄바꿈이 곧 판짜임이다 — 뭉치면
 *     정의·예·단계가 한 덩어리로 이어져 읽을 수 없다.
 *  2. **교사 주석은 학생 본문에 싣지 않는다.** 강의Plus 상자는 지도용이다.
 *     버리지도 않는다 — 출처 메타데이터로 남겨 검수자가 본다.
 *  3. **못 읽은 글리프는 unknown으로 올린다** (조용히 지우지 않는다).
 * ───────────────────────────────────────────────────────────── */

export interface ConceptParagraph {
  /**
   * `body` — 본문 흐름 · `aside` — 본문 오른쪽에 떠 있던 곁블록
   * (방법 2 수형도, 참고 세로셈, 그림 상자). 곁블록은 지면에서 나란히
   * 서 있지만 화면은 한 줄기이므로, 겹치던 본문 문단 **뒤에** 놓는다.
   */
  kind: "body" | "aside";
  /** 줄 단위 runs — 줄바꿈이 보존된다 */
  lines: Run[][];
  /** 정렬용 — 지면에서 이 문단이 시작한 위치 */
  page: number;
  y: number;
}

export interface ExtractedConcept {
  /** 소단원 제목 (「공약수와 최대공약수」) */
  subsection: string;
  /** 러닝헤드에서 읽은 중단원 (「2. 최대공약수와 최소공배수」) */
  unit: { number: string; title: string } | null;
  /** 개념 번호 (1, 2, 3 …) — 제목 왼쪽 19pt 숫자 */
  no: string | null;
  /** 질문형 제목 (「최대공약수는 어떻게 구하는가?」) */
  title: string;
  /** 「핵심문제 02~04」 상호참조 — 지면에 인쇄된 개념→문항 연결 */
  xref: string | null;
  page: number;
  /** 제목 줄의 y — 곁블록·주석이 어느 개념 것인지 가르는 기준 */
  titleY: number;
  /** 같은 소단원 안의 순서 (0-based) */
  order: number;
  paragraphs: ConceptParagraph[];
  /** 교사용 여백 주석 (강의Plus) — 본문이 아니라 메타데이터다 */
  teacherNotes: string[];
  /** 해독하지 못한 글리프 — 하나라도 있으면 검수 대상 */
  unknownGlyphs: string[];
}

interface ConceptSpan extends MaybeStacked {
  /** 곁블록 후보 — 본문 왼끝보다 한참 오른쪽에서 시작한 조각 */
  aside?: boolean;
}

interface Line {
  y: number;
  top: number;
  bottom: number;
  size: number;
  spans: ConceptSpan[];
}

/** 사설 사용 영역(PUA) 아이콘 글리프 — 지면의 ◉ 같은 장식이다 */
const PUA = /[-]/g;

/** 항목 머리 — 이 글자로 시작하는 줄은 새 문단이다 */
const ITEM_HEAD = /^[⑴⑵⑶⑷⑸⑹⑺⑻❶❷❸❹❺❻❼❽▶]|^방법\s*\d/;

function lineText(line: Line): string {
  return cleanBodyText(
    line.spans.map((s) => s.text).join(""),
  ).trim();
}

/**
 * 한 쪽의 span을 줄로 세운다 — 별책 파서와 같은 규칙.
 * (기준선 허용 오차 · 작은 위첨자 흡수 · 분수 글꼴의 내려앉은 기준선)
 */
function buildLines(spans: ConceptSpan[], profile: ConceptExtractionProfile): Line[] {
  const lines: Line[] = [];
  const ordered = [...spans].sort(
    (a, b) => b.size - a.size || a.y1 - b.y1 || a.x0 - b.x0,
  );
  for (const span of ordered) {
    const center = (span.y0 + span.y1) / 2;
    const line = lines.find((l) => {
      if (Math.abs(l.y - span.y1) <= profile.lineToleranceY) return true;
      if (span.size < l.size * 0.8 && center > l.top && center < l.bottom) return true;
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
      lines.push({ y: span.y1, top: span.y0, bottom: span.y1, size: span.size, spans: [span] });
    }
  }
  for (const line of lines) line.spans.sort((a, b) => a.x0 - b.x0);
  lines.sort((a, b) => a.y - b.y);
  return lines;
}

/**
 * 한 줄의 span → runs. 별책 파서의 push와 같은 규칙이다 —
 * 좌표가 이어지는 수식 조각은 붙이고, 작게 떠 있으면 위첨자로 올린다.
 */
function lineToRuns(
  line: Line,
  profile: ConceptExtractionProfile,
  unknownSink: string[],
): Run[] {
  const runs: Run[] = [];
  let lastX1 = Number.NEGATIVE_INFINITY;
  let lastSize = 0;

  for (const span of line.spans) {
    const table = span.tableLatex;
    const raw = span.text;
    const prevX1 = lastX1;
    const adjacent = span.x0 - prevX1 < 1.5;
    /* 조각 사이의 지면 틈 — 이걸 살리지 않으면 배지와 본문(「예2, 3…」),
     * 밑줄 딸림 표기(「2개3개4개」)가 붙어 버린다 */
    const gapped =
      prevX1 !== Number.NEGATIVE_INFINITY && span.x0 - prevX1 >= 2.5;
    lastX1 = span.x1;
    const raised = adjacent && span.size < lastSize * 0.8;
    if (!raised) lastSize = span.size;

    if (table) {
      runs.push({ kind: "math", raw, latex: table, unknown: [] });
      continue;
    }
    if (profile.mathFont.test(span.font)) {
      const decoded = span.stacked
        ? (() => {
            const top = decodeHwpMath(span.stacked!.numerator, span.font);
            const bottom = decodeHwpMath(span.stacked!.denominator, span.font);
            return {
              latex: `\\frac{${top.latex}}{${bottom.latex}}`,
              unknown: [...top.unknown, ...bottom.unknown],
            };
          })()
        : decodeHwpMath(markSuperscripts(raw, span.chars), span.font);
      if (decoded.latex === "") continue;
      unknownSink.push(...decoded.unknown);
      const latex = raised ? `^{${decoded.latex}}` : decoded.latex;
      const last = runs[runs.length - 1];
      if (last?.kind === "math" && adjacent) {
        last.raw += raw;
        last.latex = joinLatex(last.latex, latex);
        last.unknown.push(...decoded.unknown);
        continue;
      }
      if (gapped && last) {
        if (last.kind === "text") {
          if (!last.text.endsWith(" ")) last.text += " ";
        } else {
          runs.push({ kind: "text", text: " " });
        }
      }
      runs.push({ kind: "math", raw, latex, unknown: decoded.unknown });
      continue;
    }
    let text = tidyBodyText(cleanBodyText(raw));
    if (text.trim() === "") continue;
    const last = runs[runs.length - 1];
    /* 문장부호는 앞말에 붙는 것이 맞다 — 틈이 있어도 공백을 넣지 않는다 */
    if (gapped && last && !/^[\s,.)\]}%:：]/.test(text)) {
      if (last.kind === "text") {
        if (!last.text.endsWith(" ")) last.text += " ";
      } else {
        text = ` ${text}`;
      }
    }
    if (last?.kind === "text") {
      last.text = joinKorean(last.text, text);
      continue;
    }
    runs.push({ kind: "text", text });
  }

  /* 줄 끝의 군더더기 공백 — 다음 줄과는 \n으로 이어지므로 필요 없다 */
  const tail = runs[runs.length - 1];
  if (tail?.kind === "text") tail.text = tail.text.replace(/[ \t]+$/, "");
  return runs;
}

/** 여백·그림 상자 판별 결과 */
interface AsideBoxes {
  /** 교사 주석 상자 (강의Plus) — 상자째 본문에서 뺀다 */
  teacher: { page: number; y: number; text: string }[];
  /** 그림 상자 — 본문 뒤에 곁블록으로 남긴다 */
  figures: {
    page: number;
    y: number;
    spans: ConceptSpan[];
    /** 격자표 재구성 결과 (에라토스테네스의 체) */
    gridLatex?: string;
  }[];
  claimed: Set<ConceptSpan>;
}

/**
 * 숫자 격자(에라토스테네스의 체)를 KaTeX 배열로 재구성한다.
 *
 * 근거는 전부 지면에 있다 (실측):
 *  - 수는 글자 상자로 자리가 잡힌다 (한 span에 「8  9  10」처럼 여럿)
 *  - **지운 수 위에는 사선**(테두리 도형, 약 10×8pt)이 그어져 있다 → \cancel
 *  - **남는 소수 뒤에는 칠한 원**(약 13×13pt)이 깔려 있고 굵은 글꼴이다 → \mathbf
 *
 * 격자가 아니면(숫자가 아니거나 행이 모자라면) null — 억지로 만들지 않는다.
 */
function gridToArray(
  spans: ConceptSpan[],
  page: PageDump,
  profile: ConceptExtractionProfile,
): string | null {
  interface Token {
    text: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    bold: boolean;
  }
  const tokens: Token[] = [];
  for (const span of spans) {
    if (!profile.mathFont.test(span.font)) return null;
    const glyphs = [...span.text];
    const boxes = span.chars;
    if (!boxes || boxes.length !== glyphs.length) {
      const t = span.text.trim();
      if (t === "") continue;
      tokens.push({ text: t, x0: span.x0, y0: span.y0, x1: span.x1, y1: span.y1, bold: /Bold/.test(span.font) });
      continue;
    }
    let cur: Token | null = null;
    glyphs.forEach((ch, i) => {
      const b = boxes[i]!;
      if (ch.trim() === "") {
        cur = null;
        return;
      }
      if (cur) {
        cur.text += ch;
        cur.x1 = Math.max(cur.x1, b[2]);
        cur.y1 = Math.max(cur.y1, b[3]);
      } else {
        cur = { text: ch, x0: b[0], y0: b[1], x1: b[2], y1: b[3], bold: /Bold/.test(span.font) };
        tokens.push(cur);
      }
    });
  }
  if (tokens.length < 12 || tokens.some((t) => !/^\d+$/.test(t.text))) return null;

  /* 행 세우기 */
  const rows: Token[][] = [];
  for (const token of [...tokens].sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0)) {
    const row = rows.find((r) => Math.abs(r[0]!.y1 - token.y1) <= 5);
    if (row) row.push(token);
    else rows.push([token]);
  }
  if (rows.length < 3) return null;
  for (const row of rows) row.sort((a, b) => a.x0 - b.x0);

  /* 사선 — 수의 상자와 겹치는 작은 테두리 도형 */
  const strikes = page.drawings.filter((d) => {
    const w = d.x1 - d.x0;
    const h = d.y1 - d.y0;
    return !d.fill && w >= 3 && w <= 16 && h >= 3 && h <= 16;
  });
  const struck = (t: Token): boolean =>
    strikes.some(
      (d) => d.x0 < t.x1 && d.x1 > t.x0 && d.y0 < t.y1 && d.y1 > t.y0,
    );

  const body = rows
    .map((row) =>
      row
        .map((t) => (struck(t) ? `\\cancel{${t.text}}` : t.bold ? `\\mathbf{${t.text}}` : t.text))
        .join(" & "),
    )
    .join(" \\\\ ");
  const cols = Math.max(...rows.map((r) => r.length));
  return `\\begin{array}{${"c".repeat(cols)}}${body}\\end{array}`;
}

/**
 * 테두리 상자를 찾아 그 안의 span을 본문 흐름에서 뗀다.
 *
 * 상자 안에 '강의' 배지(YDVYGOStd23)가 있으면 교사 주석이고, 없으면
 * 그림 상자(밑·지수 도해, 소인수분해 표 등)다. 작은 상자부터 차지해야
 * 큰 상자(지면 테두리)가 전부를 삼키지 않는다.
 */
function claimBoxes(
  page: PageDump,
  spans: ConceptSpan[],
  profile: ConceptExtractionProfile,
): AsideBoxes {
  const out: AsideBoxes = { teacher: [], figures: [], claimed: new Set() };
  const boxes = page.drawings
    .filter((d) => {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      /* 쪽 위 초록 띠(y<0에서 시작하는 장식 배경)는 상자가 아니다. p.17에서
       * 이 띠가 강의Plus 배지를 품는 바람에 **소단원 제목까지** 교사 주석으로
       * 삼켰다 — 소단원이 갱신되지 않아 개념→정본 매핑이 통째로 틀어진다. */
      if (d.y0 < profile.topMarginY - 8) return false;
      return (
        w >= profile.asideBox.minW &&
        w <= profile.asideBox.maxW &&
        h >= profile.asideBox.minH
      );
    })
    .sort(
      (a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0),
    );

  for (const box of boxes) {
    const inside = spans.filter((s) => {
      if (out.claimed.has(s)) return false;
      const cx = (s.x0 + s.x1) / 2;
      const cy = (s.y0 + s.y1) / 2;
      return cx > box.x0 && cx < box.x1 && cy > box.y0 && cy < box.y1;
    });
    if (inside.length < 2) continue;

    const isTeacher = inside.some((s) => profile.teacherBadge.test(s.font));
    if (isTeacher) {
      for (const s of inside) out.claimed.add(s);
      /* 배지 글자('강의'·'Plus')는 주석 내용이 아니다 */
      const content = inside.filter(
        (s) =>
          !profile.teacherBadge.test(s.font) &&
          !(s.size <= 9 && cleanBodyText(s.text).trim() === "Plus"),
      );
      const text = buildLines(content, profile)
        .map((l) => {
          const unknown: string[] = [];
          return runsToPlain(lineToRuns(l, profile, unknown));
        })
        .filter((t) => t !== "")
        .join("\n");
      if (text) out.teacher.push({ page: page.page, y: box.y0, text });
      continue;
    }

    /* 그림 상자 — 수식이 둘 이상 들어 있을 때만. 아니면 본문 흐름에 둔다
     * (강조 테두리만 두른 문장을 상자로 떼면 본문 가운데가 빈다). */
    const mathCount = inside.filter((s) => profile.mathFont.test(s.font)).length;
    if (mathCount < 2) continue;
    for (const s of inside) out.claimed.add(s);
    /* 그림 상자는 본문 오른쪽에 나란히 선다 — 아래끝으로 자리를 잡아야
     * 겹치던 본문 항목들 **뒤에** 선다 (y0으로 잡으면 항목 사이를 파고든다) */
    const grid = gridToArray(inside, page, profile);
    out.figures.push({
      page: page.page,
      y: box.y1,
      spans: inside,
      ...(grid ? { gridLatex: grid } : {}),
    });
  }

  /* ── 상자 없는 강의Plus — 배지에서 아래로 줍는다 ─────────────
   *
   * p.17의 지도목표는 테두리 상자 없이 배지와 6.8pt 글줄만 있다. 교사
   * 주석 글자는 7.5pt 이하, 본문의 화살표 주석(「서로소」·「지수」)은
   * 7.88pt다 — 실측한 이 간극이 둘을 가른다. 핵심문제 상호참조(7.31pt)는
   * 글줄에 「핵심문제」가 들어 있어 따로 비켜 준다. */
  for (const badge of spans) {
    if (out.claimed.has(badge)) continue;
    if (!profile.teacherBadge.test(badge.font)) continue;
    out.claimed.add(badge);
    const cand = spans
      .filter((s) => {
        if (out.claimed.has(s)) return false;
        if (s.size > 7.6) return false;
        if (/핵심문제/.test(s.text)) return false;
        if (cleanBodyText(s.text).trim() === "Plus") return false;
        const cx = (s.x0 + s.x1) / 2;
        return (
          cx >= badge.x0 - 12 &&
          cx <= badge.x0 + 170 &&
          s.y0 >= badge.y0 - 6 &&
          s.y0 <= badge.y0 + 110
        );
      })
      .sort((a, b) => a.y0 - b.y0);
    /* 세로 틈이 벌어지면 주석이 끝난 것이다 */
    const kept: ConceptSpan[] = [];
    for (const s of cand) {
      const prev = kept[kept.length - 1];
      if (prev && s.y0 - prev.y1 > 16) break;
      kept.push(s);
    }
    if (kept.length === 0) continue;
    for (const s of kept) out.claimed.add(s);
    const text = buildLines(kept, profile)
      .map((l) => {
        const unknown: string[] = [];
        return runsToPlain(lineToRuns(l, profile, unknown));
      })
      .filter((t) => t !== "")
      .join("\n");
    if (text) out.teacher.push({ page: page.page, y: badge.y0, text });
  }
  return out;
}

/** runs → 검수자용 평문 (`$latex$` 꼴) — 교사 주석 저장용 */
function runsToPlain(runs: Run[]): string {
  return runs
    .map((r) => (r.kind === "math" ? `$${r.latex}$` : r.text))
    .join("")
    .trim();
}

/**
 * 한 줄을 본문 조각과 곁블록 조각으로 가른다.
 *
 * 지면은 본문 오른쪽에 수형도·세로셈·정렬 계산을 나란히 세운다. 줄로만
 * 읽으면 「❶ 각 수를 소인수분해 한다. 18=2×3²」처럼 단계와 계산이
 * 한 줄에 섞인다 — 실제 v2 정찰에서 그렇게 나왔다. 큰 틈(sideGap) 뒤가
 * sideClusterX 오른쪽이면 곁블록으로 뗀다.
 */
function splitAside(
  line: Line,
  profile: ConceptExtractionProfile,
): { body: Line | null; aside: Line | null } {
  const spans = line.spans;
  if (spans.length === 0) return { body: null, aside: null };

  let splitAt = -1;
  for (let i = 1; i < spans.length; i += 1) {
    const gap = spans[i]!.x0 - spans[i - 1]!.x1;
    if (gap >= profile.sideGap && spans[i]!.x0 >= profile.sideClusterX) {
      splitAt = i;
      break;
    }
  }
  /* 줄 전체가 오른쪽에서 시작하면 통째로 곁블록이다 (수형도의 숫자 줄) */
  if (splitAt === -1 && spans[0]!.x0 >= profile.sideClusterX) {
    return { body: null, aside: line };
  }
  if (splitAt === -1) return { body: line, aside: null };

  const make = (part: ConceptSpan[]): Line => ({
    y: line.y,
    top: Math.min(...part.map((s) => s.y0)),
    bottom: Math.max(...part.map((s) => s.y1)),
    size: Math.max(...part.map((s) => s.size)),
    spans: part,
  });
  return { body: make(spans.slice(0, splitAt)), aside: make(spans.slice(splitAt)) };
}

export interface ConceptExtractionResult {
  concepts: ExtractedConcept[];
  /** 대단원 (짝수 쪽 푸터 「Ⅰ. 소인수분해」) */
  chapter: string | null;
  /** 어느 개념에도 속하지 않은 본문 줄 수 — 조용한 누락의 척도 */
  unassignedLines: number;
}

export function extractConceptPages(
  dump: SourceDump,
  profile: ConceptExtractionProfile,
  opts: {
    /**
     * 개념 본문이 실리는 쪽의 허용목록 (인쇄 쪽 번호).
     *
     * 이 교재의 문제 쪽(확인하기·익히기·시험·마무리)은 상자·오른쪽 블록이
     * 개념 쪽과 같은 조판 신호를 쓴다. 신호만으로 개념 쪽을 추론하다가
     * 개념 하나가 문제 12쪽 분량을 삼키는 것을 실측으로 봤다 — RPM의
     * `--expect`처럼 **사람이 차례를 보고 확인한 범위**를 명시하는 쪽이
     * 조용한 오염보다 낫다. 생략하면 전 쪽을 개념 후보로 본다.
     */
    conceptPages?: readonly number[];
  } = {},
): ConceptExtractionResult {
  const conceptPageSet =
    opts.conceptPages === undefined ? null : new Set(opts.conceptPages);
  const concepts: ExtractedConcept[] = [];
  let chapter: string | null = null;
  let unit: { number: string; title: string } | null = null;
  let subsection: string | null = null;
  let subsectionOrder = 0;
  let current: ExtractedConcept | null = null;
  /** 문제 구역(확인하기·익히기·시험·마무리) — 개념이 아니다 */
  let problemZone = false;
  let unassignedLines = 0;
  /** 교사 주석 — 전부 모아 두고 마지막에 위치로 귀속시킨다 */
  const teacherBuf: { page: number; y: number; text: string }[] = [];

  for (const page of dump.pages) {
    /* ── 1. 러닝헤드에서 계층 읽기 ─────────────────────────
     * 위(중단원)와 아래(쪽번호+계층)는 **따로** 읽는다. 한 줄로 이으면
     * 「1. 소인수분해10 Ⅰ. 소인수분해」가 되어 아무 패턴에도 안 걸린다. */
    const readZone = (spans: typeof page.spans): string =>
      cleanBodyText(
        spans
          .filter((s) => !/DINMittelschrift/.test(s.font))
          .sort((a, b) => a.x0 - b.x0)
          .map((s) => s.text)
          .join(""),
      ).trim();
    for (const zoneText of [
      readZone(page.spans.filter((s) => s.y1 < profile.topMarginY)),
      readZone(page.spans.filter((s) => s.y0 > profile.footerY)),
    ]) {
      const unitMatch = profile.runningUnit.exec(zoneText);
      if (unitMatch) unit = { number: unitMatch[1]!, title: unitMatch[2]!.trim() };
      const chapterMatch = /^([ⅠⅡⅢⅣ]+|[IVX]+)\s*[.·]\s*(\S.{1,20})$/.exec(zoneText);
      if (chapterMatch && !chapter)
        chapter = `${chapterMatch[1]}. ${chapterMatch[2]}`.trim();
    }

    /* 허용목록 밖의 쪽 — 계층만 읽고 본문은 건드리지 않는다 */
    if (conceptPageSet !== null && !conceptPageSet.has(page.page)) {
      current = null;
      continue;
    }

    /* ── 1.5 개념 번호 배지 — **원시 span에서** 잡는다 ────────
     * 번호는 색 배지 위의 흰 글자다. 배지가 방패꼴 path라 글리프 상자
     * (줄 높이 27pt)를 다 덮지 못해 isInvisibleInk가 흔적으로 오판한다.
     * 지면에 잘 보이는 글자임을 아는 것은 폰트·크기·꼴이므로 잉크 판정을
     * 거치지 않고 직접 줍는다. */
    const numberBadges = page.spans.filter(
      (s) =>
        profile.conceptNumber.font.test(s.font) &&
        s.size >= profile.conceptNumber.minSize &&
        s.size <= profile.conceptNumber.maxSize &&
        /^\d{1,2}$/.test(cleanBodyText(s.text).trim()),
    );

    /* ── 2. 본문 span 고르기 ───────────────────────────────── */
    const spans: ConceptSpan[] = (visibleSpans(page) as ConceptSpan[]).filter((s) => {
      if (s.y0 > profile.footerY || s.y1 < profile.topMarginY) return false;
      if (profile.dropFonts.test(s.font)) return false;
      if (profile.decorationFont.test(s.font)) return false;
      if (profile.purchaserStamp.test(s.text)) return false;
      if (/DINMittelschrift/.test(s.font)) return false;
      /* 오른쪽 가장자리의 세로 단원 탭 (「소/인/수/분/해」 한 글자씩) */
      if (s.x0 > page.width - 52) return false;
      const text = s.text.replace(PUA, "");
      if (text.trim() === "") return false;
      s.text = text;
      return true;
    });

    /* ── 2.5 사람이 쓴 대체 문장(figureOverrides) — 영역째 선점 ──
     * 화살표 도해·복잡한 표는 글자만 옮기면 뜻이 사라진다. 영역 안의
     * span을 전부 거두고, 지면을 보고 쓴 문장 하나로 대신한다. */
    const overrideParas: { y: number; text: string }[] = [];
    let flowSource = spans;
    for (const o of profile.figureOverrides) {
      if (o.page !== page.page) continue;
      const inside = new Set(
        flowSource.filter((s) => {
          const cx = (s.x0 + s.x1) / 2;
          const cy = (s.y0 + s.y1) / 2;
          return (
            cx > o.region.x0 && cx < o.region.x1 &&
            cy > o.region.y0 && cy < o.region.y1
          );
        }),
      );
      if (inside.size === 0) continue;
      flowSource = flowSource.filter((s) => !inside.has(s));
      /* 지면에서 그 자리쯤에 서도록 영역 가운데 높이에 앉힌다 */
      overrideParas.push({ y: (o.region.y0 + o.region.y1) / 2, text: o.text });
    }

    /* ── 3. 상자 떼기 (교사 주석 · 그림) ───────────────────── */
    const boxes = claimBoxes(page, flowSource, profile);
    teacherBuf.push(...boxes.teacher);
    /* 상자 밖에 남은 배지 글리프('강의'·'Plus')는 상자 테두리에 걸터앉아
     * 있던 것이다 — 본문이 아니다. 소단원 제목이 「소인수분해Plus」가 되고
     * 곁블록에 「Plus」 한 줄이 서는 것이 이 글리프들이었다. */
    const isBadgeGlyph = (s: ConceptSpan): boolean =>
      profile.teacherBadge.test(s.font) ||
      (s.size <= 9 && /DINPro-Bold/.test(s.font) &&
        cleanBodyText(s.text).trim() === "Plus");
    const flow = flowSource.filter(
      (s) => !boxes.claimed.has(s) && !isBadgeGlyph(s),
    );

    /* ── 4. 표·분수 합치고 줄 세우기 ─────────────────────────
     *
     * 분수 막대 후보에서 **표의 괘선을 뺀다.** p.17 약수 표의 가로줄이
     * 분수 막대로 오인되어 표의 「9」와 아랫줄 본문 「3²×11」이
     * 9/(3²×11)라는 가짜 분수가 됐다. 표의 괘선은 같은 y에 조각이
     * 여럿이거나(칸 경계) — 진짜 분수 막대는 홀로 선 짧은 선분이다. */
    const fractionSafe = {
      ...page,
      drawings: page.drawings.filter((d) => {
        const isBar = d.y1 - d.y0 < 1.5 && d.x1 - d.x0 >= 3;
        if (!isBar) return true;
        return !page.drawings.some(
          (o) =>
            o !== d &&
            o.y1 - o.y0 < 1.5 &&
            Math.abs(o.y0 - d.y0) < 1 &&
            (o.x1 < d.x0 || o.x0 > d.x1),
        );
      }),
    };
    const prepared = mergeGridTables(
      mergeDivisionTables(
        mergeStackedFractions(flow, fractionSafe, profile),
        profile,
      ),
      page,
      profile,
    ) as ConceptSpan[];
    const lines = buildLines(prepared, profile);

    /* ── 5. 줄 분류 → 상태 기계 ────────────────────────────── */
    /** 곁블록 줄 — 문단으로 묶기 위해 모아 둔다 */
    const asideLines: Line[] = [];

    for (const line of lines) {
      const first = line.spans[0]!;
      const text = lineText(line);
      if (text === "") continue;

      /* 소단원 제목 — 줄에 다른 조각(여백 상자 부스러기)이 흡수됐어도
       * 제목 폰트의 글자만 제목이다 */
      if (
        profile.subsectionTitle.font.test(first.font) &&
        first.size >= profile.subsectionTitle.minSize
      ) {
        subsection = cleanBodyText(
          line.spans
            .filter((s) => profile.subsectionTitle.font.test(s.font))
            .map((s) => s.text)
            .join(""),
        ).trim();
        subsectionOrder = 0;
        current = null;
        problemZone = false;
        continue;
      }
      /* 중단원 표지의 제목(19pt) — 러닝헤드로 이미 아는 값이다 */
      if (
        profile.subsectionTitle.font.test(first.font) &&
        first.size >= 17
      ) {
        continue;
      }
      /* 문제 구역 배지 — 개념 수집 멈춤 */
      if (
        line.spans.some(
          (s) =>
            profile.problemBadge.font.test(s.font) &&
            s.size >= profile.problemBadge.minSize,
        )
      ) {
        problemZone = true;
        current = null;
        continue;
      }
      if (subsection === null) continue;

      /* 개념 번호만 있는 줄 — 번호는 원시 span(numberBadges)에서 이미
       * 잡았다. 여기서는 본문으로 새지 않게 삼키기만 한다. */
      if (
        profile.conceptNumber.font.test(first.font) &&
        first.size >= profile.conceptNumber.minSize &&
        /^\d{1,2}$/.test(text)
      ) {
        continue;
      }
      /* 개념 제목 — 같은 줄에 상호참조가 섞여 올 수 있다.
       *
       * **한 조각만 집으면 잘린다.** 제목은 쉼표와 수식에서 span이 갈라진다:
       *   p.163 「거리, 속력, 시간에 대한 문제」 → "거리" + " 속력" + " 시간에 대한 문제"
       *   p.198 「정비례 관계 y=ax의 그래프는 어떻게 그리는가?」
       *          → "정비례 관계 " + (수식) + "의 그래프는 어떻게 그리는가?"
       * 앞 조각만 쓰면 제목이 「거리」·「정비례 관계」가 된다. 이건 화면에
       * 나가는 이름이자 **재적재 때 같은 자료인지 가리는 열쇠**라서, 잘리면
       * 서로 다른 개념이 같은 이름으로 부딪친다.
       *
       * 그래서 제목 글꼴 조각을 왼쪽부터 전부 이어 붙인다. 쉼표와 수식은
       * 빠지지만 그건 RPM 유형 제목과 같은 사정이다 — 지면에 없는 글자를
       * 지어내지 않는다. */
      const titleSpans = line.spans
        .filter(
          (s) =>
            profile.conceptTitle.font.test(s.font) &&
            s.size >= profile.conceptTitle.minSize &&
            s.size <= profile.conceptTitle.maxSize,
        )
        .sort((a, b) => a.x0 - b.x0);
      const titleSpan = titleSpans[0];
      const titleText = titleSpans
        .map((s) => cleanBodyText(s.text))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      /* 번호 배지는 제목 왼쪽에서 제목 줄과 세로로 겹친다 */
      const numberSpan = titleSpan
        ? numberBadges.find(
            (s) => s.x1 <= titleSpan.x0 + 2 && s.y0 < line.y && s.y1 > line.y - 16,
          )
        : undefined;
      /**
       * 제목임을 아는 근거는 **둘**이다.
       *
       * 처음에는 물음표만 봤다. 이 책의 개념 제목이 대개 질문형이기
       * 때문인데(「최대공약수는 어떻게 구하는가?」), 전부는 아니다 —
       * p.163 「거리, 속력, 시간에 대한 문제」·「농도에 대한 문제」는
       * 명사구다. 그 쪽은 개념 블록이 **0개**로 나오고 본문 31줄이
       * 통째로 미분류가 됐다. 허용목록에 넣었는데도 아무것도 안 나온
       * 것이라, 미분류 수를 보지 않았으면 그냥 없는 줄 알았을 것이다.
       *
       * 번호 배지(DINPro-Bold 17.5~20pt의 한두 자리 숫자)가 제목 왼쪽에
       * 붙어 있는 것이 더 확실한 근거다 — 개념이 아닌 줄에는 그 배지가
       * 없다. 물음표는 배지를 못 읽었을 때의 보조 근거로 남긴다.
       */
      if (titleSpan && titleText !== "" && (numberSpan || /\?$/.test(titleText))) {
        const xrefText = line.spans
          .filter(
            (s) =>
              profile.xref.font.test(s.font) && s.size <= profile.xref.maxSize,
          )
          .map((s) => cleanBodyText(s.text))
          .join("")
          .trim();
        current = {
          subsection,
          unit,
          no: numberSpan ? cleanBodyText(numberSpan.text).trim() : null,
          title: titleText,
          xref: profile.xref.pattern.test(xrefText) ? xrefText : null,
          page: page.page,
          titleY: line.y,
          order: subsectionOrder,
          paragraphs: [],
          teacherNotes: [],
          unknownGlyphs: [],
        };
        concepts.push(current);
        subsectionOrder += 1;
        problemZone = false;
        continue;
      }
      /* 상호참조가 다른 줄로 갈라져 온 경우 */
      if (
        current &&
        current.xref === null &&
        line.spans.every(
          (s) => profile.xref.font.test(s.font) && s.size <= profile.xref.maxSize,
        ) &&
        profile.xref.pattern.test(text)
      ) {
        current.xref = text;
        continue;
      }
      if (problemZone) continue;
      if (current === null) {
        unassignedLines += 1;
        if (process.env.KWR_DEBUG) {
          console.error(`[미분류 p${page.page} y${line.y.toFixed(0)}] ${text}`);
        }
        continue;
      }

      /* 보충학습 배지 → 문단 머리 글자로. 배지가 「보충」·「학습」 두
       * 조각으로 두 줄에 걸쳐 오므로, 마커 문단은 한 번만 세운다. */
      if (line.spans.some((s) => profile.supplementBadge.test(s.font))) {
        const rest = { ...line, spans: line.spans.filter((s) => !profile.supplementBadge.test(s.font)) };
        /* 배지가 「보충」·「학습」 두 조각·두 줄로 오므로, **첫 줄이 마커인
         * 문단이 바로 앞에 있으면** 이미 연 것이다 (마커 뒤에 제목 줄이
         * 이어붙은 상태까지 포함해야 한다 — 마지막 문단만 보면 두 번 선다) */
        const last = current.paragraphs[current.paragraphs.length - 1];
        const lastIsMarker =
          last?.lines[0]?.length === 1 &&
          last.lines[0][0]?.kind === "text" &&
          last.lines[0][0].text === "보충학습";
        if (!lastIsMarker) {
          current.paragraphs.push({
            kind: "body",
            lines: [[{ kind: "text", text: "보충학습" }]],
            page: page.page,
            y: line.y,
          });
        }
        if (rest.spans.length > 0) appendBodyLine(current, rest, page.page, profile);
        continue;
      }

      /* 본문 — 곁블록을 가르고 담는다 */
      const { body, aside } = splitAside(line, profile);
      if (aside) asideLines.push(aside);
      if (body) appendBodyLine(current, body, page.page, profile);
    }

    /* ── 6. 곁블록·그림 상자 → aside 문단 ────────────────────
     *
     * **이 쪽에 개념 본문이 실제로 담겼을 때만** 처리한다. 문제 쪽
     * (확인하기·익히기·시험·마무리)에도 상자·오른쪽 블록이 즐비한데,
     * 무조건 처리하면 전부 직전 개념으로 흘러든다 — 실측에서 개념 하나가
     * 문제 12쪽 분량(500줄)을 삼켰다. */
    const pageHadConcept = concepts.some((c) =>
      c.paragraphs.some((p) => p.page === page.page && p.kind === "body"),
    );
    if (pageHadConcept) {
      const owner = (y: number): ExtractedConcept => {
        const samePage = concepts.filter((c) => c.page <= page.page);
        return (
          [...samePage]
            .reverse()
            .find(
              (c) =>
                c.page < page.page ||
                /* 제목 줄보다 아래에 있으면 이 개념의 것이다 */
                c.titleY <= y + 2,
            ) ?? concepts[concepts.length - 1]!
        );
      };
      /* 곁줄을 세로 근접으로 뭉친다 (한 수형도·한 세로셈이 한 문단) */
      const clusters: Line[][] = [];
      for (const line of [...asideLines].sort((a, b) => a.y - b.y)) {
        const last = clusters[clusters.length - 1];
        if (last && line.top - last[last.length - 1]!.bottom < 14) last.push(line);
        else clusters.push([line]);
      }
      for (const cluster of clusters) {
        const target = owner(cluster[0]!.y);
        const para: ConceptParagraph = {
          kind: "aside",
          lines: [],
          page: page.page,
          y: cluster[0]!.y,
        };
        for (const line of cluster) {
          const runs = lineToRuns(line, profile, target.unknownGlyphs);
          if (runs.length > 0) para.lines.push(runs);
        }
        if (para.lines.length > 0) target.paragraphs.push(para);
      }
      /* 사람이 쓴 대체 문장 — 영역에서 거둔 span들 대신 선다 */
      for (const o of overrideParas) {
        const target = owner(o.y);
        target.paragraphs.push({
          kind: "aside",
          lines: [[{ kind: "text", text: o.text }]],
          page: page.page,
          y: o.y,
        });
      }
      for (const fig of boxes.figures) {
        const target = owner(fig.y);
        const para: ConceptParagraph = { kind: "aside", lines: [], page: page.page, y: fig.y };
        if (fig.gridLatex) {
          /* 격자표(체) — 사선·굵음까지 좌표·도형 실측으로 재구성한 배열 */
          para.lines.push([
            { kind: "math", raw: fig.spans.map((s) => s.text).join(" "), latex: fig.gridLatex, unknown: [] },
          ]);
        } else {
          for (const line of buildLines(fig.spans, profile)) {
            const runs = lineToRuns(line, profile, target.unknownGlyphs);
            if (runs.length > 0) para.lines.push(runs);
          }
        }
        if (para.lines.length > 0) target.paragraphs.push(para);
      }
    }
  }
  /* ── 교사 주석 귀속 ──────────────────────────────────────────
   * 같은 쪽에서 제목이 주석보다 위에 있는 **마지막 개념**의 것이다.
   * 그런 개념이 없으면(소단원 지도목표 — 첫 개념 제목보다 위에 찍힌다)
   * 그 자리 **다음에 시작하는 첫 개념**이 받는다. 소단원 경계에서
   * 몰아서 붙였더니 지도목표가 전부 직전 소단원으로 밀렸다 (실측). */
  for (const note of teacherBuf) {
    const above = [...concepts]
      .reverse()
      .find((c) => c.page === note.page && c.titleY <= note.y + 4);
    const next = concepts.find(
      (c) =>
        c.page > note.page ||
        (c.page === note.page && c.titleY > note.y - 4),
    );
    const target = above ?? next ?? concepts[concepts.length - 1];
    target?.teacherNotes.push(note.text);
  }

  /* 문단을 지면 순서로 — 곁블록은 같은 y의 본문 뒤에 선다 */
  for (const concept of concepts) {
    concept.paragraphs.sort(
      (a, b) =>
        a.page - b.page ||
        a.y - b.y ||
        (a.kind === "aside" ? 1 : 0) - (b.kind === "aside" ? 1 : 0),
    );
  }

  return { concepts, chapter, unassignedLines };
}

/**
 * 본문 줄 하나를 현재 개념에 담는다.
 *
 * 새 문단을 여는 것은 **항목 머리**(⑴·❶·예·참고·주의·방법 N)뿐이다.
 * 나머지 줄은 앞 문단에 줄바꿈으로 이어진다 — 세로 간격으로 가르면
 * 지면의 항목 사이(21.7pt)와 보충학습 앞(19.8pt)이 역전되어 있어
 * 어긋난다 (실측).
 */
function appendBodyLine(
  concept: ExtractedConcept,
  line: Line,
  page: number,
  profile: ConceptExtractionProfile,
): void {
  const first = line.spans[0]!;
  const text = lineText(line);
  const isBadge =
    profile.itemBadge.font.test(first.font) &&
    first.size <= profile.itemBadge.maxSize &&
    profile.itemBadge.pattern.test(cleanBodyText(first.text).trim());
  const opens = isBadge || ITEM_HEAD.test(text);

  const runs = lineToRuns(line, profile, concept.unknownGlyphs);
  if (runs.length === 0) return;

  const last = concept.paragraphs[concept.paragraphs.length - 1];
  if (!opens && last && last.kind === "body" && last.page === page) {
    last.lines.push(runs);
    return;
  }
  concept.paragraphs.push({ kind: "body", lines: [runs], page, y: line.y });
}
