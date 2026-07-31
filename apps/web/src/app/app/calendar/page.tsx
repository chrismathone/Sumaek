import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  HOLIDAY_KIND_LABEL,
  SESSION_STATUS_LABEL,
  formatTime,
  label,
  todayInTimeZone,
} from "@/lib/format";

export const metadata: Metadata = { title: "캘린더" };

/* 월간 캘린더 (10장 축소판) — 실제 수업과 휴일만 그린다.
 * 날짜는 워크스페이스 시간대 기준 session_date를 그대로 쓰고(문자열 비교),
 * 시각만 timestamptz를 시간대로 변환한다 (불변 조건 14). */

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 수업 상태별 표시 — 색만으로 구분하지 않고 라벨을 함께 둔다 (5장) */
const SESSION_TONE: Record<string, string> = {
  planned: "border-pen text-pen",
  confirmed: "border-pen text-pen",
  in_progress: "border-pen bg-pen-soft text-pen",
  completed: "border-rule text-ink",
  cancelled: "border-grade text-grade line-through",
  makeup_planned: "border-highlight bg-highlight-soft text-ink",
};

interface SessionRow {
  id: string;
  session_date: string;
  starts_at: Date;
  status: string;
  group_name: string;
}

interface HolidayRow {
  id: string;
  name: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  group_name: string | null;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const today = todayInTimeZone(user.timezone);
  const { month } = await searchParams;
  const view = resolveMonth(month, today.slice(0, 7));

  const [sessions, holidays] = await Promise.all([
    sql<SessionRow[]>`
      select s.id, s.session_date::text as session_date, s.starts_at, s.status,
             g.name as group_name
      from sessions s
      join learning_groups g on g.id = s.learning_group_id
      where s.organization_id = ${user.organizationId}
        and s.session_date between ${view.firstDay}::date and ${view.lastDay}::date
      order by s.session_date, s.starts_at
    `,
    sql<HolidayRow[]>`
      select h.id, h.name, h.kind,
             h.starts_on::text as starts_on, h.ends_on::text as ends_on,
             g.name as group_name
      from holidays h
      left join learning_groups g on g.id = h.learning_group_id
      where h.organization_id = ${user.organizationId}
        and h.starts_on <= ${view.lastDay}::date
        and h.ends_on >= ${view.firstDay}::date
      order by h.starts_on
    `,
  ]);

