import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KST, todayInKst, zonedTimeToUtc } from "../src/shared/index.js";

/* ─────────────────────────────────────────────────────────────
 * 시간대 못 (KST pin).
 *
 * 이 제품의 시간대는 하나뿐이다 (core/shared/dates.ts의 KST 주석 참고).
 * 규약은 코드로 지켜지지 않으면 반년 뒤 조용히 풀린다 — 실제로 예전에
 * `organizations.timezone`을 70곳 가까이 흘려보내면서 교육과정·문항 상세
 * 화면만 "Asia/Seoul"을 그대로 박아 두어 기준이 갈려 있었다.
 *
 * 그래서 **소스를 직접 훑는다.** 여기서 걸리면 방법은 하나다: 리터럴을
 * 지우고 KST 상수를 쓰거나, 시간대 인자를 받지 않는 헬퍼로 바꾸는 것.
 * 이 테스트를 느슨하게 만들어 통과시키는 것은 답이 아니다.
 * ───────────────────────────────────────────────────────────── */

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** 상수가 사는 곳 — 유일하게 리터럴이 허용된다 */
const DEFINITION = "packages/core/src/shared/dates.ts";

/**
 * 테스트 픽스처는 조직 행에 시간대 문자열을 직접 넣는다(그게 DB 값이다).
 * 그건 동작 분기가 아니므로 못의 대상이 아니다.
 */
const isTestFile = (p: string) =>
  p.includes("/test/") || p.endsWith(".test.ts") || p.endsWith(".spec.ts");

function sourceFiles(): string[] {
  return execSync(
    'git ls-files -- "apps/*/src/**/*.ts" "apps/*/src/**/*.tsx" "packages/*/src/**/*.ts"',
    { cwd: REPO, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((p) => !isTestFile(p));
}

const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

describe("시간대 못 — KST 하나로 고정한다", () => {
  it("상수는 Asia/Seoul이고 오늘 날짜는 KST로 읽는다", () => {
    expect(KST).toBe("Asia/Seoul");
    expect(todayInKst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayInKst()).toBe(
      new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
    );
  });

  it("KST 벽시계 09:00은 UTC 00:00이다 (서머타임 없음)", () => {
    expect(zonedTimeToUtc("2026-08-03", "09:00").toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
    // 겨울에도 같은 오프셋 — 한국은 DST를 쓰지 않는다
    expect(zonedTimeToUtc("2026-01-15", "09:00").toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
  });

  it('소스에 "Asia/Seoul" 리터럴은 상수 정의 파일에만 있다', () => {
    /* 스키마의 컬럼 기본값은 예외다 — 그건 DB에 남는 감사 스냅샷의 기본값이지
     * 동작을 가르는 코드가 아니다. */
    const offenders = sourceFiles().filter(
      (p) =>
        p !== DEFINITION &&
        !p.includes("/schema/") &&
        read(p).includes("Asia/Seoul"),
    );
    expect(
      offenders,
      "KST 상수를 import해서 쓰세요 (@su-maek/core/shared)",
    ).toEqual([]);
  });

  it("timeZone 옵션에 KST 말고 다른 것을 넘기지 않는다", () => {
    const offenders: string[] = [];
    for (const p of sourceFiles()) {
      if (p === DEFINITION) continue;
      read(p)
        .split("\n")
        .forEach((line, i) => {
          const m = line.match(/timeZone:\s*([^,}\s]+)/);
          if (m && m[1] !== "KST") offenders.push(`${p}:${i + 1} — ${line.trim()}`);
        });
    }
    expect(offenders, "timeZone: KST 로 통일하세요").toEqual([]);
  });

  it("SQL의 at time zone도 상수 바인딩만 쓴다", () => {
    /* `o.timezone`처럼 **행에서 읽은 값**으로 시간대를 정하는 것이 이 못이
     * 막으려는 것이다 — 실제로 ai-usage.ts의 월 집계가 그렇게 돌고 있었다.
     * postgres.js 템플릿이므로 ${KST}는 바인드 파라미터로 나간다. */
    const offenders: string[] = [];
    for (const p of sourceFiles()) {
      read(p)
        .split("\n")
        .forEach((line, i) => {
          const m = line.match(/at time zone\s+([^\s)_,]+)/);
          if (m && m[1] !== "${KST}") {
            offenders.push(`${p}:${i + 1} — ${line.trim()}`);
          }
        });
    }
    expect(
      offenders,
      "SQL 안에서도 at time zone ${KST} 로 쓰세요 (행에서 읽은 시간대 금지)",
    ).toEqual([]);
  });

  it("동작 코드가 organizations.timezone 을 읽지 않는다", () => {
    /* 컬럼 자체는 남는다 — "그때 무엇이 참이었나"를 남기는 감사 스냅샷이다.
     * 다만 그것을 **읽어서 동작을 가르는** 순간 시간대가 다시 설정이 된다. */
    const offenders: string[] = [];
    for (const p of sourceFiles()) {
      if (p.includes("/schema/")) continue; // 컬럼 정의는 남겨 둔다
      read(p)
        .split("\n")
        .forEach((line, i) => {
          if (/select\s+timezone\s+from\s+organizations/i.test(line)) {
            offenders.push(`${p}:${i + 1} — ${line.trim()}`);
          }
        });
    }
    expect(offenders, "KST 상수를 쓰세요 — 조직별 시간대는 없습니다").toEqual([]);
  });
});
