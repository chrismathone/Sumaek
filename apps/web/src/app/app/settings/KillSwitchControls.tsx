"use client";

import { useActionState } from "react";
import { toggleKillSwitch, type ActionResult } from "./actions";

/* Kill switch 조작 (28장) — 상태는 서버 컴포넌트가 그리고,
 * 여기는 전환 폼만 담당한다. 중지에는 사유가 필수다. */

export interface SwitchView {
  key: string;
  label: string;
  /** 이 조직에서의 유효 상태 (전역·조직 스코프 통합) */
  enabled: boolean;
  /** 중지 사유 (있다면) */
  reason: string | null;
  /** 전역 스위치로 중지된 경우 — 조직에서 재개할 수 없다 */
  globallyDisabled: boolean;
}

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

function SwitchRow({ view }: { view: SwitchView }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    toggleKillSwitch,
    null,
  );
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">{view.label}</span>
          <span className="ml-2 font-mono text-xs text-ink-soft">{view.key}</span>
          {view.reason && (
            <span className="ml-2 text-xs text-ink-soft">사유: {view.reason}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-xs ${
              view.enabled ? "border-pen text-pen" : "border-grade text-grade"
            }`}
          >
            {view.enabled ? "동작 중" : "중지됨"}
          </span>
          {view.globallyDisabled ? (
            <span className="text-xs text-ink-soft">
              전역 중지 — 운영 CLI로만 재개
            </span>
          ) : (
            <form action={action} className="flex items-center gap-2">
              <input type="hidden" name="key" value={view.key} />
              <input
                type="hidden"
                name="action"
                value={view.enabled ? "disable" : "enable"}
              />
              {view.enabled && (
                <input
                  name="reason"
                  placeholder="중지 사유 (필수)"
                  aria-label={`${view.label} 중지 사유`}
                  className="w-40 rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs"
                />
              )}
              <button
                type="submit"
                disabled={pending}
                className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-xs disabled:opacity-60 ${
                  view.enabled
                    ? "border-grade text-grade hover:bg-grade-soft"
                    : "border-pen text-pen hover:bg-pen-soft/50"
                }`}
              >
                {pending ? "처리 중…" : view.enabled ? "중지" : "재개"}
              </button>
            </form>
          )}
        </div>
      </div>
      <StatusLine state={state} />
    </li>
  );
}

export function KillSwitchControls({ switches }: { switches: SwitchView[] }) {
  return (
    <ul className="mt-2 divide-y divide-rule-soft">
      {switches.map((s) => (
        <SwitchRow key={s.key} view={s} />
      ))}
    </ul>
  );
}
