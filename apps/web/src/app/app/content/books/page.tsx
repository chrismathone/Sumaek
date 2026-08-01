import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDate } from "@/lib/format";
import {
  STACKED_PAGE_SIZE,
  parseTableQuery,
  type RawSearchParams,
} from "@/lib/table";
import { RightActions } from "./RightActions";

export const metadata: Metadata = { title: "교재" };

/* 교재 (27장 사용 권한 포함) — 교재·판본·사용 권한을 함께 본다.
 * 시스템은 권리 확보를 보증하지 않는다. 근거·증빙의 기록과 집행만 한다. */

const RIGHT_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  under_review: "확인 중",
  usable: "사용 가능",
  restricted: "제한적 사용",
  expired: "만료",
  blocked: "차단",
};

const USE_LABEL: Record<string, string> = {
  transform: "변형",
  ai: "AI 처리",
  print: "인쇄",
  online: "온라인 제공",
};

const SCHOOL_LEVEL_LABEL: Record<string, string> = {
  elementary: "초등",
  middle: "중등",
  high: "고등",
};

/** 판본 없는 사용 권한 표의 정렬 키 → 정렬 대상 (화이트리스트).
 * 값은 전부 base CTE의 출력 별칭이라 ORDER BY에서 그대로 쓸 수 있다. */
const SORT_COLUMN: Record<string, string> = {
  rights_holder: "rights_holder",
  status: "status",
  question_count: "question_count",
  expires_on: "expires_on",
  created_at: "created_at",
};

interface StandaloneRightRow {
  id: string;
  rights_holder: string | null;
  status: string;
  evidence_ref: string | null;
  allowed_uses: unknown;
  expires_on: Date | null;
  created_at: Date;
  question_count: number;
  total_count: number;
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("books");
  const sql = getSharedSql();

