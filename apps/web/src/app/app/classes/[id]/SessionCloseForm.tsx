"use client";

import { useActionState, useState } from "react";
import type { SessionAwaitingClose } from "@su-maek/db/domain";
import { closeSessionAction } from "./actions";

/* ─────────────────────────────────────────────────────────────
 * 반 수업 마감 (T4.2 · E-02).
 *
 * 「마감」 단추 하나로 끝내지 않는다. 이 화면이 만드는 것은 **실제로 어디까지
 * 나갔는가**의 기록이고, 그 기록이 미래 일정 재계획의 입력이 된다(T4.3).
 * 계획된 노드를 그대로 늘어놓고 하나씩 물어야 「다 했다」와 「예제 15번까지」가
 * 구분된다.
 *
 * 학생의 하루 완료 수를 함께 보이되 **마감 조건으로 쓰지 않는다.** 한 명이
 * 다 했다고 반이 끝나지 않고, 반이 끝났다고 학생 하루가 끝나지 않는다
 * (I-21 · ADR-0017 §1).
 * ───────────────────────────────────────────────────────────── */

const PROGRESS_OPTIONS = [
  { value: "completed", label: "다 나감" },
  { value: "partial", label: "일부만" },
  { value: "skipped", label: "못 나감" },
] as const;

function SessionRow({
  session,
  nodeTitle,
}: {
  session: SessionAwaitingClose;
  nodeTitle: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [result, action, pending] = useActionState(closeSessionAction, null);

  const when = session.startsAt.slice(0, 16).replace("T", " ");

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-mono text-sm">
          {when}
          <span className="ml-3 text-ink-soft">
            {session.teacherName ?? "담당 미지정"}
          </span>
        </p>
        <span className="font-mono text-xs text-ink-soft">
          계획 {session.plannedNodeIds.length}개 · 하루 마친 학생{" "}
          {session.learnersCompleted}/{session.learnerCount}
        </span>
      </div>

      {result && (
        <p
          role="status"
          className={`mt-2 text-sm ${result.ok ? "text-ink" : "text-grade"}`}
        >
          {result.message}
        </p>
      )}

      {open ? (
        <form action={action} className="mt-3">
          <input type="hidden" name="sessionId" value={session.sessionId} />
          <input
            type="hidden"
            name="learningGroupId"
            value={session.learningGroupId}
          />

          {session.plannedNodeIds.length === 0 ? (
            <p className="text-sm text-ink-soft">
              이 차시에는 배정된 학습 내용이 없습니다. 마감하면 진행 없음으로
              기록됩니다.
            </p>
          ) : (
            <ul className="space-y-2">
              {session.plannedNodeIds.map((nodeId) => (
                <li
                  key={nodeId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="min-w-0 flex-1 text-sm break-keep">
                    {nodeTitle[nodeId] ?? "이름 없는 차시 내용"}
                  </span>
                  <span className="flex shrink-0 gap-3">
                    {PROGRESS_OPTIONS.map((o) => (
                      <label key={o.value} className="text-sm">
                        <input
                          type="radio"
                          name={`node:${nodeId}`}
                          value={o.value}
                          defaultChecked={o.value === "completed"}
                          required
                          className="mr-1"
                        />
                        {o.label}
                      </label>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <input
            name="note"
            maxLength={500}
            placeholder="남길 말 (예: 예제 15번까지만 진행)"
            className="mt-3 w-full rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-1.5 text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-control)] bg-pen px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "마감 중…" : "이대로 마감"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-ink-soft underline underline-offset-4"
            >
              그만두기
            </button>
            {/* 되돌릴 수 없다는 것을 누르기 전에 말한다 — 진도 기록은
                append-only라 마감 뒤에는 고칠 수 없다. */}
            <span className="text-xs text-ink-soft">
              마감하면 진도 기록이 남고 되돌릴 수 없습니다.
            </span>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-sm text-pen underline underline-offset-4"
        >
          진행 확인하고 마감
        </button>
      )}
    </li>
  );
}

export function SessionCloseList({
  sessions,
  nodeTitle,
  canClose,
}: {
  sessions: SessionAwaitingClose[];
  nodeTitle: Record<string, string>;
  canClose: boolean;
}) {
  if (sessions.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
        마감을 기다리는 수업이 없습니다.
      </p>
    );
  }

  return (
    <>
      <p className="mt-1 text-sm text-ink-soft">
        오늘까지의 수업 중 아직 마감하지 않은 것입니다. 여기서 적은 실제 진도가
        앞으로의 일정 재계획에 쓰입니다 — 계획대로 나가지 못한 부분은 다음
        차시로 밀립니다.
      </p>
      <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
        {sessions.map((s) =>
          canClose ? (
            <SessionRow key={s.sessionId} session={s} nodeTitle={nodeTitle} />
          ) : (
            <li key={s.sessionId} className="px-4 py-3 font-mono text-sm">
              {s.startsAt.slice(0, 16).replace("T", " ")}
              <span className="ml-3 text-ink-soft">
                계획 {s.plannedNodeIds.length}개 · 마감 권한 없음
              </span>
            </li>
          ),
        )}
      </ul>
    </>
  );
}
