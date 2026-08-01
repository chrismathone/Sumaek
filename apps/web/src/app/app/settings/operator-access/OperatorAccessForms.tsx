"use client";

import { useActionState } from "react";
import { ActionToast } from "@/components/ActionToast";
import {
  grantOperatorAccess,
  revokeOperatorAccessAction,
  type ActionResult,
} from "./actions";

/* break-glass 발급·회수 폼 (인수 28).
 * 상태 표시는 서버 컴포넌트가 그리고, 여기는 제출만 담당한다.
 *
 * 만료를 "시각"이 아니라 "필요 시간"으로 받는다 — datetime-local 값은
 * 시간대가 없는 문자열이라 서버에서 절대 시각으로 되돌리다 어긋나기 쉽고,
 * 승인 창은 조직 시간대와 무관한 절대 시각이어야 한다. 실제 만료 시각은
 * DB 시계로 계산된다. */

const DURATION_CHOICES: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 30, label: "30분" },
  { minutes: 60, label: "1시간" },
  { minutes: 120, label: "2시간" },
  { minutes: 240, label: "4시간 (최대)" },
];

const CONTROL =
  "rounded-[var(--radius-control)] border border-rule px-2 py-1 text-sm";

export function GrantForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    grantOperatorAccess,
    null,
  );
  return (
    <form action={action} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm sm:col-span-2">
        <span className="text-ink-soft">운영자 계정 ID (UUID)</span>
        <input
          name="operatorUserId"
          required
          placeholder="00000000-0000-0000-0000-000000000000"
          className={`${CONTROL} mt-1 w-full font-mono text-xs`}
        />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="text-ink-soft">
          접근 사유 (소유자에게 그대로 고지됩니다)
        </span>
        <input
          name="reason"
          required
          minLength={5}
          placeholder="예: 일정 실체화 실패 원인 조사 (지원 티켓 #123)"
          className={`${CONTROL} mt-1 w-full`}
        />
      </label>
      <label className="text-sm">
        <span className="text-ink-soft">필요 시간</span>
        <select name="durationMinutes" defaultValue={60} className={`${CONTROL} mt-1 w-full`}>
          {DURATION_CHOICES.map((c) => (
            <option key={c.minutes} value={c.minutes}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-sm text-pen hover:bg-pen-soft/50 disabled:opacity-60"
        >
          {pending ? "승인 중…" : "접근 승인"}
        </button>
      </div>
      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </form>
  );
}

export function RevokeButton({ grantId }: { grantId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    revokeOperatorAccessAction,
    null,
  );
  return (
    <form action={action}>
      <input type="hidden" name="grantId" value={grantId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-control)] border border-grade px-2 py-0.5 text-xs text-grade hover:bg-grade-soft disabled:opacity-60"
      >
        {pending ? "회수 중…" : "즉시 회수"}
      </button>
      {/* 결과는 토스트로 — 행 안에 문구를 그리면 행 높이가 늘어난다 */}
      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </form>
  );
}
