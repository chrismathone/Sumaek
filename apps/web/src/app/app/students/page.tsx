import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  MASTERY_STATE_LABEL,
  MASTERY_STATES,
  WEAK_MASTERY_STATES,
  formatDate,
  todayInTimeZone,
  trimScore,
} from "@/lib/format";

export const metadata: Metadata = { title: "학습자" };

/* 학습자 목록 (12장).
 * 불투명한 위험 점수 하나로 학생을 줄세우지 않는다 — 무엇을 근거로 살펴봐야
 * 하는지 문장으로 적고, 그 숫자는 모두 실제 행 수다. */

interface LearnerRow {
  id: string;
  display_name: string;
  grade_level: string | null;
  status: string;
  group_names: string | null;
}

export default async function StudentsPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();
  const today = todayInTimeZone(user.timezone);

  const [learners, lastAttempts, reviews, todayTasks, masteries] = await Promise.all([
    sql<LearnerRow[]>`
      select l.id, l.display_name, l.grade_level, l.status,
             string_agg(distinct g.name, ', ' order by g.name) as group_names
      from learners l
      left join learning_group_memberships m
        on m.learner_id = l.id
       and m.organization_id = ${user.organizationId}
       and m.status = 'active'
      left join learning_groups g on g.id = m.learning_group_id
      where l.organization_id = ${user.organizationId}
        and l.status <> 'archived'
      group by l.id, l.display_name, l.grade_level, l.status
      order by l.display_name
    `,
    sql<
      {
        learner_id: string;
        title: string;
        status: string;
        total_score: string | null;
        max_score: string | null;
        at: Date | null;
      }[]
    >`
      select distinct on (t.learner_id)
             t.learner_id, a.title, t.status,
             t.total_score::text as total_score, t.max_score::text as max_score,
             coalesce(t.finalized_at, t.submitted_at) as at
      from attempts t
      join assessment_instances a on a.id = t.assessment_id
      where t.organization_id = ${user.organizationId}
        and t.status in ('submitted', 'auto_graded', 'review_required', 'finalized')
      order by t.learner_id, coalesce(t.finalized_at, t.submitted_at) desc nulls last
    `,
    sql<{ learner_id: string; scheduled: number; overdue: number }[]>`
      select learner_id,
             count(*)::int as scheduled,
             count(*) filter (where due_on <= ${today}::date)::int as overdue
      from review_items
      where organization_id = ${user.organizationId} and status = 'scheduled'
      group by learner_id
    `,
    sql<{ learner_id: string; assigned: number; pending: number }[]>`
      select s.learner_id,
             count(*)::int as assigned,
             count(*) filter (
               where t.id is null or t.status in ('not_started', 'in_progress')
             )::int as pending
      from assignments s
      join assessment_instances a on a.id = s.assessment_id
      left join attempts t on t.assessment_id = a.id and t.learner_id = s.learner_id
      where s.organization_id = ${user.organizationId}
        and s.status <> 'cancelled'
        and a.scheduled_date = ${today}::date
      group by s.learner_id
    `,
    sql<{ learner_id: string; state: string; cnt: number }[]>`
      select learner_id, state, count(*)::int as cnt
      from concept_masteries
      where organization_id = ${user.organizationId}
      group by learner_id, state
    `,
  ]);

  const lastAttemptBy = new Map(lastAttempts.map((r) => [r.learner_id, r]));
  const reviewBy = new Map(reviews.map((r) => [r.learner_id, r]));
  const taskBy = new Map(todayTasks.map((r) => [r.learner_id, r]));

  const masteryBy = new Map<string, Record<string, number>>();
  for (const m of masteries) {
    const bucket = masteryBy.get(m.learner_id) ?? {};
    bucket[m.state] = m.cnt;
    masteryBy.set(m.learner_id, bucket);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">학습자</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        학습자 {learners.length}명. 상태 요약은 개념 숙련도 행 수를 그대로
        센 것이며, 종합 위험 점수는 만들지 않습니다.
      </p>

      {learners.length === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">등록된 학습자가 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            명단 CSV를 가져오거나 외부 명단 연동을 설정하면 여기에 표시됩니다.
          </p>
          <Link
            href="/app/settings/integrations"
            className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            외부 명단 연동 설정
          </Link>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
          {learners.map((l) => {
            const last = lastAttemptBy.get(l.id);
            const review = reviewBy.get(l.id);
            const task = taskBy.get(l.id);
            const mastery = masteryBy.get(l.id) ?? {};
            const masteryTotal = Object.values(mastery).reduce((a, b) => a + b, 0);

            return (
              <li key={l.id}>
                <Link
                  href={`/app/students/${l.id}`}
                  className="block px-4 py-4 hover:bg-paper"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {l.display_name}
                        {l.status === "paused" && (
                          <span className="ml-2 font-mono text-xs font-normal text-ink-soft">
                            휴식
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-ink-soft">
                        {l.group_names ?? "소속 반 없음"}
                        {l.grade_level && ` · ${l.grade_level}`}
                      </p>
                      <p className="mt-1 font-mono text-xs text-ink-soft">
                        {last
                          ? `최근 테스트 ${
                              last.total_score !== null
                                ? `${trimScore(last.total_score)}/${trimScore(last.max_score)}점`
                                : "채점 대기"
                            } · ${last.title}${
                              last.at ? ` · ${formatDate(last.at, user.timezone)}` : ""
                            }`
                          : "응시 기록 없음"}
                      </p>
                      <p className="mt-1 font-mono text-xs text-ink-soft">
                        오늘 할 일 {task?.pending ?? 0}건
                        {task && task.assigned > 0 && ` (배정 ${task.assigned}건)`} ·
                        복습 예정 {review?.scheduled ?? 0}건
                        {(review?.overdue ?? 0) > 0 && ` (기한 지남 ${review?.overdue}건)`}
                      </p>
                      <p className="mt-1.5 text-xs">{evidenceNote(mastery, task, review, last)}</p>
                    </div>

                    <div className="shrink-0">
                      {masteryTotal === 0 ? (
                        <p className="font-mono text-xs text-ink-soft">
                          숙련도 근거 없음
                        </p>
                      ) : (
                        <ul className="flex flex-wrap justify-end gap-1">
                          {MASTERY_STATES.filter((s) => (mastery[s] ?? 0) > 0).map(
                            (s) => (
                              <li
                                key={s}
                                className={`rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-[11px] ${
                                  s === "recheck_needed"
                                    ? "border-grade text-grade"
                                    : s === "stable" || s === "transfer_confirmed"
                                      ? "border-pen text-pen"
                                      : "border-rule text-ink-soft"
                                }`}
                              >
                                {MASTERY_STATE_LABEL[s]} {mastery[s]}
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 살펴봐야 할 이유를 근거 문장으로 만든다 — 점수 하나로 압축하지 않는다 */
function evidenceNote(
  mastery: Record<string, number>,
  task: { pending: number } | undefined,
  review: { overdue: number } | undefined,
  last: { total_score: string | null; max_score: string | null } | undefined,
): string {
  const notes: string[] = [];
  const recheck = mastery["recheck_needed"] ?? 0;
  if (recheck > 0) notes.push(`재점검 필요 개념 ${recheck}개`);
  const weak = WEAK_MASTERY_STATES.reduce((sum, s) => sum + (mastery[s] ?? 0), 0);
  if (weak - recheck > 0) notes.push(`탐색·부분 이해 ${weak - recheck}개`);
  if ((task?.pending ?? 0) > 0) notes.push(`오늘 테스트 미제출 ${task?.pending}건`);
  if ((review?.overdue ?? 0) > 0) notes.push(`복습 기한 지남 ${review?.overdue}건`);
  if (last && last.total_score !== null && last.max_score !== null) {
    const total = Number(last.total_score);
    const max = Number(last.max_score);
    if (max > 0 && total / max < 0.6) {
      notes.push(`최근 테스트 정답률 ${Math.round((total / max) * 100)}%`);
    }
  }
  return notes.length > 0 ? `살펴볼 근거: ${notes.join(" · ")}` : "특별히 밀린 항목 없음";
}
