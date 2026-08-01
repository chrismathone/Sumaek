import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "외부 명단 연동" };

/* 외부 명단 연동 (1A장 연동 경계).
 * 동기화 상태는 반드시 UI에 노출한다 — 상태가 안 보이는 동기화는 침묵 속에
 * 틀린다 (eywa makeedu 실사고). */

export default async function IntegrationsPage() {
  const user = await requireAccess("integrations");
  const sql = getSharedSql();

  const connections = await sql<
    {
      id: string;
      kind: string;
      name: string;
      status: string;
      resource: string | null;
      last_status: string | null;
      last_synced_at: Date | null;
      last_error: string | null;
    }[]
  >`
    select c.id, c.kind, c.name, c.status,
           s.resource, s.last_status, s.last_synced_at, s.last_error
    from integration_connections c
    left join integration_sync_cursors s on s.connection_id = c.id
    where c.organization_id = ${user.organizationId}
    order by c.name, s.resource
  `;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">외부 명단 연동</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        연동 범위는 사용자·학습 그룹 동기화, 수업 참여 이벤트 수신, 평가 결과
        내보내기, 오늘 학습 링크 전달로 제한됩니다. 결제·상담·전자출결
        원장·보호자 연락처는 수신하지 않고 폐기합니다.
      </p>

      {connections.length === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">연결된 외부 시스템이 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            연동 없이도 CSV 가져오기와 직접 등록으로 모든 핵심 기능이
            동작합니다. 외부 연동이 끊겨도 이미 동기화된 명단·게시된 루트·오늘
            수업·응시·채점은 계속 동작합니다.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {connections.map((c) => (
            <li key={`${c.id}-${c.resource}`} className="rounded-lg border border-rule bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {c.name} <span className="font-mono text-xs text-ink-soft">({c.kind})</span>
                </p>
                <span
                  className={`rounded-[var(--radius-control)] px-2 py-1 font-mono text-xs ${
                    c.last_error
                      ? "bg-grade-soft text-grade"
                      : "border border-rule"
                  }`}
                >
                  {c.last_error ? "오류" : (c.last_status ?? c.status)}
                </span>
              </div>
              {c.resource && (
                <p className="mt-1 font-mono text-xs text-ink-soft">
                  {c.resource} · 마지막 동기화{" "}
                  {c.last_synced_at
                    ? formatDateTime(c.last_synced_at, user.timezone)
                    : "없음"}
                </p>
              )}
              {c.last_error && (
                <p className="mt-1 text-xs text-grade">{c.last_error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
