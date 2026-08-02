import type { ParsedAnswer } from "./answers";
import type { ExtractedQuestion, Run } from "./types";

/**
 * 추출 결과의 **이상 징후**를 찾는다.
 *
 * KaTeX가 렌더에 성공했다고 맞는 것이 아니다. `A=2b\times 3^{b}\times 5c`는
 * 아무 오류 없이 예쁘게 그려지지만 지면의 `A=2^a×3^b×5^c`와 다른 식이다.
 * 학생은 틀린 풀이를 읽고, 화면 어디에도 「이상하다」는 표시가 없다.
 *
 * 그래서 렌더 성공 여부와 **따로** 내용을 본다. 여기 있는 규칙은 전부
 * 실제로 한 번씩 틀렸던 것들이다 — 짐작으로 넣은 규칙은 없다.
 */
export interface Finding {
  printedNumber: string;
  /** 어디서 났나 — 「발문」 「선택지 ②」 「풀이 3」 … */
  where: string;
  kind: FindingKind;
  detail: string;
  /** 문제가 된 대목 */
  excerpt: string;
}

export type FindingKind =
  | "미해독-글리프"
  | "위첨자-소실"
  | "수식-조각남"
  | "수식-빈칸"
  | "과도한-공백"
  | "내용-없음"
  | "구매자-도장";

/**
 * 수식에 남아도 되는 글자.
 *
 * 여기 없는 글자가 latex에 남았다면 해독표가 모르는 글리프다 — 화면에는
 * 네모나 엉뚱한 기호로 나가거나, KaTeX가 「character metrics 없음」으로
 * 경고하며 대충 그린다. 둘 다 지면과 다르다.
 */
const SAFE_MATH = /^[\x20-\x7e\s\\{}^_×÷≤≥≠≒∴∵…√°∠△□○◯㎝㎡㎥ㄱ-ㅎ가-힣①-⑮─-╿]*$/u;

/** 지면의 위첨자가 본문 글자로 떨어진 자리 — `2b`, `5c`처럼 */
const LOST_SUPERSCRIPT = /(?<![\\a-zA-Z])(\d)([a-z])(?![a-zA-Z0-9])/;

/** 구매자 식별 도장 — 학생 화면에 절대 나가면 안 된다 */
const PURCHASER = /[\w.+-]+@[\w-]+\.[\w.]+/;

const mathOf = (runs: Run[]): { latex: string; raw: string }[] =>
  runs.flatMap((r) => (r.kind === "math" ? [{ latex: r.latex, raw: r.raw }] : []));

const render = (runs: Run[]): string =>
  runs.map((r) => (r.kind === "text" ? r.text : `$${r.latex}$`)).join("");

