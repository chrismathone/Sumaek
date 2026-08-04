"use client";

import { useActionState, useState } from "react";
import { submitPracticeAction, type PracticeResult } from "./actions";

/* 연습문제 한 묶음 — 한 화면에서 다 풀고 한 번에 채점받는다.
 * 테스트와 달리 시간 제한도, 제출 확정 단계도 두지 않는다. 연습이니까. */

export interface PracticeItem {
  key: string;
  number: number;
  kind: string;
  bodyHtml: string;
  choices: Array<{ choiceId: string; order: number; html: string }> | null;
  /** 정답이 ◯·△·× 기호인 문항 — 기호 칩을 보여 준다 (서버가 판정) */
  symbolInput: boolean;
}

/* 판별 문항의 답은 키보드로 칠 수 없는 기호다(◯·△·×). 칩 셋은 고정이다 —
 * 문항이 요구하는 둘만 보여 주면 남은 하나가 정답 후보를 좁혀 준다.
 * 어느 둘이 유효한지는 발문이 이미 말한다. 입력창은 그대로 두어 직접
 * 타이핑(o·x·ㅇ)도 받는다 — 채점기가 동치로 인정한다. */
const ANSWER_SYMBOLS = ["◯", "△", "×"] as const;

function ShortAnswerInput({
  name,
  symbolInput,
}: {
  name: string;
  symbolInput: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="mt-3">
      {symbolInput && (
        <div className="mb-1.5 flex gap-1.5" role="group" aria-label="기호로 답하기">
          {ANSWER_SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={value === s}
              onClick={() => setValue(s)}
              className="h-9 w-9 rounded-[var(--radius-control)] border border-rule text-base leading-none aria-pressed:border-pen aria-pressed:bg-pen-soft/30"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <input
        name={name}
        type="text"
        placeholder="답"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="block w-48 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm focus:border-pen focus:outline-none"
      />
    </div>
  );
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
                    <ShortAnswerInput
                      name={`a-${q.key}`}
                      symbolInput={q.symbolInput}
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
