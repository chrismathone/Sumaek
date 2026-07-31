import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime, todayInTimeZone } from "@/lib/format";

export const metadata: Metadata = { title: "반·학습 그룹" };

/* 반 목록 (11장) — 반마다 "지금 무엇을 봐야 하는가"를 한 줄에 담는다.
 * 요약 숫자는 전부 실제 행 수이며, 근거 화면으로 이동할 수 있어야 한다. */

const GROUP_STATUS_LABEL: Record<string, string> = {
  planned: "개설 예정",
  operating: "운영 중",
  completed: "종료",
  archived: "보관",
};

export default async function ClassesPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();
  const today = todayInTimeZone(user.timezone);

  const groups = await sql<
    {
      id: string;
      name: string;
      course_name: string | null;
      status: string;
      teacher_name: string | null;
      period_name: string | null;
      learner_count: number;
      next_session_at: Date | null;
      next_session_status: string | null;
      upcoming_sessions: number;
      open_exceptions: number;
    }[]
  >`
    select g.id, g.name, g.course_name, g.status,
           u.display_name as teacher_name,
           p.name as period_name,
           (select count(*)::int from learning_group_memberships m
             where m.organization_id = ${user.organizationId}
               and m.learning_group_id = g.id and m.status = 'active') as learner_count,
           next_s.starts_at as next_session_at,
           next_s.status as next_session_status,
           (select count(*)::int from sessions s
             where s.organization_id = ${user.organizationId}
               and s.learning_group_id = g.id
               and s.session_date >= ${today}::date
               and s.status not in ('cancelled', 'completed')) as upcoming_sessions,
           (select count(*)::int
              from grading_exceptions ge
              join attempts t on t.id = ge.attempt_id
              join assessment_instances a on a.id = t.assessment_id
             where ge.organization_id = ${user.organizationId}
               and a.learning_group_id = g.id
               and ge.status <> 'resolved') as open_exceptions
    from learning_groups g
    left join users u on u.id = g.home_teacher_user_id
    left join course_periods p on p.id = g.course_period_id
    left join lateral (
      select s.starts_at, s.status
      from sessions s
      where s.organization_id = ${user.organizationId}
        and s.learning_group_id = g.id
        and s.session_date >= ${today}::date
        and s.status <> 'cancelled'
      order by s.starts_at
      limit 1
    ) next_s on true
    where g.organization_id = ${user.organizationId}
    order by (g.status = 'operating') desc, g.name
  `;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">반·학습 그룹</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        반을 누르면 학생 명단, 최근 테스트, 다가오는 수업을 함께 볼 수 있습니다.
      </p>

      {groups.length === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">등록된 반이 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            설정에서 과정 기간과 반을 만들고 학생 명단을 가져오면 여기에
            표시됩니다.
          </p>
          <Link
            href="/app/settings"
            className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            설정에서 반 등록하기
          </Link>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/app/classes/${g.id}`}
                className="block px-4 py-4 hover:bg-paper"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {g.name}
                      <span className="ml-2 font-mono text-xs font-normal text-ink-soft">
                        {GROUP_STATUS_LABEL[g.status] ?? g.status}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {g.course_name ?? "과정 미지정"} ·{" "}
                      {g.teacher_name ?? "담당 미지정"}
                      {g.period_name && ` · ${g.period_name}`}
                    </p>
                    <p className="mt-1 font-mono text-xs text-ink-soft">
                      학생 {g.learner_count}명 · 예정 수업 {g.upcoming_sessions}건
                      {g.next_session_at
                        ? ` · 다음 수업 ${formatDateTime(g.next_session_at, user.timezone)}`
                        : " · 다음 수업 없음"}
                    </p>
                  </div>
                  {g.open_exceptions > 0 && (
                    <span className="rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-2 py-1 font-mono text-xs">
                      미처리 채점 예외 {g.open_exceptions}건
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
