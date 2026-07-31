import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "문제은행" };

/* 문제은행 (16장) — 문항·출처·사용 권한·검수 상태를 한 화면에서 본다.
 * 자동 출제 가능 여부는 검수·권한·수식 게이트의 종합 결과이며 여기서는
 * 저장된 값을 그대로 보여준다 (원칙 9 — 권한 미확인 문항 자동 출제 금지). */

const REVIEW_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  extracting: "추출 중",
  review_required: "검수 필요",
  formula_review_required: "수식 검수 필요",
  layout_review_required: "레이아웃 검수 필요",
  approved: "승인",
  rejected: "반려",
  quarantined: "격리",
  published: "게시",
};

const KIND_LABEL: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "단답형",
  multi_blank: "다중 빈칸",
  essay: "서술형",
};

const RIGHT_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  under_review: "확인 중",
  usable: "사용 가능",
  restricted: "제한적 사용",
  expired: "만료",
  blocked: "차단",
};

const BAND_LABEL: Record<string, string> = {
  low: "기초",
  mid: "표준",
  high: "심화",
};

interface QuestionRow {
  id: string;
  kind: string;
  review_status: string;
  is_auto_assignable: boolean;
  difficulty_band: string | null;
  right_status: string | null;
  concept_names: string;
  used_count: number;
}

