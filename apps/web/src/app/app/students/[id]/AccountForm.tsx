"use client";

import { useActionState } from "react";
import { ActionToast } from "@/components/ActionToast";
import {
  linkLearnerAccountAction,
  unlinkLearnerAccountAction,
  type AccountResult,
} from "./actions";

/* 학생 로그인 계정 연결 (4장).
 *
 * 초기 비밀번호는 **여기서 한 번만** 보인다. 서버가 저장하지 않고 다시
 * 보여 줄 방법도 없으므로, 그 사실을 화면에 그대로 적는다 — 나중에 다시
 * 볼 수 있다고 오해하면 선생님이 받아 적지 않는다. */

export function LinkAccountForm({ learnerId }: { learnerId: string }) {
  const [state, action, pending] = useActionState<AccountResult | null, FormData>(
    linkLearnerAccountAction,
    null,
  );

  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="learnerId" value={learnerId} />
        <label htmlFor="account-email" className="text-sm">
          <span className="block">학생 이메일</span>
          <input
            id="account-email"
            name="email"
            type="email"
            required
            placeholder="student@example.com"
            className="mt-1 block w-72 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "처리 중…" : "계정 연결"}
        </button>
      </form>

      {/* 초기 비밀번호는 토스트로 띄우면 6초 뒤 사라져 받아 적을 수 없다.
          이것만 예외로 그 자리에 남긴다 — 사라지면 안 되는 정보다. */}
      {state?.temporaryPassword && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-highlight bg-highlight-soft p-4 text-sm"
        >
          <p className="font-medium">초기 비밀번호 — 지금 한 번만 표시됩니다</p>
          <p className="mt-2 font-mono text-base tracking-wide">
            {state.temporaryPassword}
          </p>
          <p className="mt-2 text-xs text-ink-soft">
            서버에 저장되지 않아 다시 볼 수 없습니다. 학생에게 전달하고 첫
            로그인 후 바꾸도록 안내하세요. 잃어버리면 연결을 해제하고 다시
            발급해야 합니다.
          </p>
        </div>
      )}

      {state && !state.temporaryPassword && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </div>
  );
}

export function UnlinkAccountButton({ learnerId }: { learnerId: string }) {
  const [state, action, pending] = useActionState<AccountResult | null, FormData>(
    unlinkLearnerAccountAction,
    null,
  );

  return (
    <form action={action} className="inline">
      <input type="hidden" name="learnerId" value={learnerId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-xs hover:bg-paper disabled:opacity-60"
      >
        {pending ? "처리 중…" : "연결 해제"}
      </button>
      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </form>
  );
}
