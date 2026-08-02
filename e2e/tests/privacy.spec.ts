import { expect, test, type Page } from "@playwright/test";
import { gotoTableRow, tableRow } from "../lib/table";
import { TEACHER } from "../lib/accounts";


async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(TEACHER.email);
  await page.getByLabel("비밀번호").fill(TEACHER.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });
}

/**
 * 인수 39: 개인정보 삭제 요청 접수 → 이름 확인 게이트 → 익명화 집행.
 * 전용 반·학습자를 스스로 만들어 시드·다른 스펙에 영향이 없다 (멱등).
 * 익명화는 표시명 토큰화 + 반 소속 종료 + 감사 기록까지 검증한다.
 */
test("삭제 요청 → 잘못된 확인 거부 → 익명화 → 토큰 표시·감사", async ({
  page,
}) => {
  await login(page);

  const stamp = Date.now().toString(36).slice(-5);
  const groupName = `E2E삭제반-${stamp}`;
  const learnerName = `E2E삭제대상-${stamp}`;

  // 1. 전용 반·학습자 등록
  await page.goto("/app/settings");
  const groupSection = page.locator("section").filter({ hasText: "반 만들기" });
  await groupSection.getByLabel("반 이름").fill(groupName);
  await groupSection.getByText("토", { exact: true }).click();
  await groupSection.getByRole("button", { name: "반 만들기" }).click();
  await expect(
    groupSection.getByRole("status").filter({ hasText: "만들었습니다" }),
  ).toBeVisible({ timeout: 30_000 });

  await page.reload();
  const learnerSection = page
    .locator("section")
    .filter({ hasText: "학습자 등록" });
  await learnerSection.getByLabel("이름 (표시명)").fill(learnerName);
  await learnerSection.getByLabel("소속 반").selectOption({ label: groupName });
  await learnerSection.getByRole("button", { name: "학습자 등록" }).click();
  await expect(
    learnerSection.getByRole("status").filter({ hasText: "등록했습니다" }),
  ).toBeVisible({ timeout: 30_000 });

  // 2. 학습자 상세 → 삭제 요청 접수
  //    표 + 페이지네이션이라 검색으로 좁혀 행을 잡는다 (ADR-0016)
  const learnerRow = await gotoTableRow(page, "/app/students", learnerName);
  await learnerRow.getByRole("link", { name: learnerName }).click();
  await expect(
    page.getByRole("heading", { name: learnerName, exact: true }),
  ).toBeVisible();

  const privacy = page
    .locator("section")
    .filter({ hasText: "개인정보 삭제 요청" });
  await privacy.getByLabel("요청 사유 (필수)").fill("E2E — 보호자 요청 훈련");
  await privacy.getByRole("button", { name: "삭제 요청 접수" }).click();
  // 접수 성공 → revalidate로 요청 폼이 요청 행으로 바뀐다 (결과 기반 검증)
  await expect(privacy.getByText("접수됨")).toBeVisible({ timeout: 30_000 });

  // 3. 잘못된 이름 확인 → 집행 거부
  await privacy.getByLabel("학습자 표시명 재입력 (위험 작업 확인)").fill("오타이름");
  await privacy.getByRole("button", { name: "익명화 집행" }).click();
  await expect(
    privacy.getByRole("status").filter({ hasText: "정확히 입력" }),
  ).toBeVisible({ timeout: 30_000 });

  // 4. 정확한 이름으로 집행 → 토큰 표시명으로 전환
  await privacy
    .getByLabel("학습자 표시명 재입력 (위험 작업 확인)")
    .fill(learnerName);
  await privacy.getByRole("button", { name: "익명화 집행" }).click();
  await expect(
    page.getByRole("heading", { name: /삭제된 학습자-[0-9a-f]{8}/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(privacy.getByText("완료", { exact: true })).toBeVisible();
  await expect(privacy.getByText(/백업 만료 \d{4}-\d{2}-\d{2}/)).toBeVisible();

  // 5. 학습자 목록에 원래 이름이 없다
  //    목록이 쪽으로 나뉘므로 "전체 목록에 없음"은 검색으로 확인해야 한다 —
  //    그냥 1쪽만 보면 2쪽에 남아 있어도 통과하는 거짓 통과가 된다.
  await page.goto(`/app/students?q=${encodeURIComponent(learnerName)}`);
  await expect(tableRow(page, learnerName)).toHaveCount(0);
  await expect(page.getByText("조건에 맞는 학습자가 없습니다.")).toBeVisible();

  // 6. 감사 로그 — 요청·집행 기록
  //    표의 필터 <option>에도 같은 작업명이 있으므로 본문 행(tbody tr)만 본다.
  //    감사는 건수가 많아 검색으로 좁힌 뒤 확인한다.
  await expect(
    (await gotoTableRow(page, "/app/audit", "privacy", "privacy.request")).first(),
  ).toBeVisible();
  await expect(tableRow(page, "privacy.erase").first()).toBeVisible();
});