  const sessionsByDay = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const list = sessionsByDay.get(s.session_date);
    if (list) list.push(s);
    else sessionsByDay.set(s.session_date, [s]);
  }

  const holidaysByDay = new Map<string, HolidayRow[]>();
  for (const day of view.days) {
    const hit = holidays.filter((h) => h.starts_on <= day && h.ends_on >= day);
    if (hit.length > 0) holidaysByDay.set(day, hit);
  }

  const cells: (string | null)[] = [
    ...Array.from({ length: view.leadingBlanks }, () => null),
    ...view.days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isEmpty = sessions.length === 0 && holidays.length === 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[MaruBuri] text-2xl font-semibold">캘린더</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {user.timezone} 기준 · 수업 {sessions.length}건 · 휴일{" "}
            {holidaysByDay.size}일
          </p>
        </div>
        <nav className="flex items-center gap-2" aria-label="월 이동">
          <Link
            href={`/app/calendar?month=${view.prevMonth}`}
            className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 font-mono text-sm hover:bg-surface"
          >
            ← {view.prevMonth}
          </Link>
          <span className="font-mono text-sm font-semibold">{view.key}</span>
          <Link
            href={`/app/calendar?month=${view.nextMonth}`}
            className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 font-mono text-sm hover:bg-surface"
          >
            {view.nextMonth} →
          </Link>
        </nav>
      </div>

      {/* 범례 — 색만으로 구분되지 않도록 라벨을 함께 둔다 */}
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        <li>
          <span className="text-pen">■</span> 예정·확정
        </li>
        <li>
          <span className="text-ink">■</span> 완료
        </li>
        <li>
          <span className="text-grade">■</span> 취소
        </li>
        <li>
          <span className="text-highlight">■</span> 보강 계획
        </li>
      </ul>

      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[42rem] rounded-lg border border-rule bg-surface">
          <div className="grid grid-cols-7 border-b border-rule-soft">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={`px-2 py-2 text-center text-xs font-semibold ${
                  i === 0 ? "text-grade" : "text-ink-soft"
                }`}
              >
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, index) => {
              if (!day) {
                return (
                  <div
                    key={`blank-${index}`}
                    className="min-h-24 border-r border-b border-rule-soft bg-paper/50 last:border-r-0"
                  />
                );
              }
              const daySessions = sessionsByDay.get(day) ?? [];
              const dayHolidays = holidaysByDay.get(day) ?? [];
              const isToday = day === today;
              return (
                <div
                  key={day}
                  className={`min-h-24 border-r border-b border-rule-soft p-1.5 ${
                    isToday ? "bg-pen-soft" : ""
                  }`}
                >
                  <p
                    className={`font-mono text-xs ${
                      index % 7 === 0 ? "text-grade" : "text-ink-soft"
                    } ${isToday ? "font-bold text-pen" : ""}`}
                  >
                    {Number(day.slice(8))}
                    {isToday && <span className="ml-1 text-[10px]">오늘</span>}
                  </p>

                  {dayHolidays.map((h) => (
                    <p
                      key={h.id}
                      className="mt-1 truncate rounded-[var(--radius-control)] bg-highlight-soft px-1 py-0.5 text-[11px]"
                      title={`${h.name} (${label(HOLIDAY_KIND_LABEL, h.kind)}${
                        h.group_name ? ` · ${h.group_name}` : ""
                      })`}
                    >
                      {label(HOLIDAY_KIND_LABEL, h.kind)} {h.name}
                    </p>
                  ))}

                  {daySessions.map((s) => (
                    <p
                      key={s.id}
                      className={`mt-1 truncate rounded-[var(--radius-control)] border-l-2 px-1 py-0.5 text-[11px] ${
                        SESSION_TONE[s.status] ?? "border-rule text-ink"
                      }`}
                      title={`${s.group_name} ${formatTime(
                        s.starts_at,
                        user.timezone,
                      )} · ${label(SESSION_STATUS_LABEL, s.status)}`}
                    >
                      <span className="font-mono">
                        {formatTime(s.starts_at, user.timezone)}
                      </span>{" "}
                      {s.group_name}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {isEmpty && (
        <div className="mt-4 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">{view.key}에 등록된 수업·휴일이 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            게시된 학습 루트에서 일정을 생성하면 이 달력에 채워집니다. 휴일은
            설정에서 등록합니다.
          </p>
          <Link
            href="/app/routes"
            className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            학습 루트에서 일정 생성하기
          </Link>
        </div>
      )}
    </div>
  );
}

interface MonthView {
  key: string;
  firstDay: string;
  lastDay: string;
  days: string[];
  leadingBlanks: number;
  prevMonth: string;
  nextMonth: string;
}

/** ?month=YYYY-MM 해석 — 형식이 어긋나면 조용히 이번 달로 되돌린다 */
function resolveMonth(raw: string | undefined, fallback: string): MonthView {
  const key = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : fallback;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));

  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = Array.from(
    { length: dayCount },
    (_, i) => `${key}-${String(i + 1).padStart(2, "0")}`,
  );

  return {
    key,
    firstDay: days[0]!,
    lastDay: days[dayCount - 1]!,
    days,
    leadingBlanks: new Date(Date.UTC(year, month - 1, 1)).getUTCDay(),
    prevMonth: shiftMonth(year, month, -1),
    nextMonth: shiftMonth(year, month, 1),
  };
}

function shiftMonth(year: number, month: number, delta: number): string {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
