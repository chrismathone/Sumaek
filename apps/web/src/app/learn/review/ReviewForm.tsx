"use client";

import { useActionState } from "react";
import Link from "next/link";
import { answerReviewAction } from "./actions";
import type { ReviewAnswerResult } from "@/lib/domain/review";

/* 복습 한 건 풀기. 결과는 **그 자리에 남긴다** — 맞았는지 틀렸는지가
 * 이 화면의 본문이라 6초 뒤 사라지는 알림으로 띄우면 안 된다
 * (알림화 규약은 목록 행 안의 결과에 대한 것이다). */

export function ReviewForm({
  reviewItemId,
  conceptName,
  bodyHtml,
  choices,
  kind,
}: {
  reviewItemId: string;
  conceptName: string;
  bodyHtml: string;
  choices: Array<{ choiceId: string; order: number; html: string }> | null;
  kind: string;
}) {
  const [state, action, pending] = useActionState<
    ReviewAnswerResult | null,
    FormData
  >(answerReviewAction, null);

  if (state?.ok) {
    return (
      <div
        className={`rounded-lg border p-5 ${
          state.correct
            ? "border-pen bg-pen-soft/40"
            : "border-highlight bg-highlight-soft"
        }`}
      >
        <p className="font-medium">{state.message}</p>
        <p className="mt-1 text-sm text-ink-soft">
          {state.remaining > 0
            ? `남은 복습 ${state.remaining}건`
            : "오늘 할 복습을 모두 마쳤습니다."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {state.remaining > 0 ? (
            <Link
              href="/learn/review"
              className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
            >
              다음 복습
            </Link>
          ) : null}
          <Link
            href="/learn/today"
            className="rounded-[var(--radius-control)] border border-rule px-4 py-2 text-sm"
          >
            오늘 학습으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-lg border border-rule bg-surface p-5">
      <input type="hidden" name="reviewItemId" value={reviewItemId} />
      <input type="hidden" name="kind" value={kind} />
      <p className="font-mono text-xs text-ink-soft">{conceptName}</p>
      <div
        className="mt-2 text-[15px]"
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />

      {kind === "multiple_choice" && choices ? (
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">답 고르기</legend>
          {choices.map((c, i) => (
            <label
              key={c.choiceId}
              className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-rule px-3 py-2 has-[:checked]:border-pen has-[:checked]:bg-pen-soft/30"
            >
              <input
                type="radio"
                name="choiceId"
                value={c.choiceId}
                className="sr-only"
              />
              <span className="font-mono text-sm">
                {["①", "②", "③", "④", "⑤"][i]}
              </span>
              <span dangerouslySetInnerHTML={{ __html: c.html }} />
            </label>
          ))}
        </fieldset>
      ) : (
        <label className="mt-4 block text-sm text-ink-soft">
          답 (분수는 3/4 형태로 입력)
          <input
            name="answer"
            type="text"
            className="mt-1.5 block w-48 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-ink focus:border-pen focus:outline-none"
          />
        </label>
      )}

      {state && !state.ok && (
        <p role="alert" className="mt-3 text-sm text-grade">
          {state.message}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "채점 중…" : "확인"}
        </button>
        <Link href="/learn/today" className="text-sm text-ink-soft underline underline-offset-4">
          나중에 하기
        </Link>
      </div>
    </form>
  );
}
