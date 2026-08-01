"use client";

import { useActionState } from "react";
import { ActionToast } from "@/components/ActionToast";
import {
  dismissAvailability,
  reportAvailability,
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

export function AvailabilityForm({
  learningGroupId,
  learners,
  today,
}: {
  learningGroupId: string;
  learners: Array<{ id: string; name: string }>;
  today: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    reportAvailability,
    null,
  );
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="learningGroupId" value={learningGroupId} />
      <label className="text-sm">
        구분
        <select name="kind" required
          className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
          <option value="group_cancelled">휴강 (반 전체)</option>
          <option value="learner_absence">학습 불참 (학생)</option>
        </select>
      </label>
      <label className="text-sm">
        대상 학생
        <select name="learnerId"
          className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
          <option value="">— (휴강은 반 전체)</option>
          {learners.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        시작일
        <input name="startsOn" type="date" defaultValue={today} required
          className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
      </label>
      <label className="text-sm">
        종료일
        <input name="endsOn" type="date" defaultValue={today} required
          className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
      </label>
      <label className="text-sm">
        사유
        <input name="reason" placeholder="학교 시험 등"
          className="mt-1 block w-36 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
      </label>
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "접수 중…" : "접수"}
      </button>
      <div className="w-full"><StatusLine state={state} /></div>
    </form>
  );
}

export function DismissButton({
  eventId,
  learningGroupId,
}: {
  eventId: string;
  learningGroupId: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    dismissAvailability,
    null,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="learningGroupId" value={learningGroupId} />
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs hover:bg-paper disabled:opacity-60">
        {pending ? "처리 중…" : "무시"}
      </button>
      {/* 결과는 알림으로 — 목록 행 안이라 여기에 그리면 행 높이가 늘어난다 */}
      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </form>
  );
}
