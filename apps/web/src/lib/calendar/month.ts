/* ─────────────────────────────────────────────────────────────
 * 월간 격자의 날짜 계산.
 *
 * 전부 Date.UTC 기반이라 실행 환경의 로컬 시간대에 흔들리지 않는다 —
 * 여기서 하는 일은 "달력 눈금 만들기"이지 시각 변환이 아니다. 표시할
 * 실제 시각은 KST로 변환한다 (lib/format.ts).
 *
 * 출처: app/app/calendar/page.tsx의 같은 이름 함수들을 옮겨 왔다. 교사
 * 달력은 **이번 변경에서 건드리지 않았다** — 그 화면은 axe 검사 대상이라
 * 세 뷰포트 회귀 확인이 따라붙고, 지금 필요한 것은 학생 화면이다. 그래서
 * 30줄이 두 벌 있다는 사실을 알고 남긴다. 교사 달력을 이 모듈로 갈아끼우는
 * 것은 별건이고, 그때 이 주석을 지우면 된다.
 * ───────────────────────────────────────────────────────────── */

/** 0=일요일 — 격자 첫 열이 일요일이다 */
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export interface MonthView {
  /** YYYY-MM */
  key: string;
  firstDay: string;
  lastDay: string;
  /** 그 달의 모든 날 (YYYY-MM-DD) */
  days: string[];
  /** 1일 앞에 두어야 할 빈 칸 수 */
  leadingBlanks: number;
  prevMonth: string;
  nextMonth: string;
}

/** ?month=YYYY-MM 해석 — 형식이 어긋나면 조용히 fallback으로 되돌린다 */
export function resolveMonth(
  raw: string | undefined,
  fallback: string,
): MonthView {
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

export function shiftMonth(year: number, month: number, delta: number): string {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 그 달의 몇 번째 날인지로 요일을 구한다.
 *
 * `new Date("2026-08-03")`을 거치지 않는 것이 요점이다 — 그 파싱은 UTC로
 * 해석되고 `getDay()`는 로컬로 답해서, 서버의 오프셋이 **음수면**(아메리카
 * 대륙 등) 요일이 하루 앞으로 어긋난다. UTC나 KST 서버는 멀쩡하므로 로컬과
 * CI에서는 영영 드러나지 않는다 — 그래서 테스트가 시간대 축을 따로 돈다
 * (`test/ui/month.test.ts`). 격자를 만든 배열에서 세면 그런 일이 아예 없다.
 */
export function weekdayIndex(view: MonthView, day: string): number {
  const i = view.days.indexOf(day);
  return i < 0 ? 0 : (view.leadingBlanks + i) % 7;
}
