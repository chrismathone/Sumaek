import { cleanBodyText, decodeHwpMath } from "./hwp-encoding";
import type { PageDump, Run, SourceDump } from "./types";

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
  /** 「답」 앞의 내용 — 풀이 */
  explanation: Run[];
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
};

export function parseAnswerPage(
  page: PageDump,
  profile: AnswerProfile,
): ParsedAnswer[] {
  const columnWidth = page.width / profile.columns;
  const columnOf = (x: number): number =>
    Math.min(profile.columns - 1, Math.max(0, Math.floor(x / columnWidth)));

  /* 줄 세우기 — 본책과 같은 이유로 아래끝을 기준선으로 쓴다 */
  interface Line {
    y: number;
    column: number;
    spans: (typeof page.spans)[number][];
  }
  const lines: Line[] = [];
  const bodyRight = page.width - profile.rightMarginPt;
  for (const span of [...page.spans].sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0)) {
    if (span.text.trim() === "") continue;
    if (span.x0 >= bodyRight) continue; // 세로 단원명 — 본문이 아니다
    if (span.y0 > page.height * profile.bottomMarginRatio) continue; // 러닝헤드
    const column = columnOf((span.x0 + span.x1) / 2);
    const line = lines.find(
      (l) => l.column === column && Math.abs(l.y - span.y1) <= profile.lineToleranceY,
    );
    if (line) line.spans.push(span);
    else lines.push({ y: span.y1, column, spans: [span] });
  }
  for (const line of lines) line.spans.sort((a, b) => a.x0 - b.x0);
  lines.sort((a, b) => a.column - b.column || a.y - b.y);

  const out: ParsedAnswer[] = [];
  let current: ParsedAnswer | null = null;
  let inAnswer = false;
  /** 답 뒤에 붙는 곁다리 상자 — 여기서부터는 정답이 아니다 */
  let answerClosed = false;
  const ASIDE = /^(참고|다른 풀이|전략|주의|보충)/;

  const push = (runs: Run[], text: string, isMath: boolean, raw: string): void => {
    if (isMath) {
      const decoded = decodeHwpMath(raw);
      if (decoded.latex !== "") {
        runs.push({ kind: "math", raw, latex: decoded.latex, unknown: decoded.unknown });
      }
      return;
    }
    if (text.trim() === "") return;
    const last = runs[runs.length - 1];
    if (last?.kind === "text") last.text += text;
    else runs.push({ kind: "text", text });
  };

  for (const line of lines) {
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
            current = { printedNumber: digits, page: page.page, answer: [], explanation: [] };
            inAnswer = false;
            answerClosed = false;
            out.push(current);
          }
          continue;
        }
      }

      if (!current) continue;

      // 「답」 표식 — 여기서부터가 정답이다
      if (profile.answerLabelFont.test(span.font) && cleaned.includes("답")) {
        inAnswer = true;
        continue;
      }

      /* 「답 ①」 뒤에 「참고 2=2¹이다.」 같은 상자가 이어진다. 그대로 두면
       * 정답이 「①참고2=2^{1}이다.」가 된다 — 객관식은 기호만 뽑아 살아남지만
       * 단답형은 그대로 오답 판정으로 이어진다. */
      if (inAnswer && ASIDE.test(cleaned.trim())) answerClosed = true;
      if (inAnswer && answerClosed) continue;

      const target = inAnswer ? current.answer : current.explanation;
      push(target, cleaned, profile.mathFont.test(span.font), span.text);
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
  for (const page of dump.pages) {
    for (const parsed of parseAnswerPage(page, profile)) {
      // 같은 번호가 두 번 나오면 앞엣것을 남긴다 (뒤는 「다시 풀기」 참조다)
      if (!byNumber.has(parsed.printedNumber)) byNumber.set(parsed.printedNumber, parsed);
    }
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
