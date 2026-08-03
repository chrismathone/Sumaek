import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDate, todayInKst, trimScore } from "@/lib/format";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";

export const metadata: Metadata = { title: "학습자" };

/* 학습자 목록 (12장).
 * 불투명한 위험 점수 하나로 학생을 줄세우지 않는다 — 열에 담긴 숫자는 모두
 * 실제 행 수이며, 행을 누르면 그 근거 화면으로 이동한다. */

/** 정렬 키 → 실제 정렬 대상 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다) */
const SORT_COLUMN: Record<string, string> = {
  name: "display_name",
  group: "group_names",
  grade: "grade_level",
  last_attempt_at: "last_attempt_at",
  review_scheduled: "review_scheduled",
  recheck_needed: "recheck_needed",
};

interface LearnerRow {
  id: string;
  display_name: string;
  grade_level: string | null;
  status: string;
  group_names: string | null;
  last_attempt_title: string | null;
  last_attempt_at: Date | null;
  total_score: string | null;
  max_score: string | null;
  review_scheduled: number;
  review_overdue: number;
  recheck_needed: number;
  weak_count: number;
  stable_count: number;
  mastery_total: number;
  total_count: number;
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("learners");
  const sql = getSharedSql();
  const today = todayInKst();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "name",
    filterKeys: ["group"],
  });
  const groupFilter = query.params.group ?? "";

  const [rows, groups] = await Promise.all([
    sql<LearnerRow[]>`
      with base as (
        select l.id, l.display_name, l.grade_level, l.status::text as status,
               (select string_agg(g.name, ', ' order by g.name)
                  from learning_group_memberships m
                  join learning_groups g on g.id = m.learning_group_id
                 where m.organization_id = ${user.organizationId}
                   and m.learner_id = l.id
                   and m.status = 'active') as group_names,
               last_a.title as last_attempt_title,
               last_a.last_attempt_at,
               last_a.total_score,
               last_a.max_score,
               rev.review_scheduled,
               rev.review_overdue,
               mast.recheck_needed,
               mast.weak_count,
               mast.stable_count,
               mast.mastery_total
        from learners l
        left join lateral (
          select a.title,
                 coalesce(t.finalized_at, t.submitted_at) as last_attempt_at,
                 t.total_score::text as total_score,
                 t.max_score::text as max_score
          from attempts t
          join assessment_instances a on a.id = t.assessment_id
          where t.organization_id = ${user.organizationId}
            and t.learner_id = l.id
            and t.status in ('submitted', 'auto_graded', 'review_required', 'finalized')
          order by coalesce(t.finalized_at, t.submitted_at) desc nulls last
          limit 1
        ) last_a on true
        left join lateral (
          select count(*)::int as review_scheduled,
                 count(*) filter (where r.due_on <= ${today}::date)::int as review_overdue
          from review_items r
          where r.organization_id = ${user.organizationId}
            and r.learner_id = l.id
            and r.status = 'scheduled'
        ) rev on true
        left join lateral (
          select count(*) filter (where c.state = 'recheck_needed')::int as recheck_needed,
                 count(*) filter (where c.state in ('exploring', 'partial'))::int as weak_count,
                 count(*) filter (
                   where c.state in ('stable', 'transfer_confirmed')
                 )::int as stable_count,
                 count(*) filter (where c.state <> 'no_evidence')::int as mastery_total
          from concept_masteries c
          where c.organization_id = ${user.organizationId}
            and c.learner_id = l.id
        ) mast on true
        where l.organization_id = ${user.organizationId}
          and l.status <> 'archived'
          and (${query.q}::text = '' or l.display_name ilike ${`%${query.q}%`})
          and (${groupFilter}::text = '' or exists (
                select 1
                from learning_group_memberships m2
                where m2.organization_id = ${user.organizationId}
                  and m2.learner_id = l.id
                  and m2.status = 'active'
                  and m2.learning_group_id::text = ${groupFilter}))
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "display_name")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               display_name asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    sql<{ id: string; name: string }[]>`
      select g.id, g.name
      from learning_groups g
      where g.organization_id = ${user.organizationId}
        and g.status::text <> 'archived'
      order by g.name
    `,
  ]);

  const total = rows[0]?.total_count ?? 0;

  const columns: Column<LearnerRow>[] = [
    {
      key: "name",
      label: "이름",
      sortable: true,
      render: (l) => (
        <>
          {l.display_name}
          {l.status === "paused" && (
            <span className="ml-2 font-mono text-xs font-normal text-ink-soft">
              휴식
            </span>
          )}
        </>
      ),
    },
    {
      key: "group",
      label: "소속 반",
      sortable: true,
      render: (l) => (
        <span className="text-ink-soft">{l.group_names ?? "소속 반 없음"}</span>
      ),
    },
    {
      key: "grade",
      label: "학년",
      sortable: true,
      secondary: true,
      mono: true,
      render: (l) => l.grade_level ?? "—",
    },
    {
      key: "last_attempt_at",
      label: "최근 테스트",
      sortable: true,
      mono: true,
      render: (l) => {
        if (!l.last_attempt_at && !l.last_attempt_title) {
          return <span className="text-ink-soft">응시 기록 없음</span>;
        }
        const score =
          l.total_score !== null
            ? `${trimScore(l.total_score)}/${trimScore(l.max_score)}점`
            : "채점 대기";
        return (
          <span className="whitespace-nowrap">
            {l.last_attempt_at ? formatDate(l.last_attempt_at) : "—"}
            <span className="ml-1.5 text-ink-soft">{score}</span>
          </span>
        );
      },
    },
    {
      key: "review_scheduled",
      label: "복습 예정",
      sortable: true,
      align: "right",
      mono: true,
      render: (l) =>
        l.review_overdue > 0 ? (
          <span className="rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-1.5 py-0.5 whitespace-nowrap">
            {l.review_scheduled}건 · 기한 지남 {l.review_overdue}
          </span>
        ) : (
          <span className={l.review_scheduled > 0 ? "" : "text-ink-soft"}>
            {l.review_scheduled}건
          </span>
        ),
    },
    {
      key: "mastery",
      label: "숙련도 요약",
      render: (l) =>
        l.mastery_total === 0 ? (
          <span className="font-mono text-xs text-ink-soft">숙련도 근거 없음</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {l.recheck_needed > 0 && (
              <li className="rounded-[var(--radius-control)] border border-grade px-2 py-0.5 font-mono text-[11px] text-grade">
                재점검 {l.recheck_needed}
              </li>
            )}
            {l.weak_count > 0 && (
              <li className="rounded-[var(--radius-control)] border border-rule px-2 py-0.5 font-mono text-[11px] text-ink-soft">
                탐색·부분 {l.weak_count}
              </li>
            )}
            {l.stable_count > 0 && (
              <li className="rounded-[var(--radius-control)] border border-pen px-2 py-0.5 font-mono text-[11px] text-pen">
                안정 {l.stable_count}
              </li>
            )}
          </ul>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">학습자</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        상태 요약은 개념 숙련도 행 수를 그대로 센 것이며, 종합 위험 점수는 만들지
        않습니다. 학습자를 누르면 근거 화면으로 이동합니다.
      </p>

      <TableFilters
        basePath="/app/students"
        query={query}
        search={{ label: "검색", placeholder: "학습자 이름" }}
        selects={[
          {
            name: "group",
            label: "소속 반",
            options: groups.map((g) => ({ value: g.id, label: g.name })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        rowHref={(l) => `/app/students/${l.id}`}
        total={total}
        query={query}
        basePath="/app/students"
        empty={
          query.q || query.params.group ? (
            <>
              <p className="font-medium">조건에 맞는 학습자가 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                검색어나 소속 반 필터를 바꿔보세요.
              </p>
            </>
          ) : (
            <>
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
            </>
          )
        }
      />
    </div>
  );
}
