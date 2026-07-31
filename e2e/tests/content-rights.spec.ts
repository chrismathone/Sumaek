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
 * 인수 30의 기초: 사용 권한 중지가 즉시 표시·집행되고 (신규 출제 풀 제외),
 * 복구가 가능하며, 전환이 감사에 남는다. 워커의 영향 목록 전파는
 * content.rights-impact 핸들러가 담당한다 (워커 스모크 대상).
 *
 * 시드 권한 "수맥 합성 콘텐츠"를 중지하면 시드 문항 8개가 전부 풀에서
 * 빠지므로, 스펙 끝에서 반드시 복구한다 (뒤에 오는 full-loop가 출제 풀을
 * 쓴다). 시작 시에도 복구를 시도해 이전 실패 실행의 잔재를 정리한다.
 */
test("사용 권한 중지 → 출제 제외 안내 → 복구 → 감사 기록", async ({ page }) => {
  await login(page);
  await page.goto("/app/content/books");

  const row = page
    .locator("li")
    .filter({ hasText: "수맥 합성 콘텐츠" })
    .first();
  await expect(row).toBeVisible();

  // 0. 이전 실행 잔재 정리 — 중지 상태면 먼저 복구
  if (await row.getByRole("button", { name: "다시 사용 가능으로" }).isVisible()) {
    await row.getByRole("button", { name: "다시 사용 가능으로" }).click();
    await expect(row.getByText("사용 가능", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  }

  // 1. 사유 없는 중지 → 정직한 거부
  await row.getByRole("button", { name: "사용 중지" }).click();
  await expect(row.getByRole("status")).toContainText("중지 사유를 입력하세요", {
    timeout: 30_000,
  });

  // 2. 사유를 채워 중지 (React 19 폼 리셋 후 재입력)
  await row
    .getByLabel("수맥 합성 콘텐츠 (자체 제작) 사용 중지 사유")
    .fill("E2E — 사용권 회수 훈련");
  await row.getByRole("button", { name: "사용 중지" }).click();
  await expect(row.getByRole("status")).toContainText(
    "신규 출제에서 즉시 제외",
    { timeout: 30_000 },
  );
  await expect(row.getByText("차단", { exact: true })).toBeVisible();
  await expect(row.getByRole("status")).toContainText(/영향 문항 \d+개/);

  // 3. 복구 — 신규 출제 풀 복귀 (뒤 스펙들의 전제).
  //    출제 풀 필터 자체(usable만 진입)는 선정 엔진 단위 테스트가 덮는다.
  await row.getByRole("button", { name: "다시 사용 가능으로" }).click();
  await expect(row.getByRole("status")).toContainText("복귀", {
    timeout: 30_000,
  });
  await expect(row.getByText("사용 가능", { exact: true })).toBeVisible();

  // 4. 감사 로그에 회수·복구 기록
  await page.goto("/app/audit");
  await expect(page.getByText("content.rights-revoke").first()).toBeVisible();
  await expect(page.getByText("content.rights-restore").first()).toBeVisible();
});
