/* ─────────────────────────────────────────────────────────────
 * NEIS 나이스 교육정보 개방 포털 어댑터 (1A장 연동 경계 · 인수 61).
 *
 * 설계 원칙: 전체 학교를 내려받지 않는다 — 학원이 연결한 학교만,
 * 오늘~과정 기간 종료일 범위만, 요청 시에만 조회한다.
 * (전국 ~12,000교 × 연 ~140행 = 99.9%가 이 학원과 무관하다.)
 *
 * 허용 필드 목록(NEIS_ALLOWED_FIELDS) 밖의 응답 필드(주소·전화·팩스 등)는
 * 매핑 단계에서 버린다 — 저장 전 폐기 (인수 61).
 * 인증키가 없으면 NEIS는 호출당 5건 샘플만 준다 — 결과에 정직하게 표시한다.
 * ───────────────────────────────────────────────────────────── */

const NEIS_BASE = "https://open.neis.go.kr/hub";
const TIMEOUT_MS = 10_000;

/** 수신을 허용하는 NEIS 응답 필드 — 이 밖은 저장 전 폐기 (인수 61) */
export const NEIS_ALLOWED_FIELDS = [
  "ATPT_OFCDC_SC_CODE", // 시도교육청 코드
  "ATPT_OFCDC_SC_NM", // 시도교육청명
  "SD_SCHUL_CODE", // 표준 학교 코드
  "SCHUL_NM", // 학교명
  "SCHUL_KND_SC_NM", // 학교 종류 (초·중·고)
  "AA_YMD", // 학사 일자
  "EVENT_NM", // 행사명
  "SBTR_DD_SC_NM", // 수업 공제일 구분 (공휴일·휴업일)
] as const;

export interface NeisSchool {
  officeCode: string;
  officeName: string;
  schoolCode: string;
  name: string;
  kind: string; // 초등학교·중학교·고등학교
}

export interface NeisScheduleEvent {
  /** YYYY-MM-DD */
  date: string;
  eventName: string;
  /** 공휴일 | 휴업일 | null(수업일 행사) */
  dayOff: string | null;
}

interface NeisFetchOk<T> {
  ok: true;
  rows: T[];
  totalCount: number;
  /** 키 없는 샘플 호출 여부 — 5건 제한이라 부분 결과일 수 있다 */
  sampleOnly: boolean;
}

interface NeisFetchError {
  ok: false;
  message: string;
}

export type NeisFetchResult<T> = NeisFetchOk<T> | NeisFetchError;

function apiKey(): string {
  return (process.env.NEIS_API_KEY ?? "").trim();
}

