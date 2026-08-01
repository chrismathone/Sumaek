import { expect, test } from "@playwright/test";
import { tableRowIn } from "../lib/table";

const DEMO_EMAIL = "demo-teacher@su-maek.app";
const DEMO_PASSWORD = process.env.DEMO_TEACHER_PASSWORD ?? "sumaek-demo-2026!";

test.describe("인증·앱 셸 (인수 13의 기초)", () => {
  test("비로그인으로 /app 접근 시 로그인으로 보낸다", async ({ page }) => {
    await page.goto("/app/today");
    await expect(page).toHaveURL(/\/login/);
  });

  test("잘못된 비밀번호는 해결 방법이 있는 오류를 보여준다", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(DEMO_EMAIL);
    await page.getByLabel("비밀번호").fill("wrong-password");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "맞지 않습니다" }),
    ).toBeVisible();
  });

  test("데모 교사 로그인 → 오늘 운영실에 시드 데이터 표시 → 로그아웃", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(DEMO_EMAIL);
    await page.getByLabel("비밀번호").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();

    // dev 서버 첫 컴파일·원격 인증 왕복을 감안한 넉넉한 대기
    await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "오늘 수업" })).toBeVisible();
    // 시드된 워크스페이스·반 데이터 (가짜 데이터 아님 — DB 실조회)
    await expect(page.getByText("수맥 데모 학원").first()).toBeVisible();

    // ADR-0016 이후 반 목록은 카드가 아니라 표다. 한 줄이던 "중2 심화 A ·
    // 학습자 5명"이 반 이름·과정·학습자 칸으로 쪼개졌으므로 칸별로 단언한다.
    const groupSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "운영 중인 반" }) });
    const groupRow = tableRowIn(groupSection, "중2 심화 A");
    await expect(groupRow).toBeVisible();
    await expect(
      groupRow.getByRole("cell", { name: "중2 심화 A", exact: true }),
    ).toBeVisible();
    await expect(
      groupRow.getByRole("cell", { name: "5명", exact: true }),
    ).toBeVisible();
    // 행 전체가 반 상세로 이어진다 (표 전환의 요지)
    await expect(groupRow.getByRole("link", { name: "중2 심화 A" })).toHaveAttribute(
      "href",
      /^\/app\/classes\//,
    );

    // 수업 미생성 상태의 정직한 빈 상태와 다음 행동
    await expect(page.getByText("오늘 예정된 수업이 없습니다.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "학습 루트에서 일정 생성하기" }),
    ).toBeVisible();

    // 로그아웃 → 보호 경로 재차단
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/app/today");
    await expect(page).toHaveURL(/\/login/);
  });
});
