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
  /** 판별 문항의 기호 칩 — 발문이 언급한 기호만 담긴다. 빈 배열이면 일반 단답 */
  symbolOptions: string[];
}

/* 기호 칩의 그림 — **글자가 아니라 도형으로 그린다.**
 *
 * ◯(U+25EF)·△(U+25B3)·×(U+00D7)는 폰트마다 글리프 크기가 제각각이다. 같은
 * font-size를 줘도 ◯는 크고 ×는 작게 나와, 칩 셋이 나란히 서면 눈에 띄게
 * 들쭉날쭉했다(실측). 이모지(⭕🔺❌)는 더 나쁘다 — OS마다 모양·색이 다르고
 * 색이 박혀 있어 잉크 색을 따르지 않는다.
 *
 * 같은 24×24 상자에 같은 선 굵기로 그리면 셋이 정확히 같은 무게가 된다.
 * 색은 currentColor라 눌림 상태·테마를 그대로 따른다. 제출 값은 여전히
 * 기호 문자 그대로다(채점이 문자열을 본다) — 바뀐 것은 보이는 그림뿐이다. */
function SymbolGlyph({ symbol }: { symbol: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden focusable="false">
      {symbol === "◯" && <circle cx="12" cy="12" r="8.25" {...common} />}
      {symbol === "△" && <path d="M12 3.9 L20.4 19 L3.6 19 Z" {...common} />}
      {symbol === "×" && <path d="M6.2 6.2 L17.8 17.8 M17.8 6.2 L6.2 17.8" {...common} />}
    </svg>
  );
}

/* 판별 문항의 답은 키보드로 칠 수 없는 기호다(◯·△·×). 칩이 유일한 입력이고
 * 발문도 「고르시오」로 표시 전환된다(symbol-answer.ts). 칩은 발문이 언급한
 * 기호만 — 「옳으면 ◯, 옳지 않으면 ×」 문항에 △ 칩이 있으면 뜻 없는 답이
 * 가능해진다. 같은 칩을 다시 누르면 답을 물린다. */
function ShortAnswerInput({
  name,
  symbolOptions,
}: {
  name: string;
  symbolOptions: string[];
}) {
  const [value, setValue] = useState("");
  if (symbolOptions.length === 0) {
    return (
      <input
        name={name}
        type="text"
        placeholder="답"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-3 block w-48 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm focus:border-pen focus:outline-none"
      />
    );
  }
  return (
    <div className="mt-3 flex gap-1.5" role="group" aria-label="답 고르기">
      <input name={name} type="hidden" value={value} />
      {symbolOptions.map((s) => (
        /* aria-label로 기호를 남긴다 — 그림만 남기면 스크린리더와 이름으로
           찾는 테스트가 버튼을 못 부른다 */
        <button
          key={s}
          type="button"
          aria-label={s}
          aria-pressed={value === s}
          onClick={() => setValue(value === s ? "" : s)}
          className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] border border-rule aria-pressed:border-pen aria-pressed:bg-pen-soft/30"
        >
          <SymbolGlyph symbol={s} />
        </button>
      ))}
    </div>
  );
}

export function PracticeForm({
  materialId,
  title,
  conceptName,
  items,
  titleAs: Title = "h2",
  showConcept = true,
}: {
  materialId: string;
  title: string;
  conceptName: string;
  items: PracticeItem[];
  /** 문서 위계에 맞는 제목 태그 — 연습 화면은 h2, 개념 학습 쪽 안에서는 h4.
   *  고정하면 개념 쪽에서 묶음 제목이 개념 이름(h2)과 같은 층에 앉아, 제목
   *  개요만 보는 사람에게 연습 묶음이 또 하나의 개념처럼 읽힌다. */
  titleAs?: "h2" | "h3" | "h4";
  /** 개념명 캡션 — 화면(또는 쪽) 전체가 이미 그 개념일 때는 끈다 */
  showConcept?: boolean;
}) {
  const [state, action, pending] = useActionState<PracticeResult | null, FormData>(
    submitPracticeAction,
    null,
  );

  return (
    <form action={action} className="rounded-lg border border-rule bg-surface p-5">
      <input type="hidden" name="materialId" value={materialId} />
      {showConcept && (
        <p className="font-mono text-xs text-ink-soft">{conceptName}</p>
      )}
      <Title className="mt-0.5 font-medium">{title}</Title>

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
                      symbolOptions={q.symbolOptions}
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
