import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  ATTEMPT_STATUS_LABEL,
  MASTERY_STATE_LABEL,
  formatDate,
  formatRatio,
  label,
  todayInTimeZone,
  trimScore,
} from "@/lib/format";
import { CancelOverrideButton, OverrideForm } from "./OverrideForm";

const OVERRIDE_KIND_LABEL: Record<string, string> = {
  remediation: "취약 개념 보충",
  absence_makeup: "불참 보강",
  temporary_advance: "일시적 선행",
  retest_relearn: "재시험 재학습",
  book_substitution: "교재 대체",
  permanent_individual: "영구 개별 진도",
  rejoin: "반 공통 재합류",
  skip: "진도 건너뛰기",
  deadline_change: "기한 변경",
};

const OVERRIDE_STATUS_LABEL: Record<string, string> = {
  active: "적용 중",
  completed: "완료",
  cancelled: "취소됨",
};

export const metadata: Metadata = { title: "학습자 상세" };

/* 학습자 상세 — 개념 숙련도는 상태 라벨만 보여주지 않는다.
 * 점 추정치·불확실성·증거 수·마지막 증거일을 함께 두어 자동 판정의 근거를
 * 교사가 직접 확인할 수 있게 한다 (20장·원칙 8). */

const REVIEW_SOURCE_LABEL: Record<string, string> = {
  wrong_answer: "오답",
  spaced_repetition: "간격 복습",
  teacher_assigned: "교사 지정",
};

