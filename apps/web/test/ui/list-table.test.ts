import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DENSE_PAGE_SIZE, pageWindow, parseTableQuery, sortHref, tableHref } from "@/lib/table";

/* ─────────────────────────────────────────────────────────────
 * 목록 화면 규약 회귀 검사.
 *
 * 목록을 카드로 되돌리거나(정렬·페이지네이션 상실), 행을 클릭할 수 없게
 * 만드는 회귀를 막는다 — 실제로 /app/today의 반 카드가 링크가 아니어서
 * 클릭이 전혀 되지 않는 상태로 배포돼 있었다.
 * ───────────────────────────────────────────────────────────── */

const APP_DIR = fileURLToPath(new URL("../../src/app/app", import.meta.url));
const read = (rel: string) => readFileSync(path.join(APP_DIR, rel), "utf8");

/** 목록을 그리는 화면 — 전부 공통 표를 써야 한다 */
const LIST_PAGES = [
  "today/page.tsx",
  "classes/page.tsx",
  "students/page.tsx",
  "routes/page.tsx",
  "tests/page.tsx",
  "content/questions/page.tsx",
  "content/curriculum/page.tsx",
  "content/books/page.tsx",
  "content/ingestion/page.tsx",
  "content/review/page.tsx",
  "grading/page.tsx",
  "inbox/page.tsx",
  "audit/page.tsx",
  "analytics/page.tsx",
] as const;

/** 목록 → 상세 이동이 가능해야 하는 화면 (상세 라우트가 실제로 있는 것) */
const ROW_LINK_PAGES: ReadonlyArray<[page: string, detailDir: string]> = [
  ["today/page.tsx", "classes/[id]"],
  ["classes/page.tsx", "classes/[id]"],
  ["students/page.tsx", "students/[id]"],
  ["routes/page.tsx", "routes/[id]"],
  ["content/questions/page.tsx", "content/questions/[id]"],
];

describe("목록 화면 표 규약", () => {
  it("모든 목록 화면이 공통 DataTable을 쓴다", () => {
    const missing = LIST_PAGES.filter((p) => !read(p).includes("DataTable"));
    expect(missing).toEqual([]);
  });

  it("표를 쓰는 화면은 정렬·페이지네이션까지 배선한다", () => {
    // DataTable만 쓰고 parseTableQuery가 없으면 정렬·쪽 이동이 죽은 장식이 된다
    const unwired = LIST_PAGES.filter((p) => !read(p).includes("parseTableQuery"));
    expect(unwired).toEqual([]);
  });

  it("상세 화면이 있는 목록은 행이 클릭된다", () => {
    const notLinked: string[] = [];
    for (const [page, detailDir] of ROW_LINK_PAGES) {
      expect(
        existsSync(path.join(APP_DIR, detailDir, "page.tsx")),
        `상세 라우트가 사라졌다: ${detailDir}`,
      ).toBe(true);
      if (!read(page).includes("rowHref")) notLinked.push(page);
    }
    expect(notLinked).toEqual([]);
  });

  it("한 쪽 행 수를 늘려 바깥 스크롤을 만들지 않는다", () => {
    // pageSize를 직접 넘기는 경우 DENSE_PAGE_SIZE 이하만 허용한다
    const tooBig: string[] = [];
    for (const page of LIST_PAGES) {
      for (const m of read(page).matchAll(/pageSize:\s*(\d+)/g)) {
        if (Number(m[1]) > DENSE_PAGE_SIZE) tooBig.push(`${page} (${m[1]})`);
      }
    }
    expect(tooBig).toEqual([]);
  });
});

describe("표 파라미터 해석", () => {
  const opts = {
    sortKeys: ["name", "count"],
    defaultSort: "name",
    filterKeys: ["status"],
  };

  it("허용 목록에 없는 정렬 키는 기본값으로 되돌린다", () => {
    const q = parseTableQuery({ sort: "name; drop table users", dir: "desc" }, opts);
    expect(q.sort).toBe("name");
    expect(q.dir).toBe("desc");
  });

  it("잘못된 쪽 번호는 1쪽으로 본다", () => {
    for (const page of ["0", "-3", "abc", ""]) {
      expect(parseTableQuery({ page }, opts).page).toBe(1);
    }
    expect(parseTableQuery({ page: "4" }, opts).offset).toBe(30);
  });

  it("정렬을 바꿔도 필터가 유지되고 쪽은 1로 돌아간다", () => {
    const q = parseTableQuery({ q: "가나", status: "active", page: "5" }, opts);
    const href = sortHref("/app/classes", q, "count");
    expect(href).toContain("q=%EA%B0%80%EB%82%98");
    expect(href).toContain("status=active");
    expect(href).toContain("sort=count");
    expect(href).not.toContain("page=");
  });

  it("같은 열을 다시 누르면 방향이 뒤집힌다", () => {
    const asc = parseTableQuery({ sort: "count", dir: "asc" }, opts);
    expect(sortHref("/app/classes", asc, "count")).toContain("dir=desc");
    const desc = parseTableQuery({ sort: "count", dir: "desc" }, opts);
    expect(sortHref("/app/classes", desc, "count")).toContain("dir=asc");
  });

  it("쪽 이동 링크는 정렬·필터를 그대로 들고 간다", () => {
    const q = parseTableQuery({ sort: "count", dir: "desc", status: "active" }, opts);
    const href = tableHref("/app/classes", q, { page: 3 });
    expect(href).toContain("sort=count");
    expect(href).toContain("dir=desc");
    expect(href).toContain("status=active");
    expect(href).toContain("page=3");
  });

  it("쪽 번호 창은 항상 7칸 이하라 폭이 튀지 않는다", () => {
    for (const last of [1, 5, 7, 8, 20, 100]) {
      for (const cur of [1, Math.ceil(last / 2), last]) {
        expect(pageWindow(cur, last).length).toBeLessThanOrEqual(7);
      }
    }
    expect(pageWindow(50, 100)).toEqual([1, null, 49, 50, 51, null, 100]);
  });
});
