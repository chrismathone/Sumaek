import type { Metadata } from "next";
import Link from "next/link";
import { renderMixedText } from "@su-maek/core/math";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { listDueReviews } from "@/lib/domain/review";
import { renderQuestionBody } from "@/lib/learn/question-body";
import { ReviewForm } from "./ReviewForm";

export const metadata: Metadata = { title: "복습" };

/* 복습 화면 — 기한이 온 것 **한 건씩** 낸다.
 * 목록을 통째로 보여 주면 무엇부터 할지 또 학생이 정해야 한다. 오래된
 * 것부터 하나씩 내고, 하나 끝나면 다음으로 이어 준다. */

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

function bodyToText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return body
    .map((block: { type?: string; text?: string; runs?: ContentRun[] }) => {
      if (block.type === "text") return block.text ?? "";
      if (block.type === "paragraph") return runsToText(block.runs ?? []);
      return "";
    })
    .join("\n");
}

export default async function ReviewPage() {
  const learner = (await getCurrentLearner())!;
  const today = todayInKst();
  const due = await listDueReviews({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    today,
    limit: 20,
  });

  if (due.length === 0) {
    return (
      <div>
        <h1 className="font-[MaruBuri] text-2xl font-semibold">복습</h1>
        <p className="mt-4 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
          오늘 할 복습이 없습니다. 틀린 개념은 간격을 두고 여기에 다시 올라옵니다.
        </p>
        <Link
          href="/learn/today"
          className="mt-4 inline-block text-sm text-pen underline underline-offset-4"
        >
          오늘 학습으로 돌아가기
        </Link>
      </div>
    );
  }

  /* 문항 참조가 끊긴 항목은 풀 수 없다 — 지어내지 않고 그렇다고 말한다.
   * (review_items.question_id는 nullable이고, 문항이 회수되면 본문도 없다) */
  const first = due.find((r) => r.body !== null);

  if (!first) {
    return (
      <div>
        <h1 className="font-[MaruBuri] text-2xl font-semibold">복습</h1>
        <p className="mt-4 rounded-lg border border-rule bg-surface p-5 text-sm">
          복습 {due.length}건이 잡혀 있지만 문항을 불러올 수 없습니다. 선생님께
          알려 주세요.
        </p>
        <Link
          href="/learn/today"
          className="mt-4 inline-block text-sm text-pen underline underline-offset-4"
        >
          오늘 학습으로 돌아가기
        </Link>
      </div>
    );
  }

  const rendered = renderQuestionBody(bodyToText(first.body));
  const choices = Array.isArray(first.choices)
    ? (first.choices as Array<{
        choiceId: string;
        order: number;
        content?: ContentRun[];
      }>).map((c) => ({
        choiceId: c.choiceId,
        order: c.order,
        html: renderMixedText(runsToText(c.content ?? []), "publish").html,
      }))
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-[MaruBuri] text-2xl font-semibold">복습</h1>
        <p className="font-mono text-xs text-ink-soft">
          기한이 온 {due.length}건 중 1건
          {first.overdue && " · 기한 지남"}
        </p>
      </div>
      {/* 예전 문구는 "맞히면 끝, 틀리면 내일"이었는데 둘 다 사실이 아니다.
          맞히면 간격이 늘어 더 뒤로 밀리고, 틀리면 간격이 줄어 더 빨리 온다.
          정확한 날짜는 답을 낸 뒤에 알려 준다. */}
      <p className="mt-1 text-sm text-ink-soft">
        전에 틀렸던 문항입니다. 맞히면 다음 복습이 더 뒤로 밀리고, 틀리면 더
        빨리 다시 올라옵니다.
      </p>
      <div className="mt-4">
        <ReviewForm
          reviewItemId={first.id}
          conceptName={first.conceptName}
          bodyLines={rendered.lines}
          choices={choices}
          kind={first.kind ?? "short_answer"}
        />
      </div>
    </div>
  );
}
