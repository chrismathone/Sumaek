import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDate, todayInKst } from "@/lib/format";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";
import { MaterializeButton } from "./MaterializeButton";
import { NewRouteForm } from "./RouteBuilderForms";

export const metadata: Metadata = { title: "학습 루트" };

/* 학습 루트 (13장) — 목록·새 루트 생성·일정 실체화.
 * 노드 편집·검증·게시는 각 루트의 빌더 화면에서 한다. */

const PLAN_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  validating: "검증 중",
  needs_fix: "수정 필요",
  publishable: "게시 가능",
  published: "게시됨",
  superseded: "대체됨",
  archived: "보관",
};

/** 정렬 키 → 실제 정렬 대상 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다) */
const SORT_COLUMN: Record<string, string> = {
  name: "name",
  group_name: "group_name",
  status: "status",
  node_count: "node_count",
  target_end_date: "target_end_date",
  future_sessions: "future_sessions",
  updated_at: "updated_at",
};

interface RouteRow {
  plan_id: string;
  name: string;
  status: string;
  group_id: string | null;
  group_name: string | null;
  version_number: number | null;
  node_count: number;
  target_end_date: string | null;
  future_sessions: number;
  updated_at: Date;
  total_count: number;
}

export default async function RoutesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("routes");
  const sql = getSharedSql();
  const today = todayInKst();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "updated_at",
    defaultDir: "desc",
    filterKeys: ["status"],
  });
  const statusFilter = query.params.status ?? "";

  const routes = await sql<RouteRow[]>`
    with base as (
      select p.id as plan_id, p.name, p.status,
             g.id as group_id, g.name as group_name,
             v.version_number,
             (select count(*)::int from route_nodes n
               where n.route_version_id = v.id) as node_count,
             p.target_end_date::text as target_end_date,
             (select count(*)::int from sessions s
               where s.organization_id = ${user.organizationId}
                 and s.learning_group_id = g.id
                 and s.session_date >= ${today}::date) as future_sessions,
             p.updated_at
      from route_plans p
      left join route_versions v on v.id = p.active_version_id
      left join learning_groups g on g.id = p.learning_group_id
      where p.organization_id = ${user.organizationId}
        and (${query.q}::text = '' or p.name ilike ${`%${query.q}%`}
             or coalesce(g.name, '') ilike ${`%${query.q}%`})
        -- enum은 빈 문자열과 직접 비교할 수 없다 — 양쪽 다 ::text로 맞춘다
        and (${statusFilter}::text = '' or p.status::text = ${statusFilter})
    )
    select *, count(*) over ()::int as total_count
    from base
    order by ${sql(SORT_COLUMN[query.sort] ?? "updated_at")}
             ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
             name asc, plan_id asc
    limit ${query.pageSize} offset ${query.offset}
  `;

  const total = routes[0]?.total_count ?? 0;

  const [groups, learners] = await Promise.all([
    sql<{ id: string; name: string }[]>`
      select id, name from learning_groups
      where organization_id = ${user.organizationId} and status = 'operating'
      order by name
    `,
    sql<{ id: string; name: string }[]>`
      select id, display_name as name from learners
      where organization_id = ${user.organizationId} and status = 'active'
      order by display_name
    `,
  ]);

  const columns: Column<RouteRow>[] = [
    { key: "name", label: "루트 이름", sortable: true, render: (r) => r.name },
    {
      key: "group_name",
      label: "대상 반",
      sortable: true,
      render: (r) =>
        r.group_name ?? <span className="text-ink-soft">그룹 미지정</span>,
    },
    {
      key: "status",
      label: "버전·상태",
      sortable: true,
      mono: true,
      render: (r) => (
        <span className="text-ink-soft">
          {r.version_number !== null
            ? `v${r.version_number} 게시됨`
            : (PLAN_STATUS_LABEL[r.status] ?? r.status)}
        </span>
      ),
    },
    {
      key: "node_count",
      label: "노드",
      sortable: true,
      align: "right",
      mono: true,
      render: (r) => `${r.node_count}개`,
    },
    {
      key: "target_end_date",
      label: "목표 종료",
      sortable: true,
      mono: true,
      secondary: true,
      render: (r) => r.target_end_date ?? "—",
    },
    {
      key: "future_sessions",
      label: "예정 수업",
      sortable: true,
      align: "right",
      mono: true,
      render: (r) => `${r.future_sessions}건`,
    },
    {
      key: "updated_at",
      label: "최근 수정",
      sortable: true,
      mono: true,
      secondary: true,
      render: (r) => formatDate(r.updated_at),
    },
    {
      key: "materialize",
      label: "일정 실체화",
      align: "right",
      // 행 전체 링크(첫 칸의 늘어난 ::after)가 버튼을 덮지 않도록 위로 올린다
      className: "relative z-10",
      render: (r) =>
        r.status === "published" && r.group_id ? (
          <MaterializeButton learningGroupId={r.group_id} />
        ) : (
          <span className="text-ink-soft">—</span>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">학습 루트</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        게시된 루트에서 수업일·휴일을 반영한 미래 일정을 생성합니다. 완료된
        과거와 잠긴 일정은 변경되지 않습니다.
      </p>

      <section className="mt-6 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">새 루트 만들기</h2>
        <p className="mt-1 text-sm text-ink-soft">
          반 공통 루트 또는 학생 독립 루트를 만듭니다. 노드를 채운 뒤 검증을
          통과해야 게시할 수 있습니다.
        </p>
        {groups.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            먼저 설정에서 반을 만드세요.
          </p>
        ) : (
          <NewRouteForm groups={groups} learners={learners} />
        )}
      </section>

      <h2 className="mt-8 font-semibold">루트 목록</h2>

      <TableFilters
        basePath="/app/routes"
        query={query}
        search={{ label: "검색", placeholder: "루트 이름·반 이름" }}
        selects={[
          {
            name: "status",
            label: "상태",
            options: Object.entries(PLAN_STATUS_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={routes}
        rowKey={(r) => r.plan_id}
        rowHref={(r) => `/app/routes/${r.plan_id}`}
        total={total}
        query={query}
        basePath="/app/routes"
        empty={
          query.params.status || query.q ? (
            <>
              <p className="font-medium">조건에 맞는 루트가 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                검색어나 상태 필터를 바꿔보세요.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">아직 학습 루트가 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                위에서 반 루트를 만들어 게시하세요.
              </p>
            </>
          )
        }
      />
    </div>
  );
}
