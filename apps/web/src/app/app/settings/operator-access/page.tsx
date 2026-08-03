import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import {
  DEFAULT_MATRIX,
  MAX_GRANT_HOURS,
  canWrite,
  grantState,
  minutesRemaining,
  type GrantState,
} from "@su-maek/core/authz";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDateTime } from "@/lib/format";
import {
  DENSE_PAGE_SIZE,
  parseTableQuery,
  type RawSearchParams,
} from "@/lib/table";
import { GrantForm, RevokeButton } from "./OperatorAccessForms";

export const metadata: Metadata = { title: "운영자 접근" };

/* ─────────────────────────────────────────────────────────────
 * break-glass 운영자 접근 (27장 · 인수 28) — 소유자 고지 화면.
 *
 * disclosed_to_owner가 존재하는 이유가 이 화면이다: 소유자는 "누가·왜·
 * 언제까지" 접근했는지를 알림함(발급·회수 시점)과 이 목록(전체 이력) 두
 * 경로로 볼 수 있어야 한다. 알림은 지나가고 목록은 남는다.
 *
 * 상태(유효·만료·회수·승인대기)는 SQL이 아니라 core의 grantState가 정한다 —
 * 같은 판정을 SQL where 절에도 적어 두면 두 곳이 어긋나고, 어긋난 쪽이
 * 느슨하면 만료된 승인이 "유효"로 보인다. 그래서 상태 필터도 두지 않는다.
 * ───────────────────────────────────────────────────────────── */

const STATE_LABEL: Record<GrantState, string> = {
  active: "유효",
  expired: "만료됨",
  revoked: "회수됨",
  pending_approval: "승인 대기",
};

/** 정렬 키 화이트리스트 — 값은 base CTE의 출력 별칭이다 */
const SORT_COLUMN: Record<string, string> = {
  created_at: "created_at",
  expires_at: "expires_at",
  operator_name: "operator_name",
};

interface GrantRow {
  id: string;
  operator_user_id: string;
  operator_name: string | null;
  reason: string;
  approver_name: string | null;
  approved_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
  disclosed_to_owner: Date | null;
  created_at: Date;
  recorded_actions: number;
  total_count: number;
}

