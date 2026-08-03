import { expect, test, type Page } from "@playwright/test";
import { TEACHER } from "../lib/accounts";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(TEACHER.email);
  await page.getByLabel("비밀번호").fill(TEACHER.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });
}

/** 이전 실행 잔재 정리 — 연결이 남아 있으면 전부 해제 (teacher-app 스펙의
 * 빈 상태 단언과 다음 실행의 멱등성을 지킨다) */
async function disconnectAll(page: Page) {
  const buttons = page.getByRole("button", { name: "연결 해제" });
  for (let i = 0; i < 10; i++) {
    const count = await buttons.count();
    if (count === 0) break;
    await buttons.first().click();
    await expect(buttons).toHaveCount(count - 1, { timeout: 15_000 });
  }
  await expect(buttons).toHaveCount(0);
}

/**
 * 인수 61의 실동작: 실제 공공 API를 부르는 스펙이다 — 포털이 죽어 있으면
 * 정직하게 skip한다 (거짓 실패로 다른 스펙을 가리지 않게).
 *
 * 설계 검증 포인트: 전체 학교를 내려받지 않는다 — 공휴일은 전국 1회,
 * 학사일정은 연결한 학교만·시험 기간만. 재실행은 전부 멱등(중복 0).
 */
test("공휴일 동기화: 실제 쉬는 날만 · 연 1회 · 멱등", async ({ page }) => {
  await login(page);
  await page.goto("/app/settings/integrations");

  const section = page.locator("section").filter({ hasText: "공휴일" });
  await section.getByRole("button", { name: "공휴일 동기화" }).click();

  const toast = page.getByRole("status").filter({ hasText: /공휴일 동기화|특일 API/ });
  await expect(toast).toBeVisible({ timeout: 30_000 });
  const firstMessage = await toast.innerText();
  if (/응답 없음|거부/.test(firstMessage)) {
    test.skip(true, `특일 API 접근 불가 — ${firstMessage}`);
  }
  expect(firstMessage).toMatch(/새로 \d+건 · 이미 있음 \d+건/);

  // 보유 건수 반영 (2026년 공휴일 22건 — 대체공휴일 포함, 절기·기념일 없음)
  await page.reload();
  const stats = await section.locator("p.font-mono").innerText();
  expect(stats).toMatch(/보유 [1-9]\d*건/);

  // 멱등: 다시 눌러도 새로 0건
  await section.getByRole("button", { name: "공휴일 동기화" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "새로 0건" }),
  ).toBeVisible({ timeout: 30_000 });
});

test("학교 연결 → 시험 기간만 동기화 → 해제 (전체 학교 다운로드 없음)", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/settings/integrations");
  await disconnectAll(page);

  // 1. 학교 검색 — 이 학원 학생들이 다니는 학교만 고른다
  const searchSection = page.locator("section").filter({ hasText: "학교 연결" });
  await searchSection.getByLabel("학교 이름").fill("대치중학교");
  await searchSection.getByRole("button", { name: "학교 검색" }).click();

  const searchStatus = searchSection.getByRole("status");
  await expect(searchStatus).toBeVisible({ timeout: 30_000 });
  const searchMessage = await searchStatus.innerText();
  if (/응답 없음|오류/.test(searchMessage)) {
    test.skip(true, `NEIS 접근 불가 — ${searchMessage}`);
  }

  const resultRow = searchSection
    .locator("li")
    .filter({ hasText: "대치중학교" })
    .first();
  await expect(resultRow).toBeVisible();
  await resultRow.getByRole("button", { name: "연결", exact: true }).click();

  // 연결 카드 등장 (revalidate)
  const card = page.locator("li").filter({ hasText: "NEIS · 대치중학교" }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });

  // 2. 학사일정 동기화 — 시험 기간만, 대상은 전체 반
  await card.getByRole("button", { name: "학사일정 동기화" }).click();
  const syncToast = page
    .getByRole("status")
    .filter({ hasText: /학사일정 \d+건 조회/ });
  await expect(syncToast).toBeVisible({ timeout: 30_000 });
  const syncMessage = await syncToast.innerText();
  expect(syncMessage).toMatch(/시험 기간 \d+건 중 새로 \d+건/);
  expect(syncMessage).toContain("휴업일·방학은 학원 수업일이라 가져오지 않습니다");

  // 동기화 상태가 카드에 남는다 (상태 안 보이는 동기화 금지)
  await page.reload();
  await expect(card.getByText(/마지막 동기화/)).toBeVisible();
  await expect(card.getByText("ok", { exact: true })).toBeVisible();

  // 3. 멱등: 재동기화 → 새로 0건
  await card.getByRole("button", { name: "학사일정 동기화" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /시험 기간 \d+건 중 새로 0건/ }),
  ).toBeVisible({ timeout: 30_000 });

  // 4. 해제 → 빈 상태 복귀 (teacher-app 스펙의 전제)
  await card.getByRole("button", { name: "연결 해제" }).click();
  await expect(page.getByText("연결된 외부 시스템이 없습니다.")).toBeVisible({
    timeout: 30_000,
  });
});
