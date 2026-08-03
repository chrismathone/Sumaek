/* ─────────────────────────────────────────────────────────────
 * 한국천문연구원 특일 정보 어댑터 (data.go.kr) — 공휴일·대체공휴일.
 *
 * 전국 공통이므로 연도당 호출 1회면 충분하다 — 학교별로 받지 않는다.
 * 이 API는 향후 약 1년치만 선입력되므로, 먼 연도는 빈 결과가 정상이다
 * (호출자는 0건을 오류로 취급하지 않는다).
 * ───────────────────────────────────────────────────────────── */

const KASI_BASE =
  "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService";
const TIMEOUT_MS = 10_000;

export interface PublicHoliday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
}

export type KasiResult =
  | { ok: true; holidays: PublicHoliday[] }
  | { ok: false; message: string };

function apiKey(): string {
  return (process.env.DATA_GO_KR_API_KEY ?? "").trim();
}

/** 한 해의 공휴일(대체공휴일 포함) 전체 — isHoliday=Y만 취한다 */
export async function fetchPublicHolidays(year: number): Promise<KasiResult> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      message:
        "DATA_GO_KR_API_KEY가 비어 있습니다. .env에 채운 뒤 pnpm env:sync를 실행하세요.",
    };
  }

  const query = new URLSearchParams({
    serviceKey: key,
    solYear: String(year),
    numOfRows: "100",
    _type: "json",
  });
  let body: unknown;
  try {
    const response = await fetch(`${KASI_BASE}/getRestDeInfo?${query}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    // 키 오류·차단 시 XML로 응답한다 — JSON 파싱 전에 구분
    if (text.trimStart().startsWith("<")) {
      const reason = text.match(/<returnAuthMsg>([^<]+)</)?.[1];
      return {
        ok: false,
        message: `특일 API 거부: ${reason ?? "XML 오류 응답"} — Decoding 키인지, 활용신청이 승인됐는지 확인하세요.`,
      };
    }
    body = JSON.parse(text);
  } catch {
    return { ok: false, message: "특일 API 응답 없음 — 네트워크를 확인하세요." };
  }

  const parsed = body as {
    response?: {
      header?: { resultCode?: string; resultMsg?: string };
      body?: { items?: { item?: unknown } | "" };
    };
  };
  const header = parsed.response?.header;
  if (header?.resultCode !== "00") {
    return {
      ok: false,
      message: `특일 API 오류: ${header?.resultMsg ?? "알 수 없는 응답"}`,
    };
  }

  const rawItems = parsed.response?.body?.items;
  const items =
    rawItems && typeof rawItems === "object" && "item" in rawItems
      ? rawItems.item
      : [];
  // 1건이면 배열이 아니라 객체로 온다 — data.go.kr 공통 함정
  const list = Array.isArray(items) ? items : items ? [items] : [];

  const holidays: PublicHoliday[] = [];
  for (const item of list as Array<Record<string, unknown>>) {
    if (String(item.isHoliday ?? "") !== "Y") continue;
    const locdate = String(item.locdate ?? "");
    if (!/^\d{8}$/.test(locdate)) continue;
    holidays.push({
      date: `${locdate.slice(0, 4)}-${locdate.slice(4, 6)}-${locdate.slice(6, 8)}`,
      name: String(item.dateName ?? "").trim() || "공휴일",
    });
  }
  return { ok: true, holidays };
}
