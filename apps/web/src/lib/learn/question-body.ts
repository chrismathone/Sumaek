import "server-only";
import { renderMixedText } from "@su-maek/core/math";
import {
  markSymbolGlyphs,
  splitInstructionLine,
} from "@/lib/learn/symbol-answer";

/* ─────────────────────────────────────────────────────────────
 * 문항 본문 → 화면에 낼 줄들.
 *
 * 연습·테스트·복습이 **같은 함수를 쓴다.** 각자 조립하면 같은 문항이 화면에
 * 따라 다른 모습이 된다 — 실제로 그랬다: 발문의 ◯·△·×가 연습에서는 도형,
 * 테스트·복습에서는 폰트 글자였고, 판별 대상(「…고르시오. 11」의 11)이 한쪽
 * 에서만 다음 줄로 갔다.
 *
 * 줄을 가르는 근거와 기호를 그리는 근거는 symbol-answer.ts에 있다. 여기서는
 * 그 둘을 렌더에 꿰기만 한다.
 * ───────────────────────────────────────────────────────────── */

export interface QuestionBodyRender {
  /** 게시 모드로 렌더된 줄들 — 첫 줄이 발문, 뒤가 판별 대상이다 */
  lines: string[];
  /** 수식 렌더 실패 — 삼키지 않고 올려 보낸다. 시험 화면은 이걸로 응시를 막는다 */
  failures: string[];
}

export function renderQuestionBody(text: string): QuestionBodyRender {
  const failures: string[] = [];
  const lines = markSymbolGlyphs(text)
    .split("\n")
    .flatMap(splitInstructionLine)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const rendered = renderMixedText(line, "publish");
      failures.push(...rendered.failures);
      return rendered.html;
    });
  return { lines, failures };
}