export default async function QuestionBankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const params = await searchParams;
  const rawStatus = params.status;
  const rawKind = params.kind;
  const status = typeof rawStatus === "string" && rawStatus ? rawStatus : null;
  const kind = typeof rawKind === "string" && rawKind ? rawKind : null;

  // enum 컬럼을 text로 비교한다 — 알 수 없는 필터 값이 와도 쿼리가 깨지지 않고
  // 단순히 0건이 된다.
  const statusClause = status ? sql`and q.review_status::text = ${status}` : sql``;
  const kindClause = kind ? sql`and q.kind::text = ${kind}` : sql``;

  const [rows, statusCounts, kindCounts] = await Promise.all([
    sql<QuestionRow[]>`
      select q.id, q.kind::text as kind, q.review_status::text as review_status,
             q.is_auto_assignable,
             v.difficulty->>'band' as difficulty_band,
             cr.status::text as right_status,
             (select count(*)::int from assessment_questions aq
               where aq.question_id = q.id
                 and aq.organization_id = q.organization_id) as used_count,
             (select coalesce(string_agg(c.name, ' · ' order by c.name), '')
                from question_alignments qa
                join canonical_concepts c on c.id = qa.concept_id
               where qa.question_id = q.id
                 and qa.organization_id = q.organization_id) as concept_names
      from questions q
      left join question_versions v on v.id = q.current_version_id
      left join content_rights cr on cr.id = q.content_right_id
        and cr.organization_id = q.organization_id
      where q.organization_id = ${user.organizationId}
        ${statusClause}
        ${kindClause}
      order by q.created_at desc
      limit 200
    `,
    sql<{ value: string; cnt: number }[]>`
      select review_status::text as value, count(*)::int as cnt
      from questions where organization_id = ${user.organizationId}
      group by review_status order by count(*) desc
    `,
    sql<{ value: string; cnt: number }[]>`
      select kind::text as value, count(*)::int as cnt
      from questions where organization_id = ${user.organizationId}
      group by kind order by count(*) desc
    `,
  ]);

  const total = statusCounts.reduce((sum, r) => sum + r.cnt, 0);
  const assignable = rows.filter((r) => r.is_auto_assignable).length;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">문제은행</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        전체 {total}문항 · 이 목록에서 자동 출제 가능 {assignable}문항. 검수를
        통과하고 사용 권한이 확인된 문항만 자동 출제 풀에 들어갑니다.
      </p>

      {/* 필터 — URL 파라미터. 실제로 존재하는 값만 노출한다. */}
      <div className="mt-5 space-y-2">
        <FilterRow
          label="검수 상태"
          options={statusCounts}
          labels={REVIEW_STATUS_LABEL}
          active={status}
          hrefFor={(v) => buildHref(v, kind)}
          allHref={buildHref(null, kind)}
        />
        <FilterRow
          label="유형"
          options={kindCounts}
          labels={KIND_LABEL}
          active={kind}
          hrefFor={(v) => buildHref(status, v)}
          allHref={buildHref(status, null)}
        />
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">
            {total === 0
              ? "아직 등록된 문항이 없습니다."
              : "이 조건에 맞는 문항이 없습니다."}
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            {total === 0
              ? "문제집 변환으로 원본을 반입하거나 문항을 직접 등록하세요."
              : "필터를 지우면 전체 문항을 볼 수 있습니다."}
          </p>
          <Link
            href={total === 0 ? "/app/content/ingestion" : "/app/content/questions"}
            className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            {total === 0 ? "문제집 변환으로 이동" : "필터 지우기"}
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-rule-soft text-left text-xs text-ink-soft">
              <tr>
                <th className="px-4 py-2 font-medium">문항</th>
                <th className="px-4 py-2 font-medium">유형</th>
                <th className="px-4 py-2 font-medium">난이도</th>
                <th className="px-4 py-2 font-medium">개념</th>
                <th className="px-4 py-2 font-medium">검수</th>
                <th className="px-4 py-2 font-medium">사용 권한</th>
                <th className="px-4 py-2 font-medium">자동 출제</th>
                <th className="px-4 py-2 text-right font-medium">출제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule-soft">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-paper">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/app/content/questions/${r.id}`}
                      className="font-mono text-xs text-pen underline-offset-2 hover:underline"
                      title={r.id}
                    >
                      {shortId(r.id)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="px-4 py-2.5">
                    {r.difficulty_band
                      ? (BAND_LABEL[r.difficulty_band] ?? r.difficulty_band)
                      : "—"}
                  </td>
                  <td className="max-w-[18rem] truncate px-4 py-2.5">
                    {r.concept_names || (
                      <span className="text-ink-soft">개념 미연결</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={reviewTone(r.review_status)}
                      label={REVIEW_STATUS_LABEL[r.review_status] ?? r.review_status}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {r.right_status ? (
                      <Badge
                        tone={r.right_status === "usable" ? "ok" : "warn"}
                        label={RIGHT_STATUS_LABEL[r.right_status] ?? r.right_status}
                      />
                    ) : (
                      <Badge tone="warn" label="권한 미연결" />
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={r.is_auto_assignable ? "ok" : "muted"}
                      label={r.is_auto_assignable ? "가능" : "불가"}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    {r.used_count}회
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 200 && (
        <p className="mt-3 font-mono text-xs text-ink-soft">
          최근 200문항만 표시했습니다.
        </p>
      )}
    </div>
  );
}

function buildHref(status: string | null, kind: string | null): string {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (kind) p.set("kind", kind);
  const query = p.toString();
  return query ? `/app/content/questions?${query}` : "/app/content/questions";
}

function FilterRow({
  label,
  options,
  labels,
  active,
  hrefFor,
  allHref,
}: {
  label: string;
  options: Array<{ value: string; cnt: number }>;
  labels: Record<string, string>;
  active: string | null;
  hrefFor: (value: string) => string;
  allHref: string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-ink-soft">{label}</span>
      <Chip href={allHref} active={active === null} label="전체" />
      {options.map((o) => (
        <Chip
          key={o.value}
          href={hrefFor(o.value)}
          active={active === o.value}
          label={`${labels[o.value] ?? o.value} ${o.cnt}`}
        />
      ))}
    </div>
  );
}

function Chip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-xs ${
        active
          ? "border-pen bg-pen-soft font-medium text-pen"
          : "border-rule bg-surface text-ink-soft hover:border-pen"
      }`}
    >
      {label}
    </Link>
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

function reviewTone(status: string): "ok" | "warn" | "bad" | "muted" {
  if (status === "published" || status === "approved") return "ok";
  if (status === "rejected" || status === "quarantined") return "bad";
  if (status === "draft" || status === "extracting") return "muted";
  return "warn";
}

/** 시드 문항 ID는 앞자리가 모두 같다 — 구별되는 뒷자리 8글자를 쓴다. */
function shortId(id: string): string {
  return id.replace(/-/g, "").slice(-8);
}
