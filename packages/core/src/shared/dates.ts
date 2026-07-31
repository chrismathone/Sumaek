/**
 * 날짜 계산 — 시간대 안전.
 * 모든 시간은 UTC 저장, 수업 날짜 계산에는 워크스페이스 시간대 ID를 명시한다
 * (불변 조건 14). 엔진은 "현재 시각"을 읽지 않고 입력으로 받는다.
 */

/** ISO 날짜 문자열 (YYYY-MM-DD) — 일정 엔진의 기본 날짜 표현 */
export type IsoDate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string): IsoDate {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`유효한 ISO 날짜(YYYY-MM-DD)가 아닙니다: ${value}`);
  }
  return value;
}

/** UTC 자정 기준 Date 객체로 변환 (표시용 아님 — 산술용) */
export function toUtcDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function fromUtcDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

/** 0=일요일 … 6=토요일 (calendar_rules.weekday와 동일 규약) */
export function weekdayOf(date: IsoDate): number {
  return toUtcDate(date).getUTCDay();
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBetween(date: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return date >= from && date <= to;
}

/** from부터 to까지 (포함) 날짜 나열 — 결정론적 순서 */
export function eachDate(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * 특정 시간대의 벽시계 시각을 UTC Date로 변환.
 * DST가 없는 Asia/Seoul이 기본이지만 임의 IANA 시간대를 지원한다.
 */
export function zonedTimeToUtc(
  date: IsoDate,
  time: string, // HH:mm 또는 HH:mm:ss
  timeZone: string,
): Date {
  const [h = 0, m = 0, s = 0] = time.split(":").map(Number);
  // 1차 근사 후 해당 시간대의 실제 표시 시각과의 차이로 보정 (2회 반복으로 수렴)
  let utc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    h,
    m,
    s,
  );
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMs(new Date(utc), timeZone);
    utc = Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      h,
      m,
      s,
    ) - offset;
  }
  return new Date(utc);
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}
