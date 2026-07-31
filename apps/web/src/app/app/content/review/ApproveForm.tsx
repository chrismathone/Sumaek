"use client";

import { useActionState } from "react";
import { approveQuestionAction } from "@/app/app/content/ingestion/actions";

/** 문항 검수 승인 — 사람 확인 후에만 게시·출제 가능 (원칙 9) */
export function ApproveForm({ questionId }: { questionId: string }) {
  const [state, action, pending] = useActionState<
    { ok: boolean; message: string } | null,
    FormData
  >(approveQuestionAction, null);

  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="questionId" value={questionId} />
      <input
        type="text"
        name="note"
        placeholder="검수 의견 (정답·수식·출처 확인)"
        className="min-w-48 flex-1 rounded-[var(--radius-control)] border border-rule px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "반영 중…" : "검수 승인·게시"}
      </button>
      {state && (
        <p
          role="status"
          className={`w-full text-sm ${state.ok ? "text-pen" : "text-grade"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
