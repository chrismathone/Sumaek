"use client";

import { useActionState, useState } from "react";
import {
  addRouteNode,
  createDraftVersion,
  createRoutePlan,
  deleteRouteNode,
  moveRouteNode,
  publishRoute,
  validateDraft,
  type BuilderResult,
} from "./actions";

function StatusLine({ state }: { state: BuilderResult | null }) {
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

export function NewRouteForm({
  groups,
  learners,
}: {
  groups: Array<{ id: string; name: string }>;
  learners: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<BuilderResult | null, FormData>(
    createRoutePlan,
    null,
  );
  const [scope, setScope] = useState<"group" | "learner">("group");
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-sm">
        루트 이름
        <input name="name" required placeholder="중2 일차함수 단원"
          className="mt-1 block w-48 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
      </label>
      <label className="text-sm">
        종류
        <select name="scope" value={scope}
          onChange={(e) => setScope(e.target.value as "group" | "learner")}
          className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
          <option value="group">반 공통 루트</option>
          <option value="learner">학생 독립 루트</option>
        </select>
      </label>
      {scope === "group" ? (
        <label className="text-sm">
          대상 반
          <select name="learningGroupId"
            className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <label className="text-sm">
          대상 학생
          <select name="learnerId"
            className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
            {learners.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm">
        목표 종료일
        <input name="targetEndDate" type="date"
          className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
      </label>
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "생성 중…" : "루트 만들기"}
      </button>
      <div className="w-full"><StatusLine state={state} /></div>
    </form>
  );
}

const NODE_KIND_OPTIONS = [
  { value: "concept_lesson", label: "개념 수업" },
  { value: "problem_solving", label: "문제 풀이" },
  { value: "book_range", label: "교재 범위" },
  { value: "homework", label: "숙제" },
  { value: "confirmation_test", label: "확인테스트" },
  { value: "wrong_answer_review", label: "오답 복습" },
  { value: "cumulative_review", label: "누적 복습" },
  { value: "buffer", label: "버퍼" },
] as const;

export function AddNodeForm({
  planId,
  lockVersion,
  concepts,
}: {
  planId: string;
  lockVersion: number;
  concepts: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<BuilderResult | null, FormData>(
    addRouteNode,
    null,
  );
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="expectedLockVersion" value={lockVersion} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          종류
          <select name="kind"
            className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
            {NODE_KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          노드 제목
          <input name="title" required placeholder="일차함수의 뜻"
            className="mt-1 block w-48 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          예상 (분)
          <input name="expectedMinutes" type="number" defaultValue={60} min={5} max={480}
            className="mt-1 block w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
        </label>
        <button type="submit" disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? "추가 중…" : "노드 추가"}
        </button>
      </div>
      {concepts.length > 0 && (
        <fieldset className="text-sm">
          <legend className="text-xs text-ink-soft">
            다루는 개념 (선택 — 선수 공백·커버리지 검증의 입력)
          </legend>
          <div className="mt-1.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {concepts.map((c) => (
              <label key={c.id}
                className="flex cursor-pointer items-center gap-1 rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs has-checked:border-pen has-checked:bg-pen-soft/50">
                <input type="checkbox" name="conceptIds" value={c.id}
                  className="accent-[var(--color-pen)]" />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <StatusLine state={state} />
    </form>
  );
}

export function NodeRowActions({
  planId,
  nodeId,
  lockVersion,
}: {
  planId: string;
  nodeId: string;
  lockVersion: number;
}) {
  const [moveState, moveAction, movePending] = useActionState<
    BuilderResult | null,
    FormData
  >(moveRouteNode, null);
  const [deleteState, deleteAction, deletePending] = useActionState<
    BuilderResult | null,
    FormData
  >(deleteRouteNode, null);
  const busy = movePending || deletePending;
  const error = [moveState, deleteState].find((s) => s && !s.ok);
  return (
    <span className="flex items-center gap-1">
      <form action={moveAction} className="inline">
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="nodeId" value={nodeId} />
        <input type="hidden" name="expectedLockVersion" value={lockVersion} />
        <input type="hidden" name="direction" value="up" />
        <button type="submit" disabled={busy} aria-label="위로"
          className="rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs hover:bg-paper disabled:opacity-60">
          ↑
        </button>
      </form>
      <form action={moveAction} className="inline">
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="nodeId" value={nodeId} />
        <input type="hidden" name="expectedLockVersion" value={lockVersion} />
        <input type="hidden" name="direction" value="down" />
        <button type="submit" disabled={busy} aria-label="아래로"
          className="rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs hover:bg-paper disabled:opacity-60">
          ↓
        </button>
      </form>
      <form action={deleteAction} className="inline">
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="nodeId" value={nodeId} />
        <input type="hidden" name="expectedLockVersion" value={lockVersion} />
        <button type="submit" disabled={busy} aria-label="삭제"
          className="rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs text-grade hover:bg-grade-soft disabled:opacity-60">
          삭제
        </button>
      </form>
      {error && <span className="text-xs text-grade">{error.message}</span>}
    </span>
  );
}

export function ValidatePublishControls({
  planId,
  canPublish,
  lockVersion,
}: {
  planId: string;
  canPublish: boolean;
  lockVersion: number;
}) {
  const [validateState, validateAction, validatePending] = useActionState<
    BuilderResult | null,
    FormData
  >(validateDraft, null);
  const [publishState, publishAction, publishPending] = useActionState<
    BuilderResult | null,
    FormData
  >(publishRoute, null);
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-3">
        <form action={validateAction}>
          <input type="hidden" name="planId" value={planId} />
          <button type="submit" disabled={validatePending}
            className="rounded-[var(--radius-control)] border border-pen px-4 py-2 text-sm font-medium text-pen hover:bg-pen-soft/50 disabled:opacity-60">
            {validatePending ? "검증 중…" : "검증 실행"}
          </button>
        </form>
        {canPublish && (
          <form action={publishAction}>
            <input type="hidden" name="planId" value={planId} />
            <input type="hidden" name="expectedLockVersion" value={lockVersion} />
            <button type="submit" disabled={publishPending}
              className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {publishPending ? "게시 중…" : "게시"}
            </button>
          </form>
        )}
      </div>
      <StatusLine state={publishState ?? validateState} />
    </div>
  );
}

export function NewVersionButton({ planId }: { planId: string }) {
  const [state, action, pending] = useActionState<BuilderResult | null, FormData>(
    createDraftVersion,
    null,
  );
  return (
    <form action={action}>
      <input type="hidden" name="planId" value={planId} />
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] border border-rule px-4 py-2 text-sm hover:bg-paper disabled:opacity-60">
        {pending ? "만드는 중…" : "새 버전 만들기"}
      </button>
      <StatusLine state={state} />
    </form>
  );
}
