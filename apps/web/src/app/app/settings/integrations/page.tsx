import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
import { formatDateTime } from "@/lib/format";
import {
  DisconnectButton,
  HolidaySyncButton,
  ScheduleSyncForm,
  SchoolSearchForm,
} from "./IntegrationForms";

export const metadata: Metadata = { title: "외부 명단 연동" };

/* 외부 명단 연동 (1A장 연동 경계 · 인수 61).
 * 동기화 상태는 반드시 UI에 노출한다 — 상태가 안 보이는 동기화는 침묵 속에
 * 틀린다 (eywa makeedu 실사고).
 *
 * 설계: 전체 학교를 내려받지 않는다 — 공휴일은 전국 공통 연 1회(특일 API),
 * 학사일정은 연결한 학교만·시험 기간만 온디맨드. */

export default async function IntegrationsPage() {
  const user = await requireAccess("integrations");
  const sql = getSharedSql();

  const [connections, groups, holidayStats, lastHolidaySync] = await Promise.all([
    sql<
      {
        id: string;
        kind: string;
        name: string;
        status: string;
        config: { schoolKind?: string; officeName?: string } | null;
        resource: string | null;
        last_status: string | null;
        last_synced_at: Date | null;
        last_error: string | null;
      }[]
    >`
      select c.id, c.kind, c.name, c.status, c.config,
             s.resource, s.last_status, s.last_synced_at, s.last_error
      from integration_connections c
      left join integration_sync_cursors s on s.connection_id = c.id
      where c.organization_id = ${user.organizationId}
        and c.status <> 'disconnected'
      order by c.name, s.resource
    `,
    sql<{ id: string; name: string }[]>`
      select id, name from learning_groups
      where organization_id = ${user.organizationId} and status = 'operating'
      order by name
    `,
    sql<{ cnt: number; latest: string | null }[]>`
      select count(*)::int as cnt, max(starts_on)::text as latest
      from holidays
      where organization_id = ${user.organizationId}
        and kind = 'national' and learning_group_id is null
    `,
    sql<{ created_at: Date }[]>`
      select created_at from audit_events
      where organization_id = ${user.organizationId}
        and action = 'integration.sync-holidays'
      order by created_at desc limit 1
    `,
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">외부 명단 연동</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        연동 범위는 사용자·학습 그룹 동기화, 수업 참여 이벤트 수신, 평가 결과
        내보내기, 오늘 학습 링크 전달로 제한됩니다. 결제·상담·전자출결
        원장·보호자 연락처는 수신하지 않고 폐기합니다.
      </p>

      <section className="mt-6 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">공휴일 (한국천문연구원 특일 정보)</h2>
        <p className="mt-1 text-sm text-ink-soft">
          실제 쉬는 날(공휴일·대체공휴일)만 가져옵니다 — 절기·기념일은
          받지 않습니다. 전국 공통이라 연도당 호출 1회면 충분합니다.
        </p>
        <p className="mt-2 font-mono text-xs text-ink-soft">
          보유 {holidayStats[0]?.cnt ?? 0}건
          {holidayStats[0]?.latest && ` · 가장 늦은 날 ${holidayStats[0].latest}`}
          {" · 마지막 동기화 "}
          {lastHolidaySync[0]
            ? formatDateTime(lastHolidaySync[0].created_at, user.timezone)
            : "없음"}
        </p>
        <div className="mt-3">
          <HolidaySyncButton />
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">학교 연결 (NEIS 학사일정)</h2>
        <p className="mt-1 text-sm text-ink-soft">
          우리 학원 학생들이 다니는 학교만 연결합니다 — 전체 학교를 내려받지
          않습니다. 연결한 학교의 학사일정에서 <strong>시험 기간만</strong> 휴일
          달력으로 가져옵니다 (학교 휴업일·방학은 학원 수업일, 공휴일은 위의
          특일 동기화가 담당).
        </p>
        <div className="mt-3">
          <SchoolSearchForm />
        </div>
      </section>

      {connections.length === 0 ? (
        <div className="mt-4 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">연결된 외부 시스템이 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            연동 없이도 CSV 가져오기와 직접 등록으로 모든 핵심 기능이
            동작합니다. 외부 연동이 끊겨도 이미 동기화된 명단·게시된 루트·오늘
            수업·응시·채점은 계속 동작합니다.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {connections.map((c) => (
            /* key에 resource를 넣으면 첫 동기화에서 커서 행이 생길 때 key가
             * 바뀌어 폼이 리마운트되고 진행 중 토스트가 사라진다 (실측) */
            <li key={c.id} className="rounded-lg border border-rule bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {c.name}{" "}
                  <span className="font-mono text-xs text-ink-soft">
                    ({c.config?.schoolKind || c.kind})
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-[var(--radius-control)] px-2 py-1 font-mono text-xs ${
                      c.last_error
                        ? "bg-grade-soft text-grade"
                        : "border border-rule"
                    }`}
                  >
                    {c.last_error ? "오류" : (c.last_status ?? c.status)}
                  </span>
                  <DisconnectButton connectionId={c.id} />
                </div>
              </div>
              <p className="mt-1 font-mono text-xs text-ink-soft">
                {c.resource ?? "school_schedule"} · 마지막 동기화{" "}
                {c.last_synced_at
                  ? formatDateTime(c.last_synced_at, user.timezone)
                  : "없음"}
              </p>
              {c.last_error && (
                <p className="mt-1 text-xs text-grade">{c.last_error}</p>
              )}
              <ScheduleSyncForm connectionId={c.id} groups={groups} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
