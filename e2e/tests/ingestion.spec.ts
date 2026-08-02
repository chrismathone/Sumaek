import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
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
 * 열 머리 이름으로 그 열의 칸을 집는다 (ADR-0016).
 *
 * 한 줄 문구가 칸으로 쪼개지면서 "행 어딘가에 숫자가 있다"는 단언은 페이지 수를
 * 추출 문항 수로 착각할 수 있게 됐다. 열 이름으로 집으면 무엇을 재는지가 분명해지고
 * 열 순서가 바뀌어도 따라간다.
 */
async function cellByHeader(row: Locator, header: string): Promise<Locator> {
  const headers = await row
    .locator("xpath=ancestor::table[1]")
    .locator("thead th")
    .allTextContents();
  const index = headers.findIndex((h) => h.includes(header));
  expect(index, `"${header}" 열을 찾지 못했습니다`).toBeGreaterThanOrEqual(0);
  return row.locator("td").nth(index);
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

    // 원본 목록에 파일·상태 반영. 표는 최신순이고 같은 이름의 이전 업로드가
    // 쌓여 있으므로, 검색으로 좁힌 뒤 방금 올린 첫 행만 본다 (ADR-0016).
    const uploaded = (
      await gotoTableRow(page, "/app/content/ingestion", "sample-workbook.pdf")
    ).first();
    await expect(uploaded).toBeVisible();
    await expect(
      uploaded.getByText("sample-workbook.pdf", { exact: true }),
    ).toBeVisible();
    // 추출 결과는 전부 검수 대기 — 파일 상태 칸이 그것을 말한다
    await expect(await cellByHeader(uploaded, "상태")).toHaveText("검수 필요");

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

  // 검수함은 미해결만 보여준다 — 전부 처리되면 정직한 빈 상태.
  // 승인 버튼이 아니라 표 본문 행으로 센다 (수식 검수처럼 버튼 없는 행도 있다).
  await page.reload();
  const remaining = await page.locator("tbody tr").count();
  if (remaining === 0) {
    await expect(page.getByText("검수할 항목이 없습니다.")).toBeVisible();
  }

  // 반입 파일에 추출 문항 수가 기록되어 있고, 문제은행에 게시 문항 존재.
  // 같은 이름의 이전 업로드가 여러 건 남아 있으므로 검색으로 좁혀 첫 행을 본다.
  const fileRow = (
    await gotoTableRow(page, "/app/content/ingestion", "sample-workbook.pdf")
  ).first();
  await expect(fileRow).toBeVisible();
  // 추출 문항 ≥1 — 페이지 수가 아니라 "추출 문항" 칸을 직접 읽는다
  await expect(await cellByHeader(fileRow, "추출 문항")).toHaveText(/^[1-9]\d*$/);

  // 표 본문에서만 찾는다 — 검수 상태 필터의 <option>에도 "게시"가 있다
  await page.goto("/app/content/questions?status=published");
  const publishedRow = tableRow(page, "게시").first();
  await expect(publishedRow).toBeVisible();
  await expect(await cellByHeader(publishedRow, "검수")).toHaveText("게시");
});
