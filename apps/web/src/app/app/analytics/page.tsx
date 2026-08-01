import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { MASTERY_STATE_LABEL, MASTERY_STATES } from "@/lib/format";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";

export const metadata: Metadata = { title: "개념 숙련도" };

/* 개념 숙련도 개요 — 개념별 학습자 상태 분포.
 * 취약(탐색 중·부분 이해·재점검 필요) 학생 수가 많은 개념부터 보여준다.
 * 집계는 concept_masteries 행을 그대로 센 것이며 추정·보정하지 않는다.
 *
 * 상단 상태 분포 요약은 워크스페이스 전체 기준이다 — 표의 검색·필터·쪽넘김과
 * 무관하게 같은 수를 보여야 "전체에서 어디를 보고 있는가"를 알 수 있다. */

/** 정렬 키 → 실제 정렬 대상 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다).
 *  값은 모두 base CTE의 출력 별칭이다. */
const SORT_COLUMN: Record<string, string> = {
  name: "name",
  grade_band: "grade_band",
  domain_name: "domain_name",
  learner_count: "learner_count",
  weak_count: "weak_count",
  recheck_needed: "n_recheck_needed",
  exploring: "n_exploring",
  partial: "n_partial",
  stable: "n_stable",
  transfer_confirmed: "n_transfer_confirmed",
  no_evidence: "n_no_evidence",
};

interface ConceptRow {
  concept_id: string;
  name: string;
  domain_name: string | null;
  grade_band: string | null;
  learner_count: number;
  weak_count: number;
  n_no_evidence: number;
  n_exploring: number;
  n_partial: number;
  n_stable: number;
  n_transfer_confirmed: number;
  n_recheck_needed: number;
  total_count: number;
}

