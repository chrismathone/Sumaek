import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDateTime } from "@/lib/format";
import { parseTableQuery, type RawSearchParams } from "@/lib/table";
import { ResolveForm } from "./ResolveForm";
import { KST } from "@su-maek/core/shared";

export const metadata: Metadata = { title: "채점·예외" };

const KIND_LABEL: Record<string, string> = {
  low_confidence_ocr: "인식 신뢰도 부족",
  multiple_valid_answers: "복수 정답 가능",
  format_mismatch: "정답 형식 불일치",
  essay_partial: "서술형 부분 점수",
  answer_explanation_conflict: "답안·해설 충돌",
  question_error_suspected: "문항 오류 의심",
  ambiguous_answer: "답안 해석 모호",
};

/** 정렬 키 → base CTE의 출력 별칭 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다) */
const SORT_COLUMN: Record<string, string> = {
  learner_name: "learner_name",
  assessment_title: "assessment_title",
  sort_order: "sort_order",
  kind: "kind",
  created_at: "created_at",
};

interface ExceptionRow {
  id: string;
  kind: string;
  created_at: Date;
  learner_name: string;
  assessment_title: string;
  sort_order: number;
  raw_answer: unknown;
  auto_result: unknown;
  points: string;
  answer_snapshot: unknown;
  total_count: number;
}

/* 채점 예외함 (19장) — 학생 원본 답안·자동 판단 근거·신뢰도를 나란히 보고
 * 사람이 판정한다. 불확실한 답을 임의로 확정하지 않는다 (원칙 8). */

export default async function GradingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("grading");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: Object.keys(SORT_COLUMN),
    defaultSort: "created_at",
    filterKeys: ["kind"],
  });
  const kindFilter = query.params.kind ?? "";
  const like = `%${query.q}%`;

  const [exceptions, resolved] = await Promise.all([
    sql<ExceptionRow[]>`
      with base as (
        select ge.id::text as id,
               ge.kind::text as kind,
               ge.created_at as created_at,
               l.display_name as learner_name,
               a.title as assessment_title,
               aq.sort_order as sort_order,
               r.answer as raw_answer,
               ge.auto_result as auto_result,
               aq.points::text as points,
               aq.answer_snapshot as answer_snapshot
        from grading_exceptions ge
        join responses r on r.id = ge.response_id
        join attempts t on t.id = ge.attempt_id
        join learners l on l.id = t.learner_id
        join assessment_instances a on a.id = t.assessment_id
        join assessment_questions aq on aq.id = r.assessment_question_id
        where ge.organization_id = ${user.organizationId}
          and ge.status <> 'resolved'
          and (${kindFilter}::text = '' or ge.kind::text = ${kindFilter})
          and (${query.q}::text = ''
               or l.display_name ilike ${like}
               or a.title ilike ${like})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(SORT_COLUMN[query.sort] ?? "created_at")}
               ${query.dir === "asc" ? sql`asc` : sql`desc`} nulls last,
               id asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from grading_exceptions
      where organization_id = ${user.organizationId}
        and status = 'resolved'
        and resolved_at >= date_trunc('day', now() at time zone ${KST})
    `,
  ]);

  const total = exceptions[0]?.total_count ?? 0;
  const resolvedToday = resolved[0]?.cnt ?? 0;
  const filtered = Boolean(query.q || query.params.kind);

  const columns: Column<ExceptionRow>[] = [
    {
      key: "learner_name",
      label: "학생",
      sortable: true,
      render: (e) => <span className="font-medium">{e.learner_name}</span>,
    },
    {
      key: "assessment_title",
      label: "테스트",
      sortable: true,
      secondary: true,
      render: (e) => <span className="text-ink-soft">{e.assessment_title}</span>,
    },
    {
      key: "sort_order",
      label: "문항",
      sortable: true,
      align: "right",
      mono: true,
      render: (e) => `${e.sort_order}번`,
    },
    {
      key: "kind",
      label: "예외 종류",
      sortable: true,
      render: (e) => (
        <span className="whitespace-nowrap rounded-[var(--radius-control)] bg-highlight-soft px-2 py-1 font-mono text-xs">
          {KIND_LABEL[e.kind] ?? e.kind}
        </span>
      ),
    },
    {
      key: "raw_answer",
      label: "학생 답안 (원본)",
      render: (e) => (
        <div className="max-w-[18rem] space-y-1">
          <p className="break-words font-mono text-xs">
            {formatAnswer(e.raw_answer)}
          </p>
          <details>
            <summary className="cursor-pointer text-xs text-ink-soft">
              자동 채점 판단 근거
            </summary>
            <pre className="mt-1 max-w-[18rem] overflow-x-auto rounded bg-paper p-2 font-mono text-xs">
              {JSON.stringify(e.auto_result, null, 2)}
            </pre>
          </details>
        </div>
      ),
    },
    {
      key: "answer_snapshot",
      label: "기준 정답",
      secondary: true,
      render: (e) => (
        <span className="break-words font-mono text-xs">
          {formatKey(e.answer_snapshot)}
        </span>
      ),
    },
    {
      key: "created_at",
      label: "접수",
      sortable: true,
      mono: true,
      secondary: true,
      render: (e) => formatDateTime(e.created_at),
    },
    {
      key: "action",
      label: "판정",
      render: (e) => (
        <ResolveForm exceptionId={e.id} maxPoints={Number(e.points)} />
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">채점·예외</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        자동 채점이 확정하지 않은 답안입니다. 판정하면 점수·숙련도·복습이 함께
        갱신되고 변경 이력이 감사 로그에 남습니다.
        {resolvedToday > 0 && ` 오늘 판정 완료 ${resolvedToday}건.`}
      </p>

      <TableFilters
        basePath="/app/grading"
        query={query}
        search={{ label: "검색", placeholder: "학생·테스트 이름" }}
        selects={[
          {
            name: "kind",
            label: "예외 종류",
            options: Object.entries(KIND_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={exceptions}
        rowKey={(e) => e.id}
        total={total}
        query={query}
        basePath="/app/grading"
        empty={
          filtered ? (
            <>
              <p className="font-medium">조건에 맞는 채점 예외가 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                검색어나 예외 종류 필터를 바꿔보세요.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">검토할 채점 예외가 없습니다.</p>
              <p className="mt-1.5 text-sm text-ink-soft">
                자동 채점이 불확실한 답안(서술형, 단위 문제, 모호한 표기)만 이곳으로
                옵니다.
              </p>
            </>
          )
        }
      />
    </div>
  );
}

function formatAnswer(answer: unknown): string {
  if (!answer || typeof answer !== "object") return "무응답";
  const a = answer as { kind?: string; rawText?: string; selectedChoiceIds?: string[]; text?: string };
  if (a.kind === "short_answer") return a.rawText || "무응답";
  if (a.kind === "multiple_choice") return (a.selectedChoiceIds ?? []).join(", ") || "무응답";
  if (a.kind === "essay") return a.text || "무응답";
  return JSON.stringify(answer);
}

function formatKey(key: unknown): string {
  if (!key || typeof key !== "object") return "—";
  const k = key as {
    kind?: string;
    accepted?: Array<{ value: string; unit?: string }>;
    correctChoiceIds?: string[];
  };
  if (k.kind === "short_answer") {
    return (k.accepted ?? [])
      .map((x) => `${x.value}${x.unit ? ` ${x.unit}` : ""}`)
      .join(" 또는 ");
  }
  if (k.kind === "multiple_choice") return (k.correctChoiceIds ?? []).join(", ");
  return "루브릭 채점";
}
