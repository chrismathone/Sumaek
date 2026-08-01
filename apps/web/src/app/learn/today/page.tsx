import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { trimScore } from "@/lib/format";

export const metadata: Metadata = { title: "오늘 학습" };

export default async function LearnTodayPage() {
  const learner = (await getCurrentLearner())!;
  const sql = getSharedSql();

  const assessments = await sql<
    {
      id: string;
      title: string;
      time_limit_minutes: number | null;
      question_count: number;
      attempt_id: string | null;
      attempt_status: string | null;
      total_score: string | null;
      max_score: string | null;
    }[]
  >`
    select a.id, a.title, a.time_limit_minutes,
           (select count(*)::int from assessment_questions q where q.assessment_id = a.id) as question_count,
           t.id as attempt_id, t.status as attempt_status,
           t.total_score::text, t.max_score::text
    from assignments s
    join assessment_instances a on a.id = s.assessment_id
    left join attempts t on t.assessment_id = a.id and t.learner_id = s.learner_id
    where s.learner_id = ${learner.learnerId}
      and s.status <> 'cancelled'
      and a.status in ('published', 'open', 'closed', 'grading', 'finalized')
    order by a.scheduled_date desc nulls last, a.created_at desc
  `;

  const reviews = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from review_items
    where learner_id = ${learner.learnerId} and status = 'scheduled'
  `;

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold">
        {learner.displayName}님의 오늘 학습
      </h1>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">테스트</h2>
        {assessments.length === 0 ? (
          <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
            배정된 테스트가 없습니다. 선생님이 배정하면 여기에 표시됩니다.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {assessments.map((a) => {
              const done =
                a.attempt_status &&
                ["submitted", "auto_graded", "review_required", "finalized"].includes(
                  a.attempt_status,
                );
              return (
                <li key={a.id} className="rounded-lg border border-rule bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{a.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-ink-soft">
                        {a.question_count}문항
                        {a.time_limit_minutes && ` · 제한 ${a.time_limit_minutes}분`}
                      </p>
                    </div>
                    {done ? (
                      <Link
                        href={`/learn/results/${a.attempt_id}`}
                        className="rounded-[var(--radius-control)] border border-pen px-4 py-2 text-sm font-medium text-pen"
                      >
                        {a.total_score !== null
                          ? `결과 보기 (${trimScore(a.total_score)}/${trimScore(a.max_score)}점)`
                          : "결과 보기"}
                      </Link>
                    ) : (
                      <Link
                        href={`/learn/tests/${a.id}`}
                        className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
                      >
                        {a.attempt_status === "in_progress" ? "이어서 풀기" : "응시하기"}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {reviews[0] && reviews[0].cnt > 0 && (
        <section className="mt-6 rounded-lg border border-highlight bg-highlight-soft p-4 text-sm">
          다음 복습 예정 {reviews[0].cnt}건이 준비되어 있습니다. 오답 개념은
          간격을 두고 다시 확인합니다.
        </section>
      )}
    </div>
  );
}
