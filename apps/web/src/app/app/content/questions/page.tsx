import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDate } from "@/lib/format";
import {
  DENSE_PAGE_SIZE,
  parseTableQuery,
  type RawSearchParams,
} from "@/lib/table";

export const metadata: Metadata = { title: "문제은행" };

/* 문제은행 (16장) — 문항·출처·사용 권한·검수 상태를 한 화면에서 본다.
 * 자동 출제 가능 여부는 검수·권한·수식 게이트의 종합 결과이며 여기서는
 * 저장된 값을 그대로 보여준다 (원칙 9 — 권한 미확인 문항 자동 출제 금지). */

const REVIEW_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  extracting: "추출 중",
  review_required: "검수 필요",
  formula_review_required: "수식 검수 필요",
  layout_review_required: "레이아웃 검수 필요",
  approved: "승인",
  rejected: "반려",
  quarantined: "격리",
  published: "게시",
};

const KIND_LABEL: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "단답형",
  multi_blank: "다중 빈칸",
  essay: "서술형",
};

const RIGHT_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  under_review: "확인 중",
  usable: "사용 가능",
  restricted: "제한적 사용",
  expired: "만료",
  blocked: "차단",
};

const BAND_LABEL: Record<string, string> = {
  low: "기초",
  mid: "표준",
  high: "심화",
};

/** 정렬 키 → 실제 정렬 대상 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다).
 * 상태·유형은 enum 그대로 정렬해 정의 순서(작업 흐름 순)를 따른다. */
const SORT_COLUMN: Record<string, string> = {
  kind: "kind",
  difficulty: "difficulty_rank",
  review_status: "review_status",
  right_status: "right_status",
  is_auto_assignable: "is_auto_assignable",
  used_count: "used_count",
  created_at: "created_at",
};

interface QuestionRow {
  id: string;
  kind: string;
  review_status: string;
  is_auto_assignable: boolean;
  difficulty_band: string | null;
  right_status: string | null;
  concept_names: string;
  used_count: number;
  created_at: Date;
  total_count: number;
}

