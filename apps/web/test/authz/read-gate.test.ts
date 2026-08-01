import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX, ROLES, canAccess, isPermissionLocked } from "@su-maek/core/authz";
import { NAV_GROUPS, firstAccessibleHref } from "@/lib/nav";

/* ─────────────────────────────────────────────────────────────
 * 읽기 게이트 회귀 검사 (인수 13).
 *
 * 내비에서 링크를 숨기는 것은 접근 제한이 아니다 — URL 직접 입력으로
 * 도달할 수 있었다. 모든 /app 페이지가 requireAccess로 조회를 막는지,
 * 그리고 메뉴 키가 내비 정의와 어긋나지 않는지 소스 수준에서 검사한다
 * (scripts/boundary-check.mjs와 같은 방식 — 드리프트는 사람이 못 막는다).
 * ───────────────────────────────────────────────────────────── */

const APP_DIR = fileURLToPath(new URL("../../src/app/app", import.meta.url));

/** 게이트 면제 — 거부된 사용자의 착지 지점과 역할별 분기 진입점 */
const EXEMPT = new Set(["no-access/page.tsx", "page.tsx"]);

function pageFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) return pageFiles(full, rel);
    return name === "page.tsx" ? [rel] : [];
  });
}

/** 내비 href(/app/foo) → 페이지 파일 상대경로(foo/page.tsx) */
function hrefToFile(href: string): string {
  return `${href.replace(/^\/app\/?/, "")}/page.tsx`.replace(/^\//, "");
}

const ALL_PAGES = pageFiles(APP_DIR);
const source = (rel: string) =>
  readFileSync(path.join(APP_DIR, rel), "utf8");

describe("읽기 게이트 (인수 13)", () => {
  it("모든 /app 페이지가 requireAccess를 호출한다", () => {
    const ungated = ALL_PAGES.filter(
      (rel) => !EXEMPT.has(rel) && !source(rel).includes("requireAccess("),
    );
    expect(ungated).toEqual([]);
  });

  it("게이트 없이 getCurrentUser로 바로 조회하는 페이지가 없다", () => {
    // 이 패턴이 바로 취약점이었다 — 역할 검사 없이 사용자만 꺼내 쓰는 형태
    const leaked = ALL_PAGES.filter(
      (rel) => !EXEMPT.has(rel) && source(rel).includes("(await getCurrentUser())!"),
    );
    expect(leaked).toEqual([]);
  });

  it("각 내비 항목의 페이지가 그 메뉴 키로 게이트한다", () => {
    const mismatched: string[] = [];
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        const rel = hrefToFile(item.href);
        if (!ALL_PAGES.includes(rel)) {
          mismatched.push(`${item.href} → 페이지 파일 없음(${rel})`);
          continue;
        }
        if (!source(rel).includes(`requireAccess("${item.menu}")`)) {
          mismatched.push(`${item.href} → requireAccess("${item.menu}") 없음`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("매트릭스 가드레일대로 콘텐츠 역할은 학습자 개인정보 메뉴가 닫혀 있다", () => {
    for (const role of ["content_manager", "content_reviewer"] as const) {
      for (const menu of ["learners", "mastery", "groups", "today", "grading", "reports"] as const) {
        expect(isPermissionLocked(menu, role)).toBe(true);
        expect(canAccess(DEFAULT_MATRIX, role, menu)).toBe(false);
      }
    }
  });

  it("거부 리다이렉트 대상은 그 역할이 실제로 열 수 있는 화면이다", () => {
    // 고정 경로로 보내면 그 메뉴가 none인 역할이 무한 루프에 빠진다
    for (const role of ROLES) {
      if (role === "student") continue;
      const href = firstAccessibleHref(role);
      if (href === null) continue;
      const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href);
      expect(item, `${role}의 착지 경로 ${href}가 내비에 없다`).toBeDefined();
      expect(canAccess(DEFAULT_MATRIX, role, item!.menu)).toBe(true);
    }
  });
});

describe("학생 영역 리다이렉트 (로그인 무한루프 방지)", () => {
  const layout = readFileSync(
    fileURLToPath(new URL("../../src/app/learn/layout.tsx", import.meta.url)),
    "utf8",
  );

  it("이미 로그인한 교직원을 /login으로 되돌리지 않는다", () => {
    // 교직원 분기가 로그인이 아니라 앱 영역으로 가야 루프가 끊긴다
    expect(layout).toContain('user.role !== "student"');
    expect(layout).toContain("firstAccessibleHref(user.role)");
  });

  it("미인증만 로그인으로 보낸다", () => {
    const loginRedirects = layout.match(/redirect\("\/login[^"]*"\)/g) ?? [];
    expect(loginRedirects).toHaveLength(1);
  });
});
