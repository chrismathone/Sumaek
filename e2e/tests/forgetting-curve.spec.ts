import { expect, test, type Page } from "@playwright/test";
import { TEACHER, STUDENT } from "../lib/accounts";

/** 시드 학습자 박서윤 — 복습 항목을 가진 데모 학생 */
const SEED_LEARNER_ID = "00000000-0000-7000-8000-000000000101";

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(who.email);
  await page.getByLabel("비밀번호").fill(who.password);
  await page.getByRole("button", { name: "로그인" }).click();
}

/* ─────────────────────────────────────────────────────────────
 * 망각곡선이 **화면에 닿는가**.
 *
 * 계산과 DB 반영은 단위·통합 테스트가 덮는다. 여기서 보는 것은 사람이
 * 읽는 문구다. 예전 화면은 둘 다 거짓이었다:
 *   - 교사: 어떤 항목이든 언제나 "간격 1일" (간격이 자란 적이 없어서)
 *   - 학생: "맞히면 끝, 틀리면 내일" (맞혀도 안 끝나고, 틀려도 내일이 아니다)
 * ───────────────────────────────────────────────────────────── */

test("교사 학습자 상세: 복습에 예측 기억률이 보인다", async ({ page }) => {
  await login(page, TEACHER);
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });
  await page.goto(`/app/students/${SEED_LEARNER_ID}`);

  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "예정된 복습" }) });
  await expect(section).toBeVisible();

  /* 항목이 하나라도 있으면 기억률이 붙어야 한다. 시드가 비어 있을 수 있으므로
   * 빈 상태는 빈 상태대로 정직하게 받아들이되, 있으면 반드시 확인한다. */
  const empty = section.getByText("예정된 복습 항목이 없습니다.");
  if ((await empty.count()) > 0) {
    await expect(empty).toBeVisible();
    return;
  }
  await expect(section.getByText(/기억률 \d+%/).first()).toBeVisible();
});

test("학생 복습 안내: 맞히면 밀리고 틀리면 당겨진다고 말한다", async ({
  page,
}) => {
  await login(page, STUDENT);
  await expect(page).toHaveURL(/\/learn\/today/, { timeout: 30_000 });
  await page.goto("/learn/review");

  /* 오늘 할 복습이 없으면 안내 자체가 없다 — 그 경우는 건너뛴다 */
  const heading = page.getByRole("heading", { name: "복습", exact: true });
  if ((await heading.count()) === 0) return;

  await expect(
    page.getByText(/맞히면 다음 복습이 더 뒤로 밀리고/),
  ).toBeVisible();
  // 거짓이었던 옛 문구가 남아 있지 않다
  await expect(page.getByText(/틀리면 내일 다시 올라옵니다/)).toHaveCount(0);
});
