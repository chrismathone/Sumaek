"use client";

import { useActionState } from "react";
import { ActionToast } from "@/components/ActionToast";
import { resolveExceptionAction } from "./actions";

/* 판정 폼은 DataTable 「판정」 칸 안에서 렌더된다.
 * 결과를 그 자리에 그리면 줄바꿈되어 행 높이가 늘어나므로 알림으로 띄운다. */

export function ResolveForm({
  exceptionId,
  maxPoints,
}: {
  exceptionId: string;
  maxPoints: number;
}) {
  const [state, action, pending] = useActionState<
    { ok: boolean; message: string } | null,
    FormData
  >(resolveExceptionAction, null);

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <label className="text-sm">
        판정
        <select
          name="verdict"
          className="ml-2 rounded-[var(--radius-control)] border border-rule bg-surface px-2 py-1.5 text-sm"
        >
          <option value="correct">정답 확정 (+{maxPoints}점)</option>
          <option value="incorrect">오답 확정</option>
          <option value="partial">부분 점수</option>
        </select>
      </label>
      <label className="text-sm">
        부분 점수
        <input
          type="number"
          name="partialScore"
          min={0}
          max={maxPoints}
          defaultValue={0}
          className="ml-2 w-16 rounded-[var(--radius-control)] border border-rule px-2 py-1.5 font-mono text-sm"
        />
      </label>
      <input
        type="text"
        name="note"
        placeholder="판정 사유 (감사 기록)"
        className="min-w-40 flex-1 rounded-[var(--radius-control)] border border-rule px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "반영 중…" : "판정 반영"}
      </button>
      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </form>
  );
}