interface SummaryRow {
  total_rows: number;
  concept_count: number;
  n_no_evidence: number;
  n_exploring: number;
  n_partial: number;
  n_stable: number;
  n_transfer_confirmed: number;
  n_recheck_needed: number;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("mastery");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "weak_count",
    defaultDir: "desc",
    filterKeys: ["band"],
  });
  const bandFilter = query.params.band ?? "";

  const [concepts, summaryRows, bandRows] = await Promise.all([
    sql<ConceptRow[]>`
      with base as (
        select c.id as concept_id, c.name, c.domain_name, c.grade_band,
               count(*)::int as learner_count,
               count(*) filter (
                 where cm.state in ('exploring', 'partial', 'recheck_needed')
               )::int as weak_count,
               count(*) filter (where cm.state = 'no_evidence')::int as n_no_evidence,
               count(*) filter (where cm.state = 'exploring')::int as n_exploring,
               count(*) filter (where cm.state = 'partial')::int as n_partial,
               count(*) filter (where cm.state = 'stable')::int as n_stable,
               count(*) filter (where cm.state = 'transfer_confirmed')::int as n_transfer_confirmed,
               count(*) filter (where cm.state = 'recheck_needed')::int as n_recheck_needed
        from concept_masteries cm
        join canonical_concepts c on c.id = cm.concept_id
        where cm.organization_id = ${user.organizationId}
          and (${query.q}::text = '' or c.name ilike ${`%${query.q}%`}
               or coalesce(c.domain_name, '') ilike ${`%${query.q}%`}
               or coalesce(c.grade_band, '') ilike ${`%${query.q}%`})
          and (${bandFilter}::text = ''
               or coalesce(c.grade_band, '')::text = ${bandFilter})
        group by c.id, c.name, c.domain_name, c.grade_band
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "weak_count")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               name asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    /* 상단 요약 — 필터와 무관한 워크스페이스 전체 집계 */
    sql<SummaryRow[]>`
      select count(*)::int as total_rows,
             count(distinct cm.concept_id)::int as concept_count,
             count(*) filter (where cm.state = 'no_evidence')::int as n_no_evidence,
             count(*) filter (where cm.state = 'exploring')::int as n_exploring,
             count(*) filter (where cm.state = 'partial')::int as n_partial,
             count(*) filter (where cm.state = 'stable')::int as n_stable,
             count(*) filter (where cm.state = 'transfer_confirmed')::int as n_transfer_confirmed,
             count(*) filter (where cm.state = 'recheck_needed')::int as n_recheck_needed
      from concept_masteries cm
      join canonical_concepts c on c.id = cm.concept_id
      where cm.organization_id = ${user.organizationId}
    `,
    sql<{ band: string }[]>`
      select distinct c.grade_band as band
      from concept_masteries cm
      join canonical_concepts c on c.id = cm.concept_id
      where cm.organization_id = ${user.organizationId}
        and c.grade_band is not null
      order by band asc
      limit 30
    `,
  ]);

  const summary = summaryRows[0];
  const totals: Record<string, number> = {
    no_evidence: summary?.n_no_evidence ?? 0,
    exploring: summary?.n_exploring ?? 0,
    partial: summary?.n_partial ?? 0,
    stable: summary?.n_stable ?? 0,
    transfer_confirmed: summary?.n_transfer_confirmed ?? 0,
    recheck_needed: summary?.n_recheck_needed ?? 0,
  };
  const totalRows = summary?.total_rows ?? 0;
  const conceptCount = summary?.concept_count ?? 0;
  const total = concepts[0]?.total_count ?? 0;
  const filtered = query.q !== "" || bandFilter !== "";

  const columns: Column<ConceptRow>[] = [
    {
      key: "name",
      label: "개념",
      sortable: true,
      render: (c) => (
        <>
          <span className="font-medium">{c.name}</span>
          {(c.domain_name || c.grade_band) && (
            <span className="ml-2 text-xs text-ink-soft">
              {[c.grade_band, c.domain_name].filter(Boolean).join(" · ")}
            </span>
          )}
        </>
      ),
    },
    {
      key: "learner_count",
      label: "학습자",
      sortable: true,
      align: "right",
      mono: true,
      render: (c) => <span className="text-ink-soft">{c.learner_count}</span>,
    },
    {
      key: "weak_count",
      label: "취약",
      sortable: true,
      align: "right",
      mono: true,
      render: (c) =>
        c.weak_count > 0 ? (
          <span className="font-bold text-grade">{c.weak_count}</span>
        ) : (
          <span className="text-ink-soft">0</span>
        ),
    },
    ...MASTERY_STATES.map(
      (s): Column<ConceptRow> => ({
        key: s,
        label: MASTERY_STATE_LABEL[s] ?? s,
        sortable: true,
        align: "right",
        mono: true,
        // 재점검 필요는 좁은 화면에서도 남긴다 — 손봐야 할 상태의 대표값
        secondary: s !== "recheck_needed",
        render: (c) => <span className="text-ink-soft">{stateCount(c, s)}</span>,
      }),
    ),
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">개념 숙련도</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        개념별 학습자 상태 분포입니다. 취약(탐색 중·부분 이해·재점검 필요)
        학생이 많은 개념이 위에 옵니다.
      </p>

      {totalRows === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">아직 집계할 숙련도 근거가 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            테스트 채점이 확정되면 개념별 증거가 쌓이고 상태가 계산됩니다.
          </p>
          <Link
            href="/app/tests"
            className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            일일·확인테스트로 이동
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {MASTERY_STATES.map((s) => (
              <div
                key={s}
                className={`rounded-lg border p-3 ${
                  s === "recheck_needed"
                    ? "border-highlight bg-highlight-soft"
                    : "border-rule bg-surface"
                }`}
              >
                <p className="text-xs text-ink-soft">{MASTERY_STATE_LABEL[s]}</p>
                <p className="mt-1 font-mono text-lg font-bold">
                  {totals[s] ?? 0}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono text-xs text-ink-soft">
            개념 {conceptCount}개 · 학습자·개념 조합 {totalRows}건
          </p>

          <TableFilters
            basePath="/app/analytics"
            query={query}
            search={{ label: "검색", placeholder: "개념명·영역·학년군" }}
            selects={[
              {
                name: "band",
                label: "학년군",
                options: bandRows.map((b) => ({ value: b.band, label: b.band })),
              },
            ]}
          />

          <DataTable
            columns={columns}
            rows={concepts}
            rowKey={(c) => c.concept_id}
            total={total}
            query={query}
            basePath="/app/analytics"
            empty={
              filtered ? (
                <>
                  <p className="font-medium">조건에 맞는 개념이 없습니다.</p>
                  <p className="mt-1.5 text-sm text-ink-soft">
                    검색어나 학년군 필터를 바꿔보세요.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">표시할 개념이 없습니다.</p>
                  <p className="mt-1.5 text-sm text-ink-soft">
                    테스트 채점이 확정되면 개념별 증거가 쌓이고 상태가
                    계산됩니다.
                  </p>
                </>
              )
            }
          />
        </>
      )}
    </div>
  );
}

function stateCount(row: ConceptRow, state: (typeof MASTERY_STATES)[number]): number {
  switch (state) {
    case "recheck_needed":
      return row.n_recheck_needed;
    case "exploring":
      return row.n_exploring;
    case "partial":
      return row.n_partial;
    case "stable":
      return row.n_stable;
    case "transfer_confirmed":
      return row.n_transfer_confirmed;
    case "no_evidence":
      return row.n_no_evidence;
  }
}
