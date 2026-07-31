import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "콘텐츠 검수" };

/* 콘텐츠 검수함 — 사람이 판정해야 넘어가는 항목만 모은다.
 * 수식 게이트에 걸린 표현은 자동 보정으로 통과시키지 않고 여기서 격리된다
 * (원칙 12 — 수식이 깨진 문항은 게시할 수 없다). */

const SUBJECT_LABEL: Record<string, string> = {
  question: "문항",
  source_file: "원본 파일",
  diagram: "도형",
  mapping: "개념 매핑",
};

const REVIEW_STATUS_LABEL: Record<string, string> = {
  open: "미배정",
  assigned: "배정됨",
  reviewing: "검토 중",
  resolved: "완료",
};

const DECISION_LABEL: Record<string, string> = {
  approve: "승인",
  reject: "반려",
  quarantine: "격리",
  needs_fix: "수정 필요",
};

const PARSE_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  parsed: "파싱됨",
  normalized: "정규화됨",
  render_validated: "렌더 검증 완료",
  review_required: "검수 필요",
  corrected: "보정됨",
  rejected: "반려",
};

export default async function ContentReviewPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const [contentReviews, formulaReviews] = await Promise.all([
    sql<
      {
        id: string;
        subject_type: string;
        subject_id: string;
        decision: string | null;
        notes: string | null;
        status: string;
        created_at: Date;
        reviewer_name: string | null;
        checklist: unknown;
      }[]
    >`
      select cr.id, cr.subject_type, cr.subject_id, cr.decision, cr.notes,
             cr.status, cr.created_at, cr.checklist,
             u.display_name as reviewer_name
      from content_reviews cr
      left join users u on u.id = cr.reviewer_id
      where cr.organization_id = ${user.organizationId}
        and cr.status <> 'resolved'
      order by cr.created_at asc
      limit 100
    `,
    sql<
      {
        id: string;
        question_id: string | null;
        status: string;
        created_at: Date;
        diagnosis: unknown;
        assignee_name: string | null;
        raw_source: string | null;
        normalized_latex: string | null;
        parse_status: string | null;
      }[]
    >`
      select fr.id, fr.question_id, fr.status, fr.created_at, fr.diagnosis,
             u.display_name as assignee_name,
             me.raw_source, me.normalized_latex,
             me.parse_status::text as parse_status
      from formula_reviews fr
      left join users u on u.id = fr.assigned_to
      left join math_expressions me on me.id = fr.expression_id
        and me.organization_id = fr.organization_id
      where fr.organization_id = ${user.organizationId}
        and fr.status <> 'resolved'
      order by fr.created_at asc
      limit 100
    `,
  ]);

  const total = contentReviews.length + formulaReviews.length;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">콘텐츠 검수</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {total > 0
          ? `검토 대기 ${total}건 — 콘텐츠 ${contentReviews.length}건, 수식 ${formulaReviews.length}건.`
          : "사람의 판정이 필요한 항목만 이곳에 모입니다."}
      </p>

      {total === 0 && (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">검수할 항목이 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            수식 게이트 실패, 중복 의심, 권한 확인 필요 항목이 생기면 자동으로
            여기에 쌓입니다. 검수를 통과하지 못한 문항은 자동 출제되지 않습니다.
          </p>
          <Link
            href="/app/content/questions"
            className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            문제은행 열기
          </Link>
        </div>
      )}

      {/* 수식 검수 */}
      {formulaReviews.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">수식 검수</h2>
          <ul className="mt-3 space-y-4">
            {formulaReviews.map((f) => (
              <li key={f.id} className="rounded-lg border border-rule bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {f.question_id ? (
                      <Link
                        href={`/app/content/questions/${f.question_id}`}
                        className="text-pen underline underline-offset-2"
                      >
                        문항 {shortId(f.question_id)}
                      </Link>
                    ) : (
                      "문항 미연결 수식"
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {f.parse_status && (
                      <Badge
                        label={PARSE_STATUS_LABEL[f.parse_status] ?? f.parse_status}
                        tone="warn"
                      />
                    )}
                    <Badge
                      label={REVIEW_STATUS_LABEL[f.status] ?? f.status}
                      tone={f.status === "open" ? "warn" : "muted"}
                    />
                  </div>
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-[var(--radius-control)] border border-rule-soft p-3">
                    <dt className="text-xs text-ink-soft">원문 (불변)</dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {f.raw_source ?? "—"}
                    </dd>
                  </div>
                  <div className="rounded-[var(--radius-control)] border border-rule-soft p-3">
                    <dt className="text-xs text-ink-soft">정규화 결과</dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {f.normalized_latex ?? "정규화 결과 없음"}
                    </dd>
                  </div>
                </dl>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-ink-soft">진단 내용</summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-paper p-2 font-mono text-xs">
                    {JSON.stringify(f.diagnosis, null, 2)}
                  </pre>
                </details>
                <p className="mt-2 font-mono text-xs text-ink-soft">
                  {formatDateTime(f.created_at)} · 담당 {f.assignee_name ?? "미배정"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 콘텐츠 검수 */}
      {contentReviews.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">콘텐츠 검수</h2>
          <ul className="mt-3 space-y-4">
            {contentReviews.map((c) => (
              <li key={c.id} className="rounded-lg border border-rule bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {SUBJECT_LABEL[c.subject_type] ?? c.subject_type}{" "}
                    {c.subject_type === "question" ? (
                      <Link
                        href={`/app/content/questions/${c.subject_id}`}
                        className="font-mono text-sm text-pen underline underline-offset-2"
                      >
                        {shortId(c.subject_id)}
                      </Link>
                    ) : (
                      <span className="font-mono text-sm text-ink-soft">
                        {shortId(c.subject_id)}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {c.decision && (
                      <Badge
                        label={DECISION_LABEL[c.decision] ?? c.decision}
                        tone={c.decision === "approve" ? "ok" : "warn"}
                      />
                    )}
                    <Badge
                      label={REVIEW_STATUS_LABEL[c.status] ?? c.status}
                      tone={c.status === "open" ? "warn" : "muted"}
                    />
                  </div>
                </div>
                {c.notes && <p className="mt-2 text-sm">{c.notes}</p>}
                {c.checklist != null && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-ink-soft">체크리스트</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-paper p-2 font-mono text-xs">
                      {JSON.stringify(c.checklist, null, 2)}
                    </pre>
                  </details>
                )}
                <p className="mt-2 font-mono text-xs text-ink-soft">
                  {formatDateTime(c.created_at)} · 검수자 {c.reviewer_name ?? "미배정"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function shortId(id: string): string {
  return id.replace(/-/g, "").slice(-8);
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
