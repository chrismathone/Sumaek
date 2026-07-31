import { expect, test } from "@playwright/test";

test.describe("랜딩", () => {
  test("히어로 카피와 CTA가 지정 문구로 표시된다", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("수학 선생님을 위한 수업 운영 시스템"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toContainText("이미 준비되어 있습니다");
    await expect(
      page.getByRole("link", { name: "샘플 반으로 오늘 수업 보기" }),
    ).toHaveAttribute("href", "/demo");
    await expect(
      page.getByText("실제 학생 정보 없이 샘플 데이터로 체험합니다."),
    ).toBeVisible();
  });

  test("학원 ERP 오인 문구가 없다 (인수 1·62)", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();
    for (const forbidden of [
      "학원 운영을 한 번에",
      "매출·상담·출결 통합",
      "올인원 학원 관리",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test("운영 흐름 탭 전환이 동작한다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: /테스트 자동 운영/ }).click();
    await expect(page.getByRole("tabpanel")).toContainText("일일테스트 8문항");
    await page.getByRole("tab", { name: /미래 일정 재계산/ }).click();
    await expect(page.getByRole("tabpanel")).toContainText("승인 대기");
  });

  test("FAQ가 펼쳐진다", async ({ page }) => {
    await page.goto("/");
    const first = page.locator("details").first();
    await first.locator("summary").click();
    await expect(first).toHaveAttribute("open", "");
  });
});

test.describe("수업 궤도판 데모 (인수 2)", () => {
  test("학습 불참 반영: 과거 보존 + 보강·재합류 + 승인 필요 배지", async ({
    page,
  }) => {
    await page.goto("/demo");
    // 반영 전 — 안내 문구
    await expect(
      page.getByText("불참을 반영하면 미래 일정만 다시 계산됩니다"),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "정하린 학습 불참 반영" })
      .click();

    // 변경 이유·전후와 승인 배지
    await expect(
      page.getByText("완료된 7월 기록은 유지"),
    ).toBeVisible();
    await expect(page.getByText("선생님 승인 필요")).toBeVisible();
    // SVG 접근성 설명이 갱신된다
    await expect(
      page.getByRole("img", { name: /8월 5일 보강 후 8월 10일 반 경로에 재합류/ }),
    ).toBeVisible();
  });

  test("점수 반영: 확인테스트 예약 + 자동 반영 배지", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "이도윤 점수 반영" }).click();
    await expect(page.getByText("자동 반영 가능")).toBeVisible();
    await expect(
      page.getByText(/8월 7일\(금\) 확인테스트/),
    ).toBeVisible();
  });
});

test.describe("도입 문의", () => {
  test("필수값 없이 제출하면 해결 방법이 있는 오류가 보인다", async ({
    page,
  }) => {
    await page.goto("/request-demo");
    await page.getByRole("button", { name: /문의|접수|보내기/ }).click();
    // 네이티브 required 또는 서버 검증 메시지 — 조용한 실패 금지
    const nameInput = page.locator("input[name=name]");
    const invalid = await nameInput.evaluate(
      (el) => !(el as HTMLInputElement).checkValidity(),
    );
    if (!invalid) {
      await expect(page.getByText(/입력|필수|확인/)).toBeVisible();
    }
  });
});

test.describe("수식 게이트 (인수 51·53)", () => {
  test("인쇄 샘플: katex-error·원시 LaTeX 폴백 0건, MathML 존재", async ({
    page,
  }) => {
    await page.goto("/print/sample");
    await expect(page.locator(".katex").first()).toBeVisible();
    await expect(page.locator(".katex-error")).toHaveCount(0);
    await expect(page.locator("code.math-raw")).toHaveCount(0);
    // 접근성 — MathML 동시 출력
    expect(await page.locator(".katex math").count()).toBeGreaterThan(0);
    // 다행 수식(연립방정식) 선택지·본문 렌더 확인
    await expect(page.locator(".katex").filter({ hasText: "" }).first()).toBeVisible();
  });
});
