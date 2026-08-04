"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { StudentAnswer } from "@su-maek/contracts";
import { QuestionBody } from "@/components/learn/QuestionText";
import {
  saveAnswerAction,
  submitAttemptAction,
} from "@/app/learn/tests/[id]/actions";

/* ─────────────────────────────────────────────────────────────
 * 실응시 러너 (18장) — 서버 권위 저장·제출. 데모 TestRunner와 같은 UI 문법.
 *
 * 제한 시간의 기준 시각은 서버가 기록한 attempts.started_at이다. 새로고침해도
 * 남은 시간이 되돌아가지 않는다 — 클라이언트는 마감을 계산만 하고 정하지 않는다.
 *
 * 남은 결손 (서버 강제 아님): 이 카운트다운은 표시와 자동 제출을 위한 클라이언트
 * 장치일 뿐이다. 서버는 마감을 검사하지 않는다 — saveResponse는 status가
 * in_progress인지만 보고, submitAndGrade도 시각을 대조하지 않는다. 따라서 탭을
 * 닫아 타이머를 멈추거나 기기 시계를 되돌린 학생은 마감 뒤에도 답안을 저장하고
 * 제출할 수 있다. 서버 측 마감 검사는 아직 구현되지 않았다.
 * ───────────────────────────────────────────────────────────── */

export interface AttemptQuestion {
  assessmentQuestionId: string;
  number: number;
  kind: "multiple_choice" | "short_answer";
  /** 첫 줄이 발문, 뒤가 판별 대상이다 (renderQuestionBody) */
  bodyLines: string[];
  choices?: Array<{ choiceId: string; order: number; html: string }>;
  points: number;
  savedAnswer: StudentAnswer | null;
}

export function AttemptRunner({
  attemptId,
  questions,
  timeLimitMinutes,
  startedAt,
}: {
  attemptId: string;
  questions: AttemptQuestion[];
  timeLimitMinutes: number | null;
  /** 서버가 기록한 응시 시작 시각(ISO). 없으면 제한을 계산하지 않는다. */
  startedAt: string | null;
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
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const autoSubmitted = useRef(false);

  /* 제출 — 수동·자동(시간 종료) 공통 경로 */
  const submit = useCallback(() => {
    startSubmit(async () => {
      const result = await submitAttemptAction(attemptId);
      // 성공 시 서버가 결과 페이지로 redirect — 여기 도달하면 실패
      if (result && !result.ok) setSubmitError(result.message);
    });
  }, [attemptId, startSubmit]);

  /* 마감 시각 = 서버 기록 시작 시각 + 제한 시간. 둘 중 하나라도 없으면 제한 없음. */
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const deadline =
    timeLimitMinutes !== null && Number.isFinite(startedMs)
      ? startedMs + timeLimitMinutes * 60_000
      : null;

  /* 초기값을 서버 렌더에서 잡으면 하이드레이션이 어긋난다 — 마운트 후부터 센다. */
  useEffect(() => {
    if (deadline === null) return;
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const expired = deadline !== null && secondsLeft !== null && secondsLeft <= 0;
  const lowTime = secondsLeft !== null && secondsLeft <= 60;

  /* 시간 종료 → 자동 제출. 수동 제출과 같은 경로를 쓰고, 저장 중이면 그 저장이
   * 끝난 뒤에 보낸다 (마지막 답안이 유실되지 않게). 자동 재시도는 하지 않고,
   * 실패하면 학생이 배너에서 직접 다시 제출한다. */
  useEffect(() => {
    if (!expired || pending || autoSubmitted.current) return;
    autoSubmitted.current = true;
    setSubmitError(null);
    submit();
  }, [expired, pending, submit]);

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
        {deadline !== null ? (
          <p
            className={`font-mono text-xs ${
              lowTime ? "font-bold text-grade" : "text-ink-soft"
            }`}
          >
            {secondsLeft === null
              ? `제한 ${timeLimitMinutes}분`
              : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")} 남음`}
          </p>
        ) : (
          timeLimitMinutes !== null && (
            <p className="font-mono text-xs text-ink-soft">제한 {timeLimitMinutes}분</p>
          )
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

      {expired && (
        <div
          role={submitError ? "alert" : "status"}
          className={`flex items-center justify-between gap-3 border-b border-rule-soft px-4 py-2 text-sm ${
            submitError ? "bg-grade-soft text-grade" : "bg-highlight-soft"
          }`}
        >
          {submitError ? (
            <>
              <p>제한 시간이 끝났지만 제출에 실패했습니다. {submitError}</p>
              <button
                type="button"
                disabled={submitting}
                onClick={submit}
                className="shrink-0 rounded-[var(--radius-control)] border border-grade px-3 py-1 text-xs font-medium disabled:opacity-60"
              >
                {submitting ? "제출 중…" : "다시 제출"}
              </button>
            </>
          ) : (
            <p>제한 시간이 끝나 자동으로 제출하고 있습니다…</p>
          )}
        </div>
      )}

      <div className="min-h-[220px] px-5 py-6">
        <div className="flex gap-2">
          <span className="font-mono font-bold text-pen">{q.number}.</span>
          <QuestionBody lines={q.bodyLines} className="leading-relaxed" />
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
            {/* key가 없으면 React가 문항을 넘길 때 **같은 DOM 노드를 재사용**한다.
                비제어 입력이라 defaultValue가 다시 적용되지 않아, 앞 문항에
                입력한 글자가 다음 문항 칸에 그대로 남는다 (실측: 3번에 「5」를
                넣고 넘어가니 손대지 않은 4번 칸에 「5」가 보였다). 학생이 이미
                답한 줄 알고 넘어가거나, 그 칸을 건드리는 순간 남의 답이
                저장된다. 문항마다 새로 마운트시켜 끊는다. */}
            <input
              key={q.assessmentQuestionId}
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
              onClick={submit}
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
