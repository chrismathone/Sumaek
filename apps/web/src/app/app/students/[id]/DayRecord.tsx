"use client";

import { useActionState, useState } from "react";
import type { LearnerDayPlanSummary } from "@su-maek/db/domain";
import { reopenLearnerDayAction } from "./actions";

/* ─────────────────────────────────────────────────────────────
 * 한 학생의 하루 실행 기록 (T4.1).
 *
 * 이 표가 생기기 전까지 `learner_day_plans`는 교사에게 보이지 않았다.
 * 학생 화면은 「오늘 할 일을 모두 마쳤습니다」라고 말하는데, 교사가 그
 * 사실을 확인할 곳은 어디에도 없었다.
 *
 * 완료 취소를 여기 두는 이유: 되돌릴 대상이 (학생·날짜) 한 칸이고, 그
 * 칸은 이 표의 한 줄이다. 반·날짜로 가로지르는 현황판은 T4.4의 몫이다.
 * ───────────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<string, string> = {
  not_started: "시작 전",
  in_progress: "진행 중",
  blocked: "막힘",
  completed: "완료",
};

function DayRow({
  day,
  learnerId,
  canReopen,
}: {
  day: LearnerDayPlanSummary;
  learnerId: string;
  canReopen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, action, pending] = useActionState(reopenLearnerDayAction, null);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm">
          <span className="font-mono">{day.planDate}</span>
          <span className="ml-3">
            {STATUS_LABEL[day.status] ?? day.status}
          </span>
          <span className="ml-2 font-mono text-xs text-ink-soft">
            필수 {day.requiredSatisfied}/{day.requiredTotal}
            {day.requiredBlocked > 0 && ` · 막힘 ${day.requiredBlocked}`}
          </span>
        </p>
        <span className="font-mono text-xs text-ink-soft">
          {day.completedAt
            ? `완료 기록 ${day.completedAt.slice(0, 16).replace("T", " ")}`
            : "완료 기록 없음"}
        </span>
      </div>

      {/* 재개방은 지워지지 않는 사실이다 — 완료 시각 옆에 함께 둔다.
          「완료 기록은 있는데 상태는 진행 중」이 보이는 유일한 설명이다. */}
      {day.reopenedAt && (
        <p className="mt-1 text-xs text-ink-soft">
          완료 취소됨 · {day.reopenReason ?? "사유 없음"}
        </p>
      )}

      {result && (
        <p
          role="status"
          className={`mt-2 text-sm ${result.ok ? "text-ink" : "text-grade"}`}
        >
          {result.message}
        </p>
      )}

      {canReopen && day.completedAt !== null && day.status === "completed" && (
        <div className="mt-2">
          {open ? (
            <form action={action} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="learnerId" value={learnerId} />
              <input type="hidden" name="planDate" value={day.planDate} />
              <input
                name="reason"
                required
                maxLength={500}
                placeholder="취소 사유 (예: 시험 채점이 잘못돼 다시 보게 함)"
                className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              >
                {pending ? "취소 중…" : "완료 취소"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-ink-soft underline underline-offset-4"
              >
                그만두기
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-sm text-pen underline underline-offset-4"
            >
              완료 취소
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function DayRecord({
  days,
  learnerId,
  canReopen,
}: {
  days: LearnerDayPlanSummary[];
  learnerId: string;
  canReopen: boolean;
}) {
  if (days.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
        하루 실행 기록이 없습니다. 학생이 오늘 학습 화면을 처음 여는 순간
        그날의 계획이 확정되고, 여기에 한 줄씩 쌓입니다.
      </p>
    );
  }

  return (
    <>
      <p className="mt-1 text-sm text-ink-soft">
        완료는 필수 항목이 전부 충족된 순간 서버가 기록합니다. 완료를 취소해도
        <strong> 완료 시각은 지워지지 않고</strong> 취소 사실이 더해집니다 —
        기록을 지우면 숙련도·일정 계산에 같은 날이 두 번 들어갑니다. 취소의
        효과는 <strong>그날 계획이 다시 갱신되는 것</strong>이며, 필수가 여전히
        전부 충족돼 있으면 곧바로 다시 완료로 표시됩니다.
      </p>
      <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
        {days.map((d) => (
          <DayRow
            key={d.planId}
            day={d}
            learnerId={learnerId}
            canReopen={canReopen}
          />
        ))}
      </ul>
    </>
  );
}
