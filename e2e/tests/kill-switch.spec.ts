import { expect, test, type Page } from "@playwright/test";

const TEACHER = {
  email: "demo-teacher@su-maek.app",
  password: process.env.DEMO_TEACHER_PASSWORD ?? "sumaek-demo-2026!",
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(TEACHER.email);
  await page.getByLabel("비밀번호").fill(TEACHER.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });
}

/**
 * 인수 40의 기초: kill switch를 화면에서 중지·재개할 수 있고, 사유 없는
 * 중지는 거부되며, 전환이 감사에 남는다. 자동화 게이트 자체(토픽 클레임
 * 제외·작업 연기)는 워커 코드 단위 테스트가 덮는다.
 */
test("kill switch: 사유 필수 중지 → 상태 전환 → 재개 → 감사 기록", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/settings");

  const section = page.locator("section").filter({ hasText: "Kill Switch" });
  const row = section.locator("li").filter({ hasText: "자동 일정 재계산" });

  // 이전 실행 잔재 정리 — 중지 상태로 남아 있으면 먼저 재개
  if (await row.getByRole("button", { name: "재개" }).isVisible()) {
    await row.getByRole("button", { name: "재개" }).click();
    await expect(row.getByText("동작 중")).toBeVisible({ timeout: 30_000 });
  }

  // 사유 없는 중지 → 정직한 거부
  await row.getByRole("button", { name: "중지" }).click();
  await expect(row.getByRole("status")).toContainText("중지 사유를 입력하세요", {
    timeout: 30_000,
  });
  await expect(row.getByText("동작 중")).toBeVisible();

  // 사유를 채워 중지 → 상태 전환 (React 19 폼 리셋 후 재입력)
  await row
    .getByLabel("자동 일정 재계산 중지 사유")
    .fill("E2E — 재계산 폭주 대응 훈련");
  await row.getByRole("button", { name: "중지" }).click();
  await expect(row.getByText("중지됨")).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText("재계산 폭주 대응 훈련")).toBeVisible();

  // 재개 — 다음 실행의 멱등성
  await row.getByRole("button", { name: "재개" }).click();
  await expect(row.getByText("동작 중")).toBeVisible({ timeout: 30_000 });

  // 감사 로그에 전환 기록
  await page.goto("/app/audit");
  await expect(page.getByText("settings.kill-switch").first()).toBeVisible();
});
