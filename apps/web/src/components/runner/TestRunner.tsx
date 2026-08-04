"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { gradeAnswer, type GradeOutcome } from "@su-maek/core/grading";
import type { StudentAnswer } from "@su-maek/contracts";
import { QuestionBody } from "@/components/learn/QuestionText";
import type { RunnerQuestion } from "./types";

/* ─────────────────────────────────────────────────────────────
 * 학생 테스트 러너 (골프롬프트 18장) — 데모 체험판이자 실제 러너의 원형.
 *
 * - 문제 번호·진행률, KaTeX 수식(서버 사전 렌더), 임시 저장(증가 시퀀스),
 *   제출 전 미응답 확인, 키보드 조작.
 * - 데모에서는 core 채점 엔진이 브라우저에서 즉시 실행된다.
 *   실제 응시에서는 같은 엔진이 서버에서 실행되고 저신뢰 답은 예외함으로
 *   이동한다 — 판정 로직은 동일하다 (단일 엔진).
 * ───────────────────────────────────────────────────────────── */

interface RunnerState {
  answers: Record<string, StudentAnswer>;
  savedSequence: number;
}

const STORAGE_KEY = "su-maek-demo-attempt";

export function TestRunner({
  questions,
  timeLimitMinutes,
}: {
  questions: RunnerQuestion[];
  timeLimitMinutes: number;
}) {
  const [current, setCurrent] = useState(0);
  const [state, setState] = useState<RunnerState>({ answers: {}, savedSequence: 0 });
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(timeLimitMinutes * 60);

  // 임시 저장 복원 (재접속·새로고침 대응 — 18장 네트워크 재연결의 데모판)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RunnerState;
        if (parsed && typeof parsed.savedSequence === "number") setState(parsed);
      }
    } catch {
      /* 손상된 저장분은 무시 — 새로 시작 */
    }
  }, []);

  // 타이머
  useEffect(() => {
    if (submitted) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [submitted]);

  const saveAnswer = useCallback(
    (questionId: string, answer: StudentAnswer) => {
      setState((prev) => {
        // 증가 시퀀스 — 여러 탭·기기 충돌 감지의 데모판 (2G)
        const next: RunnerState = {
          answers: { ...prev.answers, [questionId]: answer },
          savedSequence: prev.savedSequence + 1,
        };
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* 저장 실패 시에도 메모리 상태는 유지 */
        }
        return next;
      });
    },
    [],
  );

  const unanswered = useMemo(
    () => questions.filter((q) => !state.answers[q.questionId]),
    [questions, state.answers],
  );

  const results = useMemo(() => {
    if (!submitted) return null;
    const map = new Map<string, GradeOutcome>();
    for (const q of questions) {
      const answer =
        state.answers[q.questionId] ??
        (q.kind === "multiple_choice"
          ? ({ kind: "multiple_choice", selectedChoiceIds: [] } as const)
          : ({ kind: "short_answer", rawText: "" } as const));
      map.set(
        q.questionId,
        gradeAnswer(q.answerKey, answer, q.points, { minAutoConfidence: 0.9 }),
      );
    }
    return map;
  }, [submitted, questions, state.answers]);

  if (submitted && results) {
    return <ResultView questions={questions} results={results} />;
  }

  const q = questions[current];
  if (!q) return null;
  const currentAnswer = state.answers[q.questionId];

  return (
    <div className="rounded-lg border border-rule bg-surface">
      {/* 상단: 진행률·타이머 */}
      <div className="flex items-center justify-between border-b border-rule-soft px-4 py-3">
        <p className="font-mono text-sm">
          {current + 1} / {questions.length}
        </p>
        <div
          className="flex h-1.5 w-40 overflow-hidden rounded bg-rule-soft"
          role="progressbar"
          aria-valuenow={current + 1}
          aria-valuemin={1}
          aria-valuemax={questions.length}
          aria-label="진행률"
        >
          <div
            className="bg-pen transition-all"
            style={{ width: `${((current + 1) / questions.length) * 100}%` }}
          />
        </div>
        <p
          className={`font-mono text-sm ${secondsLeft < 60 ? "text-grade" : "text-ink-soft"}`}
          aria-live="polite"
        >
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </p>
      </div>

      {/* 문항 */}
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
                  className={`flex cursor-pointer items-baseline gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 transition-colors ${
                    selected
                      ? "border-pen bg-pen-soft/50"
                      : "border-rule hover:border-pen"
                  }`}
                >
                  <input
                    type="radio"
                    name={`q-${q.questionId}`}
                    checked={selected}
                    onChange={() =>
                      saveAnswer(q.questionId, {
                        kind: "multiple_choice",
                        selectedChoiceIds: [choice.choiceId],
                      })
                    }
                    className="sr-only"
                  />
                  <span className="font-mono text-sm">
                    {["①", "②", "③", "④", "⑤"][i]}
                  </span>
                  <span dangerouslySetInnerHTML={{ __html: choice.html }} />
                </label>
              );
            })}
          </fieldset>
        )}

        {q.kind === "short_answer" && (
          <div className="mt-5">
            <label
              htmlFor={`answer-${q.questionId}`}
              className="block text-sm text-ink-soft"
            >
              답 (분수는 3/4 형태로 입력)
            </label>
            <input
              id={`answer-${q.questionId}`}
              type="text"
              inputMode="text"
              value={
                currentAnswer?.kind === "short_answer" ? currentAnswer.rawText : ""
              }
              onChange={(e) =>
                saveAnswer(q.questionId, {
                  kind: "short_answer",
                  rawText: e.target.value,
                })
              }
              className="mt-1.5 w-48 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono focus:border-pen focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* 하단: 이동·제출 */}
      <div className="flex items-center justify-between border-t border-rule-soft px-4 py-3">
        <button
          type="button"
          disabled={current === 0}
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 text-sm disabled:opacity-40"
        >
          이전
        </button>
        <p className="font-mono text-xs text-ink-soft" aria-live="polite">
          저장 {state.savedSequence}회
        </p>
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

      {/* 제출 전 미응답 확인 (18장) */}
      {confirming && (
        <div className="border-t border-rule-soft bg-highlight-soft px-4 py-3">
          {unanswered.length > 0 ? (
            <p className="text-sm">
              미응답 {unanswered.length}문항이 있습니다 (
              {unanswered.map((u) => u.number).join(", ")}번). 그래도
              제출할까요?
            </p>
          ) : (
            <p className="text-sm">모든 문항에 답했습니다. 제출할까요?</p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSubmitted(true);
                try {
                  sessionStorage.removeItem(STORAGE_KEY);
                } catch {
                  /* noop */
                }
              }}
              className="rounded-[var(--radius-control)] bg-ink px-4 py-1.5 text-sm font-medium text-white"
            >
              제출 확정
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

/* ── 결과 화면 — 즉시 채점 + 다음 학습 행동 설명 ── */

function ResultView({
  questions,
  results,
}: {
  questions: RunnerQuestion[];
  results: Map<string, GradeOutcome>;
}) {
  const outcomes = questions.map((q) => ({
    q,
    r: results.get(q.questionId) as GradeOutcome,
  }));
  const correct = outcomes.filter((o) => o.r.verdict === "correct");
  const wrong = outcomes.filter(
    (o) => o.r.verdict === "incorrect" || o.r.verdict === "partial",
  );
  const review = outcomes.filter((o) => o.r.verdict === "needs_review");
  const earned = outcomes.reduce((s, o) => s + (o.r.score ?? 0), 0);
  const max = outcomes.reduce((s, o) => s + o.r.maxScore, 0);

  return (
    <div className="rounded-lg border border-rule bg-surface">
      <div className="border-b border-rule-soft px-5 py-4">
        <p className="font-mono text-xs text-ink-soft">채점 결과</p>
        <p className="mt-1 text-2xl font-bold">
          {earned}점 <span className="text-base font-normal text-ink-soft">/ {max}점</span>
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          정답 {correct.length} · 오답 {wrong.length}
          {review.length > 0 && ` · 선생님 확인 대기 ${review.length}`}
        </p>
      </div>

      <ul className="divide-y divide-rule-soft">
        {outcomes.map(({ q, r }) => (
          <li key={q.questionId} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {q.number}번 · {q.conceptName}
              </p>
              <span
                className={`shrink-0 font-mono text-xs ${
                  r.verdict === "correct"
                    ? "text-pen"
                    : r.verdict === "needs_review"
                      ? "text-ink-soft"
                      : "text-grade"
                }`}
              >
                {r.verdict === "correct"
                  ? `정답 +${r.score}`
                  : r.verdict === "needs_review"
                    ? "선생님 확인"
                    : r.verdict === "partial"
                      ? `부분 점수 ${r.score}/${r.maxScore}`
                      : "오답"}
              </span>
            </div>
            {r.verdict !== "correct" && (
              <p className="mt-1 text-xs text-ink-soft">
                {r.verdict === "needs_review"
                  ? "판정이 불확실한 답은 임의로 확정하지 않고 선생님 검토함으로 보냅니다."
                  : "이 개념의 오답 복습이 내일 일정에 배치되고, 금요일 확인테스트 후보에 추가됩니다."}
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="border-t border-rule-soft bg-paper px-5 py-4 text-sm text-ink-soft">
        <p>
          실제 운영에서는 이 결과가 개념 숙련도 증거로 기록되고, 오답 복습·
          재시험·미래 일정 재계산이 자동으로 이어집니다. 한 번의 점수만으로
          숙련을 확정하지 않습니다.
        </p>
      </div>
    </div>
  );
}