const PURPOSE_LABEL: Record<string, string> = {
  diagnostic: "진단",
  formative: "일일",
  confirmation: "확인",
  cumulative_review: "누적 복습",
  transfer: "전이",
  summative: "총괄",
  retest: "재시험",
};

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();
  const today = todayInTimeZone(user.timezone);

  const [learner] = await sql<
    {
      id: string;
      display_name: string;
      grade_level: string | null;
      status: string;
      group_names: string | null;
      curriculum_name: string | null;
    }[]
  >`
    select l.id, l.display_name, l.grade_level, l.status,
           string_agg(distinct g.name, ', ' order by g.name) as group_names,
           max(cv.name) as curriculum_name
    from learners l
    left join learning_group_memberships m
      on m.learner_id = l.id
     and m.organization_id = ${user.organizationId}
     and m.status = 'active'
    left join learning_groups g on g.id = m.learning_group_id
    left join curriculum_versions cv on cv.id = l.curriculum_version_id
    where l.id = ${id} and l.organization_id = ${user.organizationId}
    group by l.id, l.display_name, l.grade_level, l.status
  `;
  if (!learner) notFound();

  const [masteries, attempts, reviewItems, baseRoute, overrides] = await Promise.all([
    sql<
      {
        id: string;
        concept_name: string;
        domain_name: string | null;
        grade_band: string | null;
        state: string;
        point_estimate: string | null;
        uncertainty: string | null;
        evidence_count: number;
        distinct_days: number;
        last_evidence_at: Date | null;
        has_override: boolean;
      }[]
    >`
      select cm.id, c.name as concept_name, c.domain_name, c.grade_band,
             cm.state, cm.point_estimate::text as point_estimate,
             cm.uncertainty::text as uncertainty,
             cm.evidence_count, cm.distinct_days, cm.last_evidence_at,
             (cm.teacher_override is not null) as has_override
      from concept_masteries cm
      join canonical_concepts c on c.id = cm.concept_id
      where cm.organization_id = ${user.organizationId}
        and cm.learner_id = ${id}
      order by case cm.state
                 when 'recheck_needed' then 0
                 when 'exploring' then 1
                 when 'partial' then 2
                 when 'no_evidence' then 3
                 when 'stable' then 4
                 else 5
               end,
               cm.last_evidence_at desc nulls last,
               c.name
    `,
    sql<
      {
        id: string;
        title: string;
        purpose: string;
        status: string;
        total_score: string | null;
        max_score: string | null;
        at: Date | null;
      }[]
    >`
      select t.id, a.title, a.purpose, t.status,
             t.total_score::text as total_score, t.max_score::text as max_score,
             coalesce(t.finalized_at, t.submitted_at, t.started_at) as at
      from attempts t
      join assessment_instances a on a.id = t.assessment_id
      where t.organization_id = ${user.organizationId}
        and t.learner_id = ${id}
        and t.status <> 'not_started'
      order by coalesce(t.finalized_at, t.submitted_at, t.started_at) desc nulls last
      limit 20
    `,
    sql<
      {
        id: string;
        due_on: string;
        source_kind: string;
        interval_days: number | null;
        concept_name: string | null;
      }[]
    >`
      select r.id, r.due_on::text as due_on, r.source_kind, r.interval_days,
             c.name as concept_name
      from review_items r
      left join canonical_concepts c on c.id = r.concept_id
      where r.organization_id = ${user.organizationId}
        and r.learner_id = ${id}
        and r.status = 'scheduled'
      order by r.due_on
      limit 30
    `,
    sql<{ version_id: string; node_id: string; title: string }[]>`
      select p.active_version_id as version_id, n.id as node_id, n.title
      from learning_group_memberships m
      join route_plans p on p.learning_group_id = m.learning_group_id
        and p.status = 'published' and p.active_version_id is not null
      join route_nodes n on n.route_version_id = p.active_version_id
      where m.organization_id = ${user.organizationId}
        and m.learner_id = ${id} and m.status = 'active'
      order by n.sort_order
    `,
    sql<
      {
        id: string;
        kind: string;
        status: string;
        reason: string;
        goal: string | null;
        effective_from: string | null;
        effective_to: string | null;
        delta: unknown;
        created_at: Date;
      }[]
    >`
      select id, kind, status, reason, goal,
             effective_from::text as effective_from,
             effective_to::text as effective_to, delta, created_at
      from student_route_overrides
      where organization_id = ${user.organizationId} and learner_id = ${id}
      order by created_at desc
      limit 10
    `,
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-mono text-xs text-ink-soft">
        <Link href="/app/students" className="hover:underline">
          학습자
        </Link>{" "}
        / {learner.display_name}
      </p>
      <h1 className="mt-1 font-[MaruBuri] text-2xl font-semibold">
        {learner.display_name}
      </h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {learner.group_names ?? "소속 반 없음"}
        {learner.grade_level && ` · ${learner.grade_level}`}
        {learner.curriculum_name && ` · ${learner.curriculum_name}`}
        {learner.status !== "active" && ` · ${learner.status === "paused" ? "휴식" : "보관"}`}
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">개념 숙련도</h2>
        <p className="mt-1 text-sm text-ink-soft">
          상태는 증거로부터 계산된 파생 결과입니다. 점 추정·불확실성·증거 수를
          함께 확인하세요.
        </p>
        {masteries.length === 0 ? (
          <div className="mt-3 rounded-lg border border-rule bg-surface p-5">
            <p className="font-medium">아직 숙련도 근거가 없습니다.</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              테스트를 응시하고 채점이 확정되면 개념별 상태가 계산됩니다.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-rule-soft text-left text-xs text-ink-soft">
                  <th className="px-4 py-2 font-medium">개념</th>
                  <th className="px-4 py-2 font-medium">상태</th>
                  <th className="px-4 py-2 text-right font-medium">점 추정</th>
                  <th className="px-4 py-2 text-right font-medium">불확실성</th>
                  <th className="px-4 py-2 text-right font-medium">증거</th>
                  <th className="px-4 py-2 text-right font-medium">마지막 증거</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule-soft">
                {masteries.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{m.concept_name}</span>
                      {m.domain_name && (
                        <span className="ml-2 text-xs text-ink-soft">
                          {m.domain_name}
                        </span>
                      )}
                      {m.has_override && (
                        <span className="ml-2 rounded-[var(--radius-control)] bg-highlight-soft px-1.5 py-0.5 text-[11px]">
                          교사 재판정
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-[11px] ${
                          m.state === "recheck_needed"
                            ? "border-grade text-grade"
                            : m.state === "stable" || m.state === "transfer_confirmed"
                              ? "border-pen text-pen"
                              : "border-rule text-ink-soft"
                        }`}
                      >
                        {label(MASTERY_STATE_LABEL, m.state)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {formatRatio(m.point_estimate)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink-soft">
                      {m.uncertainty === null ? "—" : `±${formatRatio(m.uncertainty)}`}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink-soft">
                      {m.evidence_count}건 / {m.distinct_days}일
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink-soft">
                      {m.last_evidence_at
                        ? formatDate(m.last_evidence_at, user.timezone)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">최근 응시 이력</h2>
        {attempts.length === 0 ? (
          <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
            응시 기록이 없습니다. 테스트를 배정하면 여기에 쌓입니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {attempts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-soft">
                    {label(PURPOSE_LABEL, a.purpose)} ·{" "}
                    {a.at ? formatDate(a.at, user.timezone) : "날짜 없음"} ·{" "}
                    {label(ATTEMPT_STATUS_LABEL, a.status)}
                  </p>
                </div>
                <p className="font-mono text-sm">
                  {a.total_score !== null
                    ? `${trimScore(a.total_score)} / ${trimScore(a.max_score)}점`
                    : "채점 대기"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">예정된 복습</h2>
        {reviewItems.length === 0 ? (
          <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
            예정된 복습 항목이 없습니다. 오답이 확정되면 개념별 복습이 간격을
            두고 배치됩니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {reviewItems.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <p className="text-sm">
                  {r.concept_name ?? "개념 미연결"}
                  <span className="ml-2 font-mono text-xs text-ink-soft">
                    {label(REVIEW_SOURCE_LABEL, r.source_kind)}
                    {r.interval_days !== null && ` · 간격 ${r.interval_days}일`}
                  </span>
                </p>
                <span
                  className={`font-mono text-xs ${
                    r.due_on <= today ? "text-grade" : "text-ink-soft"
                  }`}
                >
                  {r.due_on}
                  {r.due_on <= today && " (기한 도래)"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">개별 경로 오버라이드</h2>
        <p className="mt-1 text-sm text-ink-soft">
          반 공통 루트를 복사하지 않고 이 학생만의 차이(건너뛰기·보충)를
          버전으로 저장합니다. 반 루트와 다른 학생에게는 영향을 주지 않습니다.
        </p>
        <div className="mt-3 rounded-lg border border-rule bg-surface p-5">
          {baseRoute.length === 0 ? (
            <p className="text-sm text-ink-soft">
              기준이 될 게시된 반 루트가 없습니다. 학습 루트에서 반 루트를 먼저
              게시하세요.
            </p>
          ) : (
            <OverrideForm
              learnerId={learner.id}
              baseNodes={baseRoute.map((n) => ({ id: n.node_id, title: n.title }))}
            />
          )}
          {overrides.length > 0 && (
            <ul className="mt-4 divide-y divide-rule-soft border-t border-rule-soft">
              {overrides.map((o) => {
                const delta = (o.delta ?? {}) as {
                  skipNodeIds?: string[];
                  insertBefore?: { nodes?: Array<{ title?: string }> };
                };
                const skips = delta.skipNodeIds?.length ?? 0;
                const inserts =
                  delta.insertBefore?.nodes
                    ?.map((n) => n.title)
                    .filter(Boolean)
                    .join(", ") ?? "";
                return (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <p className="text-sm">
                      <span className="font-medium">
                        {label(OVERRIDE_KIND_LABEL, o.kind)}
                      </span>
                      <span className="ml-2 text-xs text-ink-soft">{o.reason}</span>
                      <span className="ml-2 font-mono text-xs text-ink-soft">
                        {skips > 0 && `건너뛰기 ${skips}개`}
                        {skips > 0 && inserts && " · "}
                        {inserts && `보충: ${inserts}`}
                        {o.effective_from &&
                          ` · ${o.effective_from}${o.effective_to ? `~${o.effective_to}` : "~"}`}
                      </span>
                    </p>
                    <span className="flex items-center gap-2">
                      <span className="rounded-[var(--radius-control)] border border-rule px-2 py-0.5 font-mono text-xs">
                        {label(OVERRIDE_STATUS_LABEL, o.status)}
                      </span>
                      {o.status === "active" && (
                        <CancelOverrideButton overrideId={o.id} learnerId={learner.id} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
