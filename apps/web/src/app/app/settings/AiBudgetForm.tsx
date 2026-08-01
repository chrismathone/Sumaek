"use client";

import { useActionState } from "react";
import { setAiBudget, type ActionResult } from "./actions";

/* AI 월 비용 한도 설정 (인수 37) — 상태 표시는 서버 컴포넌트가,
 * 여기는 설정·해제 폼만 담당한다. 비우고 저장하면 한도가 해제된다. */

export function AiBudgetForm({
  currentLimitUsd,
  currentWarnRatio,
}: {
  currentLimitUsd: string | null;
  currentWarnRatio: string | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setAiBudget,
    null,
  );

  return (
    <form action={action} className="mt-3 border-t border-rule-soft pt-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="monthlyLimitUsd" className="block text-xs text-ink-soft">
            월 한도 (USD)
          </label>
          <input
            id="monthlyLimitUsd"
            name="monthlyLimitUsd"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            defaultValue={currentLimitUsd ? Number(currentLimitUsd).toFixed(2) : ""}
            placeholder="비워두면 해제"
            className="mt-1 w-32 rounded-[var(--radius-control)] border border-rule px-2 py-1 font-mono text-sm"
          />
        </div>
        <div>
          <label htmlFor="warnRatio" className="block text-xs text-ink-soft">
            경고 임계 (0.5~0.99)
          </label>
          <input
            id="warnRatio"
            name="warnRatio"
            type="number"
            step="0.01"
            min="0.5"
            max="0.99"
            inputMode="decimal"
            defaultValue={currentWarnRatio ? Number(currentWarnRatio).toFixed(2) : "0.80"}
            className="mt-1 w-24 rounded-[var(--radius-control)] border border-rule px-2 py-1 font-mono text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-sm text-pen hover:bg-pen-soft/50 disabled:opacity-60"
        >
          {pending ? "저장 중…" : "한도 저장"}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        임계 도달 시 소유자·프로그램 책임자에게 월 1회 업무함 경고가 가고, 100%를
        넘으면 AI 호출이 차단됩니다 (반입 파일은 업로드 상태로 되돌아갑니다).
      </p>
      {state && (
        <p
          role="status"
          className={`mt-2 rounded-[var(--radius-control)] px-3 py-2 text-sm ${
            state.ok ? "bg-pen-soft/60" : "bg-grade-soft text-grade"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
