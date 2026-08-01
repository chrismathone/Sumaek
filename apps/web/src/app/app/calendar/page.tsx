import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";
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
  /** 셀에서 반 화면으로 이동하기 위한 대상 */
  learning_group_id: string;
}

interface HolidayRow {
  id: string;
  name: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  group_name: string | null;
}

/** 셀 높이 고정 — 일정이 많은 날 때문에 주 행이 늘어나지 않게 한다 */
const CELL_HEIGHT = "h-28";
/** 셀에 그대로 보여줄 최대 항목 수. 나머지는 "+N개 더"로 접는다 */
const MAX_VISIBLE_ENTRIES = 2;

type CalendarEntry =
  | { kind: "holiday"; holiday: HolidayRow }
  | { kind: "session"; session: SessionRow };

function entryKey(entry: CalendarEntry): string {
  return entry.kind === "holiday" ? `h-${entry.holiday.id}` : `s-${entry.session.id}`;
}

/** 셀·스마트창에서 같은 모양으로 쓰는 한 줄 항목 */
function EntryChip({
  entry,
  timezone,
}: {
  entry: CalendarEntry;
  timezone: string;
}) {
  if (entry.kind === "holiday") {
    const h = entry.holiday;
    return (
      <p
        className="mt-0.5 truncate rounded-[var(--radius-control)] bg-highlight-soft px-1 py-0.5 text-[11px]"
        title={`${h.name} (${label(HOLIDAY_KIND_LABEL, h.kind)}${
          h.group_name ? ` · ${h.group_name}` : ""
        })`}
      >
        {label(HOLIDAY_KIND_LABEL, h.kind)} {h.name}
      </p>
    );
  }
  const s = entry.session;
  return (
    <Link
      href={`/app/classes/${s.learning_group_id}`}
      className={`mt-0.5 block truncate rounded-[var(--radius-control)] border-l-2 px-1 py-0.5 text-[11px] hover:bg-pen-soft/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-pen ${
        SESSION_TONE[s.status] ?? "border-rule text-ink"
      }`}
      title={`${s.group_name} ${formatTime(s.starts_at, timezone)} · ${label(
        SESSION_STATUS_LABEL,
        s.status,
      )}`}
    >
      <span className="font-mono">{formatTime(s.starts_at, timezone)}</span>{" "}
      {s.group_name}
    </Link>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireAccess("calendar");
  const sql = getSharedSql();

  const today = todayInTimeZone(user.timezone);
  const { month } = await searchParams;
  const view = resolveMonth(month, today.slice(0, 7));

  const [sessions, holidays] = await Promise.all([
    sql<SessionRow[]>`
      select s.id, s.session_date::text as session_date, s.starts_at, s.status,
             g.name as group_name, s.learning_group_id
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
        {/* 월 이동 — 화살표는 아이콘만, 가운데에 보고 있는 달을 크게.
            "오늘"은 현재 달로 즉시 복귀 (파라미터 없는 경로가 이번 달이다). */}
        <nav className="flex items-center gap-1.5" aria-label="월 이동">
          <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-rule">
            <Link
              href={`/app/calendar?month=${view.prevMonth}`}
              aria-label={`이전 달 (${view.prevMonth})`}
              className="px-2.5 py-1.5 text-sm hover:bg-pen-soft/50"
            >
              ‹
            </Link>
            <span
              aria-current="date"
              className="min-w-28 border-x border-rule px-3 py-1.5 text-center text-sm font-semibold"
            >
              {Number(view.key.slice(0, 4))}년 {Number(view.key.slice(5, 7))}월
            </span>
            <Link
              href={`/app/calendar?month=${view.nextMonth}`}
              aria-label={`다음 달 (${view.nextMonth})`}
              className="px-2.5 py-1.5 text-sm hover:bg-pen-soft/50"
            >
              ›
            </Link>
          </div>
          <Link
            href="/app/calendar"
            className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-sm hover:bg-pen-soft/50"
          >
            오늘
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
                    className={`${CELL_HEIGHT} border-r border-b border-rule-soft bg-paper/50 last:border-r-0`}
                  />
                );
              }
              const daySessions = sessionsByDay.get(day) ?? [];
              const dayHolidays = holidaysByDay.get(day) ?? [];
              const isToday = day === today;

              /* 셀 높이를 고정하고 넘치는 만큼만 "+N"으로 접는다 —
               * 일정이 많은 날 때문에 주 전체 행이 늘어나지 않게 한다. */
              const entries: CalendarEntry[] = [
                ...dayHolidays.map((h) => ({ kind: "holiday" as const, holiday: h })),
                ...daySessions.map((s) => ({ kind: "session" as const, session: s })),
              ];
              const visible = entries.slice(0, MAX_VISIBLE_ENTRIES);
              const hidden = entries.length - visible.length;

              return (
                <div
                  key={day}
                  className={`relative ${CELL_HEIGHT} border-r border-b border-rule-soft p-1.5 ${
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

                  {visible.map((e) => (
                    <EntryChip key={entryKey(e)} entry={e} timezone={user.timezone} />
                  ))}

                  {hidden > 0 && (
                    /* details 기반 스마트창 — JS 없이 열리고 Esc·탭으로 다룰 수 있다
                     * (모바일 내비와 같은 방식, 인수 15) */
                    <details className="group relative">
                      <summary className="mt-0.5 cursor-pointer list-none rounded-[var(--radius-control)] px-1 py-0.5 text-[11px] text-ink-soft hover:bg-pen-soft/50 hover:text-pen focus:outline-none focus-visible:ring-2 focus-visible:ring-pen [&::-webkit-details-marker]:hidden">
                        +{hidden}개 더
                      </summary>
                      <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-rule bg-surface p-2 shadow-lg">
                        <p className="px-1 pb-1 font-mono text-[11px] text-ink-soft">
                          {day} · {entries.length}건
                        </p>
                        <div className="max-h-56 overflow-y-auto">
                          {entries.map((e) => (
                            <EntryChip
                              key={`all-${entryKey(e)}`}
                              entry={e}
                              timezone={user.timezone}
                            />
                          ))}
                        </div>
                      </div>
                    </details>
                  )}
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
