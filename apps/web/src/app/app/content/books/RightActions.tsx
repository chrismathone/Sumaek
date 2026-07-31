"use client";

import { useActionState } from "react";
import { changeRightStatus, type ActionResult } from "./actions";

/* 사용 권한 중지·복구 (인수 30) — 중지에는 사유가 필수다. */

export function RightActions({
  rightId,
  status,
  holderLabel,
}: {
  rightId: string;
  status: string;
  holderLabel: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    changeRightStatus,
    null,
  );
  const blocked = status === "blocked";
  if (!blocked && status !== "usable") return null;

  return (
    <div className="mt-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="rightId" value={rightId} />
        <input type="hidden" name="action" value={blocked ? "restore" : "block"} />
        {!blocked && (
          <input
            name="reason"
            placeholder="중지 사유 (필수)"
            aria-label={`${holderLabel} 사용 중지 사유`}
            className="w-44 rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs"
          />
        )}
        <button
          type="submit"
          disabled={pending}
          className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-xs disabled:opacity-60 ${
            blocked
              ? "border-pen text-pen hover:bg-pen-soft/50"
              : "border-grade text-grade hover:bg-grade-soft"
          }`}
        >
          {pending ? "처리 중…" : blocked ? "다시 사용 가능으로" : "사용 중지"}
        </button>
      </form>
      {state && (
        <p
          role="status"
          className={`mt-2 rounded-[var(--radius-control)] px-3 py-2 text-xs ${
            state.ok ? "bg-pen-soft/60" : "bg-grade-soft text-grade"
          }`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