/** NEIS 응답 공통 해석 — 정상: {Service:[{head},{row}]}, 무자료·오류: {RESULT:{CODE}} */
async function callNeis(
  service: string,
  params: Record<string, string>,
): Promise<NeisFetchResult<Record<string, unknown>>> {
  const key = apiKey();
  const query = new URLSearchParams({
    Type: "json",
    pIndex: "1",
    pSize: "1000",
    ...(key ? { KEY: key } : {}),
    ...params,
  });
  let body: unknown;
  try {
    const response = await fetch(`${NEIS_BASE}/${service}?${query}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = await response.json();
  } catch {
    return { ok: false, message: "NEIS 응답 없음 — 네트워크·포털 상태를 확인하세요." };
  }

  const root = body as Record<string, unknown>;
  const envelope = root[service] as
    | Array<Record<string, unknown>>
    | undefined;
  if (!envelope) {
    // 무자료(INFO-200)·키 오류 등은 최상위 RESULT로 온다
    const result = (root.RESULT ?? {}) as { CODE?: string; MESSAGE?: string };
    if (result.CODE === "INFO-200") {
      return { ok: true, rows: [], totalCount: 0, sampleOnly: !key };
    }
    return {
      ok: false,
      message: `NEIS 오류: ${result.MESSAGE ?? "알 수 없는 응답"} (${result.CODE ?? "?"})`,
    };
  }

  const head = envelope[0]?.head as Array<Record<string, unknown>> | undefined;
  const totalCount = Number(
    (head?.[0] as { list_total_count?: number } | undefined)
      ?.list_total_count ?? 0,
  );
  const rows =
    (envelope[1]?.row as Array<Record<string, unknown>> | undefined) ?? [];
  return { ok: true, rows, totalCount, sampleOnly: !key };
}

/** 학교 검색 — 이름 부분 일치. 허용 필드만 남긴다 */
export async function searchSchools(
  name: string,
): Promise<NeisFetchResult<NeisSchool>> {
  const result = await callNeis("schoolInfo", { SCHUL_NM: name });
  if (!result.ok) return result;
  return {
    ...result,
    rows: result.rows.map((row) => ({
      officeCode: String(row.ATPT_OFCDC_SC_CODE ?? ""),
      officeName: String(row.ATPT_OFCDC_SC_NM ?? ""),
      schoolCode: String(row.SD_SCHUL_CODE ?? ""),
      name: String(row.SCHUL_NM ?? ""),
      kind: String(row.SCHUL_KND_SC_NM ?? ""),
    })),
  };
}

/** 학사일정 조회 — 연결된 한 학교의 지정 기간만 */
export async function fetchSchoolSchedule(input: {
  officeCode: string;
  schoolCode: string;
  /** YYYYMMDD */
  fromYmd: string;
  /** YYYYMMDD */
  toYmd: string;
}): Promise<NeisFetchResult<NeisScheduleEvent>> {
  const result = await callNeis("SchoolSchedule", {
    ATPT_OFCDC_SC_CODE: input.officeCode,
    SD_SCHUL_CODE: input.schoolCode,
    AA_FROM_YMD: input.fromYmd,
    AA_TO_YMD: input.toYmd,
  });
  if (!result.ok) return result;
  return {
    ...result,
    rows: result.rows.map((row) => {
      const ymd = String(row.AA_YMD ?? "");
      const dayOff = String(row.SBTR_DD_SC_NM ?? "").trim();
      return {
        date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
        eventName: String(row.EVENT_NM ?? "").trim(),
        dayOff: dayOff === "" || dayOff === "*" ? null : dayOff,
      };
    }),
  };
}

/* ── 순수 분류 — 학원 수업 조정에 의미 있는 것만 취한다 ── */

const EXAM_PATTERN = /시험|고사|지필평가/;
const EXAM_EXCLUDE = /모의|진단|기초학력/;

/**
 * 학사일정에서 가져올 것 판정.
 * - 공휴일: 버린다 — 전국 공통은 특일 API(연 1회)가 담당, 학교별 중복 금지
 * - 지필 시험·고사(모의 제외): school_exam — 학원이 정규 진도를 멈추는 기간.
 *   수행평가는 수업 중 실시라 학원 진도를 멈출 이유가 없어 제외한다.
 * - 휴업일·방학: 버린다 — 학교가 쉬는 날은 학원 수업일이다
 */
export function classifyScheduleEvent(
  event: NeisScheduleEvent,
): "school_exam" | null {
  if (event.dayOff === "공휴일") return null;
  if (EXAM_PATTERN.test(event.eventName) && !EXAM_EXCLUDE.test(event.eventName)) {
    return "school_exam";
  }
  return null;
}

export interface DateRange {
  name: string;
  startsOn: string;
  endsOn: string;
}

/** 같은 이름의 연속 일자를 기간 하나로 합친다 (중간고사 3일 → 1행) */
export function mergeConsecutiveDates(
  events: Array<{ date: string; name: string }>,
): DateRange[] {
  const sorted = [...events].sort(
    (a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date),
  );
  const ranges: DateRange[] = [];
  for (const event of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.name === event.name && nextDay(last.endsOn) === event.date) {
      last.endsOn = event.date;
    } else if (last && last.name === event.name && last.endsOn === event.date) {
      continue; // 같은 날 중복 행
    } else {
      ranges.push({ name: event.name, startsOn: event.date, endsOn: event.date });
    }
  }
  return ranges;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10);
}
