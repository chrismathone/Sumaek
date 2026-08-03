/**
 * 날짜 계산 — 시간대 안전.
 * 모든 시간은 UTC로 저장하고, 날짜(수업일·기한·기록일)로 바꿀 때는 KST를 쓴다
 * (불변 조건 14). 엔진은 "현재 시각"을 읽지 않고 입력으로 받는다.
 */

/* ─────────────────────────────────────────────────────────────
 * 이 제품의 시간대는 **하나뿐이다.**
 *
 * 예전에는 조직마다 시간대를 고를 수 있는 것처럼 만들어 두고
 * `organizations.timezone`을 70곳 가까이 파라미터로 흘려보냈다. 그런데
 * 실제로 KST가 아닌 시간대 문자열은 코드·시드·테스트 어디에도 없었다 —
 * 고를 수 있는 척만 하는 설정이었다. 대신 값이 흘러 다니는 동안 화면마다
 * 기준이 갈렸다: 대부분은 조직 값을 읽었지만 교육과정·문항 상세 화면은
 * "Asia/Seoul"을 그대로 박아 두었다. 이런 어긋남은 timestamptz를 날짜 칸으로
 * 나눌 때 조용히 드러난다 — UTC 기준 ::date를 쓰면 오전 9시 KST에 한 일이
 * 전날 칸에 들어간다.
 *
 * 그래서 **고를 수 없게** 만든다. 시간대를 인자로 받지 않으면 잘못 넘길 수도
 * 없다. DB의 timezone 컬럼(organizations·sessions·learner_schedule_items)은
 * "그때 무엇이 참이었나"를 남기는 감사 스냅샷으로 남기되, 동작 분기의 입력이
 * 되지는 않는다. 이 규약은 core/test/kst-pin.test.ts가 지킨다.
 * ───────────────────────────────────────────────────────────── */
/** 이 제품의 유일한 시간대. 서머타임이 없어 오프셋은 항상 +09:00이다. */
export const KST = "Asia/Seoul";

/**
 * KST 기준 오늘 (YYYY-MM-DD).
 *
 * **엔진이 부르는 함수가 아니다.** 일정 엔진은 "현재 시각"을 읽지 않고
 * `today`를 입력으로 받는다(그래야 재현 가능하다). 이 함수는 그 입력을
 * 만들어 넣는 **호출자** — 화면·핸들러 — 쪽의 시계 읽기다. 엔진 안에서
 * 이걸 부르면 그 순간 결정론이 깨진다.
 */
export function todayInKst(): IsoDate {
  return new Date().toLocaleDateString("en-CA", { timeZone: KST });
}

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
 * KST 벽시계 시각을 UTC Date로 변환.
 *
 * 시간대를 인자로 받지 않는다 — 위 KST 주석 참고. 보정 반복은 남겨 둔다:
 * 한국은 서머타임이 없어 지금은 1회로 수렴하지만, 이 함수가 하는 일은
 * "오프셋을 가정하지 않고 실제 표시 시각에서 되짚는 것"이고 +09:00을
 * 상수로 박는 순간 그 성질을 잃는다.
 */
export function zonedTimeToUtc(
  date: IsoDate,
  time: string, // HH:mm 또는 HH:mm:ss
): Date {
  const timeZone = KST;
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
