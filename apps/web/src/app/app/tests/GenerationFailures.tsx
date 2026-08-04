"use client";

import { useActionState } from "react";
import type {
  FailedAssessmentGeneration,
  RetryGenerationResult,
} from "@su-maek/db/domain";
import { retryAssessmentGenerationAction } from "./actions";

/* ─────────────────────────────────────────────────────────────
 * 자동 생성 실패의 복구 화면 (T3.4).
 *
 * 이 화면이 없던 동안 실패는 `jobs` 테이블에만 남았다. 교사는 큐를 보지
 * 않으므로, 수업 당일 아침 학생 화면의 빈 시험 칸이 첫 신호였다.
 *
 * 그래서 여기서는 세 가지를 **함께** 보인다: 무엇이 실패했나 · 왜 · 무엇을
 * 하면 되나. 사유 코드를 그대로 보여 주면 교사는 아무것도 할 수 없다.
 * ───────────────────────────────────────────────────────────── */

/** 사유 코드 → 원인·조치. 워커의 FAILURE_RECOVERY와 같은 말을 쓴다. */
const REASON_GUIDE: Record<string, { why: string; action: string; href?: string }> = {
  no_policy: {
    why: "이 반에 적용할 평가 정책이 없습니다.",
    action: "반 설정에서 평가 정책을 지정하거나 학원 기본 정책을 만드세요.",
    href: "/app/classes",
  },
  no_session: {
    why: "그날 예정된 수업이 없습니다.",
    action: "학습 루트에서 일정을 먼저 만드세요.",
    href: "/app/routes",
  },
  no_route: {
    why: "게시된 루트가 없어 확인테스트의 단원 범위를 정할 수 없습니다.",
    action: "루트를 게시한 뒤 다시 실행하세요.",
    href: "/app/routes",
  },
  insufficient_questions: {
    why: "출제할 수 있는 문항이 부족합니다.",
    action: "문항의 개념 정렬과 검수·사용 권한 상태를 확인하세요.",
    href: "/app/content/questions",
  },
  no_repeat_window: {
    why: "후보 문항이 모두 최근 출제분입니다.",
    action: "정책의 무반복 기간을 줄이거나 이 개념의 문항을 늘리세요.",
    href: "/app/content/questions",
  },
  difficulty_unsatisfiable: {
    why: "난이도 배분 조건을 만족하는 조합이 없습니다.",
    action: "정책의 난이도 배분을 확인하세요.",
    href: "/app/settings",
  },
  transient_db: {
    why: "저장 중 오류가 반복돼 재시도를 모두 소진했습니다.",
    action: "다시 실행하세요. 계속 실패하면 운영에 알리세요.",
  },
  bad_payload: {
    why: "생성 요청의 형식이 올바르지 않습니다.",
    action: "운영에 알리세요 — 자동으로 낫지 않습니다.",
  },
};

const PURPOSE_LABEL: Record<string, string> = {
  formative: "일일테스트",
  confirmation: "확인테스트",
};

export function GenerationFailures({
  failures,
}: {
  failures: FailedAssessmentGeneration[];
}) {
  const [result, action, pending] = useActionState<
    RetryGenerationResult | null,
    FormData
  >(retryAssessmentGenerationAction, null);

  /* 실패가 없으면 아무것도 그리지 않는다 — 「실패 0건」 상자를 늘 띄우면
     화면이 그만큼 시끄러워지고, 정작 실패가 났을 때 눈에 덜 띈다. */
  if (failures.length === 0) return null;

  return (
    <section className="mt-8 rounded-lg border border-grade bg-grade-soft p-5">
      <h2 className="font-semibold text-grade">
        자동 생성에 실패한 테스트 {failures.length}건
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        아래 항목은 <strong>학생에게 배정되지 않았습니다.</strong> 원인을 고친 뒤
        다시 실행하면, 자동 생성과 같은 자리에서 이어집니다.
      </p>

      {result && (
        <p
          role="status"
          className={`mt-3 text-sm ${result.ok ? "text-ink" : "text-grade"}`}
        >
          {result.message}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {failures.map((f) => {
          const guide = REASON_GUIDE[f.reason ?? ""] ?? {
            why: f.lastError ?? "알 수 없는 오류입니다.",
            action: "다시 실행해 보고, 계속 실패하면 운영에 알리세요.",
          };
          return (
            <li
              key={f.jobId}
              className="rounded-[var(--radius-control)] border border-rule bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">
                  {f.learningGroupName ?? "이름 없는 반"}
                </span>
                <span className="font-mono text-sm text-ink-soft">
                  {f.planDate ?? "날짜 미상"}
                </span>
                <span className="rounded-[var(--radius-control)] border border-rule px-2 py-0.5 font-mono text-xs">
                  {PURPOSE_LABEL[f.purpose ?? ""] ?? f.purpose ?? "—"}
                </span>
                <span className="font-mono text-xs text-ink-soft">
                  시도 {f.attempts}회
                </span>
              </div>
              <p className="mt-2 text-sm">{guide.why}</p>
              <p className="mt-1 text-sm text-ink-soft">
                {guide.action}
                {guide.href && (
                  <>
                    {" "}
                    <a className="underline" href={guide.href}>
                      바로 가기
                    </a>
                  </>
                )}
              </p>
              <form action={action} className="mt-3">
                <input type="hidden" name="jobId" value={f.jobId} />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                >
                  {pending ? "예약 중…" : "다시 생성"}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
