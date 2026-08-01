import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";
import { GenerateForm } from "./GenerateForm";

export const metadata: Metadata = { title: "일일·확인테스트" };

const STATUS_LABEL: Record<string, string> = {
  generating: "생성 중",
  draft: "초안",
  ready: "준비 완료",
  review_required: "검토 필요",
  published: "게시됨",
  open: "응시 중",
  closed: "마감",
  grading: "채점 중",
  finalized: "완료",
  cancelled: "취소",
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

/** 정렬 키 → 실제 정렬 대상 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다) */
const SORT_COLUMN: Record<string, string> = {
  title: "title",
  purpose: "purpose",
  scheduled_date: "scheduled_date",
  question_count: "question_count",
  assigned: "assigned",
  submitted: "submitted",
  status: "status",
};

interface AssessmentRow {
  id: string;
  title: string;
  purpose: string;
  status: string;
  scheduled_date: string | null;
  created_at: Date;
  group_name: string | null;
  question_count: number;
  assigned: number;
  submitted: number;
  total_count: number;
}

export default async function TestsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("tests");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "scheduled_date",
    defaultDir: "desc",
    filterKeys: ["status", "purpose"],
  });
  const statusFilter = query.params.status ?? "";
  const purposeFilter = query.params.purpose ?? "";

  const [groups, assessments, nextSession] = await Promise.all([
    sql<{ id: string; name: string }[]>`
      select id, name from learning_groups
      where organization_id = ${user.organizationId} and status = 'operating'
      order by name
    `,
    sql<AssessmentRow[]>`
      with base as (
        select a.id, a.title, a.purpose, a.status,
               a.scheduled_date::text as scheduled_date,
               a.created_at,
               g.name as group_name,
               (select count(*)::int from assessment_questions q
                 where q.assessment_id = a.id) as question_count,
               (select count(*)::int from assignments s
                 where s.assessment_id = a.id) as assigned,
               (select count(*)::int from attempts t
                 where t.assessment_id = a.id
                   and t.status in ('submitted','auto_graded','review_required','finalized')) as submitted
        from assessment_instances a
        left join learning_groups g on g.id = a.learning_group_id
        where a.organization_id = ${user.organizationId}
          and (${query.q}::text = '' or a.title ilike ${`%${query.q}%`}
               or coalesce(g.name, '') ilike ${`%${query.q}%`})
          and (${statusFilter}::text = '' or a.status::text = ${statusFilter})
          and (${purposeFilter}::text = '' or a.purpose::text = ${purposeFilter})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "scheduled_date")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               created_at desc
      limit ${query.pageSize} offset ${query.offset}
    `,
    sql<{ session_date: string }[]>`
      select min(session_date)::text as session_date from sessions
      where organization_id = ${user.organizationId}
        and session_date >= (now() at time zone ${user.timezone})::date
    `,
  ]);

  const total = assessments[0]?.total_count ?? 0;

  const defaultDate =
    nextSession[0]?.session_date ??
    new Date().toLocaleDateString("en-CA", { timeZone: user.timezone });

  const columns: Column<AssessmentRow>[] = [
    {
      key: "title",
      label: "제목",
      sortable: true,
      render: (a) => <span className="font-medium">{a.title}</span>,
    },
    {
      key: "purpose",
      label: "유형",
      sortable: true,
      render: (a) => (
        <span className="font-mono text-xs text-ink-soft">
          {PURPOSE_LABEL[a.purpose] ?? a.purpose}
        </span>
      ),
    },
    {
      key: "group",
      label: "반",
      secondary: true,
      render: (a) => <span className="text-ink-soft">{a.group_name ?? "개인"}</span>,
    },
    {
      key: "scheduled_date",
      label: "수업일",
      sortable: true,
      mono: true,
      secondary: true,
      render: (a) => a.scheduled_date ?? "—",
    },
    {
      key: "question_count",
      label: "문항",
      sortable: true,
      align: "right",
      mono: true,
      render: (a) => `${a.question_count}문항`,
    },
    {
      key: "assigned",
      label: "배정",
      sortable: true,
      align: "right",
      mono: true,
      render: (a) => `${a.assigned}명`,
    },
    {
      key: "submitted",
      label: "제출",
      sortable: true,
      align: "right",
      mono: true,
      render: (a) => `${a.submitted}명`,
    },
    {
      key: "status",
      label: "상태",
      sortable: true,
      render: (a) => (
        <span className="whitespace-nowrap rounded-[var(--radius-control)] border border-rule px-2 py-1 font-mono text-xs">
          {STATUS_LABEL[a.status] ?? a.status}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">일일·확인테스트</h1>

      <div className="mt-6">
        <GenerateForm groups={groups} defaultDate={defaultDate} />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">생성된 테스트</h2>

        <TableFilters
          basePath="/app/tests"
          query={query}
          search={{ label: "검색", placeholder: "제목·반 이름" }}
          selects={[
            {
              name: "purpose",
              label: "유형",
              options: Object.entries(PURPOSE_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            },
            {
              name: "status",
              label: "상태",
              options: Object.entries(STATUS_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            },
          ]}
        />

        <DataTable
          columns={columns}
          rows={assessments}
          rowKey={(a) => a.id}
          total={total}
          query={query}
          basePath="/app/tests"
          empty={
            query.params.status || query.params.purpose || query.q ? (
              <>
                <p className="font-medium">조건에 맞는 테스트가 없습니다.</p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  검색어나 유형·상태 필터를 바꿔보세요.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">아직 생성된 테스트가 없습니다.</p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  위에서 수업 날짜를 골라 생성하세요.
                </p>
              </>
            )
          }
        />
      </section>
    </div>
  );
}
