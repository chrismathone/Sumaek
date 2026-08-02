import { expect, test, type Page } from "@playwright/test";
import { TEACHER } from "../lib/accounts";

/* ─────────────────────────────────────────────────────────────
 * 수식 렌더 무결성 하네스 (인수 51·53·56·59).
 *
 * "테스트가 통과한다"와 "화면이 멀쩡하다"는 다르다. 실제 사고:
 * katex.min.css가 일부 라우트에만 로드돼 .katex-mathml이 숨겨지지 않았고,
 * 학생 응시 화면에 "x²+y=3" 뒤에 MathML 대체 텍스트 "x2 + y = 3"이 그대로
 * 보였다. 기존 단위·E2E 검사는 문자열만 봤기 때문에 전부 통과했다.
 *
 * 그래서 이 하네스는 **렌더된 DOM의 계산된 스타일**을 본다:
 *  1. .katex-mathml이 실제로 화면에서 감춰져 있는가 (폭·높이 ≤ 2px)
 *  2. 눈에 보이는 텍스트에 같은 수식이 두 번 나오지 않는가
 *  3. katex-error가 0건인가 (폴백 금지 — 인수 56)
 *  4. 원시 LaTeX가 새어나오지 않는가
 * ───────────────────────────────────────────────────────────── */

interface MathReport {
  katex: number;
  mathml: number;
  /** 화면에 드러난 MathML 노드 수 — 0이어야 한다 */
  exposedMathml: number;
  errors: number;
  /** 원시 LaTeX 흔적 */
  rawLatex: string[];
  /** 수식 하나가 텍스트로 두 번 반복된 사례 */
  duplicated: string[];
}

async function inspectMath(page: Page): Promise<MathReport> {
  return page.evaluate(() => {
    const katexNodes = Array.from(document.querySelectorAll<HTMLElement>(".katex"));
    const mathmlNodes = Array.from(
      document.querySelectorAll<HTMLElement>(".katex-mathml"),
    );

    /* MathML은 스크린리더 전용이다 — 시각적으로 1px 이하로 접혀 있어야 한다.
     * textContent로는 판별할 수 없다(숨겨져도 DOM에는 그대로 있다).
     * 화면에 드러났는지는 **박스 크기**만이 말해준다. */
    const exposed = mathmlNodes.filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    });

    /* 이중 표시 판정도 기하로 한다 — MathML이 흐름에 남으면 .katex 상자가
     * 실제 렌더인 .katex-html보다 뚜렷하게 넓어진다. */
    const duplicated: string[] = [];
    for (const node of katexNodes) {
      const html = node.querySelector<HTMLElement>(".katex-html");
      if (!html) continue;
      const outer = node.getBoundingClientRect().width;
      const inner = html.getBoundingClientRect().width;
      if (inner > 0 && outer > inner + 4) {
        duplicated.push(
          `${node.textContent?.slice(0, 40) ?? ""} (상자 ${Math.round(outer)}px > 렌더 ${Math.round(inner)}px)`,
        );
      }
    }

    /* 원시 LaTeX 유출은 **사람 눈에 보이는 텍스트**에서만 본다.
     * - .katex 안의 MathML annotation은 원본 LaTeX를 담는 것이 정상이다.
     * - script/style(특히 RSC 페이로드)에도 직렬화된 LaTeX가 들어 있다. */
    const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        for (let el = node.parentElement; el; el = el.parentElement) {
          if (SKIP.has(el.tagName) || el.classList.contains("katex")) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let visibleText = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      visibleText += n.nodeValue ?? "";
    }
    const rawLatex = [
      ...visibleText.matchAll(/\\(frac|sum|lim|sqrt|begin|left|right)\b/g),
    ].map((m) => m[0]);

    return {
      katex: katexNodes.length,
      mathml: mathmlNodes.length,
      exposedMathml: exposed.length,
      errors: document.querySelectorAll(".katex-error").length,
      rawLatex,
      duplicated,
    };
  });
}

/** 수식이 있는 화면이 지켜야 할 조건 — 어디서든 같다 */
async function expectCleanMath(page: Page, label: string) {
  const r = await inspectMath(page);
  expect(r.katex, `${label}: 수식이 하나도 렌더되지 않았다`).toBeGreaterThan(0);
  expect(
    r.exposedMathml,
    `${label}: MathML이 화면에 드러났다 — katex.min.css 미로드 (수식 이중 표시)`,
  ).toBe(0);
  expect(r.duplicated, `${label}: 같은 수식이 두 번 보인다`).toEqual([]);
  expect(r.errors, `${label}: katex-error 발생 (폴백 금지 — 인수 56)`).toBe(0);
  expect(r.rawLatex, `${label}: 원시 LaTeX가 새어나왔다`).toEqual([]);
}

/* ── 로그인 없이 볼 수 있는 수식 화면 ── */

test("인쇄 미리보기 — 수식이 한 번만, 오류 없이 렌더된다", async ({ page }) => {
  await page.goto("/print/sample");
  await page.waitForSelector(".katex");
  await expectCleanMath(page, "/print/sample");
});

test("샘플 응시 화면 — 학생이 보는 수식이 깨지지 않는다", async ({ page }) => {
  await page.goto("/demo/test");
  await page.waitForSelector(".katex");
  await expectCleanMath(page, "/demo/test");
});

/* ── 로그인이 필요한 수식 화면 ── */


test("문항 상세 — 검수 화면의 수식", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(TEACHER.email);
  await page.getByLabel("비밀번호").fill(TEACHER.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\//, { timeout: 30_000 });

  await page.goto("/app/content/questions");
  // 수식을 담은 첫 문항으로 들어간다
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toBeVisible();
  await firstRow.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/app\/content\/questions\/[0-9a-f-]{36}/, {
    timeout: 30_000,
  });

  const count = await page.locator(".katex").count();
  test.skip(count === 0, "이 문항에는 수식이 없다 — 다른 문항이 대상이다");
  await expectCleanMath(page, "/app/content/questions/[id]");
});
