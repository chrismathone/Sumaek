import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { UploadForm } from "./UploadForm";

export const metadata: Metadata = { title: "문제집 변환" };

/* 문제집 변환 (15장) — 원본 등록 → 추출 → 정규화·게이트 → 검수 대기.
 * 원본은 체크섬과 함께 불변 보존한다. */

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

export default async function IngestionPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const [files, jobs, bank] = await Promise.all([
    sql<
      {
        id: string;
        file_name: string;
        status: string;
        page_count: number | null;
        byte_size: number;
        created_at: Date;
        uploader_name: string | null;
        question_count: number;
      }[]
    >`
      select sf.id, sf.file_name, sf.status::text as status, sf.page_count,
             sf.byte_size, sf.created_at,
             u.display_name as uploader_name,
             (select count(*)::int from questions q
               where q.source_file_id = sf.id
                 and q.organization_id = sf.organization_id) as question_count
      from source_files sf
      left join users u on u.id = sf.uploaded_by
      where sf.organization_id = ${user.organizationId}
      order by sf.created_at desc
      limit 50
    `,
    sql<
      {
        id: string;
        topic: string;
        status: string;
        attempts: number;
        max_attempts: number;
        run_at: Date;
        last_error: string | null;
      }[]
    >`
      select j.id, j.topic, j.status::text as status, j.attempts, j.max_attempts,
             j.run_at, j.last_error
      from jobs j
      where j.organization_id = ${user.organizationId}
        and j.topic like 'ingestion.%'
      order by j.run_at desc
      limit 50
    `,
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from questions
      where organization_id = ${user.organizationId}
    `,
  ]);

  const bankCount = bank[0]?.cnt ?? 0;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">문제집 변환</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        업로드한 원본은 체크섬과 함께 그대로 보존되고, 추출 결과는 검수를 통과한
        뒤에만 문제은행에 반영됩니다. 원본 파일은 변형되지 않습니다.
      </p>

      <div className="mt-6">
        <UploadForm />
      </div>

      {/* 원본 파일 */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">원본 파일</h2>
        {files.length === 0 ? (
          <div className="mt-3 rounded-lg border border-rule bg-surface p-6 text-center">
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
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="border-b border-rule-soft text-left text-xs text-ink-soft">
                <tr>
                  <th className="px-4 py-2 font-medium">파일명</th>
                  <th className="px-4 py-2 font-medium">상태</th>
                  <th className="px-4 py-2 text-right font-medium">페이지</th>
                  <th className="px-4 py-2 text-right font-medium">추출 문항</th>
                  <th className="px-4 py-2 font-medium">업로드</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule-soft">
                {files.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{f.file_name}</p>
                      <p className="font-mono text-xs text-ink-soft">
                        {formatBytes(f.byte_size)}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        label={FILE_STATUS_LABEL[f.status] ?? f.status}
                        tone={fileTone(f.status)}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {f.page_count ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {f.question_count}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-soft">
                      {f.uploader_name ?? "업로더 미상"}
                      <br />
                      {formatDateTime(f.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 변환 작업 */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">변환 작업</h2>
        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            진행 중이거나 완료된 변환 작업이 없습니다. 원본 파일이 등록되면 OCR ·
            문항 분리 · 수식 정규화 작업이 이곳에 표시됩니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {JOB_TOPIC_LABEL[j.topic] ?? j.topic}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-ink-soft">
                    {formatDateTime(j.run_at)} · 시도 {j.attempts}/{j.max_attempts}
                  </p>
                  {j.last_error && (
                    <p className="mt-0.5 truncate font-mono text-xs text-grade">
                      {j.last_error}
                    </p>
                  )}
                </div>
                <Badge
                  label={JOB_STATUS_LABEL[j.status] ?? j.status}
                  tone={jobTone(j.status)}
                />
              </li>
            ))}
          </ul>
        )}
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

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  });
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
