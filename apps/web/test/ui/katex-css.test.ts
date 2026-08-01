import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* ─────────────────────────────────────────────────────────────
 * KaTeX 스타일시트 로드 회귀 검사 (인수 51·53·59).
 *
 * 실제 사고: katex.min.css가 문항 상세·인쇄 레이아웃에만 import돼 있어서
 * 학생 응시 화면(/learn)과 앱 대부분에서 `output:"htmlAndMathml"`의
 * .katex-mathml이 숨겨지지 않았다. 화면에는 수식이 두 번 나왔다 —
 * "x²+y=3" 뒤에 MathML 대체 텍스트 "x2 + y = 3"이 그대로 붙었다.
 *
 * 이 검사는 브라우저 없이 즉시 도는 1차 방어선이다.
 * 실제 렌더 결과는 e2e/tests/math-render.spec.ts가 DOM에서 확인한다.
 * ───────────────────────────────────────────────────────────── */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const KATEX_CSS = "katex/dist/katex.min.css";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("KaTeX 스타일시트", () => {
  const rootLayout = readFileSync(path.join(SRC, "app/layout.tsx"), "utf8");

  it("루트 레이아웃이 katex.min.css를 로드한다", () => {
    // 여기서 빠지면 앱 전체에서 수식이 이중으로 보인다
    expect(rootLayout).toContain(KATEX_CSS);
  });

  it("수식을 렌더하는 화면이 스타일시트 없는 트리에 있지 않다", () => {
    // 루트 레이아웃이 모든 라우트를 감싸므로, 루트에 있으면 전 화면이 덮인다.
    // 별도 <html>을 여는 레이아웃이 생기면 그 트리도 직접 로드해야 한다.
    const rogueRoots = walk(path.join(SRC, "app"))
      .filter((f) => f.endsWith("layout.tsx"))
      .filter((f) => f !== path.join(SRC, "app/layout.tsx"))
      .filter((f) => readFileSync(f, "utf8").includes("<html"))
      .filter((f) => !readFileSync(f, "utf8").includes(KATEX_CSS))
      .map((f) => path.relative(SRC, f));
    expect(rogueRoots).toEqual([]);
  });
});
