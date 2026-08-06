import { contentOrganizationIds } from "@su-maek/db";
import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDate } from "@/lib/format";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";
import { CreateMaterialForm, MaterialStatusButton } from "./MaterialForms";
import { KIND_LABEL, STATUS_LABEL, type ConceptOption } from "./shared";

export const metadata: Metadata = { title: "학습 자료" };

/* 학습 자료 저작 (개념 공부 · 인강 · 연습문제).
 *
 * 학생 화면은 오래전부터 이 데이터를 읽고 있었는데 넣는 문이 없었다.
 *
 * 상세 라우트를 뒤늦게 열었다. 처음에는 「행 안 액션으로 끝낸다」였는데,
 * 그 결정이 곧 **고칠 수 없다**는 뜻이었다 — 제목 오탈자 하나를 고치려고
 * 보관 후 재생성을 하면 새 material_id가 생기고 학생 진도가 옛 id에 남아
 * 사라진다. 게다가 연습문제 문항 고르기는 행 안에 넣을 수 있는 크기가
 * 아니다. 그래서 목록은 그대로 두고 상세를 붙였다. */

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
  /** 공용(플랫폼) 자료인가 — 우리 것이 아니면 읽기 전용이다 */
  is_shared: boolean;
  concept_name: string;
  kind: string;
  title: string;
  status: string;
  sort_order: number;
  video_seconds: number | null;
  curated_count: number;
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

  /* 「이 개념으로 연습문제를 만들면 낼 문항이 있는가」 — 학생 화면의
   * listPracticeQuestions 자동 선정 조건과 같은 기준으로 센다
   * (검수 완료 + 사용 권한 유효 + 그 개념에 연결). 기준이 갈리면 화면이
   * "있다"고 말한 뒤 학생 쪽에서 "없다"가 뜬다. */
  const usableCount = sql`(
    select count(*)::int from questions q
    join content_rights r on r.id = q.content_right_id and r.status = 'usable'
    join question_alignments a on a.question_id = q.id and a.concept_id = c.id
      and a.provenance <> 'ai_suggested'
    where q.organization_id = any(${contentOrganizationIds(user.organizationId)}::uuid[])
      and q.review_status = 'published'
  ) as usable_questions`;

  const [rows, concepts] = await Promise.all([
    sql<MaterialRow[]>`
      with base as (
        select m.id::text,
               (m.organization_id <> ${user.organizationId}) as is_shared,
               c.name as concept_name, m.kind::text as kind,
               m.title, m.status::text as status, m.sort_order,
               m.video_seconds,
               jsonb_array_length(m.question_ids) as curated_count,
               m.updated_at
        from learning_materials m
        join canonical_concepts c on c.id = m.concept_id
        /* 공용 자료도 함께 본다 (ADR-0020). 이전에는 자기 조직만 봤는데,
         * 콘텐츠가 플랫폼으로 간 뒤에는 그러면 목록이 통째로 빈다.
         * 우리 것인지 공용인지는 is_shared가 말한다. */
        where m.organization_id = any(${contentOrganizationIds(user.organizationId)}::uuid[])
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
     * 싣지 않기 위한 것 (문제집·자료 대량 반입 계획 대비).
     *
     * 개념마다 **낼 수 있는 문항 수**를 같이 센다. 연습문제 자료를 만들 때
     * 그 개념에 검수 완료 문항이 0개면 학생 화면에 「낼 수 있는 문항이
     * 없습니다」가 뜨는데, 지금까지 교사는 그 사실을 학생이 열어 본 뒤에야
     * 알 수 있었다. 만들기 전에 말한다. */
    conceptQuery
      ? sql<ConceptOption[]>`
          select c.id::text, c.name, ${usableCount}
          from canonical_concepts c
          where c.status in ('reviewed', 'active')
            and (c.name ilike ${"%" + conceptQuery + "%"}
                 or c.slug ilike ${"%" + conceptQuery + "%"})
          order by c.name limit 50
        `
      : sql<ConceptOption[]>`
          select c.id::text, c.name, ${usableCount}
          from canonical_concepts c
          where c.status in ('reviewed', 'active')
          order by c.updated_at desc limit 20
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
    {
      key: "title",
      label: "제목",
      sortable: true,
      /* 공용 자료는 **고칠 수 없다**(ADR-0020 갈래 C — 플랫폼이 쓰고 학원은
       * 읽는다). 표시가 없으면 교사가 눌러 들어가 고치려다 「찾을 수
       * 없습니다」를 만난다 — 제품이 고장 난 것처럼 보이는 자리다.
       * 같은 개념·같은 종류로 우리 자료를 만들면 이 줄이 가려진다. */
      render: (r) =>
        r.is_shared ? (
          <span className="inline-flex items-center gap-1.5">
            {r.title}
            <Badge tone="border-rule bg-paper text-ink-soft">공용</Badge>
          </span>
        ) : (
          r.title
        ),
    },
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
      /* 연습문제가 「어떤 문항을 내는가」 — 지정인지 자동인지가 목록에서
       * 보여야 한다. 자동은 그 개념의 검수 완료 문항에서 그때그때 고르므로
       * 교사가 본 적 없는 문항이 나갈 수 있다. */
      key: "questions",
      label: "문항",
      mono: true,
      secondary: true,
      render: (r) =>
        r.kind !== "practice"
          ? "—"
          : r.curated_count > 0
            ? `지정 ${r.curated_count}`
            : "자동",
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
      render: (r) => formatDate(r.updated_at),
    },
    ...(canAuthor
      ? [
          {
            key: "actions",
            label: "",
            /* 공용 자료에는 버튼을 두지 않는다 — 게시·보관은 우리 조직
             * 자료에만 통한다(액션이 organization_id로 좁힌다). 두면 눌리는데
             * 아무 일도 안 일어나는 버튼이 된다. */
            render: (r: MaterialRow) =>
              r.is_shared ? null : (
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
        rowHref={(r) => `/app/content/materials/${r.id}`}
        total={total}
        query={query}
        basePath="/app/content/materials"
        caption="학습 자료 — 개념별 공부 자료·인강·연습문제"
        empty={
          <>
            <p className="font-medium">등록된 학습 자료가 없습니다.</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              {canAuthor
                ? "위에서 개념을 고르고 자료를 만드세요. 만들면 초안이고, 게시해야 학생에게 보입니다. 만든 뒤에는 행을 눌러 고칠 수 있습니다."
                : "자료 등록은 쓰기 권한이 있는 구성원만 할 수 있습니다."}
            </p>
          </>
        }
      />
    </div>
  );
}
