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
          <label htmlFor="gen-purpose" className="block text-sm font-medium">
            유형
          </label>
          <select
            id="gen-purpose"
            name="purpose"
            className="mt-1 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm"
          >
            <option value="formative">일일테스트</option>
            <option value="confirmation">확인테스트</option>
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
        {/* 문항 수가 적은 학원에서는 연속 수업일마다 후보가 0이 되어 테스트를
            아예 만들 수 없다. 정책의 무반복 기간을 고치는 화면이 아직 없으므로
            선생님이 알고 넘어갈 수단을 둔다 — 기본은 꺼져 있다. */}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allowRecentlyUsed" className="size-4" />
          <span>
            최근 출제분도 허용
            <span className="ml-1 text-xs text-ink-soft">
              (무반복 기간을 넘겨 같은 문항을 다시 낼 수 있습니다)
            </span>
          </span>
        </label>
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
