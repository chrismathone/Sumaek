import { expect, test } from "@playwright/test";
import { tableRowIn } from "../lib/table";
import { TEACHER } from "../lib/accounts";

const DEMO_EMAIL = TEACHER.email;
const DEMO_PASSWORD = TEACHER.password;

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
    // 시드된 워크스페이스·반 데이터 (가짜 데이터 아님 — DB 실조회).
    // `.first()`는 DOM 순서상 좌측 내비의 이름을 집는데, 그 내비는 lg 미만에서
    // 숨는다 — 태블릿·모바일에서 "안 보인다"고 틀렸다. 실제로는 상단 헤더에
    // 언제나 있으므로, 화면 크기와 무관하게 보이는 그 쪽을 단언한다.
    await expect(
      page.getByText(/2026학년도 2학기 · 수맥 데모 학원/),
    ).toBeVisible();

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

    // 오늘 수업 표시는 요일에 달렸다 — 시드 반은 월·수·금 수업이라 그 요일에
    // 돌리면 실제 수업 행이 있고, 그 밖의 요일이면 빈 상태다. 어느 쪽이든
    // 정직한 상태를 단언한다 (일요일에만 통과하는 하드코딩 금지 — 실측 실패).
    const sessionSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "시간순 수업" }) });
    const emptyToday = sessionSection.getByText("오늘 예정된 수업이 없습니다.");
    if ((await emptyToday.count()) > 0) {
      await expect(emptyToday).toBeVisible();
      await expect(
        sessionSection.getByRole("link", { name: "학습 루트에서 일정 생성하기" }),
      ).toBeVisible();
    } else {
      // 수업 행 최소 1건 — 행 전체가 반 상세로 이어진다
      await expect(sessionSection.locator("tbody tr").first()).toBeVisible();
    }

    // 로그아웃 → 보호 경로 재차단.
    // lg 미만에서는 로그아웃이 접힌 <details> 안에 있어 접근성 트리에 없다.
    // 사용자가 하는 대로 메뉴를 먼저 편다.
    const mobileMenu = page.locator("summary").filter({ hasText: "메뉴" });
    if (await mobileMenu.isVisible()) await mobileMenu.click();
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/app/today");
    await expect(page).toHaveURL(/\/login/);
  });
});
