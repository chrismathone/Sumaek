import Link from "next/link";
import type { TableQuery } from "@/lib/table";

/* 목록 표의 필터 줄 — GET 폼이라 JS 없이 동작하고, 결과 URL이 그대로 공유된다.
 * 제출하면 page 파라미터가 빠져 항상 1쪽부터 다시 본다. 정렬은 hidden으로 보존. */

export interface SelectFilter {
  name: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** 빈 값의 표시 이름 (기본 "전체") */
  allLabel?: string;
}

export function TableFilters({
  basePath,
  query,
  search,
  selects = [],
}: {
  basePath: string;
  query: TableQuery;
  search?: { label: string; placeholder?: string };
  selects?: SelectFilter[];
}) {
  const active = Object.keys(query.params).length > 0;

  return (
    <form
      method="get"
      action={basePath}
      className="mt-4 flex flex-wrap items-end gap-2"
    >
      {/* 정렬 상태 보존 — 필터를 바꿔도 보던 순서를 잃지 않는다 */}
      <input type="hidden" name="sort" value={query.sort} />
      <input type="hidden" name="dir" value={query.dir} />

      {search && (
        <div>
          <label htmlFor="q" className="block text-xs text-ink-soft">
            {search.label}
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder={search.placeholder}
            className="mt-1 w-48 rounded-[var(--radius-control)] border border-rule px-2 py-1 text-sm"
          />
        </div>
      )}

      {selects.map((filter) => (
        <div key={filter.name}>
          <label htmlFor={filter.name} className="block text-xs text-ink-soft">
            {filter.label}
          </label>
          <select
            id={filter.name}
            name={filter.name}
            defaultValue={query.params[filter.name] ?? ""}
            className="mt-1 rounded-[var(--radius-control)] border border-rule bg-surface px-2 py-1 text-sm"
          >
            <option value="">{filter.allLabel ?? "전체"}</option>
            {filter.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}

      <button
        type="submit"
        className="rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-sm text-pen hover:bg-pen-soft/50"
      >
        적용
      </button>
      {active && (
        <Link
          href={basePath}
          className="px-1 py-1.5 text-sm text-ink-soft underline underline-offset-4 hover:text-ink"
        >
          초기화
        </Link>
      )}
    </form>
  );
}
