import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { formatTime, label, SESSION_STATUS_LABEL } from "@/lib/format";
import { parseTableQuery, type RawSearchParams, type TableQuery } from "@/lib/table";

export const metadata: Metadata = { title: "오늘 수업" };

/* 오늘 운영실 (골프롬프트 9장) — 선생님의 기본 진입 화면.
 * 서버 데이터 계층에서 실데이터를 읽는다. 데이터가 없으면 정직한 빈 상태와
 * 다음 행동을 보여준다 (26장 — 가짜 데이터 금지). */

/* ── 한 화면에 표가 둘일 때의 파라미터 규약 ─────────────────────────
 * tableHref/sortHref는 언제나 `sort`·`dir`·`page`라는 고정된 이름으로 링크를
 * 만든다. 즉 표마다 다른 파라미터 이름(sp/gp)을 쓰려면 공통 모듈을 고쳐야
 * 하는데, 그건 이 작업의 범위가 아니다. 그래서 다음 규약을 택했다.
 *
 *   1) 정렬 키에 표 접두사를 준다 — 수업 표는 `s_*`, 반 표는 `g_*`.
 *      parseTableQuery는 두 집합의 합집합을 화이트리스트로 받는다.
 *   2) 지금 조작 중인 표(= URL의 sort 접두사)만 `page`를 쓴다.
 *      다른 표는 언제나 자기 기본 정렬의 1쪽으로 돌아간다.
 *
 * 결과적으로 두 표 모두 정렬·페이지 이동이 되지만, 한 번에 한 표만 넘긴다.
 * (두 표를 동시에 2쪽으로 두는 조합은 지원하지 않는다 — 파라미터가 하나뿐.)
 * 두 표 모두 pageSize는 기본값 DEFAULT_PAGE_SIZE라 한 화면에 들어온다.
 * ──────────────────────────────────────────────────────────────── */

/** 시간순 수업 — 정렬 키 → base CTE의 출력 별칭 (화이트리스트) */
const SESSION_SORT: Record<string, string> = {
  s_group: "group_name",
  s_time: "starts_at",
  s_status: "status",
};

/** 운영 중인 반 — 정렬 키 → base CTE의 출력 별칭 (화이트리스트) */
const GROUP_SORT: Record<string, string> = {
  g_name: "name",
  g_course: "course_name",
  g_learners: "learner_count",
};

interface SessionRow {
  id: string;
  group_id: string;
  group_name: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  total_count: number;
}

