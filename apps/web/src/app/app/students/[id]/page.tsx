import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import {
  ATTEMPT_STATUS_LABEL,
  MASTERY_STATE_LABEL,
  formatDate,
  formatRatio,
  formatTime,
  label,
  todayInTimeZone,
  trimScore,
} from "@/lib/format";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { DataTable, type Column } from "@/components/DataTable";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";
import { CancelOverrideButton, OverrideForm } from "./OverrideForm";
import { MaterializeLearnerScheduleButton } from "./LearnerScheduleForm";
import { DeletionExecuteForm, DeletionRequestForm } from "./PrivacyForm";

const DELETION_STATUS_LABEL: Record<string, string> = {
  received: "접수됨",
  processing: "처리 중",
  completed: "완료",
  rejected: "반려",
};

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

/* 개별 일정 표의 정렬 키 화이트리스트 — 사용자 입력이 ORDER BY에 닿지 않는다 */
const SCHEDULE_SORT_COLUMN: Record<string, string> = {
  item_date: "item_date",
  matches_group: "matches_group",
  is_rejoin: "is_rejoin",
};

/* 이 표는 상세 화면 **안**에 있다. `page`·`sort`·`dir`은 이름이 흔해서
 * 이 화면의 다른 파라미터와 그대로 부딪히므로 전용 접두사를 쓴다. */
const SCHEDULE_PARAM_PREFIX = "ls_";

