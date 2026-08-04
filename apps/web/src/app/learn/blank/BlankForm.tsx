"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { submitBlankAction } from "./actions";
import type { BlankGradeResult } from "@/lib/domain/concept-blank";
import { VoiceInputHint } from "@/components/learn/VoiceInput";

/* 빈칸 한 단계 — 채점과 이동.
 *
 * 본문(빈칸이 뚫린 개념 섹션)은 **서버가 그린 그대로** children으로 받는다.
 * 클라이언트에서 다시 그리면 개념 섹션과 다른 화면이 되고, 그 순간
 * 「배운 것과 똑같은 화면에서 떠올린다」가 깨진다. */

export function BlankForm({
  setId,
  stage,
  nextHref,
  nextLabel,
  children,
}: {
  setId: string;
  stage: "one" | "two" | "full";
  nextHref: string;
  nextLabel: string;
  children: React.ReactNode;
}) {
  /* 음성 입력의 대상 — 학생이 **방금 누른 칸**이다. 칸마다 마이크를 두면
   * 문장 사이에 버튼이 박혀 개념 섹션과 다른 화면이 된다. 아직 아무 칸도
   * 안 눌렀으면 비어 있는 첫 칸으로 보낸다. */
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastFieldRef = useRef<HTMLInputElement | null>(null);
  const pickTarget = () => {
    const f = lastFieldRef.current;
    if (f?.isConnected) return f;
    const all = [
      ...(formRef.current?.querySelectorAll<HTMLInputElement>('input[name^="b-"]') ??
        []),
    ];
    return all.find((i) => i.value.trim().length === 0) ?? all[0] ?? null;
  };

  const [state, action, pending] = useActionState<
    BlankGradeResult | null,
    FormData
  >(submitBlankAction, null);
  const done = state?.completed ?? false;

  /* 채점 뒤 입력칸을 되살리고 맞고 틀림을 **칸 자리에서** 표시한다.
   *
   * 본문은 서버가 그린 HTML(개념 섹션과 같은 것)이라 React가 값을 들고 있지
   * 않다. 그래서 폼이 다시 그려지면 학생이 쓴 답이 사라지고, 「1번이 틀렸다」는
   * 말만 남는다 — 번호는 화면 어디에도 안 보이므로 그 말로는 어느 칸인지
   * 알 수 없다. 답을 되돌려 놓고 틀린 칸에 색을 입힌다. */
  useEffect(() => {
    if (!state?.submitted) return;
    for (const [pos, value] of Object.entries(state.submitted)) {
      const el = document.querySelector<HTMLInputElement>(`input[name="b-${pos}"]`);
      if (!el) continue;
      el.value = value;
      const ok = state.graded[Number(pos)];
      el.classList.remove("border-pen", "border-grade", "bg-grade-soft", "bg-pen-soft/30");
      el.classList.add(ok ? "border-pen" : "border-grade", ok ? "bg-pen-soft/30" : "bg-grade-soft");
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      onFocusCapture={(e) => {
        const t = e.target as HTMLElement;
        if (t instanceof HTMLInputElement && t.name.startsWith("b-")) {
          lastFieldRef.current = t;
        }
      }}
    >
      <input type="hidden" name="setId" value={setId} />

      {children}
      {/* 3단계만 말로도 입력할 수 있다 — 칸이 많아 타이핑 부담이 크다.
          1·2단계는 타이핑만이다(소유자 결정). */}
      {stage === "full" && (
        <VoiceInputHint
          getTarget={pickTarget}
          idle="채울 칸을 누른 뒤 말하면 그 칸에 들어갑니다."
        />
      )}

      {/* 채점 결과 — 어느 칸이 틀렸는지는 칸 옆이 아니라 여기 모아서 말한다.
          입력칸이 본문 HTML 안에 있어 칸마다 표시를 붙이려면 본문을
          클라이언트로 옮겨야 하고, 그러면 개념 섹션과 같은 화면이 아니게 된다. */}
      {state && (
        <div
          role="status"
          className={`mt-4 rounded-lg border px-4 py-3 text-sm break-keep ${
            done
              ? "border-pen bg-pen-soft/40"
              : "border-highlight bg-highlight-soft"
          }`}
        >
          <p className="font-medium">{state.message}</p>
          {!done && (
            <p className="mt-1 text-ink-soft">
              틀린 칸:{" "}
              {Object.entries(state.graded)
                .filter(([, ok]) => !ok)
                .map(([pos]) => `${pos}번`)
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] border border-pen bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "채점 중…" : state ? "다시 채점" : "채점하기"}
        </button>
        {/* 다음으로는 **다 맞힌 뒤에** 열린다 — 절반만 맞히고 넘어가면
            인출을 확인한 것이 아니다. 다시 풀어도 기록은 깎이지 않는다. */}
        {done ? (
          <Link
            href={nextHref}
            className="rounded-[var(--radius-control)] border border-pen bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            {nextLabel}
          </Link>
        ) : (
          <span className="text-xs break-keep text-ink-soft">
            다 맞히면 다음으로 넘어갑니다
          </span>
        )}
      </div>
    </form>
  );
}
