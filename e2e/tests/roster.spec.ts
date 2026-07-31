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

/** 인수 3의 기초: 시드 없이 반·학습자를 스스로 등록하는 자립 흐름 */
test("등록 흐름: 반 만들기 → 학습자 등록 → 목록 반영", async ({ page }) => {
  await login(page);
  await page.goto("/app/settings");

  const stamp = Date.now().toString(36).slice(-5);
  const groupName = `E2E반-${stamp}`;
  const learnerName = `E2E학생-${stamp}`;

  // 반 만들기 (시드된 과정 기간 사용)
  const groupSection = page
    .locator("section")
    .filter({ hasText: "반 만들기" });
  await groupSection.getByLabel("반 이름").fill(groupName);
  await groupSection.getByLabel("과정 설명").fill("E2E 등록 검증");
  await groupSection.getByText("화", { exact: true }).click();
  await groupSection.getByText("목", { exact: true }).click();
  await groupSection.getByRole("button", { name: "반 만들기" }).click();
  await expect(
    groupSection.getByRole("status").filter({ hasText: "만들었습니다" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    groupSection.getByRole("status").filter({ hasText: "주 2회 수업" }),
  ).toBeVisible();

  // 학습자 등록 — 새 반 선택
  await page.reload();
  const learnerSection = page
    .locator("section")
    .filter({ hasText: "학습자 등록" });
  await learnerSection.getByLabel("이름 (표시명)").fill(learnerName);
  await learnerSection.getByLabel("학년").fill("middle-2");
  await learnerSection.getByLabel("소속 반").selectOption({ label: groupName });
  await learnerSection.getByRole("button", { name: "학습자 등록" }).click();
  await expect(
    learnerSection.getByRole("status").filter({ hasText: "등록했습니다" }),
  ).toBeVisible({ timeout: 30_000 });

  // 반 목록·학습자 목록에 반영
  await page.goto("/app/classes");
  await expect(page.getByText(groupName)).toBeVisible();
  await page.goto("/app/students");
  await expect(page.getByText(learnerName)).toBeVisible();

  // 감사 로그에 기록
  await page.goto("/app/audit");
  await expect(
    page.getByText(/settings\.create-group|settings\.add-learner/).first(),
  ).toBeVisible();
});