  /* 사용 권한 표는 행마다 중지·복구 버튼이 들어가 실측 행 높이가 85px이고,
   * 위에는 교재 카드 목록까지 있다. 기본값 10행은 368px만큼 바깥 스크롤을
   * 만들었고 6행으로도 122px이 남았다(브라우저 실측). STACKED_PAGE_SIZE를 쓴다. */
  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "rights_holder",
    filterKeys: ["status"],
    pageSize: STACKED_PAGE_SIZE,
  });
  const statusFilter = query.params.status ?? "";

  const [rows, standaloneRights] = await Promise.all([
    sql<
      {
        book_id: string;
        title: string;
        school_level: string | null;
        grade_band: string | null;
        publisher_name: string | null;
        edition_id: string | null;
        edition_label: string | null;
        isbn: string | null;
        published_year: number | null;
        right_id: string | null;
        right_status: string | null;
        rights_holder: string | null;
        expires_on: Date | null;
        question_count: number;
      }[]
    >`
      select b.id as book_id, b.title, b.school_level, b.grade_band,
             p.name as publisher_name,
             e.id as edition_id, e.edition_label, e.isbn, e.published_year,
             cr.id as right_id, cr.status as right_status, cr.rights_holder, cr.expires_on,
             coalesce(
               (select count(*)::int from questions q
                 where q.book_edition_id = e.id
                   and q.organization_id = b.organization_id), 0) as question_count
      from books b
      left join publishers p on p.id = b.publisher_id
        and p.organization_id = b.organization_id
      left join book_editions e on e.book_id = b.id
        and e.organization_id = b.organization_id
      left join lateral (
        select r.id, r.status::text as status, r.rights_holder, r.expires_on
        from content_rights r
        where r.book_edition_id = e.id
          and r.organization_id = b.organization_id
        order by r.updated_at desc
        limit 1
      ) cr on true
      where b.organization_id = ${user.organizationId}
      order by b.title, e.published_year nulls last, e.edition_label
    `,
    /* 판본에 묶이지 않은 사용 권한 — 자체 제작·라이선스 일괄 등록분.
     * status는 enum이므로 필터는 양쪽 다 ::text로 비교한다 (빈 문자열이
     * enum 캐스팅을 만나 500이 나는 것을 막는다). */
    sql<StandaloneRightRow[]>`
      with base as (
        select cr.id, cr.rights_holder, cr.status::text as status, cr.evidence_ref,
               cr.allowed_uses, cr.expires_on, cr.created_at,
               (select count(*)::int from questions q
                 where q.content_right_id = cr.id
                   and q.organization_id = cr.organization_id) as question_count
        from content_rights cr
        where cr.organization_id = ${user.organizationId}
          and cr.book_edition_id is null
          and (${statusFilter}::text = '' or cr.status::text = ${statusFilter})
          and (${query.q}::text = ''
               or coalesce(cr.rights_holder, '') ilike ${`%${query.q}%`}
               or coalesce(cr.evidence_ref, '') ilike ${`%${query.q}%`})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "rights_holder")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               created_at asc
      limit ${query.pageSize} offset ${query.offset}
    `,
  ]);

  const rightsTotal = standaloneRights[0]?.total_count ?? 0;

  const rightColumns: Column<StandaloneRightRow>[] = [
    {
      key: "rights_holder",
      label: "권리자",
      sortable: true,
      render: (cr) => (
        <span className="font-medium">{cr.rights_holder ?? "권리자 미기재"}</span>
      ),
    },
    {
      key: "allowed_uses",
      label: "허용 용도",
      render: (cr) => (
        <span className="text-ink-soft">{formatAllowedUses(cr.allowed_uses)}</span>
      ),
    },
    {
      key: "evidence_ref",
      label: "증빙",
      secondary: true,
      mono: true,
      className: "max-w-[14rem] truncate",
      render: (cr) => cr.evidence_ref ?? "—",
    },
    {
      key: "question_count",
      label: "문항",
      sortable: true,
      align: "right",
      mono: true,
      render: (cr) => `${cr.question_count}개`,
    },
    {
      key: "expires_on",
      label: "만료",
      sortable: true,
      mono: true,
      secondary: true,
      render: (cr) =>
        cr.expires_on ? formatDate(cr.expires_on, user.timezone) : "—",
    },
    {
      key: "status",
      label: "상태",
      sortable: true,
      render: (cr) => (
        <Badge
          label={RIGHT_STATUS_LABEL[cr.status] ?? cr.status}
          tone={cr.status === "usable" ? "ok" : "warn"}
        />
      ),
    },
    {
      key: "actions",
      label: "조치",
      // 중지·복구는 행 안에서 끝난다 — 목록을 떠나지 않고 집행한다.
      render: (cr) => (
        <RightActions
          rightId={cr.id}
          status={cr.status}
          holderLabel={cr.rights_holder ?? "권리자 미기재"}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">교재</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        판본과 쇄가 페이지·문항 번호의 기준입니다. 사용 권한이 &lsquo;사용
        가능&rsquo;인 판본의 문항만 자동 출제 풀에 들어갑니다.
      </p>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">교재를 등록하고 문제집 변환을 시작하세요.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            등록된 교재가 아직 없습니다. 교재·판본을 먼저 만들면 원본 파일의
            페이지와 문항 번호를 그 판본 기준으로 보존합니다.
          </p>
          <Link
            href="/app/content/ingestion"
            className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            문제집 변환으로 이동
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((r) => (
            <li
              key={`${r.book_id}-${r.edition_id ?? "no-edition"}`}
              className="rounded-lg border border-rule bg-surface p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{r.title}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-soft">
                    {r.publisher_name ?? "출판사 미지정"}
                    {r.school_level &&
                      ` · ${SCHOOL_LEVEL_LABEL[r.school_level] ?? r.school_level}`}
                    {r.grade_band && ` · ${r.grade_band}`}
                  </p>
                  <p className="mt-1 text-sm">
                    {r.edition_label ?? "판본 미등록"}
                    {r.published_year && ` · ${r.published_year}년`}
                    {r.isbn && ` · ISBN ${r.isbn}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {r.right_status ? (
                    <Badge
                      label={RIGHT_STATUS_LABEL[r.right_status] ?? r.right_status}
                      tone={r.right_status === "usable" ? "ok" : "warn"}
                    />
                  ) : (
                    <Badge label="사용 권한 미등록" tone="warn" />
                  )}
                  <span className="font-mono text-xs text-ink-soft">
                    문항 {r.question_count}개
                  </span>
                </div>
              </div>
              <p className="mt-2 font-mono text-xs text-ink-soft">
                권리자 {r.rights_holder ?? "미기재"}
                {r.expires_on &&
                  ` · 만료 ${new Date(r.expires_on).toLocaleDateString("ko-KR")}`}
              </p>
              {r.right_id && (
                <RightActions
                  rightId={r.right_id}
                  status={r.right_status ?? ""}
                  holderLabel={r.rights_holder ?? r.title}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 판본에 묶이지 않은 사용 권한 — 자체 제작·라이선스 일괄 등록분 */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">판본 없는 사용 권한</h2>
        <p className="mt-1.5 text-sm text-ink-soft">
          권리자·허용 용도·문항 수를 한 줄로 보고, 그 줄에서 바로 사용을
          중지하거나 되돌립니다.
        </p>

        <TableFilters
          basePath="/app/content/books"
          query={query}
          search={{ label: "검색", placeholder: "권리자·증빙" }}
          selects={[
            {
              name: "status",
              label: "상태",
              options: Object.entries(RIGHT_STATUS_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            },
          ]}
        />

        <DataTable
          columns={rightColumns}
          rows={standaloneRights}
          rowKey={(cr) => cr.id}
          total={rightsTotal}
          query={query}
          basePath="/app/content/books"
          empty={
            query.q || query.params.status ? (
              <>
                <p className="font-medium">조건에 맞는 사용 권한이 없습니다.</p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  검색어나 상태 필터를 바꿔보세요.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  판본에 연결되지 않은 사용 권한 레코드가 없습니다.
                </p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  문제집 변환에서 원본을 반입하면 입력한 권리자·출처가 사용
                  권한으로 기록됩니다.
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
      </section>
    </div>
  );
}

function formatAllowedUses(uses: unknown): string {
  if (!uses || typeof uses !== "object") return "—";
  const entries = Object.entries(uses as Record<string, unknown>).filter(
    ([, v]) => v === true,
  );
  if (entries.length === 0) return "미기재";
  return entries.map(([k]) => USE_LABEL[k] ?? k).join(", ");
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
