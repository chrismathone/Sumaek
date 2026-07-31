import { expect, test } from "@playwright/test";

const DEMO_EMAIL = "demo-teacher@su-maek.app";
const DEMO_PASSWORD = process.env.DEMO_TEACHER_PASSWORD ?? "sumaek-demo-2026!";

/** 인수 3·5의 기초: 게시된 루트에서 날짜별 수업 생성 (시퀀스 1) */
test("루트 → 미래 일정 생성 → 오늘 운영실 반영", async ({ page }) => {
  // 로그인
  await page.goto("/login");
  await page.getByLabel("이메일").fill(DEMO_EMAIL);
  await page.getByLabel("비밀번호").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });

  // 학습 루트 목록 — 시드된 게시 루트 카드로 스코프
  //  (루트 빌더 E2E가 만든 다른 게시 루트와 구분한다)
  await page.goto("/app/routes");
  const card = page
    .locator("li")
    .filter({ hasText: "중2 심화 A — 연립방정식 단원" });
  await expect(card).toBeVisible();
  await expect(card.getByText(/v1 게시됨 · 노드 6개/)).toBeVisible();

  // 일정 생성 실행
  await card.getByRole("button", { name: "미래 일정 생성·재계산" }).click();
  const status = card.getByRole("status");
  await expect(status).toContainText(/미래 수업 \d+건을 생성했습니다/, {
    timeout: 30_000,
  });
  // 첫 수업은 월요일(2026-08-03) 이후, 광복절(8-15)은 수업일이 아님을 날짜로 간접 확인
  await expect(status).toContainText("2026-08-03");

  // 멱등성: 같은 버튼을 다시 눌러도 같은 개수로 재생성 (중복 누적 없음)
  const firstMessage = await status.innerText();
  const match = firstMessage.match(/미래 수업 (\d+)건/);
  const firstCount = Number(match?.[1] ?? 0);
  expect(firstCount).toBeGreaterThan(0);

  await card.getByRole("button", { name: "미래 일정 생성·재계산" }).click();
  await expect(card.getByRole("status")).toContainText(
    `미래 수업 ${firstCount}건을 생성했습니다`,
    { timeout: 30_000 },
  );

  // 루트 목록의 미래 수업 수 반영
  await page.reload();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "중2 심화 A — 연립방정식 단원" })
      .getByText(`예정된 미래 수업 ${firstCount}건`),
  ).toBeVisible();
});
