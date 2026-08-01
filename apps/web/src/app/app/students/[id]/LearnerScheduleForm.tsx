"use client";

import { useActionState } from "react";
import { ActionToast } from "@/components/ActionToast";
import {
  materializeLearnerScheduleAction,
  type LearnerScheduleResult,
} from "./actions";

/* 학습자 스코프 일정 실체화 실행 버튼 (인수 4).
 *
 * 결과는 그 자리에 그리지 않고 ActionToast로 띄운다 — 이 버튼은 표 머리에
 * 붙어 있어서 문구를 인라인으로 그리면 아래 표가 통째로 밀린다 (ADR-0016). */

export function MaterializeLearnerScheduleButton({
  learnerId,
}: {
  learnerId: string;
}) {
  const [state, action, pending] = useActionState<
    LearnerScheduleResult | null,
    FormData
  >(materializeLearnerScheduleAction, null);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="learnerId" value={learnerId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "계산 중…" : "개별 일정 계산"}
      </button>
      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </form>
  );
}
