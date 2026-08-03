import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { DataTable, type Column } from "@/components/DataTable";
import { TableFilters } from "@/components/TableFilters";
import { formatDateTime } from "@/lib/format";
import {
  DENSE_PAGE_SIZE,
  parseTableQuery,
  type RawSearchParams,
  type TableQuery,
} from "@/lib/table";
import { UploadForm } from "./UploadForm";

export const metadata: Metadata = { title: "문제집 변환" };

/* 문제집 변환 (15장) — 원본 등록 → 추출 → 정규화·게이트 → 검수 대기.
 * 원본은 체크섬과 함께 불변 보존한다.
 *
 * 한 화면에 표가 둘이다. 정렬 키는 URL의 sort 하나를 공유하므로 두 표의
 * 정렬 키 이름을 겹치지 않게 나누고(file_*, job_*), 자기 키가 아닐 때는
 * 각자의 기본 정렬로 돌아간다 — 한쪽을 정렬해도 다른 쪽이 흔들리지 않는다.
 * 쪽 넘김은 원본 파일 표만 쓴다 (변환 작업은 최근 분량만 보여준다). */

const FILE_STATUS_LABEL: Record<string, string> = {
  uploaded: "업로드됨",
  extracting: "추출 중",
  review_required: "검수 필요",
  approved: "승인",
  rejected: "반려",
  quarantined: "격리",
  published: "게시",
};

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  waiting_review: "검토 대기",
  succeeded: "완료",
  failed_retryable: "실패 (재시도 예정)",
  retry_scheduled: "재시도 예약",
  failed_final: "최종 실패",
  dead_lettered: "데드레터",
  cancel_requested: "취소 요청",
  cancelled: "취소",
};

const JOB_TOPIC_LABEL: Record<string, string> = {
  "ingestion.ocr": "OCR 인식",
  "ingestion.split": "문항 분리",
  "ingestion.normalize": "수식 정규화",
  "ingestion.dedupe": "중복 검사",
  "ingestion.publish": "문제은행 반영",
};

/** 정렬 키 → 정렬 대상 (화이트리스트 — 사용자 입력이 쿼리에 닿지 않는다).
 * 값은 전부 base CTE의 출력 별칭이다. */
const FILE_SORT_COLUMN: Record<string, string> = {
  file_name: "file_name",
  file_status: "status",
  page_count: "page_count",
  question_count: "question_count",
  created_at: "created_at",
};

const JOB_SORT_COLUMN: Record<string, string> = {
  topic: "topic",
  job_status: "status",
  attempts: "attempts",
  run_at: "run_at",
};

interface SourceFileRow {
  id: string;
  file_name: string;
  status: string;
  page_count: number | null;
  byte_size: number;
  created_at: Date;
  uploader_name: string | null;
  question_count: number;
  total_count: number;
}

interface JobRow {
  id: string;
  topic: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  last_error: string | null;
  total_count: number;
}

