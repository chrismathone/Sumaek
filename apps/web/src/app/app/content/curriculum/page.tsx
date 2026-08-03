import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import {
  DENSE_PAGE_SIZE,
  parseTableQuery,
  type RawSearchParams,
  type TableQuery,
} from "@/lib/table";

export const metadata: Metadata = { title: "커리큘럼 스튜디오" };

/* 커리큘럼 스튜디오 축소판 (14장).
 *
 * canonical_concepts·concept_edges는 워크스페이스 소유가 아니라 플랫폼 공유
 * 참조 데이터다 (ADR-0011) — organization_id 필터가 없다. 반면 "연결 문항 수"는
 * 워크스페이스의 문항이므로 org로 좁힌다.
 *
 * 2K 규칙 3: 내부 개념 체계를 공식 성취기준처럼 표시하지 않는다.
 *
 * 표 규약: URL 파라미터(page·sort·dir·q)는 한 벌뿐이라 한 화면에서 정렬·쪽넘김을
 * 가질 수 있는 표는 하나다. 여기서는 행이 훨씬 많은 "내부 개념" 표가 그 자리를
 * 갖고, "선수 관계"는 전체를 한 번에 보여준다(개념 그래프는 통째로 읽어야
 * 순서 검증이 되므로 원래 화면도 전량을 나열했다). */

const CONCEPT_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  reviewed: "검토 완료",
  active: "활성",
  deprecated: "폐기",
};

const SCHOOL_LEVEL_LABEL: Record<string, string> = {
  elementary: "초등",
  middle: "중등",
  high: "고등",
};

/** 정렬 키 → 실제 정렬 대상 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다).
 *  값은 모두 base CTE의 출력 별칭이다. */
const SORT_COLUMN: Record<string, string> = {
  name: "name",
  slug: "slug",
  school_level: "school_level",
  grade_band: "grade_band",
  domain_name: "domain_name",
  status: "status",
  evidence_count: "evidence_count",
  question_count: "question_count",
};

interface ConceptRow {
  id: string;
  name: string;
  slug: string;
  school_level: string | null;
  grade_band: string | null;
  domain_name: string | null;
  status: string;
  evidence_count: number;
  question_count: number;
  total_count: number;
}

interface EdgeRow {
  id: string;
  from_name: string;
  to_name: string;
  provenance: string;
  status: string;
  confidence: string | null;
  rationale: string | null;
  required_depth: string | null;
  can_teach_concurrently: boolean | null;
  reviewed_at: Date | null;
  total_count: number;
}

interface StandardRow {
  id: string;
  code: string;
  statement: string;
  domain_name: string;
  release_status: string;
  review_status: string;
  original_url: string | null;
  file_checksum: string | null;
  mapped_concepts: number;
}

const RELEASE_STATUS_LABEL: Record<string, string> = {
  imported: "가져옴",
  parsed: "구조화됨 (발행 전)",
  mapped: "매핑됨",
  expert_review: "전문가 검토",
  validated: "검증됨",
  published: "발행됨",
  superseded: "대체됨",
};

