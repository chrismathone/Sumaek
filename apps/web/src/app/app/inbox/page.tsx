import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import {
  GRADING_EXCEPTION_KIND_LABEL,
  NOTIFICATION_KIND_LABEL,
  PROPOSAL_TRIGGER_LABEL,
  formatDateTime,
  label,
} from "@/lib/format";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";

export const metadata: Metadata = { title: "알림·업무함" };

/* 알림·업무함 (22장) — 알림은 "무슨 일이·왜·영향 대상·권장 행동·기한"을
 * 담는다. 알림 저장이 비어 있어도, 실제로 처리해야 할 미해결 채점 예외와
 * 승인 대기 일정 변경안은 원본 테이블에서 직접 읽어 함께 보여준다.
 * (알림 파이프라인 장애 시에도 업무함은 유지되어야 한다.)
 *
 * 세 출처를 한 표로 합치고 구분 필터로 나눠 본다 — 기한 순으로 한 줄씩
 * 보는 것이 "오늘 무엇을 처리해야 하는가"에 가장 가깝기 때문이다. */

const SOURCE_LABEL: Record<string, string> = {
  notification: "알림",
  grading_exception: "채점 예외",
  schedule_proposal: "일정 변경안",
};

const STATUS_LABEL: Record<string, string> = {
  unread: "안 읽음",
  read: "읽음",
  in_progress: "처리 중",
  done: "완료",
  snoozed: "미룸",
  open: "미해결",
  assigned: "배정됨",
  reviewing: "검토 중",
  escalated: "상급 이관",
  proposed: "승인 대기",
};

const BODY_FIELDS: Array<{ key: string; label: string }> = [
  { key: "what", label: "무슨 일" },
  { key: "why", label: "이유" },
  { key: "impact", label: "영향 대상" },
  { key: "action", label: "권장 행동" },
  { key: "deadline", label: "기한" },
];

/** 정렬 키 → base CTE의 출력 별칭 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다) */
const SORT_COLUMN: Record<string, string> = {
  source: "source",
  title: "title",
  status: "status",
  due_at: "due_at",
  created_at: "created_at",
};

