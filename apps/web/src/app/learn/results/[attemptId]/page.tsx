import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import { getCurrentLearner } from "@/lib/auth/current-learner";

export const metadata: Metadata = { title: "테스트 결과" };

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const learner = (await getCurrentLearner())!;
  const sql = getSharedSql();

  const [attempt] = await sql<
    {
      id: string;
      status: string;
      total_score: string | null;
      max_score: string | null;
      title: string;
    }[]
  >`
    select t.id, t.status, t.total_score::text, t.max_score::text, a.title
    from attempts t
    join assessment_instances a on a.id = t.assessment_id
    where t.id = ${attemptId}
      and t.organization_id = ${learner.user.organizationId}
      and t.learner_id = ${learner.learnerId}
  `;
  if (!attempt) notFound();

  const rows = await sql<
    {
      sort_order: number;
      concept_names: string[];
      is_correct: boolean | null;
      score: string | null;
      max_score: string | null;
      is_final: boolean;
    }[]
  >`
    select aq.sort_order,
           coalesce(array_agg(c.name) filter (where c.name is not null), '{}') as concept_names,
           d.is_correct, d.score::text, d.max_score::text, d.is_final
    from assessment_questions aq
    left join responses r on r.assessment_question_id = aq.id and r.attempt_id = ${attemptId}
    left join grade_decisions d on d.response_id = r.id
      and d.version = (select max(version) from grade_decisions where response_id = r.id)
    left join question_alignments qa on qa.question_id = aq.question_id
    left join canonical_concepts c on c.id = qa.concept_id
    where aq.assessment_id = (select assessment_id from attempts where id = ${attemptId})
    group by aq.sort_order, d.is_correct, d.score, d.max_score, d.is_final
    order by aq.sort_order
  `;

  const wrongCount = rows.filter((r) => r.is_final && r.is_correct === false).length;

  return (
    <div>
      <p className="font-mono text-sm text-pen">채점 결과</p>
      <h1 className="mt-1 font-[MaruBuri] text-xl font-semibold">{attempt.title}</h1>

      <div className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <p className="text-3xl font-bold">
          {attempt.total_score ?? "—"}점{" "}
          <span className="text-base font-normal text-ink-soft">
            / {attempt.max_score ?? "—"}점
          </span>
        </p>
        {attempt.status === "review_required" && (
          <p className="mt-2 rounded-[var(--radius-control)] bg-highlight-soft px-3 py-2 text-sm">
            일부 답안은 선생님 확인 후 점수가 확정됩니다.
          </p>
        )}
      </div>

      <ul className="mt-4 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
        {rows.map((r) => (
          <li key={r.sort_order} className="flex items-center justify-between px-4 py-3">
            <p className="text-sm">
              {r.sort_order}번
              <span className="ml-2 text-ink-soft">
                {r.concept_names.join(", ")}
              </span>
            </p>
            <span
              className={`font-mono text-xs ${
                !r.is_final
                  ? "text-ink-soft"
                  : r.is_correct
                    ? "text-pen"
                    : "text-grade"
              }`}
            >
              {!r.is_final
                ? "선생님 확인"
                : r.is_correct
                  ? `정답 +${r.score}`
                  : "오답"}
            </span>
          </li>
        ))}
      </ul>

      {wrongCount > 0 && (
        <p className="mt-4 rounded-lg border border-highlight bg-highlight-soft px-4 py-3 text-sm">
          오답 {wrongCount}문항의 개념이 복습 일정에 배치되었습니다. 내일부터
          간격을 두고 다시 확인합니다.
        </p>
      )}

      <p className="mt-6 text-center">
        <Link href="/learn/today" className="text-sm text-pen underline underline-offset-4">
          오늘 학습으로 돌아가기
        </Link>
      </p>
    </div>
  );
}
