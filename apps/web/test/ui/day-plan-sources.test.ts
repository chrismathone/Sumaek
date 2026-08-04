import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* ─────────────────────────────────────────────────────────────
 * 날짜 규칙이 화면으로 새지 않는지 소스 수준에서 본다.
 *
 * G-01은 코드가 아니라 **위치**의 문제였다. 배정 날짜 규칙이 오늘 화면
 * 안에 있었고, 그래서 규칙이 화면 수만큼 생길 수 있었다. 실행 테스트는
 * 「지금 맞는가」만 보지 「다시 새지 않는가」는 못 본다 — list-table.test.ts와
 * 같은 방식으로 소스를 직접 검사한다.
 * ───────────────────────────────────────────────────────────── */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "node_modules" || name === ".next" ? [] : walk(full);
    }
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

const FILES = walk(SRC).map((path) => ({ path, body: readFileSync(path, "utf8") }));

/** `/app/learn/...` — 학생이 보는 화면 */
function isLearnerScreen(path: string): boolean {
  return path.replace(/\\/g, "/").includes("/src/app/learn/");
}

function rel(files: { path: string }[]): string[] {
  return files.map((f) => f.path.replace(SRC, "").replace(/\\/g, "/"));
}

/** 오늘의 노드·개념 범위가 필요한 학생 화면 — 전부 같은 곳에서 받아야 한다. */
const SCOPE_PAGES = [
  "app/learn/today/page.tsx",
  "app/learn/study/page.tsx",
  "app/learn/watch/page.tsx",
  "app/learn/practice/page.tsx",
];

describe("날짜 규칙의 위치", () => {
  it("90일 창이 어디에도 없다", () => {
    const offenders = FILES.filter((f) => /date\s*-\s*90/.test(f.body)).map(
      (f) => f.path,
    );
    expect(offenders).toEqual([]);
  });

  it("학생 화면은 배정을 직접 조인하지 않는다 — 투영기를 거친다", () => {
    /* 교사 화면(app/app/...)과 응시 도메인은 다른 질문에 답하므로 자기
     * 질의를 갖는다. 여기서 막는 것은 **학생 화면**이 배정 날짜 규칙을
     * 다시 쓰는 것이다 — 90일 창이 정확히 그렇게 살아 있었다. */
    const offenders = rel(
      FILES.filter(
        (f) =>
          isLearnerScreen(f.path) &&
          /from\s+assignments/.test(f.body) &&
          /join\s+assessment_instances/.test(f.body),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("오늘 범위가 필요한 화면 넷이 모두 같은 곳에서 받는다", () => {
    for (const rel of SCOPE_PAGES) {
      const file = FILES.find((f) =>
        f.path.replace(/\\/g, "/").endsWith(rel),
      );
      expect(file, `${rel}이 없다`).toBeDefined();
      expect(
        /getTodayScope|projectToday/.test(file!.body),
        `${rel}이 오늘 범위를 스스로 구한다`,
      ).toBe(true);
    }
  });

  it("학생 화면 중 계획층을 직접 읽는 곳은 둘뿐이다", () => {
    /* 계획층(learner_schedule_items)을 오늘 범위로 읽는 것은 투영기의 몫이다.
     * 허용된 둘은 다른 것을 읽는다:
     *   today   — 차시 **시각·재합류 표시**(계획 항목에 없는 화면 전용 값).
     *             어느 쪽을 읽을지는 투영기의 판단(view.source)을 따른다.
     *   records — 지난 날의 이력. 하루 계획은 마이그레이션 이후 날짜에만
     *             있으므로 이력을 계획으로 바꾸면 과거가 통째로 사라진다
     *             (ADR-0018 §7). */
    const readers = rel(
      FILES.filter(
        (f) => isLearnerScreen(f.path) && /from\s+learner_schedule_items/.test(f.body),
      ),
    );

    expect(readers.sort()).toEqual([
      "/app/learn/records/page.tsx",
      "/app/learn/today/page.tsx",
    ]);
  });
});
