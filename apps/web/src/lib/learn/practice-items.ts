import "server-only";
import { symbolAnswerClass } from "@su-maek/core/grading";
import { renderMixedText } from "@su-maek/core/math";
import {
  adaptInstructionForChoice,
  isSymbolAnswerKey,
  markSymbolGlyphs,
  splitInstructionLine,
  symbolOptionsFromBodyText,
} from "@/lib/learn/symbol-answer";
import {
  listPracticeQuestions,
  type MaterialRow,
} from "@/lib/domain/learning-material";
import type { PracticeItem } from "@/app/learn/practice/PracticeForm";

/* ─────────────────────────────────────────────────────────────
 * 연습 자료 한 건 → 화면에 낼 문항 목록.
 *
 * 개념 학습 화면(/learn/study)과 연습문제 화면(/learn/practice)이 **같은
 * 묶음을 낸다.** 각자 조립하면 판별 문항의 발문 전환·기호 칩 규칙이 한쪽에서만
 * 적용되는 상태가 된다 — 같은 문항이 화면에 따라 다른 모습이 되는 셈이다.
 *
 * 정답은 여기서 화면으로 내려가지 않는다. 기호 칩은 발문이 언급한 기호만
 * 담기므로(symbol-answer.ts) 답을 흘리지 않는다.
 * ───────────────────────────────────────────────────────────── */

interface ContentRun {
  kind: "text" | "math";
  text?: string;
  math?: { latex: string };
}

function runsToText(runs: ContentRun[]): string {
  return runs
    .map((r) => (r.kind === "math" ? `$${r.math?.latex ?? ""}$` : (r.text ?? "")))
    .join("");
}

function blocksToText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return body
    .map((block: { type?: string; text?: string; runs?: ContentRun[] }) => {
      if (block.type === "text") return block.text ?? "";
      if (block.type === "paragraph") return runsToText(block.runs ?? []);
      return "";
    })
    .join("\n");
}

export interface PracticeSet {
  material: MaterialRow;
  items: PracticeItem[];
}

/** 연습 자료들 → 낼 수 있는 문항이 있는 묶음만 (문항 0건인 묶음은 뺀다) */
export async function buildPracticeSets(input: {
  organizationId: string;
  materials: MaterialRow[];
}): Promise<PracticeSet[]> {
  const sets = await Promise.all(
    input.materials.map(async (m) => {
      const questions = await listPracticeQuestions({
        organizationId: input.organizationId,
        materialId: m.id,
      });
      const items: PracticeItem[] = questions.map((q, i) => {
        /* 판별 문항이면 발문을 고르기 발문으로 표시 전환하고, 발문이 언급한
         * 기호만 칩으로 낸다. 정답 값은 화면으로 내려가지 않는다 —
         * 기호 쌍은 발문 자체에 이미 적혀 있다. */
        const symbolAnswer =
          q.kind !== "multiple_choice" &&
          isSymbolAnswerKey(q.answerKey, (s) => symbolAnswerClass(s) !== null);
        let bodyText = blocksToText(q.body);
        if (symbolAnswer) bodyText = adaptInstructionForChoice(bodyText);
        /* 발문의 기호는 답 칩과 같은 그림으로 그린다(QuestionLine). 판별
         * 문항에서만 표시한다 — 다른 문항의 ×는 곱셈이지 답 기호가 아니다. */
        const marked = symbolAnswer ? markSymbolGlyphs(bodyText) : bodyText;
        return {
          key: q.assessmentQuestionId,
          number: i + 1,
          kind: q.kind,
          symbolOptions: symbolAnswer ? symbolOptionsFromBodyText(bodyText) : [],
          bodyLines: marked
            .split("\n")
            .flatMap(splitInstructionLine)
            .map((line) => line.trim())
            .filter((line) => line !== "")
            .map((line) => renderMixedText(line, "publish").html),
          choices: Array.isArray(q.choices)
            ? (
                q.choices as Array<{
                  choiceId: string;
                  order: number;
                  content?: ContentRun[];
                }>
              ).map((c) => ({
                choiceId: c.choiceId,
                order: c.order,
                html: renderMixedText(runsToText(c.content ?? []), "publish").html,
              }))
            : null,
        };
      });
      return { material: m, items };
    }),
  );
  return sets.filter((s) => s.items.length > 0);
}
