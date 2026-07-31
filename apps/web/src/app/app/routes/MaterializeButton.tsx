"use client";

import { useActionState } from "react";
import type { MaterializeResult } from "@/lib/domain/schedule";
import { materializeSchedule } from "./actions";

export function MaterializeButton({
  learningGroupId,
}: {
  learningGroupId: string;
}) {
  const [result, action, pending] = useActionState<
    MaterializeResult | null,
    FormData
  >(materializeSchedule, null);

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="learningGroupId" value={learningGroupId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ink disabled:opacity-60"
        >
          {pending ? "계산 중…" : "미래 일정 생성·재계산"}
        </button>
      </form>
      {result && (
        <p
          role="status"
          className={`mt-2 rounded-[var(--radius-control)] px-3 py-2 text-sm ${
            result.ok ? "bg-pen-soft/60" : "bg-grade-soft text-grade"
          }`}
        >
          {result.message}
          {result.ok && result.firstDate && (
            <>
              {" "}
              <span className="font-mono text-xs">
                ({result.firstDate} ~ {result.lastDate}
                {result.preservedSessions > 0 &&
                  ` · 완료·잠금 ${result.preservedSessions}건 보존`}
                {result.conflicts > 0 && ` · 배치 불가 ${result.conflicts}건`})
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
