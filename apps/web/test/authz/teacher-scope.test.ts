import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SCOPE_EXEMPT_DETAIL_PAGES,
  resolveMenuScope,
} from "@/lib/auth/require-scope";

/* ─────────────────────────────────────────────────────────────
 * 담당 교사 데이터 스코프 (T5.3 · G-12).
 *
 * 매트릭스는 오래전부터 교사를 `scoped`로 적어 두었다. 그런데 그 값을
 * **읽는 곳이 없었다** — `canAccess`는 scoped를 「접근 가능」으로만 보고
 * 어느 범위인지는 아무도 묻지 않는다. 그래서 담당이 아닌 반의 상세 URL을
 * 직접 치면 그대로 열린다.
 *
 * 두 겹으로 막는다:
 *   ① 판정      — 역할의 메뉴 접근 등급에서 범위를 뽑는다 (순수)
 *   ② 정적 검사 — id를 받는 상세 화면이 그 판정을 부르는지 소스로 확인
 *
 * ②가 없으면 이 작업은 오늘만 맞다. 다음에 상세 화면이 하나 생기면
 * 조용히 빠지고, 빠진 것은 URL을 쳐 보기 전까지 아무도 모른다.
 * ───────────────────────────────────────────────────────────── */

describe("메뉴 등급 → 범위 (resolveMenuScope)", () => {
  it("full 등급은 조직 전체다", () => {
    expect(resolveMenuScope("owner", "learners")).toBe("organization");
    expect(resolveMenuScope("program_director", "groups")).toBe("organization");
  });

  it("scoped 등급은 담당 범위다 — 매트릭스가 이미 그렇게 적어 두었다", () => {
    expect(resolveMenuScope("teacher", "learners")).toBe("assigned");
    expect(resolveMenuScope("teacher", "groups")).toBe("assigned");
  });

  it("readonly도 등급이 scoped면 범위가 제한된다", () => {
    /* 읽기만 한다고 남의 반을 봐도 되는 것은 아니다 — 학습자 개인정보다. */
    expect(resolveMenuScope("grader", "learners")).toBe("assigned");
  });

  it("none이면 범위도 없다", () => {
    expect(resolveMenuScope("content_manager", "learners")).toBe("none");
    expect(resolveMenuScope("student", "groups")).toBe("none");
  });

  it("운영자의 readonly 열람은 조직 범위로 남는다", () => {
    /* break-glass 운영자는 장애 대응으로 조직 전체를 읽는다. 그 접근은
     * 승인·시한·감사로 이미 막혀 있고(4장), 여기서 또 좁히면 장애 때
     * 아무것도 못 본다. (learners는 운영자에게 아예 none이라 다른 메뉴로
     * 확인한다 — 개인정보는 break-glass로도 열리지 않는다.) */
    expect(resolveMenuScope("operator", "calendar")).toBe("organization");
    expect(resolveMenuScope("operator", "learners")).toBe("none");
  });
});

/* ── 정적 검사: 상세 화면이 범위를 확인하는가 ────────────── */

const APP_DIR = fileURLToPath(
  new URL("../../src/app/app", import.meta.url),
);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** `[id]`처럼 동적 구간을 가진 페이지 — URL로 남의 것을 지목할 수 있다 */
function detailPages(): Array<{ path: string; body: string }> {
  return walk(APP_DIR)
    .filter((p) => p.endsWith("page.tsx"))
    .map((p) => ({
      path: p.replace(APP_DIR, "").replace(/\\/g, "/"),
      body: readFileSync(p, "utf8"),
    }))
    .filter((f) => /\[[^\]]+\]/.test(f.path));
}

describe("상세 화면의 범위 확인 (정적)", () => {
  it("id를 받는 화면은 범위를 확인하거나 면제 사유가 적혀 있다", () => {
    /* 내비에서 링크를 숨기는 것은 접근 제한이 아니다 — require-access가
     * 같은 이유로 생겼다. 범위도 같다: 담당 반만 목록에 보여도 URL을 치면
     * 열린다. */
    const offenders = detailPages()
      .filter((f) => !/require(Group|Learner)Scope|resolveMenuScope/.test(f.body))
      .map((f) => f.path)
      .filter((p) => !(p in SCOPE_EXEMPT_DETAIL_PAGES))
      .sort();

    expect(offenders).toEqual([]);
  });

  it("면제 목록에 죽은 항목이 없다", () => {
    /* 화면이 사라졌는데 면제만 남으면, 다음에 같은 경로가 생길 때 조용히
     * 통과한다. */
    const existing = new Set(detailPages().map((f) => f.path));
    const stale = Object.keys(SCOPE_EXEMPT_DETAIL_PAGES).filter(
      (p) => !existing.has(p),
    );
    expect(stale).toEqual([]);
  });

  it("면제에는 전부 이유가 적혀 있다", () => {
    for (const [path, reason] of Object.entries(SCOPE_EXEMPT_DETAIL_PAGES)) {
      expect(reason.length, `${path}의 면제 사유가 너무 짧다`).toBeGreaterThan(10);
    }
  });
});
