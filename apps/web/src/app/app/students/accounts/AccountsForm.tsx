"use client";

import { useActionState } from "react";
import type { ManageableLearner } from "@/lib/domain/learner-account";
import { issueAccountsAction } from "./actions";

/* ─────────────────────────────────────────────────────────────
 * 일괄 계정 발급 (T5.2).
 *
 * 초기 비밀번호는 **이 화면에서 한 번만** 보인다. 저장하지 않으므로 다시
 * 볼 수 없고, 그래서 결과를 화면 맨 위에 크게 둔다 — 실수로 닫으면 서른
 * 명 몫을 다시 발급해야 한다.
 * ───────────────────────────────────────────────────────────── */

export function AccountsForm({ learners }: { learners: ManageableLearner[] }) {
  const [result, action, pending] = useActionState(issueAccountsAction, null);
  const pendingLearners = learners.filter((l) => !l.hasAccount);

  return (
    <>
      {result && (
        <section
          role="status"
          className="mt-4 rounded-lg border border-pen bg-pen-soft p-4"
        >
          <p className="font-medium break-keep">
            발급 {result.succeeded}건 · 실패 {result.failed}건
          </p>
          {result.succeeded > 0 && (
            <p className="mt-1 text-sm break-keep text-ink-soft">
              초기 비밀번호는 <strong>지금 한 번만</strong> 보입니다. 저장하지
              않으므로 이 화면을 닫으면 다시 볼 수 없습니다.
            </p>
          )}
          <ul className="mt-3 space-y-1">
            {result.outcomes.map((o, i) => (
              <li
                key={`${o.learnerId}-${i}`}
                className="flex flex-wrap items-baseline gap-x-3 text-sm"
              >
                <span className={o.ok ? "" : "text-grade"}>
                  {o.displayName || "—"}
                </span>
                <span className="text-ink-soft">{o.message}</span>
                {o.temporaryPassword && (
                  <code className="rounded-[var(--radius-control)] border border-rule bg-surface px-2 py-0.5 font-mono text-xs select-all">
                    {o.temporaryPassword}
                  </code>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingLearners.length === 0 ? (
        <p className="mt-4 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
          담당 학생 전원이 로그인할 수 있습니다.
        </p>
      ) : (
        <form action={action} className="mt-4">
          <ul className="divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {pendingLearners.map((l) => (
              <li
                key={l.learnerId}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1 text-sm break-keep">
                  {l.displayName}
                  <span className="ml-2 font-mono text-xs text-ink-soft">
                    {l.learningGroupName ?? "반 미배정"}
                  </span>
                </span>
                {/* 빈 칸은 대상이 아니다 — 지금 발급할 학생만 적는다 */}
                <input
                  type="email"
                  name={`email:${l.learnerId}`}
                  placeholder="이메일 (비우면 건너뜀)"
                  className="w-full rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-sm sm:w-72"
                />
              </li>
            ))}
          </ul>
          <button
            type="submit"
            disabled={pending}
            className="mt-3 rounded-[var(--radius-control)] bg-pen px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "발급 중…" : "적은 학생에게 발급"}
          </button>
        </form>
      )}
    </>
  );
}