export default async function CurriculumStudioPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("curriculum_studio");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "name",
    filterKeys: ["level", "status"],
    pageSize: DENSE_PAGE_SIZE,
  });
  const levelFilter = query.params.level ?? "";
  const statusFilter = query.params.status ?? "";

  const [concepts, edges, authority, standards] = await Promise.all([
    sql<ConceptRow[]>`
      with base as (
        select c.id, c.name, c.slug, c.school_level, c.grade_band, c.domain_name,
               c.status,
               case when jsonb_typeof(c.evidence) = 'array'
                    then jsonb_array_length(c.evidence) else 0 end as evidence_count,
               (select count(*)::int from question_alignments qa
                 where qa.concept_id = c.id
                   and qa.organization_id = ${user.organizationId}) as question_count
        from canonical_concepts c
        where (${query.q}::text = '' or c.name ilike ${`%${query.q}%`}
               or c.slug ilike ${`%${query.q}%`}
               or coalesce(c.domain_name, '') ilike ${`%${query.q}%`})
          and (${levelFilter}::text = '' or c.school_level::text = ${levelFilter})
          and (${statusFilter}::text = '' or c.status::text = ${statusFilter})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "name")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               slug asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    sql<EdgeRow[]>`
      with base as (
        select e.id, f.name as from_name, t.name as to_name,
               e.provenance::text as provenance, e.status::text as status,
               e.confidence::text as confidence, e.rationale, e.required_depth,
               e.can_teach_concurrently, e.reviewed_at
        from concept_edges e
        join canonical_concepts f on f.id = e.from_concept_id
        join canonical_concepts t on t.id = e.to_concept_id
        where e.kind = 'prerequisite'
      )
      select *, count(*) over ()::int as total_count
      from base
      order by to_name asc nulls last, from_name asc
    `,
    sql<{ cnt: number; verified: number }[]>`
      select count(*)::int as cnt,
             count(*) filter (where review_status = 'verified')::int as verified
      from curriculum_authority_sources
    `,
    sql<StandardRow[]>`
      select s.id, s.code, s.statement,
             n.official_name as domain_name,
             r.status::text as release_status,
             src.review_status::text as review_status,
             src.original_url, src.file_checksum,
             (select count(*)::int from curriculum_mappings m
               where m.official_type = 'achievement_standard'
                 and m.official_id = s.id and m.status = 'active') as mapped_concepts
      from achievement_standards s
      join official_curriculum_nodes n on n.id = s.official_node_id
      join curriculum_releases r on r.id = s.release_id
      left join curriculum_authority_sources src on src.id = s.source_id
      order by s.code
    `,
  ]);

  const conceptTotal = concepts[0]?.total_count ?? 0;
  const edgeTotal = edges[0]?.total_count ?? 0;
  const sourceCount = authority[0]?.cnt ?? 0;
  const verifiedCount = authority[0]?.verified ?? 0;
  const unapproved = edges.filter(
    (e) => e.provenance === "ai_suggested" && e.reviewed_at === null,
  ).length;
  const conceptFiltered = query.q !== "" || levelFilter !== "" || statusFilter !== "";

  /* 선수 관계는 쪽넘김 없이 전량을 싣는다 — 한 쪽에 전부 들어가는 질의 결과라
   * 페이지 링크가 생기지 않고, 정렬 가능한 열도 두지 않아 URL 파라미터를
   * 개념 표와 다투지 않는다. */
  const edgeQuery: TableQuery = {
    page: 1,
    pageSize: Math.max(edgeTotal, 1),
    offset: 0,
    sort: "",
    dir: "asc",
    q: "",
    params: {},
    // 링크를 만들지 않으므로 접두사가 필요 없다 (이름을 다툴 파라미터 자체가 없다)
    prefix: "",
  };

  const conceptColumns: Column<ConceptRow>[] = [
    {
      key: "name",
      label: "개념",
      sortable: true,
      render: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: "slug",
      label: "slug",
      sortable: true,
      mono: true,
      secondary: true,
      render: (c) => <span className="text-ink-soft">{c.slug}</span>,
    },
    {
      key: "school_level",
      label: "학교급",
      sortable: true,
      render: (c) =>
        c.school_level
          ? (SCHOOL_LEVEL_LABEL[c.school_level] ?? c.school_level)
          : "—",
    },
    {
      key: "grade_band",
      label: "학년군",
      sortable: true,
      mono: true,
      render: (c) => c.grade_band ?? "—",
    },
    {
      key: "domain_name",
      label: "영역",
      sortable: true,
      secondary: true,
      render: (c) => <span className="text-ink-soft">{c.domain_name ?? "—"}</span>,
    },
    {
      key: "status",
      label: "상태",
      sortable: true,
      render: (c) => (
        <Badge
          label={CONCEPT_STATUS_LABEL[c.status] ?? c.status}
          tone={
            c.status === "active"
              ? "ok"
              : c.status === "deprecated"
                ? "bad"
                : "warn"
          }
        />
      ),
    },
    {
      key: "evidence_count",
      label: "근거",
      sortable: true,
      align: "right",
      mono: true,
      render: (c) =>
        c.evidence_count === 0 ? (
          <span className="text-grade">0</span>
        ) : (
          c.evidence_count
        ),
    },
    {
      key: "question_count",
      label: "연결 문항",
      sortable: true,
      align: "right",
      mono: true,
      render: (c) => c.question_count,
    },
  ];

  const edgeColumns: Column<EdgeRow>[] = [
    {
      key: "from_name",
      label: "선수 개념",
      render: (e) => <span className="font-medium">{e.from_name}</span>,
    },
    {
      key: "to_name",
      label: "목표 개념",
      render: (e) => (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="font-mono text-ink-soft">
            →
          </span>
          <span className="font-medium">{e.to_name}</span>
        </span>
      ),
    },
    {
      key: "provenance",
      label: "출처",
      render: (e) =>
        e.provenance === "ai_suggested" ? (
          <Badge
            label={e.reviewed_at ? "AI 제안 (승인됨)" : "AI 제안 (미승인)"}
            tone={e.reviewed_at ? "muted" : "warn"}
          />
        ) : (
          <Badge
            label={e.provenance === "imported" ? "가져옴" : "사람 작성"}
            tone="muted"
          />
        ),
    },
    {
      key: "status",
      label: "상태",
      render: (e) => (
        <Badge
          label={CONCEPT_STATUS_LABEL[e.status] ?? e.status}
          tone={e.status === "active" ? "ok" : "warn"}
        />
      ),
    },
    {
      key: "confidence",
      label: "신뢰도",
      align: "right",
      mono: true,
      secondary: true,
      render: (e) => (e.confidence ? Number(e.confidence).toFixed(2) : "—"),
    },
    {
      key: "required_depth",
      label: "필요 깊이",
      mono: true,
      secondary: true,
      render: (e) => e.required_depth ?? "—",
    },
    {
      key: "can_teach_concurrently",
      label: "동시 학습",
      secondary: true,
      render: (e) =>
        e.can_teach_concurrently === null
          ? "—"
          : e.can_teach_concurrently
            ? "가능"
            : "불가",
    },
    {
      key: "rationale",
      label: "근거 설명",
      secondary: true,
      className: "max-w-[20rem]",
      render: (e) => (
        <span className="block truncate text-ink-soft" title={e.rationale ?? ""}>
          {e.rationale ?? "근거 설명 없음"}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">커리큘럼 스튜디오</h1>

      {/* 2K 규칙 3 — 공식·내부 구분 고지 */}
      <div className="mt-3 rounded-lg border border-highlight bg-highlight-soft p-4 text-sm">
        <p className="font-medium">
          공식 성취기준(교육부 고시)과 내부 개념 체계를 구분합니다 — 내부 개념
          체계는 공식 성취기준이 아닙니다.
        </p>
        <p className="mt-1.5 text-ink-soft">
          공식 성취기준은 원문 그대로만 싣고 체크섬으로 역추적됩니다. 아래
          개념·선수 관계는 수업 설계와 숙련도 계산에 쓰는 내부 해석입니다.
          등록된 권위 문서 {sourceCount}건 (원문 대조 완료 {verifiedCount}건).
        </p>
      </div>

      {/* 공식 성취기준 — 원문·역추적. 릴리스 상태를 숨기지 않는다 */}
      {standards.length > 0 && (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">
              공식 성취기준 (2022 개정 · 중학교)
            </h2>
            <p className="font-mono text-xs text-ink-soft">
              {standards.length}개 ·{" "}
              {RELEASE_STATUS_LABEL[standards[0]!.release_status] ??
                standards[0]!.release_status}
              {standards[0]!.review_status !== "verified" && " · 원문 대조 전"}
            </p>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-rule-soft text-left text-xs text-ink-soft">
                  <th className="px-4 py-2 font-medium">코드</th>
                  <th className="px-4 py-2 font-medium">공식 문구 (원문)</th>
                  <th className="px-4 py-2 font-medium">영역</th>
                  <th className="px-4 py-2 text-right font-medium">연결 개념</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule-soft">
                {standards.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2 font-mono text-xs">[{s.code}]</td>
                    <td className="px-4 py-2">{s.statement}</td>
                    <td className="px-4 py-2 text-xs text-ink-soft">
                      {s.domain_name}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {s.mapped_concepts > 0 ? (
                        s.mapped_concepts
                      ) : (
                        <span className="text-ink-soft">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            출처: 교육부 고시 제2022-33호 [별책8]
            {standards[0]!.original_url && (
              <>
                {" · "}
                <a
                  href={standards[0]!.original_url}
                  className="text-pen underline underline-offset-2"
                >
                  원문 내려받기
                </a>
              </>
            )}
            {standards[0]!.file_checksum &&
              ` · sha256 ${standards[0]!.file_checksum.slice(0, 12)}…`}
            {" — 연결 개념은 사람 큐레이션 매핑(전역)만 셉니다."}
          </p>
        </section>
      )}

      {/* 개념 목록 */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">내부 개념 (canonical)</h2>
          <p className="font-mono text-xs text-ink-soft">{conceptTotal}개</p>
        </div>

        <TableFilters
          basePath="/app/content/curriculum"
          query={query}
          search={{ label: "검색", placeholder: "개념명·slug·영역" }}
          selects={[
            {
              name: "level",
              label: "학교급",
              options: Object.entries(SCHOOL_LEVEL_LABEL).map(
                ([value, label]) => ({ value, label }),
              ),
            },
            {
              name: "status",
              label: "상태",
              options: Object.entries(CONCEPT_STATUS_LABEL).map(
                ([value, label]) => ({ value, label }),
              ),
            },
          ]}
        />

        <DataTable
          columns={conceptColumns}
          rows={concepts}
          rowKey={(c) => c.id}
          total={conceptTotal}
          query={query}
          basePath="/app/content/curriculum"
          empty={
            conceptFiltered ? (
              <>
                <p className="font-medium">조건에 맞는 개념이 없습니다.</p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  검색어나 학교급·상태 필터를 바꿔보세요.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">등록된 개념이 없습니다.</p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  개념 체계는 플랫폼 공유 참조 데이터입니다. 큐레이터가 등록한 뒤
                  이곳에 표시됩니다.
                </p>
              </>
            )
          }
        />

        <p className="mt-2 text-xs text-ink-soft">
          근거 0건인 개념은 발행 게이트를 통과하지 못합니다 (2L — 최소 1개 근거와
          검토 상태 보유). 연결 문항 수는 이 워크스페이스의 문항만 셉니다.
        </p>
      </section>

      {/* 선수 관계 */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">선수 관계 (prerequisite)</h2>
          <p className="font-mono text-xs text-ink-soft">
            {edgeTotal}개{unapproved > 0 && ` · 미승인 AI 제안 ${unapproved}개`}
          </p>
        </div>

        <DataTable
          columns={edgeColumns}
          rows={edges}
          rowKey={(e) => e.id}
          total={edgeTotal}
          query={edgeQuery}
          basePath="/app/content/curriculum"
          caption="선수 개념 → 목표 개념 순서. 그래프 전체를 한 번에 싣습니다."
          empty={
            <>
              <p className="font-medium">등록된 선수 관계가 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                선수 관계가 없으면 학습 루트의 순서 검증과 약점 추적 경로가
                비어 있게 됩니다.
              </p>
            </>
          }
        />

        {unapproved > 0 && (
          <p className="mt-2 text-xs text-ink-soft">
            미승인 AI 제안 관계는 자동 계획(루트 순서·출제)에 사용되지 않습니다.
            사람이 승인해야 반영됩니다.
          </p>
        )}
      </section>

      <p className="mt-8 text-sm text-ink-soft">
        개념별 문항은{" "}
        <Link href="/app/content/questions" className="text-pen underline">
          문제은행
        </Link>
        에서 확인할 수 있습니다.
      </p>
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
