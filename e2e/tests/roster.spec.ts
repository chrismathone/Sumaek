import { expect, test, type Page } from "@playwright/test";
import { gotoTableRow } from "../lib/table";
import { TEACHER } from "../lib/accounts";


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

  // 반 목록·학습자 목록에 반영 (ADR-0016 이후 목록은 표 + 페이지네이션이라
  // "목록에 있으니 첫 쪽에 보이겠지"가 성립하지 않는다 — 검색으로 좁혀 행을 잡는다)
  const classRow = await gotoTableRow(page, "/app/classes", groupName);
  await expect(classRow).toBeVisible();
  // 방금 등록한 학습자가 이 반에 붙었다 — 학생 수는 별도 칸으로 쪼개졌다
  await expect(classRow.getByRole("cell", { name: "1명" })).toBeVisible();

  const learnerRow = await gotoTableRow(page, "/app/students", learnerName);
  await expect(learnerRow).toBeVisible();
  // 소속 반도 별도 칸 — 학습자가 새 반에 소속됐음을 그 칸으로 확인한다
  await expect(learnerRow.getByRole("cell", { name: groupName })).toBeVisible();

  // 감사 로그에 기록 — 두 동작이 각각 남는다.
  // 표 본문에서만 찾는다: 작업 필터 <select>의 숨은 <option>에 같은 문자열이
  // 있어 getByText가 그쪽을 먼저 잡는다. 검색으로 좁혀 페이지네이션 뒤로
  // 밀리는 것도 막는다 (감사 검색은 작업 이름을 훑는다).
  await expect(
    (await gotoTableRow(page, "/app/audit", "settings.create-group")).first(),
  ).toBeVisible();
  await expect(
    (await gotoTableRow(page, "/app/audit", "settings.add-learner")).first(),
  ).toBeVisible();
});
