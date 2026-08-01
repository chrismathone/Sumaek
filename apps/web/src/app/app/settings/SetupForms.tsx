"use client";

import { useActionState } from "react";
import {
  addLearner,
  createCoursePeriod,
  createLearningGroup,
  type ActionResult,
} from "./actions";

const WEEKDAYS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 0, label: "일" },
] as const;

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

export function PeriodForm({ defaultYear }: { defaultYear: number }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createCoursePeriod,
    null,
  );
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-sm">
        기간 이름
        <input name="name" required placeholder="2026학년도 2학기"
          className="mt-1 block w-44 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
      </label>
      <label className="text-sm">
        학년도
        <input name="academicYear" type="number" defaultValue={defaultYear}
          className="mt-1 block w-24 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
      </label>
      <label className="text-sm">
        시작일
        <input name="startsOn" type="date" required
          className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
      </label>
      <label className="text-sm">
        종료일
        <input name="endsOn" type="date" required
          className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
      </label>
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "생성 중…" : "과정 기간 만들기"}
      </button>
      <div className="w-full"><StatusLine state={state} /></div>
    </form>
  );
}

export function GroupForm({
  periods,
}: {
  periods: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createLearningGroup,
    null,
  );
  return (
    <form action={action} className="mt-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          반 이름
          <input name="name" required placeholder="중2 정규 B"
            className="mt-1 block w-40 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          과정 기간
          <select name="coursePeriodId" required
            className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          과정 설명
          <input name="courseName" placeholder="중등 2-2 정규"
            className="mt-1 block w-36 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <fieldset className="text-sm">
          <legend className="text-sm">수업 요일</legend>
          {/* 요일 일곱 칸은 360px에서 한 줄에 안 들어간다 — 줄바꿈을 막으면 화면이 통째로 가로 스크롤된다 */}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => (
              <label key={d.value}
                className="flex cursor-pointer items-center gap-1 rounded-[var(--radius-control)] border border-rule px-2 py-1.5 text-sm has-checked:border-pen has-checked:bg-pen-soft/50">
                <input type="checkbox" name="weekdays" value={d.value} className="accent-[var(--color-pen)]" />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="text-sm">
          시작
          <input name="startTime" type="time" defaultValue="16:00" required
            className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
        </label>
        <label className="text-sm">
          종료
          <input name="endTime" type="time" defaultValue="18:00" required
            className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
        </label>
        <button type="submit" disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? "생성 중…" : "반 만들기"}
        </button>
      </div>
      <StatusLine state={state} />
    </form>
  );
}

export function LearnerForm({
  groups,
  today,
}: {
  groups: Array<{ id: string; name: string }>;
  today: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addLearner,
    null,
  );
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-sm">
        이름 (표시명)
        <input name="displayName" required
          className="mt-1 block w-36 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
      </label>
      <label className="text-sm">
        학년
        <input name="gradeLevel" placeholder="middle-2"
          className="mt-1 block w-28 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
      </label>
      <label className="text-sm">
        소속 반
        <select name="learningGroupId" required
          className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        합류일
        <input name="joinedOn" type="date" defaultValue={today} required
          className="mt-1 block rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm" />
      </label>
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "등록 중…" : "학습자 등록"}
      </button>
      <div className="w-full"><StatusLine state={state} /></div>
    </form>
  );
}
