import { expect, test } from "@playwright/test";

test("랜딩이 수학 수업 설계 제품임을 보여준다", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("수학 선생님을 위한 수업 운영 시스템"),
  ).toBeVisible();
});
