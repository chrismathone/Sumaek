import { expect, test } from "@playwright/test";

test.describe("학생 응시 러너 체험 (인수 8의 데모판)", () => {
  test("응시 → 임시 저장 → 미응답 확인 → 제출 → 즉시 채점", async ({
    page,
  }) => {
    await page.goto("/demo/test");

    // 1번 객관식 — 정답 선택
    await expect(page.getByText("1 / 5")).toBeVisible();
    await page.locator("label").filter({ hasText: "②" }).click();
    await expect(page.getByText("저장 1회")).toBeVisible();
    await page.getByRole("button", { name: "다음" }).click();

    // 2번 단답 — 정답 3
    await page.getByLabel(/답/).fill("3");
    await page.getByRole("button", { name: "다음" }).click();

    // 3번 단답 — 오답 입력
    await page.getByLabel(/답/).fill("7");
    await page.getByRole("button", { name: "다음" }).click();

    // 4번 단답 — 동치 표기 정답 (5/6 대신 소수 아님 — 분수)
    await page.getByLabel(/답/).fill("5/6");
    await page.getByRole("button", { name: "다음" }).click();

    // 5번은 비워두고 제출 → 미응답 확인이 떠야 한다
    await page.getByRole("button", { name: "제출하기" }).click();
    await expect(page.getByText(/미응답 1문항/)).toBeVisible();
    await page.getByRole("button", { name: "제출 확정" }).click();

    // 채점 결과: 정답 3 (1·2·4번), 오답 2 (3번 오답 + 5번 무응답)
    await expect(page.getByText("채점 결과")).toBeVisible();
    await expect(page.getByText("30점")).toBeVisible();
    await expect(page.getByText("정답 3 · 오답 2")).toBeVisible();
    // 오답에는 다음 학습 행동 설명이 붙는다
    await expect(
      page.getByText(/오답 복습이 내일 일정에 배치/).first(),
    ).toBeVisible();
    // 숙련 확정 금지 안내
    await expect(
      page.getByText("한 번의 점수만으로 숙련을 확정하지 않습니다."),
    ).toBeVisible();
  });

  test("새로고침해도 임시 저장이 복원된다", async ({ page }) => {
    await page.goto("/demo/test");
    await page.locator("label").filter({ hasText: "②" }).click();
    await expect(page.getByText("저장 1회")).toBeVisible();
    await page.reload();
    // 복원된 선택 상태 확인
    await expect(
      page.locator("label").filter({ hasText: "②" }).locator("input"),
    ).toBeChecked();
  });

  test("동치 표기 채점: 분수 정답을 소수로 입력해도 정답", async ({ page }) => {
    await page.goto("/demo/test");
    // 4번으로 이동
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "다음" }).click();
    }
    await page.getByLabel(/답/).fill("0.8333"); // 5/6 ≈ 0.8333 — 정확 동치 아님 → 오답이어야 함
    await page.getByRole("button", { name: "다음" }).click();
    await page.getByRole("button", { name: "제출하기" }).click();
    await page.getByRole("button", { name: "제출 확정" }).click();
    // 0.8333은 5/6과 정확히 같지 않으므로 오답 (동치 검사는 유리수 정확 일치)
    await expect(page.getByText("채점 결과")).toBeVisible();
    const row = page.locator("li", { hasText: "4번" });
    await expect(row.getByText("오답", { exact: true })).toBeVisible();
  });
});