interface InboxRow {
  id: string;
  /** notification | grading_exception | schedule_proposal */
  source: string;
  title: string;
  kind: string;
  status: string;
  body: unknown;
  link_path: string | null;
  due_at: Date | null;
  created_at: Date;
  /** 일정 변경안의 엔진 버전 */
  extra: string | null;
  total_count: number;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("inbox");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "due_at",
    filterKeys: ["source"],
  });
  const sourceFilter = query.params.source ?? "";
  const like = `%${query.q}%`;

  const [rows, counts] = await Promise.all([
    sql<InboxRow[]>`
      with src as (
        select n.id::text as id,
               'notification'::text as source,
               n.title::text as title,
               n.kind::text as kind,
               n.status::text as status,
               n.body as body,
               n.link_path::text as link_path,
               n.due_at as due_at,
               n.created_at as created_at,
               null::text as extra
        from notifications n
        where n.organization_id = ${user.organizationId}
          and n.recipient_user_id = ${user.userId}
          and n.status <> 'done'
        union all
        select ge.id::text,
               'grading_exception'::text,
               (l.display_name || ' · ' || a.title)::text,
               ge.kind::text,
               ge.status::text,
               null::jsonb,
               '/app/grading'::text,
               ge.due_at,
               ge.created_at,
               null::text
        from grading_exceptions ge
        join attempts t on t.id = ge.attempt_id
        join learners l on l.id = t.learner_id
        join assessment_instances a on a.id = t.assessment_id
        where ge.organization_id = ${user.organizationId}
          and ge.status <> 'resolved'
        union all
        select p.id::text,
               'schedule_proposal'::text,
               coalesce(
                 g.name,
                 l.display_name,
                 case when p.scope_type = 'learner' then '학습자' else '반' end
               )::text,
               p.trigger_type::text,
               p.status::text,
               null::jsonb,
               '/app/calendar'::text,
               null::timestamptz,
               p.created_at,
               p.engine_version::text
        from schedule_change_proposals p
        left join learning_groups g
          on p.scope_type = 'learning_group'
         and g.id = p.scope_id
         and g.organization_id = ${user.organizationId}
        left join learners l
          on p.scope_type = 'learner'
         and l.id = p.scope_id
         and l.organization_id = ${user.organizationId}
        where p.organization_id = ${user.organizationId}
          and p.status = 'proposed'
      ),
      base as (
        select * from src
        where (${sourceFilter}::text = '' or src.source::text = ${sourceFilter})
          and (${query.q}::text = '' or src.title ilike ${like})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "due_at")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               id asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    sql<
      {
        notification_count: number;
        exception_count: number;
        proposal_count: number;
      }[]
    >`
      select
        (select count(*)::int from notifications
          where organization_id = ${user.organizationId}
            and recipient_user_id = ${user.userId}
            and status <> 'done') as notification_count,
        (select count(*)::int from grading_exceptions
          where organization_id = ${user.organizationId}
            and status <> 'resolved') as exception_count,
        (select count(*)::int from schedule_change_proposals
          where organization_id = ${user.organizationId}
            and status = 'proposed') as proposal_count
    `,
  ]);

  const total = rows[0]?.total_count ?? 0;
  const notificationCount = counts[0]?.notification_count ?? 0;
  const taskCount =
    (counts[0]?.exception_count ?? 0) + (counts[0]?.proposal_count ?? 0);
  const filtered = Boolean(query.q || query.params.source);

  const columns: Column<InboxRow>[] = [
    {
      key: "source",
      label: "구분",
      sortable: true,
      render: (r) => (
        <span
          className={`inline-block whitespace-nowrap rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-xs ${
            r.source === "schedule_proposal"
              ? "border-highlight bg-highlight-soft text-ink"
              : r.source === "grading_exception"
                ? "border-pen bg-pen-soft text-pen"
                : "border-rule bg-surface text-ink-soft"
          }`}
        >
          {SOURCE_LABEL[r.source] ?? r.source}
        </span>
      ),
    },
    {
      key: "title",
      label: "내용",
      sortable: true,
      render: (r) => {
        const lines = r.source === "notification" ? bodyLines(r.body) : [];
        return (
          <div className="max-w-[26rem]">
            <p className="font-medium">{r.title}</p>
            {r.source === "grading_exception" && (
              <p className="mt-0.5 text-xs text-ink-soft">
                자동 채점이 확정하지 않은 답안이므로 사람이 판정해야
                점수·숙련도·복습이 갱신됩니다.
              </p>
            )}
            {r.source === "schedule_proposal" && (
              <p className="mt-0.5 text-xs text-ink-soft">
                승인 전에는 일정이 바뀌지 않으며, 완료된 과거와 잠긴 수업은 변경
                대상이 아닙니다.
                {r.extra ? ` 엔진 ${r.extra}` : ""}
              </p>
            )}
            {lines.length > 0 && (
              <dl className="mt-1 space-y-0.5 text-xs">
                {lines.map((line) => (
                  <div key={line.label} className="flex gap-2">
                    <dt className="shrink-0 text-ink-soft">{line.label}</dt>
                    <dd>{line.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      },
    },
    {
      key: "kind",
      label: "종류",
      secondary: true,
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-ink-soft">
          {kindLabel(r)}
        </span>
      ),
    },
    {
      key: "status",
      label: "상태",
      sortable: true,
      secondary: true,
      render: (r) => (
        <span
          className={`whitespace-nowrap font-mono text-xs ${
            r.status === "unread" || r.status === "open"
              ? "text-pen"
              : "text-ink-soft"
          }`}
        >
          {STATUS_LABEL[r.status] ?? r.status}
        </span>
      ),
    },
    {
      key: "due_at",
      label: "기한",
      sortable: true,
      mono: true,
      render: (r) => (r.due_at ? formatDateTime(r.due_at, user.timezone) : "—"),
    },
    {
      key: "created_at",
      label: "접수",
      sortable: true,
      mono: true,
      secondary: true,
      render: (r) => formatDateTime(r.created_at, user.timezone),
    },
    {
      key: "link",
      label: "이동",
      render: (r) => {
        if (!r.link_path) return <span className="text-ink-soft">—</span>;
        const text =
          r.source === "grading_exception"
            ? "판정하기"
            : r.source === "schedule_proposal"
              ? "캘린더에서 확인"
              : "바로 가기";
        return (
          <Link
            href={r.link_path}
            className={`inline-block whitespace-nowrap rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-medium ${
              r.source === "grading_exception"
                ? "bg-pen text-white"
                : "border border-pen text-pen"
            }`}
          >
            {text}
          </Link>
        );
      },
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">알림·업무함</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {user.displayName}님에게 온 알림 {notificationCount}건 · 오늘 처리할 일{" "}
        {taskCount}건
      </p>

      <TableFilters
        basePath="/app/inbox"
        query={query}
        search={{ label: "검색", placeholder: "제목·학생·반 이름" }}
        selects={[
          {
            name: "source",
            label: "구분",
            options: Object.entries(SOURCE_LABEL).map(([value, text]) => ({
              value,
              label: text,
            })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.source}:${r.id}`}
        total={total}
        query={query}
        basePath="/app/inbox"
        empty={
          filtered ? (
            <>
              <p className="font-medium">조건에 맞는 항목이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                검색어나 구분 필터를 바꿔보세요.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">받은 알림이 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                미해결 채점 예외와 승인 대기 일정 변경안이 없습니다.
              </p>
              <p className="mt-1.5 text-sm text-ink-soft">
                테스트 생성 실패, 일정 충돌, 콘텐츠 검수 요청처럼 사람이 결정해야
                하는 일이 생기면 여기로 옵니다.
              </p>
            </>
          )
        }
      />
    </div>
  );
}

/** 출처마다 다른 라벨 사전을 쓴다 — 없는 값은 원본을 그대로 보여준다 */
function kindLabel(row: InboxRow): string {
  if (row.source === "grading_exception") {
    return label(GRADING_EXCEPTION_KIND_LABEL, row.kind);
  }
  if (row.source === "schedule_proposal") {
    return label(PROPOSAL_TRIGGER_LABEL, row.kind);
  }
  return label(NOTIFICATION_KIND_LABEL, row.kind);
}

/** 알림 body(jsonb)의 알려진 필드만 표시한다 — 없는 항목을 지어내지 않는다 */
function bodyLines(body: unknown): Array<{ label: string; value: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const record = body as Record<string, unknown>;
  const lines: Array<{ label: string; value: string }> = [];
  for (const field of BODY_FIELDS) {
    const value = record[field.key];
    if (typeof value === "string" && value.trim() !== "") {
      lines.push({ label: field.label, value });
    } else if (typeof value === "number") {
      lines.push({ label: field.label, value: String(value) });
    }
  }
  return lines;
}
