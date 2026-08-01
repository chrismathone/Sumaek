/* ─────────────────────────────────────────────────────────────
 * 목록 표 공통 규약 — 정렬·필터·페이지네이션을 URL 파라미터로 다룬다.
 *
 * 서버 렌더링만으로 동작한다(JS 없이도 링크·GET 폼으로 조작 가능). 정렬 키는
 * 반드시 화이트리스트를 통과해야 하며, 페이지가 그 키를 SQL ORDER BY로
 * 번역한다 — 사용자 입력이 쿼리에 그대로 들어가지 않는다.
 * ───────────────────────────────────────────────────────────── */

export type SortDir = "asc" | "desc";

/** 바깥 스크롤이 생기지 않는 한 화면 분량 — 표 한 쪽의 기본 행 수 */
export const DEFAULT_PAGE_SIZE = 10;
/** 셀이 한 줄인 조밀한 표(감사 로그 등)는 조금 더 담는다 */
export const DENSE_PAGE_SIZE = 15;

export interface TableQuery {
  page: number;
  pageSize: number;
  offset: number;
  sort: string;
  dir: SortDir;
  /** 검색어 (없으면 빈 문자열) */
  q: string;
  /** 원본 파라미터 — 링크를 만들 때 나머지 필터를 보존한다 */
  params: Record<string, string>;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * 검색 파라미터 해석. sortKeys에 없는 정렬 키는 조용히 기본값으로 되돌린다
 * (조작된 URL이 쿼리를 바꾸지 못한다).
 */
export function parseTableQuery(
  searchParams: RawSearchParams,
  options: {
    sortKeys: readonly string[];
    defaultSort: string;
    defaultDir?: SortDir;
    pageSize?: number;
    /** 보존할 추가 필터 파라미터 이름 */
    filterKeys?: readonly string[];
  },
): TableQuery {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const rawPage = Number.parseInt(one(searchParams.page), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawSort = one(searchParams.sort);
  const sort = options.sortKeys.includes(rawSort) ? rawSort : options.defaultSort;

  const rawDir = one(searchParams.dir);
  const dir: SortDir =
    rawDir === "asc" || rawDir === "desc" ? rawDir : (options.defaultDir ?? "asc");

  const q = one(searchParams.q).trim();

  const params: Record<string, string> = {};
  if (q) params.q = q;
  for (const key of options.filterKeys ?? []) {
    const value = one(searchParams[key]).trim();
    if (value) params[key] = value;
  }

  return { page, pageSize, offset: (page - 1) * pageSize, sort, dir, q, params };
}

/** 현재 파라미터를 유지한 채 일부만 바꾼 링크 */
export function tableHref(
  basePath: string,
  query: TableQuery,
  patch: Record<string, string | number | undefined>,
): string {
  const next = new URLSearchParams(query.params);
  next.set("sort", query.sort);
  next.set("dir", query.dir);
  if (query.page > 1) next.set("page", String(query.page));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** 헤더 클릭 링크 — 같은 열이면 방향 토글, 다른 열이면 오름차순부터 */
export function sortHref(
  basePath: string,
  query: TableQuery,
  key: string,
): string {
  const dir: SortDir = query.sort === key && query.dir === "asc" ? "desc" : "asc";
  return tableHref(basePath, query, { sort: key, dir, page: undefined });
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * 페이지 번호 창 — 항상 최대 7칸이라 폭이 튀지 않는다.
 * 생략 구간은 null로 표시한다.
 */
export function pageWindow(current: number, last: number): Array<number | null> {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const out: Array<number | null> = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(last - 1, current + 1);
  if (from > 2) out.push(null);
  for (let p = from; p <= to; p++) out.push(p);
  if (to < last - 1) out.push(null);
  out.push(last);
  return out;
}
