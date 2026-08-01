import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// axe-core는 e2e의 직접 의존이 아니다(@axe-core/playwright의 전이 의존).
// 타입만 쓰자고 의존을 하나 더 늘리지 않고 analyze()의 반환에서 뽑아 쓴다.
type AxeViolation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

/* ─────────────────────────────────────────────────────────────
 * 접근성 자동 검사 (인수 15·59).
 *
 * 기준: axe 태그 wcag2a·wcag2aa — WCAG 2.0 A·AA에 해당하는 규칙군이다.
 *   WCAG 2.1에서 추가된 규칙(wcag21a·wcag21aa, 예: non-text-contrast)은
 *   이 기준에 포함되지 않는다. 과장하지 않기 위해 적어둔다.
 *
 * 제외한 규칙: 없다.
 *   withTags를 좁히거나 disableRules로 넘어간 항목은 하나도 없다.
 *   검사 시점에 실제로 깨져 있던 것은 전부 앱 소스를 고쳐서 없앴다:
 *     - 랜딩 FlowTabs의 <ol role="tablist"><li> 구조 3종
 *       (aria-required-children·aria-required-parent·listitem)
 *     - 좁은 폭에서 키보드로 밀 수 없던 가로 스크롤 상자
 *       (scrollable-region-focusable) → ScrollableRegion으로 통일
 *     - --color-grade가 본문 색으로 대비 미달 (color-contrast)
 *
 * axe의 incomplete(미결)는 위반이 아니므로 단언하지 않는다.
 *   현재 남는 미결은 전부 color-contrast이고, 원인은 두 가지뿐이다:
 *   (1) ①·▲·■·×·· 같은 한 글자 장식 기호 — axe가 "텍스트인지 판단 불가"로 보류,
 *   (2) SVG <text> 위에 이미지 노드가 겹쳐 배경색을 확정하지 못한 경우.
 *   해당 색 토큰(--color-ink-soft #3d4b63, --color-pen #2257d7,
 *   --color-grade #b53430)은 교사용지 배경 대비 각각 8.1:1·5.7:1·5.5:1로
 *   손으로 계산해 확인했다. 미결을 실패로 다루면 상시 빨간불이 된다.
 * ───────────────────────────────────────────────────────────── */

const WCAG_TAGS = ["wcag2a", "wcag2aa"];

const TEACHER = {
  email: "demo-teacher@su-maek.app",
  password: process.env.DEMO_TEACHER_PASSWORD ?? "sumaek-demo-2026!",
};

/** 로그인 없이 볼 수 있는 화면 */
const PUBLIC_PAGES = [
  { path: "/", label: "랜딩" },
  { path: "/product", label: "제품 소개" },
  { path: "/demo/test", label: "데모 테스트지" },
  { path: "/print/sample", label: "인쇄 샘플" },
  { path: "/login", label: "로그인" },
];

/** 교사 로그인 후에만 닿는 화면 */
const TEACHER_PAGES = [
  { path: "/app/today", label: "오늘 운영실" },
  { path: "/app/students", label: "학습자 목록" },
  { path: "/app/calendar", label: "수업 달력" },
  { path: "/app/settings", label: "설정" },
];

/**
 * 위반을 사람이 읽는 한 덩어리로 만든다.
 *
 * 실패 메시지만 보고 "어느 화면의 어떤 규칙이 어느 요소에서 깨졌는지"를
 * 알 수 있어야 한다 — 재현하러 브라우저를 다시 열게 만들지 않는다.
 */
function describeViolations(
  label: string,
  path: string,
  violations: AxeViolation[],
): string {
  if (violations.length === 0) return "";
  const lines = [
    `${label}(${path}) — WCAG A·AA(axe wcag2a·wcag2aa) 위반 ${violations.length}종`,
  ];
  for (const v of violations) {
    lines.push(
      `  ■ [${v.impact ?? "unknown"}] ${v.id} — ${v.help}`,
      `    ${v.helpUrl}`,
    );
    for (const node of v.nodes) {
      lines.push(`    ▸ 요소: ${node.target.join(" ")}`);
      lines.push(`      HTML: ${node.html.replace(/\s+/g, " ").slice(0, 200)}`);
      const why = (node.failureSummary ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" | ");
      if (why) lines.push(`      이유: ${why}`);
    }
  }
  return lines.join("\n");
}

/** 화면을 열고 검사 준비가 끝날 때까지 기다린다 */
async function open(page: Page, path: string, label: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: "load", timeout: 60_000 });
  expect(response?.status() ?? 0, `${label}(${path}) HTTP 응답`).toBeLessThan(400);
  // 폰트가 늦게 붙으면 색 대비·글자 크기 판정이 흔들린다 — 자산을 기다린 뒤 검사한다
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("main").first()).toBeVisible({ timeout: 30_000 });
}

async function scan(page: Page, path: string, label: string): Promise<string> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return describeViolations(label, path, results.violations);
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(TEACHER.email);
  await page.getByLabel("비밀번호").fill(TEACHER.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });
}

test.describe("접근성 자동 검사 — 비로그인 화면 (인수 15·59)", () => {
  for (const { path, label } of PUBLIC_PAGES) {
    test(`${label} ${path} — WCAG A·AA 위반 없음`, async ({ page }) => {
      await open(page, path, label);
      expect(await scan(page, path, label)).toBe("");
    });
  }
});

test.describe("접근성 자동 검사 — 오류 상태 (인수 15·59)", () => {
  /*
   * 정상 화면만 검사하면 오류 메시지 색은 영원히 검사되지 않는다.
   * 실제로 --color-grade는 bg-grade-soft 위에서 3.87:1이었다 — 화면을
   * 열어보기만 해서는 안 걸리고, 틀린 비밀번호를 넣어야 드러난다.
   */
  test("로그인 실패 알림이 뜬 상태에도 위반 없음", async ({ page }) => {
    await open(page, "/login", "로그인");
    await page.getByLabel("이메일").fill(TEACHER.email);
    await page.getByLabel("비밀번호").fill("wrong-password");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
    expect(await scan(page, "/login", "로그인(오류 알림 표시)")).toBe("");
  });
});

test.describe("접근성 자동 검사 — 교사 앱 (인수 15·59)", () => {
  test("교사 로그인 후 주요 화면에 WCAG A·AA 위반 없음", async ({ page }) => {
    // 로그인 왕복이 화면 수만큼 반복되지 않도록 한 테스트에서 순회하고,
    // 단언은 soft로 둔다 — 첫 화면에서 멈추면 나머지 세 화면 상태를 모른다.
    await login(page);
    for (const { path, label } of TEACHER_PAGES) {
      await open(page, path, label);
      expect.soft(await scan(page, path, label), `${label} 접근성`).toBe("");
    }
  });
});