interface GroupRow {
  id: string;
  name: string;
  course_name: string | null;
  learner_count: number;
  total_count: number;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("today");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: [...Object.keys(SESSION_SORT), ...Object.keys(GROUP_SORT)],
    defaultSort: "s_time",
    filterKeys: [],
  });

  // `page`의 주인 — 정렬 키 접두사가 지금 조작 중인 표를 알려준다.
  const groupsActive = query.sort in GROUP_SORT;
  const sessionQuery: TableQuery = groupsActive
    ? { ...query, sort: "s_time", dir: "asc", page: 1, offset: 0 }
    : query;
  const groupQuery: TableQuery = groupsActive
    ? query
    : { ...query, sort: "g_name", dir: "asc", page: 1, offset: 0 };

  const [sessionRows, groupRows, exceptions, proposals] = await Promise.all([
    sql<SessionRow[]>`
      with base as (
        select s.id,
               g.id as group_id,
               g.name as group_name,
               s.starts_at,
               s.ends_at,
               s.status::text as status
        from sessions s
        join learning_groups g on g.id = s.learning_group_id
        where s.organization_id = ${user.organizationId}
          and s.session_date = (now() at time zone ${user.timezone})::date
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SESSION_SORT[sessionQuery.sort] ?? "starts_at")}
               ${sessionQuery.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               starts_at asc
      limit ${sessionQuery.pageSize} offset ${sessionQuery.offset}
    `,
    sql<GroupRow[]>`
      with base as (
        select g.id, g.name, g.course_name,
               (select count(*)::int from learning_group_memberships m
                 where m.organization_id = ${user.organizationId}
                   and m.learning_group_id = g.id and m.status = 'active') as learner_count
        from learning_groups g
        where g.organization_id = ${user.organizationId}
          and g.status = 'operating'
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(GROUP_SORT[groupQuery.sort] ?? "name")}
               ${groupQuery.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               name asc
      limit ${groupQuery.pageSize} offset ${groupQuery.offset}
    `,
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from grading_exceptions
      where organization_id = ${user.organizationId} and status in ('open', 'assigned')
    `,
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from schedule_change_proposals
      where organization_id = ${user.organizationId} and status = 'proposed'
    `,
  ]);

  // 요약 카드는 한 쪽 분량이 아니라 전체 건수를 보여준다.
  const sessionTotal = sessionRows[0]?.total_count ?? 0;
  const groupTotal = groupRows[0]?.total_count ?? 0;
  const exceptionCount = exceptions[0]?.cnt ?? 0;
  const proposalCount = proposals[0]?.cnt ?? 0;

  const sessionColumns: Column<SessionRow>[] = [
    {
      key: "s_group",
      label: "반 이름",
      sortable: true,
      render: (s) => s.group_name,
    },
    {
      key: "s_time",
      label: "시각",
      sortable: true,
      mono: true,
      render: (s) =>
        `${formatTime(s.starts_at, user.timezone)} – ${formatTime(s.ends_at, user.timezone)}`,
    },
    {
      key: "s_status",
      label: "상태",
      sortable: true,
      render: (s) => (
        <span className="font-mono text-xs text-ink-soft">
          {label(SESSION_STATUS_LABEL, s.status)}
        </span>
      ),
    },
  ];

  const groupColumns: Column<GroupRow>[] = [
    { key: "g_name", label: "반 이름", sortable: true, render: (g) => g.name },
    {
      key: "g_course",
      label: "과정",
      sortable: true,
      secondary: true,
      render: (g) => (
        <span className="text-ink-soft">{g.course_name ?? "과정 미지정"}</span>
      ),
    },
    {
      key: "g_learners",
      label: "학습자",
      sortable: true,
      align: "right",
      mono: true,
      render: (g) => `${g.learner_count}명`,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">오늘 수업</h1>

      {/* 상단 요약 */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="오늘 수업" value={`${sessionTotal}건`} />
        <SummaryCard label="운영 중인 반" value={`${groupTotal}개`} />
        <SummaryCard
          label="채점 예외"
          value={`${exceptionCount}건`}
          tone={exceptionCount > 0 ? "warn" : "ok"}
        />
        <SummaryCard
          label="승인 대기 일정 변경"
          value={`${proposalCount}건`}
          tone={proposalCount > 0 ? "warn" : "ok"}
        />
      </div>

      {/* 시간순 수업 목록 — 수업 상세 라우트가 없으므로 가장 가까운 상세인
          반 상세로 잇는다. */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">시간순 수업</h2>
        <DataTable
          columns={sessionColumns}
          rows={sessionRows}
          rowKey={(s) => s.id}
          rowHref={(s) => `/app/classes/${s.group_id}`}
          total={sessionTotal}
          query={sessionQuery}
          basePath="/app/today"
          empty={
            <>
              <p className="font-medium">오늘 예정된 수업이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                게시된 루트에서 날짜별 수업을 생성하면 여기에 표시됩니다.
              </p>
              <Link
                href="/app/routes"
                className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
              >
                학습 루트에서 일정 생성하기
              </Link>
            </>
          }
        />
      </section>

      {/* 운영 중인 반 — 행 전체가 반 상세로 이어진다 (기존 카드는 클릭이 되지 않았다). */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">운영 중인 반</h2>
        <DataTable
          columns={groupColumns}
          rows={groupRows}
          rowKey={(g) => g.id}
          rowHref={(g) => `/app/classes/${g.id}`}
          total={groupTotal}
          query={groupQuery}
          basePath="/app/today"
          empty={
            <>
              <p className="font-medium">아직 반이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                설정에서 반과 학습자를 등록하세요.
              </p>
              <Link
                href="/app/settings"
                className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
              >
                설정에서 반 등록하기
              </Link>
            </>
          }
        />
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone === "warn"
          ? "border-highlight bg-highlight-soft"
          : "border-rule bg-surface"
      }`}
    >
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold">{value}</p>
    </div>
  );
}
