"use client";

import { useActionState } from "react";
import {
  executeDeletion,
  requestDeletion,
  type ActionResult,
} from "./actions";

function StatusLine({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`mt-2 rounded-[var(--radius-control)] px-3 py-2 text-sm ${
        state.ok ? "bg-pen-soft/60" : "bg-grade-soft text-grade"
      }`}
    >
      {state.message}
    </p>
  );
}

export function DeletionRequestForm({ learnerId }: { learnerId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    requestDeletion,
    null,
  );
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="learnerId" value={learnerId} />
      <label className="text-sm">
        요청 사유 (필수)
        <input name="reason" required placeholder="보호자 삭제 요청 접수"
          className="mt-1 block w-64 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
      </label>
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] border border-grade px-4 py-2 text-sm font-medium text-grade hover:bg-grade-soft disabled:opacity-60">
        {pending ? "접수 중…" : "삭제 요청 접수"}
      </button>
      <div className="w-full"><StatusLine state={state} /></div>
    </form>
  );
}

export function DeletionExecuteForm({
  requestId,
  learnerId,
}: {
  requestId: string;
  learnerId: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    executeDeletion,
    null,
  );
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="learnerId" value={learnerId} />
      <label className="text-sm">
        학습자 표시명 재입력 (위험 작업 확인)
        <input name="confirmName" required
          className="mt-1 block w-48 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
      </label>
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] bg-grade px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "집행 중…" : "익명화 집행"}
      </button>
      <div className="w-full"><StatusLine state={state} /></div>
    </form>
  );
}
