import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import { todayInTimeZone } from "@/lib/format";
import { GroupForm, LearnerForm, PeriodForm } from "./SetupForms";
import { KillSwitchControls, type SwitchView } from "./KillSwitchControls";

/** 사람이 끌 수 있는 자동화 스위치 — 키·라벨 (28장) */
const KILL_SWITCH_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "auto_reschedule", label: "자동 일정 재계산" },
  { key: "auto_publish_questions", label: "문항 자동 게시" },
  { key: "auto_grading", label: "자동 채점" },
  { key: "curriculum_release", label: "교육과정 릴리스 발행" },
  { key: "formula_autofix", label: "수식 자동 정규화" },
  { key: "document_export", label: "문서 출력 (PDF·HWPX)" },
  { key: "external_notifications", label: "외부 알림 발송" },
];

export const metadata: Metadata = { title: "설정" };

/* 설정 (23장 축소판) — 현재 워크스페이스 상태·정책의 조회.
 * 편집 폼은 후속 단계 — 없는 기능을 있는 척하지 않는다. */

export default async function SettingsPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const [policies, masteryPolicies, groups, killSwitches, periods, groupList] =
    await Promise.all([
    sql<{ name: string; purpose: string; version: number; is_active: boolean }[]>`
      select name, purpose, version, is_active from assessment_policies
      where organization_id = ${user.organizationId} order by name
    `,
    sql<{ name: string; version: number; is_active: boolean }[]>`
      select name, version, is_active from mastery_policy_versions
      where organization_id = ${user.organizationId} order by name, version desc
    `,
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from learning_groups
      where organization_id = ${user.organizationId}
    `,
    sql<
      {
        key: string;
        enabled: boolean;
        reason: string | null;
        organization_id: string | null;
        expires_at: Date | null;
      }[]
    >`
      select key, enabled, reason, organization_id, expires_at from kill_switches
      where organization_id is null or organization_id = ${user.organizationId}
      order by key
    `,
    sql<{ id: string; name: string }[]>`
      select id, name from course_periods
      where organization_id = ${user.organizationId} and status = 'active'
      order by starts_on desc
    `,
    sql<{ id: string; name: string }[]>`
      select id, name from learning_groups
      where organization_id = ${user.organizationId} and status = 'operating'
      order by name
    `,
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">설정</h1>

      <section className="mt-6 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">워크스페이스</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-soft">이름</dt>
          <dd>{user.organizationName}</dd>
          <dt className="text-ink-soft">시간대</dt>
          <dd className="font-mono">{user.timezone}</dd>
          <dt className="text-ink-soft">학습 그룹</dt>
          <dd className="font-mono">{groups[0]?.cnt ?? 0}개</dd>
          <dt className="text-ink-soft">내 역할</dt>
          <dd>{user.role}</dd>
        </dl>
      </section>

      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">과정 기간 만들기</h2>
        <p className="mt-1 text-sm text-ink-soft">
          학년도·학기의 운영 구간입니다. 반과 일정은 이 기간 안에 배치됩니다.
        </p>
        <PeriodForm defaultYear={2026} />
      </section>

      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">반 만들기</h2>
        {periods.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            먼저 과정 기간을 만드세요. 반은 과정 기간에 속합니다.
          </p>
        ) : (
          <GroupForm periods={periods} />
        )}
      </section>

      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">학습자 등록</h2>
        <p className="mt-1 text-sm text-ink-soft">
          최소 데이터 원칙: 표시명·학년·소속만 받습니다. 보호자 연락처·주소는
          수집하지 않습니다.
        </p>
        {groupList.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">먼저 반을 만드세요.</p>
        ) : (
          <LearnerForm groups={groupList} today={todayInTimeZone(user.timezone)} />
        )}
      </section>

      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">평가 정책</h2>
        {policies.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">등록된 평가 정책이 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {policies.map((p) => (
              <li key={`${p.name}-${p.version}`} className="flex justify-between">
                <span>
                  {p.name} <span className="text-ink-soft">({p.purpose})</span>
                </span>
                <span className="font-mono text-xs">
                  v{p.version} {p.is_active ? "· 활성" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">숙련도 정책</h2>
        {masteryPolicies.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">등록된 숙련도 정책이 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {masteryPolicies.map((p) => (
              <li key={`${p.name}-${p.version}`} className="flex justify-between">
                <span>{p.name}</span>
                <span className="font-mono text-xs">
                  v{p.version} {p.is_active ? "· 활성" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          임계값·최소 증거 수·복습 간격은 정책 버전으로 관리되며 코드에
          하드코딩되지 않습니다.
        </p>
      </section>

      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="font-semibold">Kill Switch</h2>
        <p className="mt-1 text-sm text-ink-soft">
          자동화만 멈춥니다 — 수동 운영과 확정 데이터 열람은 계속 가능합니다.
          중지된 자동화의 작업은 큐에 남아 재개 시 그대로 이어집니다.
        </p>
        {(() => {
          const now = Date.now();
          const active = killSwitches.filter(
            (k) =>
              !k.enabled &&
              (k.expires_at === null || new Date(k.expires_at).getTime() > now),
          );
          const views: SwitchView[] = KILL_SWITCH_LABELS.map(({ key, label }) => {
            const rows = active.filter((k) => k.key === key);
            const globallyDisabled = rows.some((k) => k.organization_id === null);
            return {
              key,
              label,
              enabled: rows.length === 0,
              reason: rows.find((k) => k.reason)?.reason ?? null,
              globallyDisabled,
            };
          });
          return canWrite(DEFAULT_MATRIX, user.role, "settings") ? (
            <KillSwitchControls switches={views} />
          ) : (
            <ul className="mt-2 space-y-1 font-mono text-sm">
              {views.map((v) => (
                <li key={v.key} className="flex justify-between">
                  <span>{v.key}</span>
                  <span>{v.enabled ? "동작 중" : "중지됨"}</span>
                </li>
              ))}
            </ul>
          );
        })()}
      </section>

      <p className="mt-4 text-sm text-ink-soft">
        정책 편집·휴일 달력·교직원 초대 화면은 준비 중입니다. 외부 연동은{" "}
        <Link href="/app/settings/integrations" className="text-pen underline underline-offset-4">
          외부 명단 연동
        </Link>
        에서 확인하세요.
      </p>
    </div>
  );
}
