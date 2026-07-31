import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ResolveForm } from "./ResolveForm";

export const metadata: Metadata = { title: "채점·예외" };

const KIND_LABEL: Record<string, string> = {
  low_confidence_ocr: "인식 신뢰도 부족",
  multiple_valid_answers: "복수 정답 가능",
  format_mismatch: "정답 형식 불일치",
  essay_partial: "서술형 부분 점수",
  answer_explanation_conflict: "답안·해설 충돌",
  question_error_suspected: "문항 오류 의심",
  ambiguous_answer: "답안 해석 모호",
};

/* 채점 예외함 (19장) — 학생 원본 답안·자동 판단 근거·신뢰도를 나란히 보고
 * 사람이 판정한다. 불확실한 답을 임의로 확정하지 않는다 (원칙 8). */

export default async function GradingPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const exceptions = await sql<
    {
      id: string;
      kind: string;
      created_at: Date;
      learner_name: string;
      assessment_title: string;
      sort_order: number;
      raw_answer: unknown;
      auto_result: unknown;
      points: string;
      answer_snapshot: unknown;
    }[]
  >`
    select ge.id, ge.kind, ge.created_at,
           l.display_name as learner_name,
           a.title as assessment_title,
           aq.sort_order, r.answer as raw_answer, ge.auto_result,
           aq.points::text, aq.answer_snapshot
    from grading_exceptions ge
    join responses r on r.id = ge.response_id
    join attempts t on t.id = ge.attempt_id
    join learners l on l.id = t.learner_id
    join assessment_instances a on a.id = t.assessment_id
    join assessment_questions aq on aq.id = r.assessment_question_id
    where ge.organization_id = ${user.organizationId}
      and ge.status <> 'resolved'
    order by ge.created_at asc
  `;

  const [resolvedToday] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from grading_exceptions
    where organization_id = ${user.organizationId}
      and status = 'resolved'
      and resolved_at >= date_trunc('day', now() at time zone ${user.timezone})
  `;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">채점·예외</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        자동 채점이 확정하지 않은 답안입니다. 판정하면 점수·숙련도·복습이 함께
        갱신되고 변경 이력이 감사 로그에 남습니다.
        {(resolvedToday?.cnt ?? 0) > 0 && ` 오늘 판정 완료 ${resolvedToday?.cnt}건.`}
      </p>

      {exceptions.length === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">검토할 채점 예외가 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            자동 채점이 불확실한 답안(서술형, 단위 문제, 모호한 표기)만 이곳으로
            옵니다.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {exceptions.map((e) => (
            <li key={e.id} className="rounded-lg border border-rule bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {e.learner_name} · {e.assessment_title} · {e.sort_order}번
                </p>
                <span className="rounded-[var(--radius-control)] bg-highlight-soft px-2 py-1 font-mono text-xs">
                  {KIND_LABEL[e.kind] ?? e.kind}
                </span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-[var(--radius-control)] border border-rule-soft p-3">
                  <dt className="text-xs text-ink-soft">학생 답안 (원본)</dt>
                  <dd className="mt-1 font-mono">
                    {formatAnswer(e.raw_answer)}
                  </dd>
                </div>
                <div className="rounded-[var(--radius-control)] border border-rule-soft p-3">
                  <dt className="text-xs text-ink-soft">기준 정답</dt>
                  <dd className="mt-1 font-mono">
                    {formatKey(e.answer_snapshot)}
                  </dd>
                </div>
              </dl>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-ink-soft">
                  자동 채점 판단 근거
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-paper p-2 font-mono text-xs">
                  {JSON.stringify(e.auto_result, null, 2)}
                </pre>
              </details>
              <ResolveForm exceptionId={e.id} maxPoints={Number(e.points)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatAnswer(answer: unknown): string {
  if (!answer || typeof answer !== "object") return "무응답";
  const a = answer as { kind?: string; rawText?: string; selectedChoiceIds?: string[]; text?: string };
  if (a.kind === "short_answer") return a.rawText || "무응답";
  if (a.kind === "multiple_choice") return (a.selectedChoiceIds ?? []).join(", ") || "무응답";
  if (a.kind === "essay") return a.text || "무응답";
  return JSON.stringify(answer);
}

function formatKey(key: unknown): string {
  if (!key || typeof key !== "object") return "—";
  const k = key as {
    kind?: string;
    accepted?: Array<{ value: string; unit?: string }>;
    correctChoiceIds?: string[];
  };
  if (k.kind === "short_answer") {
    return (k.accepted ?? [])
      .map((x) => `${x.value}${x.unit ? ` ${x.unit}` : ""}`)
      .join(" 또는 ");
  }
  if (k.kind === "multiple_choice") return (k.correctChoiceIds ?? []).join(", ");
  return "루브릭 채점";
}
