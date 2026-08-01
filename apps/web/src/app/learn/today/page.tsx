import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { formatTime, todayInTimeZone, trimScore } from "@/lib/format";

export const metadata: Metadata = { title: "오늘 학습" };

/* ─────────────────────────────────────────────────────────────
 * 학생의 하루 (18장).
 *
 * 여기가 학생이 보는 유일한 시작 화면이므로 **오늘 할 일이 다 있어야** 한다.
 *   1) 오늘 수업 — 몇 시에 무엇을 하는가
 *   2) 테스트 — 지금 풀 것 / 예정된 것 / 끝난 것
 *   3) 복습 — 기한이 온 것을 **목록으로** (개수만 알려 주면 할 수가 없다)
 *
 * 오늘 수업은 **개별 일정(learner_schedule_items)을 먼저** 본다. 보충·재합류로
 * 반 공통과 달라진 학생에게 반 공통을 보여 주면 화면이 거짓말을 한다.
 * 개별 일정이 아직 계산되지 않은 학생은 반 공통(sessions)으로 물러선다.
 * ───────────────────────────────────────────────────────────── */

interface ScheduleRow {
  starts_at: Date;
  ends_at: Date;
  planned_node_ids: unknown;
  scope: "learner" | "group";
  matches_group: boolean | null;
  is_rejoin: boolean | null;
}

function nodeIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export default async function LearnTodayPage() {
  const learner = (await getCurrentLearner())!;
  const sql = getSharedSql();
  const tz = learner.user.timezone;
  const today = todayInTimeZone(tz);

  const [assessments, reviews, learnerItems] = await Promise.all([
    sql<
      {
        id: string;
        title: string;
        scheduled_date: string | null;
        time_limit_minutes: number | null;
        question_count: number;
        attempt_id: string | null;
        attempt_status: string | null;
        total_score: string | null;
        max_score: string | null;
      }[]
    >`
      select a.id, a.title, a.scheduled_date::text as scheduled_date,
             a.time_limit_minutes,
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
    `,
    /* 기한이 온 복습 — 교사 화면(app/students)과 **같은 기준**(due_on)을 쓴다.
     * 예전에는 여기만 due_on을 무시하고 scheduled 전체를 세어, 교사가 보는
     * 수와 학생이 보는 수가 서로 달랐다. */
    sql<
      { id: string; concept_name: string; due_on: string; overdue: boolean }[]
    >`
      select r.id, c.name as concept_name, r.due_on::text as due_on,
             (r.due_on < ${today}::date) as overdue
      from review_items r
      join canonical_concepts c on c.id = r.concept_id
      where r.learner_id = ${learner.learnerId}
        and r.status = 'scheduled'
        and r.due_on <= ${today}::date
      order by r.due_on asc
      limit 20
    `,
    sql<ScheduleRow[]>`
      select li.starts_at, li.ends_at, li.planned_node_ids,
             'learner'::text as scope, li.matches_group, li.is_rejoin
      from learner_schedule_items li
      where li.organization_id = ${learner.user.organizationId}
        and li.learner_id = ${learner.learnerId}
        and li.item_date = ${today}::date
      order by li.starts_at
    `,
  ]);

  /* 개별 일정이 없으면 반 공통으로 물러선다 — "아직 계산 안 됨"과 "오늘 수업
   * 없음"은 다른 사실이고, 학생에게는 후자만 의미가 있다. */
  const groupItems =
    learnerItems.length > 0
      ? []
      : await sql<ScheduleRow[]>`
          select s.starts_at, s.ends_at, s.planned_node_ids,
                 'group'::text as scope, null::boolean as matches_group,
                 null::boolean as is_rejoin
          from sessions s
          join learning_group_memberships m
            on m.learning_group_id = s.learning_group_id
           and m.learner_id = ${learner.learnerId}
           and m.status = 'active'
          where s.organization_id = ${learner.user.organizationId}
            and s.session_date = ${today}::date
            and s.status <> 'cancelled'
          order by s.starts_at
        `;
  const schedule = learnerItems.length > 0 ? learnerItems : groupItems;

  /* 차시에 배치된 노드 이름. 반 루트 노드는 route_nodes에 있지만 보충 노드는
   * 오버라이드 안에만 있다(반 루트를 복사하지 않는 원칙 4의 귀결). */
  const nodeIds = schedule.flatMap((s) => nodeIdList(s.planned_node_ids));
  const routeNodeIds = nodeIds.filter((n) => !n.startsWith("override:"));
  const nodeTitle = new Map<string, string>();
  if (routeNodeIds.length > 0) {
    const titles = await sql<{ id: string; title: string }[]>`
      select id::text, title from route_nodes where id = any(${routeNodeIds}::uuid[])
    `;
    for (const t of titles) nodeTitle.set(t.id, t.title);
  }
  if (nodeIds.some((n) => n.startsWith("override:"))) {
    const overrides = await sql<{ id: string; delta: unknown }[]>`
      select id::text, delta from student_route_overrides
      where organization_id = ${learner.user.organizationId}
        and learner_id = ${learner.learnerId}
    `;
    for (const o of overrides) {
      const inserted =
        ((o.delta ?? {}) as {
          insertBefore?: { nodes?: Array<{ title?: string }> };
        }).insertBefore?.nodes ?? [];
      inserted.forEach((n, i) =>
        nodeTitle.set(`override:${o.id}:${i}`, n.title ?? "보충"),
      );
    }
  }
  // 이름을 못 찾으면 지어내지 않는다
  const titleOf = (id: string) =>
    nodeTitle.get(id) ?? (id.startsWith("override:") ? "보충" : "이름 없는 항목");

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold">
        {learner.displayName}님의 오늘 학습
      </h1>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">오늘 수업</h2>
        {schedule.length === 0 ? (
          <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
            오늘은 예정된 수업이 없습니다.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {schedule.map((s, i) => {
              const ids = nodeIdList(s.planned_node_ids);
              return (
                <li
                  key={`${s.starts_at.toISOString()}-${i}`}
                  className="rounded-lg border border-rule bg-surface p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="font-mono text-sm">
                      {formatTime(s.starts_at, tz)}–{formatTime(s.ends_at, tz)}
                    </p>
                    {s.matches_group === false && (
                      <span className="rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-1.5 py-0.5 font-mono text-[11px]">
                        내 진도
                      </span>
                    )}
                    {s.is_rejoin && (
                      <span className="rounded-[var(--radius-control)] border border-pen bg-pen-soft/50 px-1.5 py-0.5 font-mono text-[11px] text-pen">
                        반 진도 합류
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm">
                    {ids.length === 0 ? (
                      <span className="text-ink-soft">배정된 학습 내용 없음</span>
                    ) : (
                      ids.map(titleOf).join(" · ")
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
              /* 응시일 게이트 — 생성 폼의 기본 날짜가 "다음 수업일"이라 미래
               * 테스트가 기본 동작이다. 숨기지 않고 **예정으로 보여 준다** —
               * 무엇이 올지는 알아야 준비할 수 있다. 서버(startAttempt)도
               * 같은 판정을 하므로 URL을 직접 쳐도 열리지 않는다. */
              const upcoming =
                !done && a.scheduled_date !== null && a.scheduled_date > today;
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
                    ) : upcoming ? (
                      <span className="rounded-[var(--radius-control)] border border-rule px-4 py-2 font-mono text-xs text-ink-soft">
                        {a.scheduled_date}부터
                      </span>
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

      <section className="mt-6">
        <h2 className="text-lg font-semibold">복습</h2>
        {reviews.length === 0 ? (
          <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
            오늘 할 복습이 없습니다. 틀린 개념은 간격을 두고 여기에 다시
            올라옵니다.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-soft">
              틀렸던 개념입니다. 다음 테스트에서 같은 개념을 맞히면 목록에서
              사라집니다.
            </p>
            <ul className="mt-3 space-y-2">
              {reviews.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule bg-surface px-4 py-3"
                >
                  <span className="text-sm font-medium">{r.concept_name}</span>
                  <span
                    className={`font-mono text-xs ${r.overdue ? "text-grade" : "text-ink-soft"}`}
                  >
                    {r.due_on}
                    {r.overdue && " · 기한 지남"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
