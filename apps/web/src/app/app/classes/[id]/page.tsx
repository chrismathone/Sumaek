import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  ASSESSMENT_STATUS_LABEL,
  SESSION_STATUS_LABEL,
  formatDate,
  formatDateTime,
  label,
  todayInTimeZone,
  trimScore,
} from "@/lib/format";

export const metadata: Metadata = { title: "반 상세" };

/* 반 상세 — 학생 명단·최근 테스트·다가오는 수업을 한 화면에서 본다.
 * 학생별 "최근 응시 점수"는 확정 여부를 함께 표시한다. 확정 전 점수를
 * 확정된 것처럼 보여주지 않는다 (원칙 8). */

const GROUP_STATUS_LABEL: Record<string, string> = {
  planned: "개설 예정",
  operating: "운영 중",
  completed: "종료",
  archived: "보관",
};

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();
  const today = todayInTimeZone(user.timezone);

  const [group] = await sql<
    {
      id: string;
      name: string;
      course_name: string | null;
      status: string;
      teacher_name: string | null;
      period_name: string | null;
      curriculum_name: string | null;
    }[]
  >`
    select g.id, g.name, g.course_name, g.status,
           u.display_name as teacher_name,
           p.name as period_name,
           cv.name as curriculum_name
    from learning_groups g
    left join users u on u.id = g.home_teacher_user_id
    left join course_periods p on p.id = g.course_period_id
    left join curriculum_versions cv on cv.id = g.curriculum_version_id
    where g.id = ${id} and g.organization_id = ${user.organizationId}
  `;
  if (!group) notFound();

  const [learners, assessments, upcoming] = await Promise.all([
    sql<
      {
        id: string;
        display_name: string;
        grade_level: string | null;
        status: string;
        joined_on: string;
        last_title: string | null;
        last_status: string | null;
        last_total: string | null;
        last_max: string | null;
        last_at: Date | null;
      }[]
    >`
      select l.id, l.display_name, l.grade_level, l.status,
             m.joined_on::text as joined_on,
             last_a.title as last_title, last_a.status as last_status,
             last_a.total_score::text as last_total,
             last_a.max_score::text as last_max,
             last_a.at as last_at
      from learning_group_memberships m
      join learners l on l.id = m.learner_id
      left join lateral (
        select a.title, t.status, t.total_score, t.max_score,
               coalesce(t.finalized_at, t.submitted_at) as at
        from attempts t
        join assessment_instances a on a.id = t.assessment_id
        where t.organization_id = ${user.organizationId}
          and t.learner_id = l.id
          and t.status in ('submitted', 'auto_graded', 'review_required', 'finalized')
        order by coalesce(t.finalized_at, t.submitted_at) desc nulls last
        limit 1
      ) last_a on true
      where m.organization_id = ${user.organizationId}
        and m.learning_group_id = ${id}
        and m.status = 'active'
      order by l.display_name
    `,
    sql<
      {
        id: string;
        title: string;
        status: string;
        purpose: string;
        scheduled_date: string | null;
        question_count: number;
        assigned: number;
        submitted: number;
      }[]
    >`
      select a.id, a.title, a.status, a.purpose, a.scheduled_date::text as scheduled_date,
             (select count(*)::int from assessment_questions q where q.assessment_id = a.id) as question_count,
             (select count(*)::int from assignments s where s.assessment_id = a.id and s.status <> 'cancelled') as assigned,
             (select count(*)::int from attempts t
               where t.assessment_id = a.id
                 and t.status in ('submitted', 'auto_graded', 'review_required', 'finalized')) as submitted
      from assessment_instances a
      where a.organization_id = ${user.organizationId}
        and a.learning_group_id = ${id}
      order by a.scheduled_date desc nulls last, a.created_at desc
      limit 10
    `,
    sql<
      {
        id: string;
        session_date: string;
        starts_at: Date;
        ends_at: Date;
        status: string;
        teacher_name: string | null;
      }[]
    >`
      select s.id, s.session_date::text as session_date, s.starts_at, s.ends_at, s.status,
             u.display_name as teacher_name
      from sessions s
      left join users u on u.id = s.teacher_user_id
      where s.organization_id = ${user.organizationId}
        and s.learning_group_id = ${id}
        and s.session_date >= ${today}::date
      order by s.starts_at
      limit 10
    `,
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-mono text-xs text-ink-soft">
        <Link href="/app/classes" className="hover:underline">
          반·학습 그룹
        </Link>{" "}
        / {group.name}
      </p>
      <h1 className="mt-1 font-[MaruBuri] text-2xl font-semibold">{group.name}</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {group.course_name ?? "과정 미지정"} ·{" "}
        {group.teacher_name ?? "담당 미지정"} ·{" "}
        {GROUP_STATUS_LABEL[group.status] ?? group.status}
        {group.period_name && ` · ${group.period_name}`}
        {group.curriculum_name && ` · ${group.curriculum_name}`}
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">학생 {learners.length}명</h2>
        {learners.length === 0 ? (
          <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
            이 반에 배정된 학생이 없습니다. 명단을 가져오거나 학습자를 직접
            배정하세요.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {learners.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/app/students/${l.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-paper"
                >
                  <div>
                    <p className="font-medium">{l.display_name}</p>
                    <p className="mt-0.5 font-mono text-xs text-ink-soft">
                      {l.grade_level ?? "학년 미지정"} · 합류 {l.joined_on}
                    </p>
                  </div>
                  <div className="text-right">
                    {l.last_at ? (
                      <>
                        <p className="font-mono text-sm">
                          {l.last_total !== null
                            ? `${trimScore(l.last_total)} / ${trimScore(l.last_max)}점`
                            : "채점 대기"}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-ink-soft">
                          {l.last_title} · {formatDate(l.last_at, user.timezone)}
                          {l.last_status === "review_required" && " · 확인 필요"}
                        </p>
                      </>
                    ) : (
                      <p className="font-mono text-xs text-ink-soft">응시 기록 없음</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">최근 테스트</h2>
        {assessments.length === 0 ? (
          <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
            이 반에 생성된 테스트가 없습니다.{" "}
            <Link href="/app/tests" className="text-pen underline underline-offset-4">
              일일·확인테스트에서 생성
            </Link>
            할 수 있습니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {assessments.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-soft">
                    {a.scheduled_date ?? "날짜 미지정"} · {a.question_count}문항 ·
                    배정 {a.assigned}명 · 제출 {a.submitted}명
                  </p>
                </div>
                <span className="rounded-[var(--radius-control)] border border-rule px-2 py-1 font-mono text-xs">
                  {label(ASSESSMENT_STATUS_LABEL, a.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">다가오는 수업</h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
            예정된 수업이 없습니다. 게시된 루트에서 일정을 생성하세요.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {upcoming.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <p className="font-mono text-sm">
                  {formatDateTime(s.starts_at, user.timezone)}
                  <span className="ml-2 text-ink-soft">
                    {s.teacher_name ?? "담당 미지정"}
                  </span>
                </p>
                <span className="font-mono text-xs text-ink-soft">
                  {label(SESSION_STATUS_LABEL, s.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
