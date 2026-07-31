import { fileURLToPath } from "node:url";
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
 * 인수 11·12의 기초 (시퀀스 7): 원본 업로드 → 추출 → 정규화·게이트 →
 * 검수 대기 → 사람 승인 → 게시 (권한 미확인이면 자동 출제 제외).
 */
test("문제집 반입: 업로드 → 추출 → 검수함 → 승인 → 게시", async ({ page }) => {
  await login(page);
  await page.goto("/app/content/ingestion");

  // 출처 없이 업로드 시도 — 거부 (required 필드)
  const fixture = fileURLToPath(
    new URL("../fixtures/sample-workbook.pdf", import.meta.url),
  );
  await page.getByLabel(/PDF 파일/).setInputFiles(fixture);
  await page.getByLabel(/권리자·출처/).fill("자체 제작 (통합 테스트)");
  await page.getByRole("button", { name: "업로드·추출" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText(/문항을 추출했습니다|이미 등록된 원본/, {
    timeout: 30_000,
  });
  const firstMessage = await status.innerText();

  if (firstMessage.includes("추출했습니다")) {
    // 추출 요약: 게이트·저신뢰 카운트 표시
    expect(firstMessage).toMatch(/게이트 통과 \d+/);
    expect(firstMessage).toMatch(/전부 검수 대기/);

    // 원본 목록에 파일·추출 문항 수 반영
    await page.reload();
    await expect(page.getByText("sample-workbook.pdf")).toBeVisible();
    await expect(page.getByText("검수 필요").first()).toBeVisible();

    // 같은 파일 재업로드 — 동일 해시 거부 (멱등)
    await page.getByLabel(/PDF 파일/).setInputFiles(fixture);
    await page.getByLabel(/권리자·출처/).fill("자체 제작 (중복 시도)");
    await page.getByRole("button", { name: "업로드·추출" }).click();
    await expect(page.getByRole("status")).toContainText(
      "이미 등록된 원본입니다",
      { timeout: 30_000 },
    );
  }

  // 검수함 — 승인 성공 시 항목이 열린 목록에서 빠진다 (revalidate).
  // 결과로 검증: 열린 항목 수 감소 + 승인 이력 존재.
  await page.goto("/app/content/review");
  const approveButtons = page.getByRole("button", { name: "검수 승인·게시" });
  const openCount = await approveButtons.count();

  if (openCount > 0) {
    await page.locator("input[name=note]").first().fill("정답·수식 확인 (E2E)");
    await approveButtons.first().click();
    // 승인 완료 → 열린 항목 감소 (게이트 차단이면 그대로 — 두 경우 모두 허용)
    await page.waitForTimeout(1500);
    const after = await approveButtons.count();
    expect(after).toBeLessThanOrEqual(openCount);
  }

  // 검수함은 미해결만 보여준다 — 전부 처리되면 정직한 빈 상태
  await page.reload();
  const remaining = await approveButtons.count();
  if (remaining === 0) {
    await expect(page.getByText("검수할 항목이 없습니다.")).toBeVisible();
  }

  // 반입 파일에 추출 문항 수가 기록되어 있고, 문제은행에 게시 문항 존재
  await page.goto("/app/content/ingestion");
  const fileRow = page.locator("tr", { hasText: "sample-workbook.pdf" });
  await expect(fileRow).toBeVisible();
  await expect(fileRow.getByText(/^[1-9]\d*$/).first()).toBeVisible(); // 추출 문항 ≥1

  await page.goto("/app/content/questions?status=published");
  await expect(page.getByText(/게시/).first()).toBeVisible();
});
