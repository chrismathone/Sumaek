"use client";

import { useState, useTransition } from "react";
import type { StudentAnswer } from "@su-maek/contracts";
import {
  saveAnswerAction,
  submitAttemptAction,
} from "@/app/learn/tests/[id]/actions";

/* 실응시 러너 (18장) — 서버 권위 저장·제출. 데모 TestRunner와 같은 UI 문법. */

export interface AttemptQuestion {
  assessmentQuestionId: string;
  number: number;
  kind: "multiple_choice" | "short_answer";
  bodyHtml: string;
  choices?: Array<{ choiceId: string; order: number; html: string }>;
  points: number;
  savedAnswer: StudentAnswer | null;
}

export function AttemptRunner({
  attemptId,
  questions,
  timeLimitMinutes,
}: {
  attemptId: string;
  questions: AttemptQuestion[];
  timeLimitMinutes: number | null;
}) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, StudentAnswer>>(() =>
    Object.fromEntries(
      questions
        .filter((q) => q.savedAnswer)
        .map((q) => [q.assessmentQuestionId, q.savedAnswer as StudentAnswer]),
    ),
  );
  const [sequence, setSequence] = useState(1);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [submitting, startSubmit] = useTransition();

  const save = (aqId: string, answer: StudentAnswer) => {
    setAnswers((prev) => ({ ...prev, [aqId]: answer }));
    const seq = sequence;
    setSequence(seq + 1);
    startTransition(async () => {
      const result = await saveAnswerAction({
        attemptId,
        assessmentQuestionId: aqId,
        answer,
        clientSequence: seq,
      });
      setSaveError(result.ok ? null : (result.message ?? "저장 실패"));
    });
  };

  const q = questions[current];
  if (!q) return null;
  const currentAnswer = answers[q.assessmentQuestionId];
  const unanswered = questions.filter((x) => !answers[x.assessmentQuestionId]);

  return (
    <div className="rounded-lg border border-rule bg-surface">
      <div className="flex items-center justify-between border-b border-rule-soft px-4 py-3">
        <p className="font-mono text-sm">
          {current + 1} / {questions.length}
        </p>
        {timeLimitMinutes !== null && (
          <p className="font-mono text-xs text-ink-soft">제한 {timeLimitMinutes}분</p>
        )}
        <p className="font-mono text-xs text-ink-soft" aria-live="polite">
          {pending ? "저장 중…" : saveError ? "저장 오류" : "저장됨"}
        </p>
      </div>

      {saveError && (
        <p role="alert" className="border-b border-rule-soft bg-grade-soft px-4 py-2 text-sm text-grade">
          {saveError}
        </p>
      )}

      <div className="min-h-[220px] px-5 py-6">
        <div className="flex gap-2">
          <span className="font-mono font-bold text-pen">{q.number}.</span>
          <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: q.bodyHtml }} />
        </div>

        {q.kind === "multiple_choice" && q.choices && (
          <fieldset className="mt-5 space-y-2">
            <legend className="sr-only">선택지</legend>
            {q.choices.map((choice, i) => {
              const selected =
                currentAnswer?.kind === "multiple_choice" &&
                currentAnswer.selectedChoiceIds.includes(choice.choiceId);
              return (
                <label
                  key={choice.choiceId}
                  className={`flex cursor-pointer items-baseline gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 ${
                    selected ? "border-pen bg-pen-soft/50" : "border-rule hover:border-pen"
                  }`}
                >
                  <input
                    type="radio"
                    name={`q-${q.assessmentQuestionId}`}
                    checked={selected}
                    onChange={() =>
                      save(q.assessmentQuestionId, {
                        kind: "multiple_choice",
                        selectedChoiceIds: [choice.choiceId],
                      })
                    }
                    className="sr-only"
                  />
                  <span className="font-mono text-sm">{["①", "②", "③", "④", "⑤"][i]}</span>
                  <span dangerouslySetInnerHTML={{ __html: choice.html }} />
                </label>
              );
            })}
          </fieldset>
        )}

        {q.kind === "short_answer" && (
          <div className="mt-5">
            <label htmlFor={`ans-${q.assessmentQuestionId}`} className="block text-sm text-ink-soft">
              답 (분수는 3/4 형태로 입력)
            </label>
            <input
              id={`ans-${q.assessmentQuestionId}`}
              type="text"
              defaultValue={
                currentAnswer?.kind === "short_answer" ? currentAnswer.rawText : ""
              }
              onBlur={(e) => {
                const value = e.target.value;
                const prev =
                  currentAnswer?.kind === "short_answer" ? currentAnswer.rawText : "";
                if (value !== prev) {
                  save(q.assessmentQuestionId, { kind: "short_answer", rawText: value });
                }
              }}
              className="mt-1.5 w-48 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono focus:border-pen focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-rule-soft px-4 py-3">
        <button
          type="button"
          disabled={current === 0}
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 text-sm disabled:opacity-40"
        >
          이전
        </button>
        {current < questions.length - 1 ? (
          <button
            type="button"
            onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}
            className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            다음
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            제출하기
          </button>
        )}
      </div>

      {confirming && (
        <div className="border-t border-rule-soft bg-highlight-soft px-4 py-3">
          {unanswered.length > 0 ? (
            <p className="text-sm">
              미응답 {unanswered.length}문항 (
              {unanswered.map((u) => u.number).join(", ")}번). 그래도 제출할까요?
            </p>
          ) : (
            <p className="text-sm">모든 문항에 답했습니다. 제출할까요?</p>
          )}
          {submitError && (
            <p role="alert" className="mt-1 text-sm text-grade">
              {submitError}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                startSubmit(async () => {
                  const result = await submitAttemptAction(attemptId);
                  // 성공 시 서버가 결과 페이지로 redirect — 여기 도달하면 실패
                  if (result && !result.ok) setSubmitError(result.message);
                })
              }
              className="rounded-[var(--radius-control)] bg-ink px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {submitting ? "제출 중…" : "제출 확정"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-[var(--radius-control)] border border-rule px-4 py-1.5 text-sm"
            >
              계속 풀기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