export default async function OperatorAccessPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("settings");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "created_at",
    defaultDir: "desc",
    pageSize: DENSE_PAGE_SIZE,
  });

  const [rows, nowRows] = await Promise.all([
    sql<GrantRow[]>`
      with base as (
        select g.id, g.operator_user_id, u.display_name as operator_name,
               g.reason, a.display_name as approver_name, g.approved_at,
               g.expires_at, g.revoked_at, g.disclosed_to_owner, g.created_at,
               (select count(*)::int from audit_events e
                 where e.access_grant_id = g.id
                   and e.action = 'ops.break_glass_access') as recorded_actions
        from operator_access_grants g
        left join users u on u.id = g.operator_user_id
        left join users a on a.id = g.approved_by
        where g.organization_id = ${user.organizationId}
          and (${query.q}::text = ''
               or g.reason ilike ${`%${query.q}%`}
               or coalesce(u.display_name, '') ilike ${`%${query.q}%`})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "created_at")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               id asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    /* 판정 시각은 DB 시계 — 화면을 그리는 서버의 시계가 아니다 */
    sql<{ now: Date }[]>`select now() as now`,
  ]);

  const now = nowRows[0]?.now ?? new Date();
  const total = rows[0]?.total_count ?? 0;
  const canApprove = canWrite(DEFAULT_MATRIX, user.role, "settings");
  const activeCount = rows.filter(
    (r) => grantState(toWindow(r), now) === "active",
  ).length;

  const columns: Column<GrantRow>[] = [
    {
      key: "operator_name",
      label: "운영자",
      sortable: true,
      render: (r) => (
        <>
          <span className="font-medium">{r.operator_name ?? "알 수 없는 계정"}</span>
          <span className="ml-2 font-mono text-[11px] text-ink-soft">
            {r.operator_user_id.slice(0, 8)}
          </span>
        </>
      ),
    },
    {
      key: "state",
      label: "상태",
      render: (r) => {
        const state = grantState(toWindow(r), now);
        return (
          <span
            className={`rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-xs ${
              state === "active" ? "border-grade text-grade" : "border-rule text-ink-soft"
            }`}
          >
            {STATE_LABEL[state]}
            {state === "active" &&
              ` · ${minutesRemaining(toWindow(r), now)}분 남음`}
          </span>
        );
      },
    },
    {
      key: "reason",
      label: "사유",
      className: "max-w-[18rem]",
      render: (r) => (
        <span className="block truncate" title={r.reason}>
          {r.reason}
        </span>
      ),
    },
    {
      key: "expires_at",
      label: "만료",
      sortable: true,
      mono: true,
      secondary: true,
      render: (r) => (
        <span className="text-ink-soft">
          {formatDateTime(r.expires_at)}
        </span>
      ),
    },
    {
      key: "approver",
      label: "승인자",
      secondary: true,
      render: (r) => (
        <span className="text-ink-soft">
          {r.approver_name ?? "—"}
          {r.disclosed_to_owner && (
            <span className="ml-1 font-mono text-[11px]">· 고지됨</span>
          )}
        </span>
      ),
    },
    {
      key: "recorded_actions",
      label: "기록된 조회",
      align: "right",
      mono: true,
      secondary: true,
      render: (r) => <span className="text-ink-soft">{r.recorded_actions}건</span>,
    },
    {
      key: "action",
      label: "",
      align: "right",
      render: (r) =>
        canApprove && grantState(toWindow(r), now) === "active" ? (
          <RevokeButton grantId={r.id} />
        ) : null,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-[MaruBuri] text-2xl font-semibold">운영자 접근</h1>
        <p className="font-mono text-xs text-ink-soft">
          현재 유효 {activeCount}건 · 전체 {total.toLocaleString("ko-KR")}건
        </p>
      </div>
      <p className="mt-1.5 text-sm text-ink-soft">
        수맥 운영자가 이 워크스페이스에 접근하려면 사유·승인자·만료 시각이 있는
        승인이 있어야 합니다. 승인은 최대 {MAX_GRANT_HOURS}시간이며 만료되면
        자동으로 닫힙니다. 접근은 읽기 전용이고, 학습자 개인정보 화면
        (학습자·숙련도·채점·리포트)은 승인 중에도 열리지 않습니다. 접근 기간의
        모든 화면 조회는 감사 로그에 남습니다.
      </p>

      {canApprove ? (
        <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
          <h2 className="font-semibold">접근 승인</h2>
          <p className="mt-1 text-sm text-ink-soft">
            승인은 즉시 유효해지고, 소유자에게 알림이 갑니다. 이미 이 워크스페이스의
            구성원인 계정에는 승인할 수 없습니다 — 그건 역할로 처리할 일입니다.
          </p>
          <GrantForm />
        </section>
      ) : (
        <p className="mt-4 rounded-lg border border-rule bg-surface p-4 text-sm text-ink-soft">
          승인·회수는 워크스페이스 소유자만 할 수 있습니다. 이 목록은 읽기 전용입니다.
        </p>
      )}

      <TableFilters
        basePath="/app/settings/operator-access"
        query={query}
        search={{ label: "검색", placeholder: "운영자 이름·사유" }}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        total={total}
        query={query}
        basePath="/app/settings/operator-access"
        caption="운영자 접근 승인 이력"
        empty={
          query.q !== "" ? (
            <>
              <p className="font-medium">조건에 맞는 승인이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">검색어를 바꿔보세요.</p>
            </>
          ) : (
            <>
              <p className="font-medium">운영자 접근 승인이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                승인이 없으면 수맥 운영자는 이 워크스페이스의 어떤 화면도 열 수
                없습니다.
              </p>
            </>
          )
        }
      />

      <p className="mt-4 text-sm text-ink-soft">
        접근 기간의 조회 기록은{" "}
        <Link href="/app/audit?actor=operator" className="text-pen underline underline-offset-4">
          감사 로그
        </Link>
        에서 볼 수 있습니다.
      </p>
    </div>
  );
}

/** 표 행 → 판정 입력. 상태 판정에 필요한 세 시각만 넘긴다 */
function toWindow(row: GrantRow) {
  return {
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}
