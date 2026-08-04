import type { Metadata } from "next";
import Link from "next/link";
import { symbolAnswerClass } from "@su-maek/core/grading";
import { renderMixedText } from "@su-maek/core/math";
import {
  adaptInstructionForChoice,
  isSymbolAnswerKey,
  symbolOptionsFromBodyText,
} from "@/lib/learn/symbol-answer";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import {
  listMaterials,
  listPracticeQuestions,
} from "@/lib/domain/learning-material";
import { getTodayScope } from "@/lib/learn/today-context";
import { PracticeForm, type PracticeItem } from "./PracticeForm";

export const metadata: Metadata = { title: "연습문제" };

/* 연습문제 — 오늘 개념의 문항을 풀어 본다.
 * 점수로 남지 않고 숙련도에도 반영되지 않는다. 그 사실을 화면에 적는다 —
 * 학생이 "이것도 성적에 들어가나" 걱정하면 연습이 연습이 아니게 된다. */

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

export default async function PracticePage() {
  const learner = (await getCurrentLearner())!;
  const today = todayInKst();
  const scope = await getTodayScope(learner, today);
  const materials = await listMaterials({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    conceptIds: scope.conceptIds,
    kinds: ["practice"],
  });

  const sets = await Promise.all(
    materials.map(async (m) => {
      const questions = await listPracticeQuestions({
        organizationId: learner.user.organizationId,
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
        return {
          key: q.assessmentQuestionId,
          number: i + 1,
          kind: q.kind,
          symbolOptions: symbolAnswer ? symbolOptionsFromBodyText(bodyText) : [],
          bodyHtml: renderMixedText(bodyText, "publish").html,
          choices: Array.isArray(q.choices)
            ? (q.choices as Array<{
                choiceId: string;
                order: number;
                content?: ContentRun[];
              }>).map((c) => ({
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
  const usable = sets.filter((s) => s.items.length > 0);

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold">연습문제</h1>
      <p className="mt-1 text-sm text-ink-soft">
        오늘 배우는 개념을 직접 풀어 봅니다.{" "}
        <strong className="font-medium">점수로 남지 않고</strong> 성적에도
        반영되지 않습니다. 틀려도 괜찮습니다.
      </p>

      {usable.length === 0 ? (
        <div className="mt-4 rounded-lg border border-rule bg-surface p-5">
          <p className="font-medium">
            {!scope.hasSession
              ? "오늘은 수업이 없어 연습할 개념이 없습니다."
              : materials.length === 0
                ? "오늘 개념에 등록된 연습문제가 아직 없습니다."
                : "연습문제 묶음은 있지만 낼 수 있는 문항이 없습니다."}
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            {scope.hasSession &&
              materials.length > 0 &&
              "문제은행에 이 개념의 검수 완료 문항이 없습니다. 선생님께 알려 주세요."}
            {scope.hasSession &&
              materials.length === 0 &&
              "선생님이 연습문제를 올리면 여기에 표시됩니다."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-4">
          {usable.map(({ material, items }) => (
            <li key={material.id}>
              <PracticeForm
                materialId={material.id}
                title={material.title}
                conceptName={material.conceptName}
                items={items}
              />
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/learn/today"
        className="mt-6 inline-block text-sm text-pen underline underline-offset-4"
      >
        오늘 학습으로 돌아가기
      </Link>
    </div>
  );
}