export default async function QuestionBankPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("question_bank");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "created_at",
    defaultDir: "desc",
    pageSize: DENSE_PAGE_SIZE,
    filterKeys: ["status", "kind"],
  });
  const statusFilter = query.params.status ?? "";
  const kindFilter = query.params.kind ?? "";

  const [rows, summaryRows] = await Promise.all([
    // enum 컬럼은 양쪽 다 ::text로 비교한다 — 빈 문자열이나 알 수 없는 필터
    // 값이 와도 쿼리가 깨지지 않고 단순히 0건이 된다.
    sql<QuestionRow[]>`
      with base as (
        select q.id, q.kind, q.review_status, q.is_auto_assignable, q.created_at,
               v.difficulty->>'band' as difficulty_band,
               case v.difficulty->>'band'
                 when 'low' then 1 when 'mid' then 2 when 'high' then 3
               end as difficulty_rank,
               cr.status as right_status,
               (select count(*)::int from assessment_questions aq
                 where aq.question_id = q.id
                   and aq.organization_id = q.organization_id) as used_count,
               (select coalesce(string_agg(c.name, ' · ' order by c.name), '')
                  from question_alignments qa
                  join canonical_concepts c on c.id = qa.concept_id
                 where qa.question_id = q.id
                   and qa.organization_id = q.organization_id) as concept_names
        from questions q
        left join question_versions v on v.id = q.current_version_id
        left join content_rights cr on cr.id = q.content_right_id
          and cr.organization_id = q.organization_id
        where q.organization_id = ${user.organizationId}
          and (${statusFilter}::text = '' or q.review_status::text = ${statusFilter})
          and (${kindFilter}::text = '' or q.kind::text = ${kindFilter})
          and (${query.q}::text = ''
               or q.id::text ilike ${`%${query.q}%`}
               or coalesce(q.printed_number, '') ilike ${`%${query.q}%`}
               or exists (select 1
                            from question_alignments qa
                            join canonical_concepts c on c.id = qa.concept_id
                           where qa.question_id = q.id
                             and qa.organization_id = q.organization_id
                             and c.name ilike ${`%${query.q}%`}))
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "created_at")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               id asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    // 요약 줄은 필터와 무관한 조직 전체 값 — 페이지를 넘겨도 흔들리지 않는다.
    sql<{ total: number; assignable: number }[]>`
      select count(*)::int as total,
             count(*) filter (where is_auto_assignable)::int as assignable
      from questions
      where organization_id = ${user.organizationId}
    `,
  ]);

  const total = rows[0]?.total_count ?? 0;
  const orgTotal = summaryRows[0]?.total ?? 0;
  const assignable = summaryRows[0]?.assignable ?? 0;
  const filtered = Object.keys(query.params).length > 0;

  const columns: Column<QuestionRow>[] = [
    {
      key: "id",
      label: "문항",
      mono: true,
      render: (r) => <span title={r.id}>{shortId(r.id)}</span>,
    },
    {
      key: "kind",
      label: "유형",
      sortable: true,
      render: (r) => KIND_LABEL[r.kind] ?? r.kind,
    },
    {
      key: "difficulty",
      label: "난이도",
      sortable: true,
      render: (r) =>
        r.difficulty_band
          ? (BAND_LABEL[r.difficulty_band] ?? r.difficulty_band)
          : "—",
    },
    {
      key: "concepts",
      label: "개념",
      secondary: true,
      className: "max-w-[18rem] truncate",
      render: (r) =>
        r.concept_names || <span className="text-ink-soft">개념 미연결</span>,
    },
    {
      key: "review_status",
      label: "검수",
      sortable: true,
      render: (r) => (
        <Badge
          tone={reviewTone(r.review_status)}
          label={REVIEW_STATUS_LABEL[r.review_status] ?? r.review_status}
        />
      ),
    },
    {
      key: "right_status",
      label: "사용 권한",
      sortable: true,
      render: (r) =>
        r.right_status ? (
          <Badge
            tone={r.right_status === "usable" ? "ok" : "warn"}
            label={RIGHT_STATUS_LABEL[r.right_status] ?? r.right_status}
          />
        ) : (
          <Badge tone="warn" label="권한 미연결" />
        ),
    },
    {
      key: "is_auto_assignable",
      label: "자동 출제",
      sortable: true,
      render: (r) => (
        <Badge
          tone={r.is_auto_assignable ? "ok" : "muted"}
          label={r.is_auto_assignable ? "가능" : "불가"}
        />
      ),
    },
    {
      key: "used_count",
      label: "출제",
      sortable: true,
      align: "right",
      mono: true,
      render: (r) => `${r.used_count}회`,
    },
    {
      key: "created_at",
      label: "등록",
      sortable: true,
      mono: true,
      secondary: true,
      render: (r) => formatDate(r.created_at, user.timezone),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">문제은행</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        전체 {orgTotal}문항 · 자동 출제 가능 {assignable}문항. 검수를 통과하고
        사용 권한이 확인된 문항만 자동 출제 풀에 들어갑니다.
      </p>

      <TableFilters
        basePath="/app/content/questions"
        query={query}
        search={{ label: "검색", placeholder: "문항 번호·ID·개념" }}
        selects={[
          {
            name: "status",
            label: "검수 상태",
            options: Object.entries(REVIEW_STATUS_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
          {
            name: "kind",
            label: "유형",
            options: Object.entries(KIND_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/content/questions/${r.id}`}
        total={total}
        query={query}
        basePath="/app/content/questions"
        empty={
          filtered ? (
            <>
              <p className="font-medium">이 조건에 맞는 문항이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                필터를 지우면 전체 문항을 볼 수 있습니다.
              </p>
              <Link
                href="/app/content/questions"
                className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
              >
                필터 지우기
              </Link>
            </>
          ) : (
            <>
              <p className="font-medium">아직 등록된 문항이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                문제집 변환으로 원본을 반입하거나 문항을 직접 등록하세요.
              </p>
              <Link
                href="/app/content/ingestion"
                className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
              >
                문제집 변환으로 이동
              </Link>
            </>
          )
        }
      />
    </div>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "bad" | "muted";
}) {
  const cls =
    tone === "ok"
      ? "border-pen bg-pen-soft text-pen"
      : tone === "warn"
        ? "border-highlight bg-highlight-soft text-ink"
        : tone === "bad"
          ? "border-grade bg-grade-soft text-grade"
          : "border-rule bg-surface text-ink-soft";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-xs ${cls}`}
    >
      {label}
    </span>
  );
}

function reviewTone(status: string): "ok" | "warn" | "bad" | "muted" {
  if (status === "published" || status === "approved") return "ok";
  if (status === "rejected" || status === "quarantined") return "bad";
  if (status === "draft" || status === "extracting") return "muted";
  return "warn";
}

/** 시드 문항 ID는 앞자리가 모두 같다 — 구별되는 뒷자리 8글자를 쓴다. */
function shortId(id: string): string {
  return id.replace(/-/g, "").slice(-8);
}
