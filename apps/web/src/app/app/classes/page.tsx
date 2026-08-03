import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDateTime, todayInKst } from "@/lib/format";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";

export const metadata: Metadata = { title: "반·학습 그룹" };

/* 반 목록 (11장) — 반마다 "지금 무엇을 봐야 하는가"를 한 줄에 담는다.
 * 요약 숫자는 전부 실제 행 수이며, 행을 누르면 근거 화면으로 이동한다. */

const GROUP_STATUS_LABEL: Record<string, string> = {
  planned: "개설 예정",
  operating: "운영 중",
  completed: "종료",
  archived: "보관",
};

/** 정렬 키 → 실제 정렬 대상 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다) */
const SORT_COLUMN: Record<string, string> = {
  name: "name",
  status: "status",
  learner_count: "learner_count",
  upcoming_sessions: "upcoming_sessions",
  next_session_at: "next_session_at",
  open_exceptions: "open_exceptions",
};

interface GroupRow {
  id: string;
  name: string;
  course_name: string | null;
  status: string;
  teacher_name: string | null;
  period_name: string | null;
  learner_count: number;
  next_session_at: Date | null;
  upcoming_sessions: number;
  open_exceptions: number;
  total_count: number;
}

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("groups");
  const sql = getSharedSql();
  const today = todayInKst();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "name",
    filterKeys: ["status"],
  });
  const statusFilter = query.params.status ?? "";

  const rows = await sql<GroupRow[]>`
    with base as (
      select g.id, g.name, g.course_name, g.status,
             u.display_name as teacher_name,
             p.name as period_name,
             (select count(*)::int from learning_group_memberships m
               where m.organization_id = ${user.organizationId}
                 and m.learning_group_id = g.id and m.status = 'active') as learner_count,
             next_s.starts_at as next_session_at,
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
        select s.starts_at
        from sessions s
        where s.organization_id = ${user.organizationId}
          and s.learning_group_id = g.id
          and s.session_date >= ${today}::date
          and s.status <> 'cancelled'
        order by s.starts_at
        limit 1
      ) next_s on true
      where g.organization_id = ${user.organizationId}
        and (${query.q}::text = '' or g.name ilike ${`%${query.q}%`}
             or coalesce(g.course_name, '') ilike ${`%${query.q}%`})
        and (${statusFilter}::text = '' or g.status::text = ${statusFilter})
    )
    select *, count(*) over ()::int as total_count
    from base
    order by ${sql(SORT_COLUMN[query.sort] ?? "name")}
             ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
             name asc
    limit ${query.pageSize} offset ${query.offset}
  `;

  const total = rows[0]?.total_count ?? 0;

  const columns: Column<GroupRow>[] = [
    { key: "name", label: "반 이름", sortable: true, render: (g) => g.name },
    {
      key: "status",
      label: "상태",
      sortable: true,
      render: (g) => (
        <span className="font-mono text-xs text-ink-soft">
          {GROUP_STATUS_LABEL[g.status] ?? g.status}
        </span>
      ),
    },
    {
      key: "course",
      label: "과정",
      secondary: true,
      render: (g) => (
        <span className="text-ink-soft">{g.course_name ?? "과정 미지정"}</span>
      ),
    },
    {
      key: "teacher",
      label: "담당",
      secondary: true,
      render: (g) => (
        <span className="text-ink-soft">{g.teacher_name ?? "미지정"}</span>
      ),
    },
    {
      key: "learner_count",
      label: "학생",
      sortable: true,
      align: "right",
      mono: true,
      render: (g) => `${g.learner_count}명`,
    },
    {
      key: "upcoming_sessions",
      label: "예정 수업",
      sortable: true,
      align: "right",
      mono: true,
      render: (g) => `${g.upcoming_sessions}건`,
    },
    {
      key: "next_session_at",
      label: "다음 수업",
      sortable: true,
      mono: true,
      secondary: true,
      render: (g) =>
        g.next_session_at ? formatDateTime(g.next_session_at) : "—",
    },
    {
      key: "open_exceptions",
      label: "채점 예외",
      sortable: true,
      align: "right",
      mono: true,
      render: (g) =>
        g.open_exceptions > 0 ? (
          <span className="rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-1.5 py-0.5">
            {g.open_exceptions}건
          </span>
        ) : (
          <span className="text-ink-soft">0</span>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">반·학습 그룹</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        반을 누르면 학생 명단, 최근 테스트, 다가오는 수업을 함께 볼 수 있습니다.
      </p>

      <TableFilters
        basePath="/app/classes"
        query={query}
        search={{ label: "검색", placeholder: "반 이름·과정" }}
        selects={[
          {
            name: "status",
            label: "상태",
            options: Object.entries(GROUP_STATUS_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(g) => g.id}
        rowHref={(g) => `/app/classes/${g.id}`}
        total={total}
        query={query}
        basePath="/app/classes"
        empty={
          query.params.status || query.q ? (
            <>
              <p className="font-medium">조건에 맞는 반이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                검색어나 상태 필터를 바꿔보세요.
              </p>
            </>
          ) : (
            <>
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
            </>
          )
        }
      />
    </div>
  );
}
