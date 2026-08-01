import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "리포트" };

const STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  generating: "생성 중",
  review_required: "검토 필요",
  approved: "승인됨",
  exported: "내보냄",
  failed: "실패",
  archived: "보관",
};

export default async function ReportsPage() {
  const user = await requireAccess("reports");
  const sql = getSharedSql();

  const reports = await sql<
    { id: string; kind: string; status: string; created_at: Date }[]
  >`
    select id, kind, status, created_at from reports
    where organization_id = ${user.organizationId}
    order by created_at desc limit 50
  `;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">리포트</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        학생 주간·월간, 반 수업, 테스트 결과, 개념 숙련도 리포트가 이곳에서
        생성·승인·내보내기됩니다. 자동 서술에는 사용 데이터와 기간이 표시되며,
        승인 후에만 외부로 내보낼 수 있습니다.
      </p>

      {reports.length === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">아직 생성된 리포트가 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            리포트 생성 기능은 준비 중입니다. 학습 데이터는 학습자·반 화면에서
            지금도 확인할 수 있습니다.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
          {reports.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm">{r.kind}</span>
              <span className="font-mono text-xs text-ink-soft">
                {STATUS_LABEL[r.status] ?? r.status} ·{" "}
                {formatDateTime(r.created_at, user.timezone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