/** 한 덩이(발문·선택지·풀이 한 줄 …)를 검사한다 */
function inspect(
  printedNumber: string,
  where: string,
  runs: Run[],
  push: (f: Finding) => void,
): void {
  const whole = render(runs);
  if (whole.trim() === "") return;

  if (PURCHASER.test(whole)) {
    push({
      printedNumber,
      where,
      kind: "구매자-도장",
      detail: "구매자 식별 문자열이 남았다",
      excerpt: whole.slice(0, 120),
    });
  }

  /* **연산자만 남은 수식이 둘 이상 잇달아 서면** 피연산자가 딴 데로 갔다.
   *
   * 하나만 보면 안 된다 — 「(최대공약수) $=$ $3×5$」나 「($2^{2}$의 약수)
   * $\times$ ($3$의 약수)」처럼 한글 사이에 연산자 하나가 서는 것은 지면
   * 그대로다. 실제 사고는 0049 선택지 ④가
   * `$\times$$\times$$\times$$\times$$=$` 다음에 분수 다섯 개가 오는 꼴로,
   * **연산자끼리 뭉쳐 있었다.** */
  const LONE_OPERATOR = /^\s*(\\times|\\div|=|\+|-|\\pm)\s*$/;
  const scrambled = runs.some(
    (r, i) =>
      r.kind === "math" &&
      LONE_OPERATOR.test(r.latex) &&
      runs[i + 1]?.kind === "math" &&
      LONE_OPERATOR.test((runs[i + 1] as { latex: string }).latex),
  );
  if (scrambled) {
    push({
      printedNumber,
      where,
      kind: "수식-조각남",
      detail: "연산자만 남은 수식이 잇달아 선다 — 피연산자가 딴 자리로 갔다",
      excerpt: whole.slice(0, 160),
    });
  }

  for (const { latex, raw } of mathOf(runs)) {
    if (latex.trim() === "") {
      push({
        printedNumber,
        where,
        kind: "수식-빈칸",
        detail: "수식이 비었다 — 지면에는 무엇이 있었다",
        excerpt: JSON.stringify(raw).slice(0, 80),
      });
      continue;
    }
    if (!SAFE_MATH.test(latex)) {
      const odd = [...latex].filter((c) => !SAFE_MATH.test(c));
      push({
        printedNumber,
        where,
        kind: "미해독-글리프",
        detail: `해독표가 모르는 글자 ${[...new Set(odd)]
          .map((c) => `${JSON.stringify(c)}(U+${c.codePointAt(0)!.toString(16).toUpperCase()})`)
          .join(" ")}`,
        excerpt: latex.slice(0, 120),
      });
    }
    /* **같은 식 안에 제대로 올라간 지수가 있을 때만** 의심한다.
     * 그 조건이 없으면 `120m`(120미터)·`800m` 같은 단위를 전부 물고 온다 —
     * 여덟 건이 그랬다. 조판이 이 식에서 지수를 썼다는 증거가 있어야
     * 「여기 하나가 안 올라갔다」는 말에 근거가 생긴다. */
    const lost = latex.includes("^{") ? LOST_SUPERSCRIPT.exec(latex) : null;
    if (lost) {
      push({
        printedNumber,
        where,
        kind: "위첨자-소실",
        detail: `「${lost[1]}${lost[2]}」 — 지면에서는 ${lost[1]}의 위첨자 ${lost[2]}일 수 있다`,
        excerpt: latex.slice(0, 120),
      });
    }
  }

  /* 공백은 **수식까지 채운 상태로** 봐야 한다. 글자만 이어 붙이면 수식이
   * 앉아 있던 자리가 전부 빈칸으로 보여, 멀쩡한 발문 17개가 걸렸다. */
  if (/\S {2,}\S/.test(whole)) {
    push({
      printedNumber,
      where,
      kind: "과도한-공백",
      detail: "글자 사이가 두 칸 이상 벌어졌다 — 조판 정렬이 그대로 남았다",
      excerpt: whole.replace(/ {2,}/g, (m) => `[${m.length}칸]`).slice(0, 120),
    });
  }
}

export function auditQuestion(q: ExtractedQuestion): Finding[] {
  const out: Finding[] = [];
  const push = (f: Finding): void => {
    out.push(f);
  };
  inspect(q.printedNumber, "발문", q.stem, push);
  if (render(q.stem).trim() === "" && q.figureBoxes.length === 0) {
    push({
      printedNumber: q.printedNumber,
      where: "발문",
      kind: "내용-없음",
      detail: "발문이 비었는데 그림도 없다",
      excerpt: "",
    });
  }
  for (const c of q.choices ?? []) {
    inspect(q.printedNumber, `선택지 ${c.marker}`, c.runs, push);
  }
  for (const [i, item] of (q.conditionBox?.items ?? []).entries()) {
    inspect(q.printedNumber, `보기 ${i + 1}`, item.runs, push);
  }
  return out;
}

export function auditAnswer(printedNumber: string, a: ParsedAnswer): Finding[] {
  const out: Finding[] = [];
  const push = (f: Finding): void => {
    out.push(f);
  };
  inspect(printedNumber, "정답", a.answer, push);
  if (render(a.answer).trim() === "") {
    push({
      printedNumber,
      where: "정답",
      kind: "내용-없음",
      detail: "정답이 비었다",
      excerpt: "",
    });
  }
  a.explanation.forEach((line, i) => inspect(printedNumber, `풀이 ${i}`, line, push));
  inspect(printedNumber, "채점기준", a.rubric, push);
  return out;
}
