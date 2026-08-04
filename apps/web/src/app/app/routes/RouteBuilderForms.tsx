"use client";

import { useActionState, useState } from "react";
import { ActionToast } from "@/components/ActionToast";
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
import { ConflictPanel } from "./ConflictPanel";
import { BASELINE_FIELD, NODE_KINDS, nodeKindLabel } from "./shared";
import {
  HOMEWORK_MODES,
  HOMEWORK_MODE_LABEL,
  payloadFieldsFor,
} from "./node-payload";

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


export function AddNodeForm({
  planId,
  lockVersion,
  baselineNodes,
  concepts,
}: {
  planId: string;
  lockVersion: number;
  /** 이 화면을 그릴 때의 노드 목록 — 충돌 시 비교 기준 (인수 20) */
  baselineNodes: string;
  concepts: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<BuilderResult | null, FormData>(
    addRouteNode,
    null,
  );
  /* 종류에 따라 필요한 칸이 다르다. 전부 열어 두면 교사는 개념 수업에도
   * 쪽 범위를 채워야 하는 줄 알고, 채우면 서버가 거부한다. */
  const [kind, setKind] = useState<string>(NODE_KINDS[0]);
  const [homeworkMode, setHomeworkMode] = useState<string>(HOMEWORK_MODES[0]);
  const fields = payloadFieldsFor(kind);
  const needsBook = fields.book && (kind !== "homework" || homeworkMode === "book_pages");
  return (
    /* 충돌 화면은 폼 **밖**에 둔다 — 폼 안에 두면 <form> 중첩이 되어 그 안의
       "다시 적용" 버튼이 바깥 폼(낡은 토큰)을 제출한다. 실제로 재현했다:
       다시 적용이 같은 충돌을 무한히 되풀이했다. */
    <>
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="expectedLockVersion" value={lockVersion} />
      <input type="hidden" name={BASELINE_FIELD} value={baselineNodes} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          종류
          <select name="kind" value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
            {NODE_KINDS.map((k) => (
              <option key={k} value={k}>{nodeKindLabel(k)}</option>
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
      {(fields.book || fields.homework || fields.assessment) && (
        <fieldset className="rounded-[var(--radius-control)] border border-rule p-3 text-sm">
          <legend className="px-1 text-xs text-ink-soft">
            {nodeKindLabel(kind)} 설정 — 비우면 저장되지 않습니다
          </legend>
          <div className="flex flex-wrap items-end gap-3">
            {fields.homework && (
              <label className="text-sm">
                숙제 방식
                <select name="homeworkMode" value={homeworkMode}
                  onChange={(e) => setHomeworkMode(e.target.value)}
                  className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
                  {HOMEWORK_MODES.map((m) => (
                    <option key={m} value={m}>{HOMEWORK_MODE_LABEL[m]}</option>
                  ))}
                </select>
              </label>
            )}
            {fields.homework && homeworkMode === "practice_set" && (
              <label className="text-sm">
                연습문제 자료 ID
                <input name="practiceMaterialId" placeholder="자료 UUID"
                  className="mt-1 block w-72 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-xs" />
              </label>
            )}
            {needsBook && (
              <>
                <label className="text-sm">
                  교재 판본 ID
                  <input name="bookEditionId" placeholder="판본 UUID"
                    className="mt-1 block w-72 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-xs" />
                </label>
                <label className="text-sm">
                  시작 쪽
                  <input name="startPage" type="number" min={1} max={9999}
                    className="mt-1 block w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
                </label>
                <label className="text-sm">
                  끝 쪽
                  <input name="endPage" type="number" min={1} max={9999}
                    className="mt-1 block w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
                </label>
              </>
            )}
            {fields.assessment && (
              <>
                <label className="text-sm">
                  출제 블루프린트 ID
                  <input name="blueprintId" placeholder="블루프린트 UUID"
                    className="mt-1 block w-72 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-xs" />
                </label>
                <label className="text-sm">
                  통과 점수 (선택)
                  <input name="passScore" type="number" min={0} max={100}
                    className="mt-1 block w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
                </label>
              </>
            )}
          </div>
        </fieldset>
      )}

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
    {state?.conflict && (
      <ConflictPanel
        conflict={state.conflict}
        planId={planId}
        action={action}
        pending={pending}
      />
    )}
    </>
  );
}

export function NodeRowActions({
  planId,
  nodeId,
  lockVersion,
  baselineNodes,
}: {
  planId: string;
  nodeId: string;
  lockVersion: number;
  baselineNodes: string;
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
  const conflict = moveState?.conflict ?? deleteState?.conflict ?? null;
  return (
    <span className="flex items-center gap-1">
      <form action={moveAction} className="inline">
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="nodeId" value={nodeId} />
        <input type="hidden" name="expectedLockVersion" value={lockVersion} />
        <input type="hidden" name={BASELINE_FIELD} value={baselineNodes} />
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
        <input type="hidden" name={BASELINE_FIELD} value={baselineNodes} />
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
        <input type="hidden" name={BASELINE_FIELD} value={baselineNodes} />
        <button type="submit" disabled={busy} aria-label="삭제"
          className="rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs text-grade hover:bg-grade-soft disabled:opacity-60">
          삭제
        </button>
      </form>
      {/* 행 안 액션의 결과 — 그 자리에 그리면 행 높이가 늘어난다.
          충돌은 자기 화면(fixed)이 이미 메시지를 싣고 있으므로 겹쳐 띄우지 않는다. */}
      {error && !conflict && (
        <ActionToast ok={false} resultKey={error.message}>
          {error.message}
        </ActionToast>
      )}
      {conflict && (
        <ConflictPanel
          conflict={conflict}
          planId={planId}
          action={conflict.intent.type === "delete" ? deleteAction : moveAction}
          pending={busy}
        />
      )}
    </span>
  );
}

export function ValidatePublishControls({
  planId,
  canPublish,
  lockVersion,
  baselineNodes,
}: {
  planId: string;
  canPublish: boolean;
  lockVersion: number;
  baselineNodes: string;
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
            <input type="hidden" name={BASELINE_FIELD} value={baselineNodes} />
            <button type="submit" disabled={publishPending}
              className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {publishPending ? "게시 중…" : "게시"}
            </button>
          </form>
        )}
      </div>
      <StatusLine state={publishState ?? validateState} />
      {publishState?.conflict && (
        <ConflictPanel
          conflict={publishState.conflict}
          planId={planId}
          action={publishAction}
          pending={publishPending}
        />
      )}
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
