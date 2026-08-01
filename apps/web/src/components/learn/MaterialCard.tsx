"use client";

import { useActionState } from "react";
import { ActionToast } from "@/components/ActionToast";
import {
  completeMaterialAction,
  type MaterialActionResult,
} from "@/app/learn/study/actions";

/* 자료 한 건 — 읽기·인강 공용.
 *
 * 「다 봤어요」는 학생이 직접 누른다. 열람만으로 완료를 찍으면 스크롤만
 * 내려도 공부한 것이 되고, 그러면 진도가 아무것도 뜻하지 않게 된다. */

export function CompleteMaterialButton({
  materialId,
  done,
}: {
  materialId: string;
  done: boolean;
}) {
  const [state, action, pending] = useActionState<
    MaterialActionResult | null,
    FormData
  >(completeMaterialAction, null);

  if (done) {
    return (
      <span className="rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-1.5 font-mono text-xs text-ink-soft">
        완료
      </span>
    );
  }

  return (
    <form action={action} className="inline">
      <input type="hidden" name="materialId" value={materialId} />
      <input type="hidden" name="status" value="completed" />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-sm font-medium text-pen disabled:opacity-60"
      >
        {pending ? "표시 중…" : "다 봤어요"}
      </button>
      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </form>
  );
}
