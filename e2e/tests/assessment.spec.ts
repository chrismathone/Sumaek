import { expect, test } from "@playwright/test";

const DEMO_EMAIL = "demo-teacher@su-maek.app";
const DEMO_PASSWORD = process.env.DEMO_TEACHER_PASSWORD ?? "sumaek-demo-2026!";

/** 인수 7의 기초: 검수·권한 통과 문항만 자동 선정 + 멱등 생성 (시퀀스 3) */
test("일일테스트 생성·게시 → 배정 → 중복 생성 방지", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(DEMO_EMAIL);
  await page.getByLabel("비밀번호").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });

  // 선행 조건 자립: 8/3 수업이 없으면 먼저 일정을 실체화한다 (순서 의존 제거)
  //  시드 루트 카드로 스코프 — 다른 E2E가 만든 게시 루트와 구분
  await page.goto("/app/routes");
  const card = page
    .locator("li")
    .filter({ hasText: "중2 심화 A — 연립방정식 단원" });
  await card.getByRole("button", { name: "미래 일정 생성·재계산" }).click();
  await expect(card.getByRole("status")).toContainText(/미래 수업 \d+건/, {
    timeout: 30_000,
  });

  await page.goto("/app/tests");
  await expect(page.getByRole("heading", { name: "일일·확인테스트" })).toBeVisible();

  // 대상 반 명시 선택 (다른 테스트가 만든 반이 기본 선택을 가로채지 않게)
  await page.getByLabel("학습 그룹").selectOption({ label: "중2 심화 A" });
  // 첫 수업일(8/3)로 생성
  await page.getByLabel("수업 날짜").fill("2026-08-03");
  await page.getByRole("button", { name: "생성·게시" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText(/일일테스트 \d+문항을 생성·게시|이미 생성된/, {
    timeout: 30_000,
  });

  // 목록에 게시 상태·배정 인원 표시
  await page.reload();
  await expect(page.getByText("일일테스트 · 2026-08-03")).toBeVisible();
  await expect(page.getByText(/배정 5명/)).toBeVisible();
  await expect(page.getByText("게시됨").first()).toBeVisible();

  // 멱등: 같은 날짜 재생성 → 중복 생성 안 함
  await page.getByLabel("학습 그룹").selectOption({ label: "중2 심화 A" });
  await page.getByLabel("수업 날짜").fill("2026-08-03");
  await page.getByRole("button", { name: "생성·게시" }).click();
  await expect(page.getByRole("status")).toContainText(
    "이미 생성된 일일테스트가 있습니다",
    { timeout: 30_000 },
  );

  // 수업 없는 날짜는 정직한 오류
  await page.getByLabel("학습 그룹").selectOption({ label: "중2 심화 A" });
  await page.getByLabel("수업 날짜").fill("2026-08-02"); // 일요일
  await page.getByRole("button", { name: "생성·게시" }).click();
  await expect(page.getByRole("status")).toContainText(
    "예정된 수업이 없습니다",
    { timeout: 30_000 },
  );
});
