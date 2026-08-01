"use client";

import { useActionState } from "react";
import {
  cancelOverride,
  createOverride,
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

const KIND_OPTIONS = [
  { value: "remediation", label: "취약 개념 보충" },
  { value: "absence_makeup", label: "불참 보강" },
  { value: "temporary_advance", label: "일시적 선행" },
  { value: "retest_relearn", label: "재시험 재학습" },
  { value: "skip", label: "진도 건너뛰기" },
] as const;

export function OverrideForm({
  learnerId,
  baseNodes,
}: {
  learnerId: string;
  baseNodes: Array<{ id: string; title: string }>;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createOverride,
    null,
  );
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="learnerId" value={learnerId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          종류
          <select name="kind"
            className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          사유 (필수)
          <input name="reason" required placeholder="확인테스트 미통과 — 가감법 보충"
            className="mt-1 block w-64 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          목표
          <input name="goal" placeholder="가감법 정답률 80%"
            className="mt-1 block w-40 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          시작일
          <input name="effectiveFrom" type="date"
            className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
        </label>
        <label className="text-sm">
          종료일
          <input name="effectiveTo" type="date"
            className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
        </label>
        <label className="text-sm">
          보충 노드 제목
          <input name="insertTitle" placeholder="가감법 집중 연습"
            className="mt-1 block w-44 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          보충 (분)
          <input name="insertMinutes" type="number" defaultValue={60} min={5} max={480}
            className="mt-1 block w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
        </label>
      </div>
      {baseNodes.length > 0 && (
        <div className="text-sm">
          <label htmlFor="rejoinNodeId" className="block">
            재합류 지점
          </label>
          <p className="text-xs text-ink-soft">
            이 노드가 놓인 차시에서 반 진도로 돌아옵니다. 그 앞의 반 공통
            노드는 학생 경로에서 빠집니다 (지나간 진도를 따라잡지 않습니다).
          </p>
          <select
            id="rejoinNodeId"
            name="rejoinNodeId"
            className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm"
          >
            <option value="">재합류 없음</option>
            {baseNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {baseNodes.length > 0 && (
        <fieldset className="text-sm">
          <legend className="text-xs text-ink-soft">
            건너뛸 반 루트 노드 (기준 버전에서 선택)
          </legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {baseNodes.map((n) => (
              <label key={n.id}
                className="flex cursor-pointer items-center gap-1 rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs has-checked:border-pen has-checked:bg-pen-soft/50">
                <input type="checkbox" name="skipNodeIds" value={n.id}
                  className="accent-[var(--color-pen)]" />
                {n.title}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "만드는 중…" : "오버라이드 만들기"}
      </button>
      <StatusLine state={state} />
    </form>
  );
}

export function CancelOverrideButton({
  overrideId,
  learnerId,
}: {
  overrideId: string;
  learnerId: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    cancelOverride,
    null,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="overrideId" value={overrideId} />
      <input type="hidden" name="learnerId" value={learnerId} />
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs hover:bg-paper disabled:opacity-60">
        {pending ? "처리 중…" : "취소"}
      </button>
      {state && !state.ok && (
        <span role="status" className="ml-2 text-xs text-grade">{state.message}</span>
      )}
    </form>
  );
}
