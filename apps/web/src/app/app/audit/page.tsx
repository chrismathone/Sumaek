import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDateTime, label } from "@/lib/format";
import {
  DENSE_PAGE_SIZE,
  parseTableQuery,
  type RawSearchParams,
} from "@/lib/table";

export const metadata: Metadata = { title: "감사 로그" };

/* 감사 로그 (23장) — 읽기 전용. 누가·언제·무엇을·왜 했는지만 보여준다.
 * 이 화면에서 로그를 고치거나 지울 수 있는 경로는 없다 (RLS로도 차단).
 *
 * 표 규약: "최근 100건" 고정 대신 전체를 쪽으로 나눠 본다 — 감사에서
 * 잘려나간 기록은 없는 기록과 같다. 정렬·필터는 전부 URL 파라미터라
 * 조사하던 화면을 그대로 공유·재현할 수 있다.
 *
 * 감사 이벤트는 상세 화면이 없다 (행 자체가 전체 내용이므로 rowHref 없음). */

const ACTOR_TYPE_LABEL: Record<string, string> = {
  user: "사용자",
  system: "시스템",
  automation: "자동화",
  operator: "운영자(승인 접근)",
};

const ACTION_LABEL: Record<string, string> = {
  "assessment.generate-publish": "테스트 생성·게시",
  "grading.resolve-exception": "채점 예외 판정",
  "schedule.materialize": "일정 생성",
  "schedule.apply-proposal": "일정 변경안 적용",
  "route.publish": "루트 게시",
  "curriculum.release-publish": "교육과정 릴리스 게시",
};

const TARGET_TYPE_LABEL: Record<string, string> = {
  assessment: "평가",
  response: "답안",
  attempt: "응시",
  learning_group: "반",
  learner: "학습자",
  session: "수업",
  route_version: "루트 버전",
  curriculum_release: "교육과정 릴리스",
  question: "문항",
  membership: "멤버십",
};

/** 정렬 키 → 실제 정렬 대상 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다).
 *  값은 모두 base CTE의 출력 별칭이다. */
const SORT_COLUMN: Record<string, string> = {
  created_at: "created_at",
  actor_type: "actor_type",
  action: "action",
  target_type: "target_type",
};

interface AuditRow {
  id: string;
  created_at: Date;
  actor_type: string;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  rule_version: string | null;
  total_count: number;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("audit");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "created_at",
    defaultDir: "desc",
    filterKeys: ["actor", "act"],
    pageSize: DENSE_PAGE_SIZE,
  });
  const actorFilter = query.params.actor ?? "";
  const actionFilter = query.params.act ?? "";

  const [events, actionRows] = await Promise.all([
    sql<AuditRow[]>`
      with base as (
        select e.id, e.created_at, e.actor_type::text as actor_type, e.action,
               e.target_type, e.target_id, e.reason, e.rule_version,
               u.display_name as actor_name
        from audit_events e
        left join users u on u.id = e.actor_id
        where e.organization_id = ${user.organizationId}
          and (${query.q}::text = '' or e.action ilike ${`%${query.q}%`}
               or e.target_type ilike ${`%${query.q}%`}
               or coalesce(e.reason, '') ilike ${`%${query.q}%`}
               or coalesce(u.display_name, '') ilike ${`%${query.q}%`})
          and (${actorFilter}::text = '' or e.actor_type::text = ${actorFilter})
          and (${actionFilter}::text = '' or e.action::text = ${actionFilter})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "created_at")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               id asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    /* 필터 선택지는 실제로 기록된 작업만 — action은 자유 문자열이라
     * 라벨 표에 없는 작업도 남을 수 있다 (임의로 감추지 않는다). */
    sql<{ action: string }[]>`
      select distinct e.action
      from audit_events e
      where e.organization_id = ${user.organizationId}
      order by e.action asc
      limit 60
    `,
  ]);

  const total = events[0]?.total_count ?? 0;
  const filtered = query.q !== "" || actorFilter !== "" || actionFilter !== "";

  const columns: Column<AuditRow>[] = [
    {
      key: "created_at",
      label: "시각",
      sortable: true,
      mono: true,
      className: "whitespace-nowrap",
      render: (e) => (
        <span className="text-ink-soft">
          {formatDateTime(e.created_at, user.timezone)}
        </span>
      ),
    },
    {
      key: "actor_type",
      label: "수행자",
      sortable: true,
      render: (e) =>
        e.actor_type === "user" ? (
          <span>{e.actor_name ?? "삭제된 사용자"}</span>
        ) : (
          <span className="text-ink-soft">
            {label(ACTOR_TYPE_LABEL, e.actor_type)}
            {e.rule_version && (
              <span className="ml-1 font-mono text-xs">({e.rule_version})</span>
            )}
          </span>
        ),
    },
    {
      key: "action",
      label: "작업",
      sortable: true,
      render: (e) => (
        <>
          <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
          {ACTION_LABEL[e.action] && (
            <span className="ml-2 font-mono text-[11px] text-ink-soft">
              {e.action}
            </span>
          )}
        </>
      ),
    },
    {
      key: "target_type",
      label: "대상",
      sortable: true,
      mono: true,
      secondary: true,
      render: (e) => (
        <span className="text-ink-soft">
          {label(TARGET_TYPE_LABEL, e.target_type)}
          {e.target_id && <span className="ml-1">{e.target_id.slice(0, 8)}</span>}
        </span>
      ),
    },
    {
      key: "reason",
      label: "사유",
      secondary: true,
      className: "max-w-[18rem]",
      render: (e) => (
        <span className="block truncate text-ink-soft" title={e.reason ?? ""}>
          {e.reason ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-[MaruBuri] text-2xl font-semibold">감사 로그</h1>
        <p className="font-mono text-xs text-ink-soft">
          {filtered ? "조건에 맞는 기록 " : "전체 "}
          {total.toLocaleString("ko-KR")}건
        </p>
      </div>
      <p className="mt-1.5 text-sm text-ink-soft">
        감사 기록은 읽기 전용이며 앱에서 수정·삭제할 수 없습니다. 자동화가 수행한
        변경에는 적용된 규칙 버전이 함께 남습니다.
      </p>

      <TableFilters
        basePath="/app/audit"
        query={query}
        search={{ label: "검색", placeholder: "작업·대상·사유·수행자" }}
        selects={[
          {
            name: "actor",
            label: "수행자",
            options: Object.entries(ACTOR_TYPE_LABEL).map(([value, text]) => ({
              value,
              label: text,
            })),
          },
          {
            name: "act",
            label: "작업",
            options: actionRows.map((a) => ({
              value: a.action,
              label: ACTION_LABEL[a.action] ?? a.action,
            })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={events}
        rowKey={(e) => e.id}
        total={total}
        query={query}
        basePath="/app/audit"
        empty={
          filtered ? (
            <>
              <p className="font-medium">조건에 맞는 감사 이벤트가 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                검색어나 수행자·작업 필터를 바꿔보세요.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">아직 기록된 감사 이벤트가 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                테스트 게시, 채점 판정, 일정 생성처럼 결과를 바꾸는 작업이
                일어나면 여기에 남습니다.
              </p>
            </>
          )
        }
      />
    </div>
  );
}