export default async function IngestionPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("ingestion");
  const sql = getSharedSql();

  const query = parseTableQuery(await searchParams, {
    sortKeys: [...Object.keys(FILE_SORT_COLUMN), ...Object.keys(JOB_SORT_COLUMN)],
    defaultSort: "created_at",
    defaultDir: "desc",
    filterKeys: ["job"],
  });
  const jobStatusFilter = query.params.job ?? "";

  // 정렬 키가 자기 표의 것이 아니면 기본 정렬(최신순)로 되돌린다.
  const fileSort = FILE_SORT_COLUMN[query.sort];
  const fileDesc = fileSort ? query.dir === "desc" : true;
  const jobSort = JOB_SORT_COLUMN[query.sort];
  const jobDesc = jobSort ? query.dir === "desc" : true;

  const [files, jobs, bank] = await Promise.all([
    sql<SourceFileRow[]>`
      with base as (
        select sf.id, sf.file_name, sf.status::text as status, sf.page_count,
               sf.byte_size, sf.created_at,
               u.display_name as uploader_name,
               (select count(*)::int from questions q
                 where q.source_file_id = sf.id
                   and q.organization_id = sf.organization_id) as question_count
        from source_files sf
        left join users u on u.id = sf.uploaded_by
        where sf.organization_id = ${user.organizationId}
          and (${query.q}::text = ''
               or sf.file_name ilike ${`%${query.q}%`}
               or coalesce(u.display_name, '') ilike ${`%${query.q}%`})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(fileSort ?? "created_at")}
               ${fileDesc ? sql`desc` : sql`asc`} nulls last,
               id asc
      limit ${query.pageSize} offset ${query.offset}
    `,
    /* status는 enum이므로 필터는 양쪽 다 ::text로 비교한다 — 빈 문자열이
     * enum 캐스팅을 만나 500이 나는 것을 막는다. */
    sql<JobRow[]>`
      with base as (
        select j.id, j.topic, j.status::text as status, j.attempts, j.max_attempts,
               j.run_at, j.last_error
        from jobs j
        where j.organization_id = ${user.organizationId}
          and j.topic like 'ingestion.%'
          and (${jobStatusFilter}::text = '' or j.status::text = ${jobStatusFilter})
      )
      select *, count(*) over ()::int as total_count
      from base
      order by ${sql(jobSort ?? "run_at")}
               ${jobDesc ? sql`desc` : sql`asc`} nulls last,
               id asc
      limit ${DENSE_PAGE_SIZE}
    `,
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from questions
      where organization_id = ${user.organizationId}
    `,
  ]);

  const fileTotal = files[0]?.total_count ?? 0;
  const jobTotal = jobs[0]?.total_count ?? 0;
  const bankCount = bank[0]?.cnt ?? 0;

  /* 변환 작업 표는 쪽을 넘기지 않는다 — 언제나 1쪽, 최근 분량만. */
  const jobQuery: TableQuery = {
    ...query,
    page: 1,
    offset: 0,
    pageSize: DENSE_PAGE_SIZE,
  };

  const fileColumns: Column<SourceFileRow>[] = [
    {
      key: "file_name",
      label: "파일명",
      sortable: true,
      render: (f) => <span className="font-medium">{f.file_name}</span>,
    },
    {
      key: "byte_size",
      label: "크기",
      align: "right",
      mono: true,
      secondary: true,
      render: (f) => formatBytes(f.byte_size),
    },
    {
      key: "file_status",
      label: "상태",
      sortable: true,
      render: (f) => (
        <Badge
          label={FILE_STATUS_LABEL[f.status] ?? f.status}
          tone={fileTone(f.status)}
        />
      ),
    },
    {
      key: "page_count",
      label: "페이지",
      sortable: true,
      align: "right",
      mono: true,
      render: (f) => f.page_count ?? "—",
    },
    {
      key: "question_count",
      label: "추출 문항",
      sortable: true,
      align: "right",
      mono: true,
      render: (f) => f.question_count,
    },
    {
      key: "uploader",
      label: "업로더",
      secondary: true,
      render: (f) => (
        <span className="text-ink-soft">{f.uploader_name ?? "업로더 미상"}</span>
      ),
    },
    {
      key: "created_at",
      label: "업로드",
      sortable: true,
      mono: true,
      secondary: true,
      render: (f) => formatDateTime(f.created_at),
    },
  ];

  const jobColumns: Column<JobRow>[] = [
    {
      key: "topic",
      label: "작업",
      sortable: true,
      render: (j) => (
        <span className="font-medium">{JOB_TOPIC_LABEL[j.topic] ?? j.topic}</span>
      ),
    },
    {
      key: "job_status",
      label: "상태",
      sortable: true,
      render: (j) => (
        <Badge
          label={JOB_STATUS_LABEL[j.status] ?? j.status}
          tone={jobTone(j.status)}
        />
      ),
    },
    {
      key: "attempts",
      label: "시도",
      sortable: true,
      align: "right",
      mono: true,
      render: (j) => `${j.attempts}/${j.max_attempts}`,
    },
    {
      key: "run_at",
      label: "실행 시각",
      sortable: true,
      mono: true,
      render: (j) => formatDateTime(j.run_at),
    },
    {
      key: "last_error",
      label: "마지막 오류",
      secondary: true,
      className: "max-w-[20rem] truncate",
      render: (j) =>
        j.last_error ? (
          <span className="font-mono text-xs text-grade">{j.last_error}</span>
        ) : (
          <span className="text-ink-soft">—</span>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">문제집 변환</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        업로드한 원본은 체크섬과 함께 그대로 보존되고, 추출 결과는 검수를 통과한
        뒤에만 문제은행에 반영됩니다. 원본 파일은 변형되지 않습니다.
      </p>

      <div className="mt-6">
        <UploadForm />
      </div>

      {/* 아래 두 표를 함께 좁히는 줄. 파일 상태는 열 머리 정렬로 훑고,
          작업 상태만 선택으로 좁힌다. */}
      <TableFilters
        basePath="/app/content/ingestion"
        query={query}
        search={{ label: "파일 검색", placeholder: "파일명·업로더" }}
        selects={[
          {
            name: "job",
            label: "작업 상태",
            options: Object.entries(JOB_STATUS_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
      />

      {/* 원본 파일 */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">원본 파일</h2>

        <DataTable
          columns={fileColumns}
          rows={files}
          rowKey={(f) => f.id}
          total={fileTotal}
          query={query}
          basePath="/app/content/ingestion"
          empty={
            query.q ? (
              <>
                <p className="font-medium">조건에 맞는 원본 파일이 없습니다.</p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  파일명이나 업로더 검색어를 바꿔보세요.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  PDF 업로드는 곧 열립니다. 현재는 직접 등록된 문항이 문제은행에
                  있습니다.
                </p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  업로드된 원본 파일이 아직 없습니다. 문제은행에 등록된 문항{" "}
                  {bankCount}개는 파일 반입이 아니라 직접 등록된 것입니다.
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
      </section>

      {/* 변환 작업 */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">변환 작업</h2>

        <DataTable
          columns={jobColumns}
          rows={jobs}
          rowKey={(j) => j.id}
          total={jobs.length}
          query={jobQuery}
          basePath="/app/content/ingestion"
          // 잘린 분량은 숨기지 않고 그대로 밝힌다 — 나머지는 상태 필터·정렬로 본다
          {...(jobTotal > jobs.length
            ? {
                caption: `작업 이력 ${jobTotal}건 가운데 최근 ${jobs.length}건만 보여줍니다. 상태로 좁히거나 열 머리를 눌러 정렬하세요.`,
              }
            : {})}
          empty={
            jobStatusFilter ? (
              <>
                <p className="font-medium">그 상태의 변환 작업이 없습니다.</p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  작업 상태를 &lsquo;전체&rsquo;로 되돌리면 모든 작업을 봅니다.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  진행 중이거나 완료된 변환 작업이 없습니다.
                </p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  원본 파일이 등록되면 OCR · 문항 분리 · 수식 정규화 작업이
                  이곳에 표시됩니다.
                </p>
              </>
            )
          }
        />
      </section>
    </div>
  );
}

function fileTone(status: string): "ok" | "warn" | "bad" | "muted" {
  if (status === "published" || status === "approved") return "ok";
  if (status === "rejected" || status === "quarantined") return "bad";
  if (status === "uploaded") return "muted";
  return "warn";
}

function jobTone(status: string): "ok" | "warn" | "bad" | "muted" {
  if (status === "succeeded") return "ok";
  if (
    status === "failed_final" ||
    status === "dead_lettered" ||
    status === "failed_retryable"
  ) {
    return "bad";
  }
  if (status === "cancelled") return "muted";
  return "warn";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
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
