import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { GenerateForm } from "./GenerateForm";

export const metadata: Metadata = { title: "일일·확인테스트" };

const STATUS_LABEL: Record<string, string> = {
  generating: "생성 중",
  draft: "초안",
  ready: "준비 완료",
  review_required: "검토 필요",
  published: "게시됨",
  open: "응시 중",
  closed: "마감",
  grading: "채점 중",
  finalized: "완료",
  cancelled: "취소",
};

export default async function TestsPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const [groups, assessments, nextSession] = await Promise.all([
    sql<{ id: string; name: string }[]>`
      select id, name from learning_groups
      where organization_id = ${user.organizationId} and status = 'operating'
      order by name
    `,
    sql<
      {
        id: string;
        title: string;
        status: string;
        scheduled_date: string | null;
        group_name: string | null;
        question_count: number;
        assigned: number;
        submitted: number;
      }[]
    >`
      select a.id, a.title, a.status, a.scheduled_date::text,
             g.name as group_name,
             (select count(*)::int from assessment_questions q where q.assessment_id = a.id) as question_count,
             (select count(*)::int from assignments s where s.assessment_id = a.id) as assigned,
             (select count(*)::int from attempts t
               where t.assessment_id = a.id and t.status in ('submitted','auto_graded','review_required','finalized')) as submitted
      from assessment_instances a
      left join learning_groups g on g.id = a.learning_group_id
      where a.organization_id = ${user.organizationId}
      order by a.created_at desc
      limit 30
    `,
    sql<{ session_date: string }[]>`
      select min(session_date)::text as session_date from sessions
      where organization_id = ${user.organizationId}
        and session_date >= (now() at time zone ${user.timezone})::date
    `,
  ]);

  const defaultDate =
    nextSession[0]?.session_date ??
    new Date().toLocaleDateString("en-CA", { timeZone: user.timezone });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">일일·확인테스트</h1>

      <div className="mt-6">
        <GenerateForm groups={groups} defaultDate={defaultDate} />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">생성된 테스트</h2>
        {assessments.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            아직 생성된 테스트가 없습니다. 위에서 수업 날짜를 골라 생성하세요.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {assessments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-soft">
                    {a.group_name ?? "개인"} · {a.question_count}문항 · 배정{" "}
                    {a.assigned}명 · 제출 {a.submitted}명
                  </p>
                </div>
                <span className="rounded-[var(--radius-control)] border border-rule px-2 py-1 font-mono text-xs">
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
