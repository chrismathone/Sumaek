"use client";

import { useActionState } from "react";
import { ActionToast } from "@/components/ActionToast";
import {
  connectNeisSchool,
  disconnectConnection,
  searchNeisSchools,
  syncPublicHolidays,
  syncSchoolSchedule,
  type ActionResult,
  type SchoolSearchResult,
} from "./actions";

function Toast({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <ActionToast ok={state.ok} resultKey={state}>
      {state.message}
    </ActionToast>
  );
}

/** 공휴일 동기화 — 전국 공통, 연도당 호출 1회 (특일 API) */
export function HolidaySyncButton() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    syncPublicHolidays,
    null,
  );
  return (
    <form action={action}>
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "동기화 중…" : "공휴일 동기화"}
      </button>
      <Toast state={state} />
    </form>
  );
}

/** 학교 검색 + 결과에서 바로 연결 */
export function SchoolSearchForm() {
  const [state, action, pending] = useActionState<SchoolSearchResult | null, FormData>(
    searchNeisSchools,
    null,
  );
  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          학교 이름
          <input name="schoolName" required placeholder="대치중학교"
            className="mt-1 block w-56 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? "검색 중…" : "학교 검색"}
        </button>
      </form>
      {state && (
        <p role="status" className={`mt-2 text-sm ${state.ok ? "text-ink-soft" : "text-grade"}`}>
          {state.message}
        </p>
      )}
      {state?.schools && state.schools.length > 0 && (
        <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule">
          {state.schools.map((school) => (
            <li key={`${school.officeCode}-${school.schoolCode}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <p className="text-sm">
                <span className="font-medium">{school.name}</span>
                <span className="ml-2 text-xs text-ink-soft">
                  {school.kind} · {school.officeName}
                </span>
              </p>
              <ConnectButton school={school} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectButton({
  school,
}: {
  school: SchoolSearchResult["schools"][number];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    connectNeisSchool,
    null,
  );
  return (
    <form action={action}>
      <input type="hidden" name="officeCode" value={school.officeCode} />
      <input type="hidden" name="officeName" value={school.officeName} />
      <input type="hidden" name="schoolCode" value={school.schoolCode} />
      <input type="hidden" name="schoolName" value={school.name} />
      <input type="hidden" name="schoolKind" value={school.kind} />
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-xs font-medium text-pen hover:bg-pen-soft/50 disabled:opacity-60">
        {pending ? "연결 중…" : "연결"}
      </button>
      <Toast state={state} />
    </form>
  );
}

/** 연결된 학교의 학사일정 동기화 — 시험 기간만, 대상 반 선택 */
export function ScheduleSyncForm({
  connectionId,
  groups,
}: {
  connectionId: string;
  groups: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    syncSchoolSchedule,
    null,
  );
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="connectionId" value={connectionId} />
      <label className="text-sm">
        시험 기간 적용 대상
        <select name="learningGroupId"
          className="mt-1 block rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm">
          <option value="">전체 반</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] border border-pen px-3 py-2 text-sm font-medium text-pen hover:bg-pen-soft/50 disabled:opacity-60">
        {pending ? "동기화 중…" : "학사일정 동기화"}
      </button>
      <Toast state={state} />
    </form>
  );
}

export function DisconnectButton({ connectionId }: { connectionId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    disconnectConnection,
    null,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="connectionId" value={connectionId} />
      <button type="submit" disabled={pending}
        className="rounded-[var(--radius-control)] border border-rule px-2.5 py-1 text-xs hover:bg-paper disabled:opacity-60">
        {pending ? "해제 중…" : "연결 해제"}
      </button>
      <Toast state={state} />
    </form>
  );
}
