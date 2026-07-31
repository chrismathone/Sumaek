"use client";

import { useActionState } from "react";
import type { GenerateResult } from "@/lib/domain/assessment";
import { generateDailyTestAction } from "./actions";

const REASON_LABEL: Record<string, string> = {
  today_concept: "오늘 학습",
  weakness: "약점 보강",
  wrong_answer_review: "오답 복습",
  cumulative: "누적 복습",
};

export function GenerateForm({
  groups,
  defaultDate,
}: {
  groups: Array<{ id: string; name: string }>;
  defaultDate: string;
}) {
  const [result, action, pending] = useActionState<
    GenerateResult | null,
    FormData
  >(generateDailyTestAction, null);

  return (
    <div className="rounded-lg border border-rule bg-surface p-5">
      <h2 className="font-semibold">일일테스트 생성</h2>
      <p className="mt-1 text-sm text-ink-soft">
        해당 날짜 수업의 개념(오늘 학습)·약점·복습 비율로 자동 선정합니다.
        같은 반·날짜 조합은 중복 생성되지 않습니다.
      </p>
      <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="gen-group" className="block text-sm font-medium">
            학습 그룹
          </label>
          <select
            id="gen-group"
            name="learningGroupId"
            className="mt-1 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="gen-date" className="block text-sm font-medium">
            수업 날짜
          </label>
          <input
            id="gen-date"
            name="targetDate"
            type="date"
            defaultValue={defaultDate}
            className="mt-1 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 font-mono text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "생성 중…" : "생성·게시"}
        </button>
      </form>
      {result && (
        <div
          role="status"
          className={`mt-3 rounded-[var(--radius-control)] px-3 py-2 text-sm ${
            result.ok ? "bg-pen-soft/60" : "bg-grade-soft text-grade"
          }`}
        >
          <p>{result.message}</p>
          {result.shortfalls.length > 0 && (
            <p className="mt-1 font-mono text-xs">
              문항 부족:{" "}
              {result.shortfalls
                .map(
                  (s) =>
                    `${REASON_LABEL[s.reason] ?? s.reason} ${s.selected}/${s.requested}`,
                )
                .join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
