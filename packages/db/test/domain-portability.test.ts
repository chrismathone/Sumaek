import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* ─────────────────────────────────────────────────────────────
 * 공유 도메인의 이식성.
 *
 * `packages/db/src/domain`은 **웹과 워커가 함께 쓰는** 자리다. 여기에
 * Next 전용 import가 하나라도 들어가면 워커가 그 함수를 부르는 순간 죽는다.
 * 평가 생성이 정확히 그래서 apps/web 안에 갇혀 있었고(`import "server-only"`),
 * 워커가 만들 수 없으니 교사가 버튼을 눌러야만 테스트가 생겼다.
 *
 * 실행 테스트로는 못 막는다 — 워커에서 부르는 코드를 쓰기 전까지는 아무도
 * 눈치채지 못한다. 소스를 직접 본다.
 * ───────────────────────────────────────────────────────────── */

const DOMAIN = fileURLToPath(new URL("../src/domain", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : full.endsWith(".ts")
        ? [full]
        : [];
  });
}

const FILES = walk(DOMAIN).map((path) => ({
  path: path.replace(DOMAIN, "").replace(/\\/g, "/"),
  body: readFileSync(path, "utf8"),
}));

/** 워커에서 죽는 import — Next 런타임에만 있는 것들 */
const WEB_ONLY = [
  /from\s+["']server-only["']/,
  /import\s+["']server-only["']/,
  /from\s+["']next\//,
  /from\s+["']next["']/,
  /from\s+["']react["']/,
  /from\s+["']@\//, // apps/web의 경로 별칭
];

describe("공유 도메인은 워커에서도 돈다", () => {
  it("Next·React 전용 import가 없다", () => {
    const offenders = FILES.filter((f) =>
      WEB_ONLY.some((re) => re.test(f.body)),
    ).map((f) => f.path);

    expect(offenders).toEqual([]);
  });

  it("평가 생성이 공유 도메인에 있다", () => {
    /* apps/web 안에 있으면 워커가 부를 수 없다 — 자동 생성(M3)이 서지 못한다. */
    expect(FILES.map((f) => f.path)).toContain("/assessment-generation.ts");
  });

  it("도메인 파일은 상대 경로로 클라이언트를 가져온다", () => {
    /* `@su-maek/db`를 자기 패키지 안에서 다시 부르면 순환 참조가 된다. */
    const selfImporters = FILES.filter((f) =>
      /from\s+["']@su-maek\/db["']/.test(f.body),
    ).map((f) => f.path);

    expect(selfImporters).toEqual([]);
  });
});
