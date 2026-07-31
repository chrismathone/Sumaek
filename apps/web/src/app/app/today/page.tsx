import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "오늘 수업" };

/* 오늘 운영실 (골프롬프트 9장) — 선생님의 기본 진입 화면.
 * 서버 데이터 계층에서 실데이터를 읽는다. 데이터가 없으면 정직한 빈 상태와
 * 다음 행동을 보여준다 (26장 — 가짜 데이터 금지). */

export default async function TodayPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const [groups, todaySessions, exceptions, proposals] = await Promise.all([
    sql<
      { id: string; name: string; course_name: string | null; learner_count: number }[]
    >`
      select g.id, g.name, g.course_name,
             (select count(*)::int from learning_group_memberships m
               where m.learning_group_id = g.id and m.status = 'active') as learner_count
      from learning_groups g
      where g.organization_id = ${user.organizationId} and g.status = 'operating'
      order by g.name
    `,
    sql<
      { id: string; starts_at: Date; ends_at: Date; group_name: string; status: string }[]
    >`
      select s.id, s.starts_at, s.ends_at, g.name as group_name, s.status
      from sessions s
      join learning_groups g on g.id = s.learning_group_id
      where s.organization_id = ${user.organizationId}
        and s.session_date = (now() at time zone ${user.timezone})::date
      order by s.starts_at
    `,
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from grading_exceptions
      where organization_id = ${user.organizationId} and status in ('open', 'assigned')
    `,
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from schedule_change_proposals
      where organization_id = ${user.organizationId} and status = 'proposed'
    `,
  ]);

  const exceptionCount = exceptions[0]?.cnt ?? 0;
  const proposalCount = proposals[0]?.cnt ?? 0;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">오늘 수업</h1>

      {/* 상단 요약 */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="오늘 수업" value={`${todaySessions.length}건`} />
        <SummaryCard label="운영 중인 반" value={`${groups.length}개`} />
        <SummaryCard
          label="채점 예외"
          value={`${exceptionCount}건`}
          tone={exceptionCount > 0 ? "warn" : "ok"}
        />
        <SummaryCard
          label="승인 대기 일정 변경"
          value={`${proposalCount}건`}
          tone={proposalCount > 0 ? "warn" : "ok"}
        />
      </div>

      {/* 시간순 수업 목록 */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">시간순 수업</h2>
        {todaySessions.length === 0 ? (
          <div className="mt-3 rounded-lg border border-rule bg-surface p-6 text-center">
            <p className="font-medium">오늘 예정된 수업이 없습니다.</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              게시된 루트에서 날짜별 수업을 생성하면 여기에 표시됩니다.
            </p>
            <Link
              href="/app/routes"
              className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
            >
              학습 루트에서 일정 생성하기
            </Link>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {todaySessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium">{s.group_name}</p>
                  <p className="font-mono text-xs text-ink-soft">
                    {formatTime(s.starts_at)} – {formatTime(s.ends_at)}
                  </p>
                </div>
                <span className="font-mono text-xs text-ink-soft">{statusLabel(s.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 운영 중인 반 */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">운영 중인 반</h2>
        {groups.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            아직 반이 없습니다. 설정에서 반과 학습자를 등록하세요.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <li key={g.id} className="rounded-lg border border-rule bg-surface p-4">
                <p className="font-semibold">{g.name}</p>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {g.course_name ?? "과정 미지정"} · 학습자 {g.learner_count}명
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone === "warn"
          ? "border-highlight bg-highlight-soft"
          : "border-rule bg-surface"
      }`}
    >
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold">{value}</p>
    </div>
  );
}

function formatTime(d: Date): string {
  return new Date(d).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    planned: "예정",
    confirmed: "확정",
    in_progress: "진행 중",
    completed: "완료",
    cancelled: "취소",
    makeup_planned: "보강 계획",
  };
  return map[status] ?? status;
}
