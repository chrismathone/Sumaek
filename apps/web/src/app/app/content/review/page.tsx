import { contentOrganizationIds } from "@su-maek/db";
import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDateTime } from "@/lib/format";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";
import { ApproveForm } from "./ApproveForm";

export const metadata: Metadata = { title: "콘텐츠 검수" };

/* 콘텐츠 검수함 — 사람이 판정해야 넘어가는 항목만 모은다.
 * 수식 게이트에 걸린 표현은 자동 보정으로 통과시키지 않고 여기서 격리된다
 * (원칙 12 — 수식이 깨진 문항은 게시할 수 없다).
 *
 * 콘텐츠 검수와 수식 검수는 "사람이 판정해야 하는 한 줄"이라는 점에서 같은
 * 대기열이므로 한 표로 합쳐 보여준다. 구분 필터로 한쪽만 볼 수 있다. */

const REVIEW_KIND_LABEL: Record<string, string> = {
  content: "콘텐츠 검수",
  formula: "수식 검수",
};

const SUBJECT_LABEL: Record<string, string> = {
  question: "문항",
  source_file: "원본 파일",
  diagram: "도형",
  mapping: "개념 매핑",
  formula: "수식",
};

const REVIEW_STATUS_LABEL: Record<string, string> = {
  open: "미배정",
  assigned: "배정됨",
  reviewing: "검토 중",
  resolved: "완료",
};

const DECISION_LABEL: Record<string, string> = {
  approve: "승인",
  reject: "반려",
  quarantine: "격리",
  needs_fix: "수정 필요",
};

const PARSE_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  parsed: "파싱됨",
  normalized: "정규화됨",
  render_validated: "렌더 검증 완료",
  review_required: "검수 필요",
  corrected: "보정됨",
  rejected: "반려",
};

/** 정렬 키 → base CTE의 출력 별칭 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다) */
const SORT_COLUMN: Record<string, string> = {
  kind: "kind",
  subject_type: "subject_type",
  status: "status",
  created_at: "created_at",
};

interface ReviewRow {
  id: string;
  /** content | formula */
  kind: string;
  subject_type: string;
  subject_id: string | null;
  /** 문항 상세로 이어지는 경우에만 값이 있다 */
  question_id: string | null;
  status: string;
  /** 콘텐츠는 판정, 수식은 파싱 게이트 상태 */
  decision: string | null;
  notes: string | null;
  raw_source: string | null;
  normalized_latex: string | null;
  /** 체크리스트(콘텐츠) 또는 진단(수식) */
  detail: unknown;
  created_at: Date;
  assignee_name: string | null;
  total_count: number;
}

