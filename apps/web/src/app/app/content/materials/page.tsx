import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDate } from "@/lib/format";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";
import { CreateMaterialForm, MaterialStatusButton } from "./MaterialForms";

export const metadata: Metadata = { title: "학습 자료" };

/* 학습 자료 저작 (개념 공부 · 인강 · 연습문제).
 *
 * 학생 화면은 오래전부터 이 데이터를 읽고 있었는데 넣는 문이 없었다.
 * 상세 라우트는 두지 않는다 — 교재·검수 화면처럼 행 안 액션으로 끝낸다. */

const KIND_LABEL: Record<string, string> = {
  reading: "개념 공부",
  video: "개념 인강",
  practice: "연습문제",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  published: "게시됨",
  archived: "보관",
};

/** 정렬 키 화이트리스트 — 사용자 입력이 ORDER BY에 닿지 않는다 */
const SORT_COLUMN: Record<string, string> = {
  concept: "concept_name",
  kind: "kind",
  title: "title",
  status: "status",
  sort_order: "sort_order",
  updated: "updated_at",
};

interface MaterialRow {
  id: string;
  concept_name: string;
  kind: string;
  title: string;
  status: string;
  sort_order: number;
  video_seconds: number | null;
  updated_at: Date;
  total_count: number;
}

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span
      className={`rounded-[var(--radius-control)] border px-1.5 py-0.5 font-mono text-[11px] ${tone}`}
    >
      {children}
    </span>
  );
}

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("materials");
  const sql = getSharedSql();
  const raw = await searchParams;

  const query = parseTableQuery(raw, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "updated",
    defaultDir: "desc",
    filterKeys: ["kind", "status"],
  });
  const kindFilter = query.params.kind ?? "";
  const statusFilter = query.params.status ?? "";
  const conceptQuery = typeof raw.cq === "string" ? raw.cq.trim() : "";

  const [rows, concepts] = await Promise.all([
    sql<MaterialRow[]>`
      with base as (
        select m.id::text, c.name as concept_name, m.kind::text as kind,
               m.title, m.status::text as status, m.sort_order,
               m.video_seconds, m.updated_at
        from learning_materials m
        join canonical_concepts c on c.id = m.concept_id
        where m.organization_id = ${user.organizationId}
          -- enum은 양쪽 ::text로 — 빈 문자열이 enum 캐스팅을 만나면 500이 난다
          and (${kindFilter}::text = '' or m.kind::text = ${kindFilter})
          and (${statusFilter}::text = '' or m.status::text = ${statusFilter})
          and (${query.q}::text = '' or m.title ilike ${"%" + query.q + "%"}
               or c.name ilike ${"%" + query.q + "%"})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "updated_at")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               id asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    /* 개념 선택지 — 검색으로 좁힌다. 개념이 수천 개가 되어도 목록을 통째로
     * 싣지 않기 위한 것 (문제집·자료 대량 반입 계획 대비). */
    conceptQuery
      ? sql<{ id: string; name: string }[]>`
          select id::text, name from canonical_concepts
          where status in ('reviewed', 'active')
            and (name ilike ${"%" + conceptQuery + "%"}
                 or slug ilike ${"%" + conceptQuery + "%"})
          order by name limit 50
        `
      : sql<{ id: string; name: string }[]>`
          select id::text, name from canonical_concepts
          where status in ('reviewed', 'active')
          order by updated_at desc limit 20
        `,
  ]);

  const canAuthor = canWrite(DEFAULT_MATRIX, user.role, "materials");
  const total = rows[0]?.total_count ?? 0;

  const columns: Column<MaterialRow>[] = [
    {
      key: "concept",
      label: "개념",
      sortable: true,
      render: (r) => r.concept_name,
    },
    {
      key: "kind",
      label: "종류",
      sortable: true,
      render: (r) => (
        <Badge tone="border-rule bg-paper">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
      ),
    },
    { key: "title", label: "제목", sortable: true, render: (r) => r.title },
    {
      key: "length",
      label: "길이",
      mono: true,
      secondary: true,
      render: (r) =>
        r.video_seconds
          ? `${Math.floor(r.video_seconds / 60)}분 ${r.video_seconds % 60}초`
          : "—",
    },
    {
      key: "sort_order",
      label: "순서",
      sortable: true,
      mono: true,
      secondary: true,
      render: (r) => String(r.sort_order),
    },
    {
      key: "status",
      label: "상태",
      sortable: true,
      render: (r) => (
        <Badge
          tone={
            r.status === "published"
              ? "border-pen bg-pen-soft/50 text-pen"
              : r.status === "archived"
                ? "border-rule bg-paper text-ink-soft"
                : "border-highlight bg-highlight-soft"
          }
        >
          {STATUS_LABEL[r.status] ?? r.status}
        </Badge>
      ),
    },
    {
      key: "updated",
      label: "수정",
      sortable: true,
      mono: true,
      secondary: true,
      render: (r) => formatDate(r.updated_at, user.timezone),
    },
    ...(canAuthor
      ? [
          {
            key: "actions",
            label: "",
            render: (r: MaterialRow) => (
              <span className="flex flex-wrap gap-1">
                {r.status !== "published" && (
                  <MaterialStatusButton
                    materialId={r.id}
                    status="published"
                    label="게시"
                    primary
                  />
                )}
                {r.status === "published" && (
                  <MaterialStatusButton
                    materialId={r.id}
                    status="draft"
                    label="게시 취소"
                  />
                )}
                {r.status !== "archived" && (
                  <MaterialStatusButton
                    materialId={r.id}
                    status="archived"
                    label="보관"
                  />
                )}
              </span>
            ),
          } as Column<MaterialRow>,
        ]
      : []),
  ];

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold">학습 자료</h1>
      <p className="mt-1 text-sm text-ink-soft">
        개념에 붙는 공부 자료입니다. 학생의 「오늘 학습」에서 개념 공부·개념
        인강·연습문제 단계로 나타납니다. 게시된 것만 학생에게 보입니다.
      </p>

      {canAuthor && (
        <CreateMaterialForm concepts={concepts} conceptQuery={conceptQuery} />
      )}

      <TableFilters
        basePath="/app/content/materials"
        query={query}
        search={{ label: "검색", placeholder: "제목 또는 개념" }}
        selects={[
          {
            name: "kind",
            label: "종류",
            options: [
              { value: "reading", label: "개념 공부" },
              { value: "video", label: "개념 인강" },
              { value: "practice", label: "연습문제" },
            ],
          },
          {
            name: "status",
            label: "상태",
            options: [
              { value: "draft", label: "초안" },
              { value: "published", label: "게시됨" },
              { value: "archived", label: "보관" },
            ],
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        total={total}
        query={query}
        basePath="/app/content/materials"
        caption="학습 자료 — 개념별 공부 자료·인강·연습문제"
        empty={
          <>
            <p className="font-medium">등록된 학습 자료가 없습니다.</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              {canAuthor
                ? "위에서 개념을 고르고 자료를 만드세요. 만들면 초안이고, 게시해야 학생에게 보입니다."
                : "자료 등록은 쓰기 권한이 있는 구성원만 할 수 있습니다."}
            </p>
          </>
        }
      />
    </div>
  );
}
