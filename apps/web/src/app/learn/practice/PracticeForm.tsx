"use client";

import { useActionState } from "react";
import { submitPracticeAction, type PracticeResult } from "./actions";

/* 연습문제 한 묶음 — 한 화면에서 다 풀고 한 번에 채점받는다.
 * 테스트와 달리 시간 제한도, 제출 확정 단계도 두지 않는다. 연습이니까. */

export interface PracticeItem {
  key: string;
  number: number;
  kind: string;
  bodyHtml: string;
  choices: Array<{ choiceId: string; order: number; html: string }> | null;
}

export function PracticeForm({
  materialId,
  title,
  conceptName,
  items,
}: {
  materialId: string;
  title: string;
  conceptName: string;
  items: PracticeItem[];
}) {
  const [state, action, pending] = useActionState<PracticeResult | null, FormData>(
    submitPracticeAction,
    null,
  );

  return (
    <form action={action} className="rounded-lg border border-rule bg-surface p-5">
      <input type="hidden" name="materialId" value={materialId} />
      <p className="font-mono text-xs text-ink-soft">{conceptName}</p>
      <h2 className="mt-0.5 font-medium">{title}</h2>

      <ol className="mt-4 space-y-6">
        {items.map((q) => {
          const verdict = state?.graded?.[q.key];
          return (
            <li key={q.key} className="border-t border-rule-soft pt-4 first:border-0 first:pt-0">
              <div className="flex items-start gap-2">
                <span className="font-mono text-sm text-pen">{q.number}.</span>
                <div className="flex-1">
                  <div dangerouslySetInnerHTML={{ __html: q.bodyHtml }} />

                  {q.kind === "multiple_choice" && q.choices ? (
                    <fieldset className="mt-3 space-y-2">
                      <legend className="sr-only">답 고르기</legend>
                      {q.choices.map((c, i) => (
                        <label
                          key={c.choiceId}
                          className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-rule px-3 py-2 has-[:checked]:border-pen has-[:checked]:bg-pen-soft/30"
                        >
                          <input
                            type="radio"
                            name={`c-${q.key}`}
                            value={c.choiceId}
                            className="sr-only"
                          />
                          <span className="font-mono text-sm">
                            {["①", "②", "③", "④", "⑤"][i]}
                          </span>
                          <span dangerouslySetInnerHTML={{ __html: c.html }} />
                        </label>
                      ))}
                    </fieldset>
                  ) : (
                    <input
                      name={`a-${q.key}`}
                      type="text"
                      placeholder="답"
                      className="mt-3 block w-48 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm focus:border-pen focus:outline-none"
                    />
                  )}
                </div>
                {verdict !== undefined && (
                  <span
                    className={`font-mono text-xs ${verdict ? "text-pen" : "text-grade"}`}
                  >
                    {verdict ? "정답" : "오답"}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {state && (
        <p
          role="status"
          className={`mt-5 rounded-[var(--radius-control)] px-3 py-2 text-sm ${
            state.ok ? "bg-pen-soft/50" : "bg-grade-soft text-grade"
          }`}
        >
          {state.message}
          {state.ok && state.total > 0 && state.correct < state.total && (
            <span className="mt-1 block text-ink-soft">
              틀린 문항은 다시 풀어 볼 수 있습니다. 연습은 횟수 제한이 없습니다.
            </span>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-5 rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "채점 중…" : state ? "다시 채점" : "채점하기"}
      </button>
    </form>
  );
}