export default async function ContentReviewPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("content_review");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "created_at",
    filterKeys: ["kind", "status"],
  });
  const kindFilter = query.params.kind ?? "";
  const statusFilter = query.params.status ?? "";
  const like = `%${query.q}%`;

  const [rows, counts] = await Promise.all([
    sql<ReviewRow[]>`
      with src as (
        select cr.id::text as id,
               'content'::text as kind,
               cr.subject_type::text as subject_type,
               cr.subject_id::text as subject_id,
               (case when cr.subject_type = 'question' then cr.subject_id::text end)
                 as question_id,
               cr.status::text as status,
               cr.decision::text as decision,
               cr.notes::text as notes,
               null::text as raw_source,
               null::text as normalized_latex,
               cr.checklist as detail,
               cr.created_at as created_at,
               u.display_name::text as assignee_name
        from content_reviews cr
        left join users u on u.id = cr.reviewer_id
        where cr.organization_id = ${user.organizationId}
          and cr.status <> 'resolved'
        union all
        select fr.id::text,
               'formula'::text,
               'formula'::text,
               fr.question_id::text,
               fr.question_id::text,
               fr.status::text,
               me.parse_status::text,
               null::text,
               me.raw_source::text,
               me.normalized_latex::text,
               fr.diagnosis,
               fr.created_at,
               u.display_name::text
        from formula_reviews fr
        left join users u on u.id = fr.assigned_to
        left join math_expressions me on me.id = fr.expression_id
          and me.organization_id = fr.organization_id
        where fr.organization_id = any(${contentOrganizationIds(user.organizationId)}::uuid[])
          and fr.status <> 'resolved'
      ),
      base as (
        select * from src
        where (${kindFilter}::text = '' or src.kind::text = ${kindFilter})
          and (${statusFilter}::text = '' or src.status::text = ${statusFilter})
          and (${query.q}::text = ''
               or coalesce(src.subject_id, '') ilike ${like}
               or coalesce(src.notes, '') ilike ${like}
               or coalesce(src.raw_source, '') ilike ${like}
               or coalesce(src.normalized_latex, '') ilike ${like})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "created_at")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               id asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    sql<{ content_count: number; formula_count: number }[]>`
      select
        (select count(*)::int from content_reviews
          where organization_id = any(${contentOrganizationIds(user.organizationId)}::uuid[])
            and status <> 'resolved') as content_count,
        (select count(*)::int from formula_reviews
          where organization_id = any(${contentOrganizationIds(user.organizationId)}::uuid[])
            and status <> 'resolved') as formula_count
    `,
  ]);

  const total = rows[0]?.total_count ?? 0;
  const contentCount = counts[0]?.content_count ?? 0;
  const formulaCount = counts[0]?.formula_count ?? 0;
  const openTotal = contentCount + formulaCount;
  const filtered = Boolean(query.q || query.params.kind || query.params.status);

  const columns: Column<ReviewRow>[] = [
    {
      key: "kind",
      label: "구분",
      sortable: true,
      render: (r) => (
        <Badge
          label={REVIEW_KIND_LABEL[r.kind] ?? r.kind}
          tone={r.kind === "formula" ? "warn" : "muted"}
        />
      ),
    },
    {
      key: "subject_type",
      label: "대상",
      sortable: true,
      render: (r) => (
        <span className="whitespace-nowrap">
          {SUBJECT_LABEL[r.subject_type] ?? r.subject_type}{" "}
          {r.question_id ? (
            <Link
              href={`/app/content/questions/${r.question_id}`}
              className="font-mono text-xs text-pen underline underline-offset-2"
            >
              {shortId(r.question_id)}
            </Link>
          ) : r.subject_id ? (
            <span className="font-mono text-xs text-ink-soft">
              {shortId(r.subject_id)}
            </span>
          ) : (
            <span className="text-xs text-ink-soft">문항 미연결</span>
          )}
        </span>
      ),
    },
    {
      key: "detail",
      label: "내용",
      render: (r) =>
        r.kind === "formula" ? (
          <div className="max-w-[24rem] space-y-1">
            <p className="break-all font-mono text-xs">
              <span className="text-ink-soft">원문(불변) </span>
              {r.raw_source ?? "—"}
            </p>
            <p className="break-all font-mono text-xs">
              <span className="text-ink-soft">정규화 </span>
              {r.normalized_latex ?? "정규화 결과 없음"}
            </p>
            <JsonDetails title="진단 내용" value={r.detail} />
          </div>
        ) : (
          <div className="max-w-[24rem] space-y-1">
            {r.notes ? (
              <p className="text-sm">{r.notes}</p>
            ) : (
              <p className="text-sm text-ink-soft">검수 의견 없음</p>
            )}
            {r.detail != null && (
              <JsonDetails title="체크리스트" value={r.detail} />
            )}
          </div>
        ),
    },
    {
      key: "status",
      label: "상태",
      sortable: true,
      render: (r) => (
        <Badge
          label={REVIEW_STATUS_LABEL[r.status] ?? r.status}
          tone={r.status === "open" ? "warn" : "muted"}
        />
      ),
    },
    {
      key: "decision",
      label: "판정·게이트",
      secondary: true,
      render: (r) => {
        if (!r.decision) return <span className="text-ink-soft">—</span>;
        if (r.kind === "formula") {
          return (
            <Badge
              label={PARSE_STATUS_LABEL[r.decision] ?? r.decision}
              tone="warn"
            />
          );
        }
        return (
          <Badge
            label={DECISION_LABEL[r.decision] ?? r.decision}
            tone={r.decision === "approve" ? "ok" : "warn"}
          />
        );
      },
    },
    {
      key: "assignee",
      label: "담당",
      secondary: true,
      render: (r) => (
        <span className="text-ink-soft">{r.assignee_name ?? "미배정"}</span>
      ),
    },
    {
      key: "created_at",
      label: "접수",
      sortable: true,
      mono: true,
      secondary: true,
      render: (r) => formatDateTime(r.created_at),
    },
    {
      key: "action",
      label: "처리",
      render: (r) =>
        r.kind === "content" &&
        r.status === "open" &&
        r.subject_type === "question" &&
        r.subject_id ? (
          <ApproveForm questionId={r.subject_id} />
        ) : (
          <span className="text-ink-soft">—</span>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">콘텐츠 검수</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {openTotal > 0
          ? `검토 대기 ${openTotal}건 — 콘텐츠 ${contentCount}건, 수식 ${formulaCount}건.`
          : "사람의 판정이 필요한 항목만 이곳에 모입니다."}
      </p>

      <TableFilters
        basePath="/app/content/review"
        query={query}
        search={{ label: "검색", placeholder: "대상 ID·의견·수식" }}
        selects={[
          {
            name: "kind",
            label: "구분",
            options: Object.entries(REVIEW_KIND_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
          {
            name: "status",
            label: "상태",
            options: ["open", "assigned", "reviewing"].map((value) => ({
              value,
              label: REVIEW_STATUS_LABEL[value] ?? value,
            })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.kind}:${r.id}`}
        total={total}
        query={query}
        basePath="/app/content/review"
        empty={
          filtered ? (
            <>
              <p className="font-medium">조건에 맞는 검수 항목이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                검색어나 구분·상태 필터를 바꿔보세요.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">검수할 항목이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                수식 게이트 실패, 중복 의심, 권한 확인 필요 항목이 생기면 자동으로
                여기에 쌓입니다. 검수를 통과하지 못한 문항은 자동 출제되지 않습니다.
              </p>
              <Link
                href="/app/content/questions"
                className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
              >
                문제은행 열기
              </Link>
            </>
          )
        }
      />
    </div>
  );
}

function shortId(id: string): string {
  return id.replace(/-/g, "").slice(-8);
}

/** 원본 근거(jsonb)를 접어 둔다 — 표 폭을 흔들지 않으면서 근거를 감추지 않는다 */
function JsonDetails({ title, value }: { title: string; value: unknown }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs text-ink-soft">{title}</summary>
      <pre className="mt-1 max-w-[24rem] overflow-x-auto rounded bg-paper p-2 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
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
