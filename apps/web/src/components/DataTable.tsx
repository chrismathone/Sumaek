import type { ReactNode } from "react";
import Link from "next/link";
import { ScrollableRegion } from "@/components/ScrollableRegion";
import {
  pageWindow,
  sortHref,
  tableHref,
  totalPages,
  type TableQuery,
} from "@/lib/table";

/* ─────────────────────────────────────────────────────────────
 * 목록 표 (탐색기 '자세히' 보기) — 정렬 가능한 열 머리, 행 전체 클릭,
 * 한 화면에 들어가는 페이지네이션.
 *
 * 서버 컴포넌트다. 정렬·이동은 전부 링크라 JS 없이도 동작하고, 뒤로 가기가
 * 그대로 이전 정렬·페이지로 돌아간다.
 *
 * 행 클릭: <tr>는 <a>를 감쌀 수 없으므로 첫 칸의 링크를 행 전체로 늘린다
 * (after:absolute inset-0). 탭 정지는 행당 하나로 유지된다.
 * ───────────────────────────────────────────────────────────── */

export interface Column<T> {
  /** 정렬 키 — 정렬 가능한 열은 페이지의 sortKeys에 있어야 한다 */
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  /** 숫자·날짜처럼 자릿수를 맞춰야 하는 열 */
  mono?: boolean;
  /** 좁은 화면에서 숨길 보조 열 */
  secondary?: boolean;
  className?: string;
  render: (row: T) => ReactNode;
}

const ALIGN = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  // 비활성도 같은 세모 글리프를 흐리게 쓴다 — ↕ 화살표와 세모가 섞여
  // 열마다 아이콘이 다른 것처럼 보이던 것을 한 계열로 통일.
  if (!active) {
    return (
      <span
        aria-hidden="true"
        className="ml-1 text-[10px] tracking-tighter text-ink-soft/40"
      >
        ▲▼
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="ml-1 text-[10px] text-pen">
      {dir === "asc" ? "▲" : "▼"}
    </span>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  total,
  query,
  basePath,
  empty,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** 있으면 행 전체가 이 경로로 이동한다 */
  rowHref?: (row: T) => string;
  /** 필터 적용 후 전체 행 수 (페이지네이션 계산용) */
  total: number;
  query: TableQuery;
  basePath: string;
  empty: ReactNode;
  /** 표의 설명 — 스크린리더에 읽히고 시각적으로도 표시된다 */
  caption?: string;
}) {
  const last = totalPages(total, query.pageSize);
  const from = total === 0 ? 0 : query.offset + 1;
  const to = Math.min(query.offset + query.pageSize, total);

  if (total === 0) {
    return (
      <div className="mt-3 rounded-lg border border-rule bg-surface p-6 text-center">
        {empty}
      </div>
    );
  }

  return (
    <div className="mt-3">
      {/*
        표는 min-w-[36rem]이라 좁은 화면에서 반드시 가로로 넘친다.
        행 링크가 있는 표는 그 링크로 스크롤이 되지만, 링크 없는 참조 표
        (예: 커리큘럼의 개념 목록)는 키보드로 밀 방법이 없었다.
      */}
      <ScrollableRegion
        label={caption ?? "목록 표"}
        className="rounded-lg border border-rule bg-surface"
      >
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          {caption && (
            <caption className="border-b border-rule-soft px-3 py-2 text-left text-xs text-ink-soft">
              {caption}
            </caption>
          )}
          <thead>
            <tr className="border-b border-rule bg-paper/60">
              {columns.map((col) => {
                const active = query.sort === col.key;
                const head = (
                  <span className="inline-flex items-center whitespace-nowrap">
                    {col.label}
                    {col.sortable && <SortIcon active={active} dir={query.dir} />}
                  </span>
                );
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={
                      active
                        ? query.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : col.sortable
                          ? "none"
                          : undefined
                    }
                    className={`px-3 py-2 text-xs font-semibold ${ALIGN[col.align ?? "left"]} ${
                      col.secondary ? "hidden sm:table-cell" : ""
                    } ${col.className ?? ""}`}
                  >
                    {col.sortable ? (
                      <Link
                        href={sortHref(basePath, query, col.key)}
                        className="rounded-[var(--radius-control)] hover:text-pen focus:outline-none focus-visible:ring-2 focus-visible:ring-pen"
                      >
                        {head}
                      </Link>
                    ) : (
                      head
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule-soft">
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className={`relative ${href ? "hover:bg-pen-soft/30" : ""}`}
                >
                  {columns.map((col, i) => {
                    const content = col.render(row);
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2 align-middle ${ALIGN[col.align ?? "left"]} ${
                          col.mono ? "font-mono text-xs" : ""
                        } ${col.secondary ? "hidden sm:table-cell" : ""} ${col.className ?? ""}`}
                      >
                        {href && i === 0 ? (
                          // 행 전체로 늘어나는 링크 — 탭 정지는 행당 하나
                          <Link
                            href={href}
                            className="font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:text-pen focus:outline-none focus-visible:ring-2 focus-visible:ring-pen"
                          >
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableRegion>

      <nav
        aria-label="페이지 이동"
        className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft"
      >
        <p>
          전체 {total.toLocaleString("ko-KR")}건 중 {from.toLocaleString("ko-KR")}–
          {to.toLocaleString("ko-KR")}
          {last > 1 && ` · ${query.page}/${last} 쪽`}
        </p>
        {last > 1 && (
          <ul className="flex items-center gap-1">
            <li>
              <PageLink
                href={tableHref(basePath, query, { page: query.page - 1 })}
                disabled={query.page <= 1}
                label="이전"
              />
            </li>
            {pageWindow(query.page, last).map((p, i) =>
              p === null ? (
                <li key={`gap-${i}`} aria-hidden="true" className="px-1">
                  …
                </li>
              ) : (
                <li key={p}>
                  <PageLink
                    href={tableHref(basePath, query, { page: p })}
                    current={p === query.page}
                    label={String(p)}
                  />
                </li>
              ),
            )}
            <li>
              <PageLink
                href={tableHref(basePath, query, { page: query.page + 1 })}
                disabled={query.page >= last}
                label="다음"
              />
            </li>
          </ul>
        )}
      </nav>
    </div>
  );
}

function PageLink({
  href,
  label,
  current,
  disabled,
}: {
  href: string;
  label: string;
  current?: boolean;
  disabled?: boolean;
}) {
  const base =
    "inline-block min-w-7 rounded-[var(--radius-control)] border px-2 py-1 text-center";
  if (disabled) {
    return (
      <span aria-disabled="true" className={`${base} border-rule-soft opacity-40`}>
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`${base} ${
        current
          ? "border-pen bg-pen text-white"
          : "border-rule hover:border-pen hover:text-pen"
      }`}
    >
      {label}
    </Link>
  );
}