interface ScheduleItemRow {
  id: string;
  item_date: string;
  starts_at: Date;
  ends_at: Date;
  session_id: string | null;
  planned_node_ids: unknown;
  matches_group: boolean;
  is_rejoin: boolean;
  total_count: number;
}

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const user = await requireAccess("learners");
  const sql = getSharedSql();
  const today = todayInTimeZone(user.timezone);

  const scheduleQuery = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SCHEDULE_SORT_COLUMN),
    defaultSort: "item_date",
    prefix: SCHEDULE_PARAM_PREFIX,
  });

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

  const [
    masteries,
    attempts,
    reviewItems,
    baseRoute,
    overrides,
    deletionRequests,
    scheduleItems,
  ] = await Promise.all([
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
        rejoin_node_id: string | null;
        created_at: Date;
      }[]
    >`
      select id, kind, status, reason, goal,
             effective_from::text as effective_from,
             effective_to::text as effective_to, delta,
             rejoin_node_id::text as rejoin_node_id, created_at
      from student_route_overrides
      where organization_id = ${user.organizationId} and learner_id = ${id}
      order by created_at desc
      limit 10
    `,
    sql<
      {
        id: string;
        status: string;
        reason: string;
        due_on: string;
        backup_expires_on: string | null;
        executed_at: Date | null;
      }[]
    >`
      select id, status, reason, due_on::text as due_on,
             backup_expires_on::text as backup_expires_on, executed_at
      from data_deletion_requests
      where organization_id = ${user.organizationId} and learner_id = ${id}
      order by created_at desc
      limit 5
    `,
    /* 학습자 스코프 실체화 결과 (인수 4). 반 공통 수업(sessions)이 아니라
     * 이 학생이 그 차시에 실제로 무엇을 하는지의 기록이다. */
    sql<ScheduleItemRow[]>`
      with base as (
        select li.id, li.item_date::text as item_date, li.starts_at, li.ends_at,
               li.session_id::text as session_id, li.planned_node_ids,
               li.matches_group, li.is_rejoin
        from learner_schedule_items li
        where li.organization_id = ${user.organizationId}
          and li.learner_id = ${id}
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SCHEDULE_SORT_COLUMN[scheduleQuery.sort] ?? "item_date")}
               ${scheduleQuery.dir === "asc" ? sql`asc` : sql`desc`},
               item_date asc, starts_at asc
      limit ${scheduleQuery.pageSize} offset ${scheduleQuery.offset}
    `,
  ]);

  const canManagePrivacy = canWrite(DEFAULT_MATRIX, user.role, "settings");
  const canManageLearners = canWrite(DEFAULT_MATRIX, user.role, "learners");
  const openDeletionRequest = deletionRequests.find(
    (r) => r.status === "received" || r.status === "processing",
  );

  /* 차시에 놓인 노드의 이름.
   * 반 루트 노드는 route_nodes에 있지만, 보충 노드는 오버라이드 안에만
   * 있다 (반 루트를 복사하지 않는다는 원칙 4의 귀결). 보충 노드의 합성 ID
   * 규칙은 실체화와 같다 — `override:<오버라이드 ID>:<순번>`. */
  const nodeTitleById = new Map<string, string>();
  for (const n of baseRoute) nodeTitleById.set(n.node_id, n.title);
  for (const o of overrides) {
    const inserted =
      ((o.delta ?? {}) as {
        insertBefore?: { nodes?: Array<{ title?: string }> };
      }).insertBefore?.nodes ?? [];
    inserted.forEach((n, index) =>
      nodeTitleById.set(`override:${o.id}:${index}`, n.title ?? "보충"),
    );
  }
  const nodeTitle = (nodeId: string): string =>
    nodeTitleById.get(nodeId) ??
    // 이름을 못 찾았다고 지어내지 않는다 — 무엇인지만 정직하게 적는다
    (nodeId.startsWith("override:") ? "보충 (이름 없음)" : "이름 없는 노드");

  const scheduleTotal = scheduleItems[0]?.total_count ?? 0;
  const scheduleColumns: Column<ScheduleItemRow>[] = [
    {
      key: "item_date",
      label: "날짜",
      sortable: true,
      mono: true,
      render: (r) => r.item_date,
    },
    {
      key: "time",
      label: "시각",
      mono: true,
      secondary: true,
      render: (r) =>
        `${formatTime(r.starts_at, user.timezone)}–${formatTime(r.ends_at, user.timezone)}`,
    },
    {
      key: "nodes",
      label: "이 차시에 하는 것",
      render: (r) => {
        const ids = Array.isArray(r.planned_node_ids)
          ? (r.planned_node_ids as unknown[]).filter(
              (v): v is string => typeof v === "string",
            )
          : [];
        return ids.length === 0 ? (
          <span className="text-ink-soft">배치된 노드 없음</span>
        ) : (
          ids.map(nodeTitle).join(" · ")
        );
      },
    },
    {
      key: "matches_group",
      label: "반 공통",
      sortable: true,
      render: (r) =>
        r.matches_group ? (
          <span className="font-mono text-xs text-ink-soft">같음</span>
        ) : (
          <span className="rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-1.5 py-0.5 font-mono text-[11px]">
            다름
          </span>
        ),
    },
    {
      key: "is_rejoin",
      label: "재합류",
      sortable: true,
      render: (r) =>
        r.is_rejoin ? (
          <span className="rounded-[var(--radius-control)] border border-pen bg-pen-soft/50 px-1.5 py-0.5 font-mono text-[11px] text-pen">
            재합류 차시
          </span>
        ) : (
          <span className="font-mono text-xs text-ink-soft">—</span>
        ),
    },
    {
      key: "session_id",
      label: "반 수업 연결",
      secondary: true,
      render: (r) => (
        <span className="font-mono text-xs text-ink-soft">
          {r.session_id ? "연결됨" : "반 일정 밖"}
        </span>
      ),
    },
  ];

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
                        {o.rejoin_node_id &&
                          ` · 재합류: ${
                            baseRoute.find((n) => n.node_id === o.rejoin_node_id)
                              ?.title ?? "다른 버전 노드"
                          }`}
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

      <section className="mt-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">개별 일정</h2>
            <p className="mt-1 text-sm text-ink-soft">
              오버라이드를 반영한 이 학생만의 차시입니다. 반 공통과{" "}
              <strong className="font-medium">다른</strong> 차시와 반 진도로{" "}
              <strong className="font-medium">재합류</strong>하는 차시가 표시됩니다.
              계산해도 반 공통 수업은 한 줄도 바뀌지 않습니다.
            </p>
          </div>
          {canManageLearners && (
            <MaterializeLearnerScheduleButton learnerId={learner.id} />
          )}
        </div>
        <DataTable
          columns={scheduleColumns}
          rows={scheduleItems}
          rowKey={(r) => r.id}
          total={scheduleTotal}
          query={scheduleQuery}
          basePath={`/app/students/${learner.id}`}
          caption="학습자 개별 일정 — 반 공통과 다른 차시·재합류 차시"
          empty={
            <>
              <p className="font-medium">아직 계산하지 않았습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                {canManageLearners
                  ? "위의 «개별 일정 계산»을 누르면 오버라이드를 반영한 이 학생의 차시가 만들어집니다. 기준이 될 반 루트가 게시되어 있어야 합니다."
                  : "개별 일정은 아직 계산되지 않았습니다. 계산은 학습자 쓰기 권한이 있는 구성원만 실행할 수 있습니다."}
              </p>
            </>
          }
        />
      </section>

      {canManagePrivacy && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">개인정보 삭제 요청</h2>
          <p className="mt-1 text-sm text-ink-soft">
            처리 방식은 익명화입니다 — 표시명은 토큰으로 치환되고 서술 답안
            본문은 삭제되며, 점수·학습 증거는 안정 토큰으로 보존됩니다
            (ADR-0015). 백업(PITR)은 최대 35일 뒤 만료됩니다.
          </p>
          <div className="mt-3 rounded-lg border border-rule bg-surface p-5">
            {deletionRequests.length > 0 && (
              <ul className="divide-y divide-rule-soft">
                {deletionRequests.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm">
                        <span className="font-medium">{r.reason}</span>
                        <span className="ml-2 font-mono text-xs text-ink-soft">
                          기한 {r.due_on}
                          {r.backup_expires_on &&
                            ` · 백업 만료 ${r.backup_expires_on}`}
                        </span>
                      </p>
                      <span className="rounded-[var(--radius-control)] border border-rule px-2 py-0.5 font-mono text-xs">
                        {DELETION_STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </div>
                    {(r.status === "received" || r.status === "processing") && (
                      <DeletionExecuteForm requestId={r.id} learnerId={learner.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!openDeletionRequest && (
              <DeletionRequestForm learnerId={learner.id} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
