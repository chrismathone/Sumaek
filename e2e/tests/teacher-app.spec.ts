import { expect, test, type Page } from "@playwright/test";

const TEACHER = {
  email: "demo-teacher@su-maek.app",
  password: process.env.DEMO_TEACHER_PASSWORD ?? "sumaek-demo-2026!",
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(TEACHER.email);
  await page.getByLabel("비밀번호").fill(TEACHER.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });
}

test.describe("교사 앱 전 화면 스모크 (인수 6·13·14 기초)", () => {
  test("조회 화면 전부가 시드 데이터 또는 정직한 빈 상태로 렌더된다", async ({
    page,
  }) => {
    await login(page);

    // 캘린더 — 8월로 이동하면 생성된 수업이 보인다
    await page.goto("/app/calendar?month=2026-08");
    await expect(page.getByText("중2 심화 A").first()).toBeVisible();
    await expect(page.getByText("광복절").first()).toBeVisible();

    // 반 목록 → 상세
    await page.goto("/app/classes");
    await expect(page.getByText("중2 심화 A")).toBeVisible();
    await page.getByRole("link", { name: /중2 심화 A/ }).click();
    await expect(page.getByText("박서윤")).toBeVisible();

    // 학습자 목록 → 상세 (숙련도 근거 표시)
    await page.goto("/app/students");
    await expect(page.getByText("박서윤")).toBeVisible();
    await page.getByRole("link", { name: /박서윤/ }).first().click();
    await expect(page.getByText(/탐색 중/).first()).toBeVisible();
    await expect(page.getByText(/증거/).first()).toBeVisible();

    // 개념 숙련도 집계
    await page.goto("/app/analytics");
    await expect(page.getByText(/가감법|대입법/).first()).toBeVisible();

    // 업무함 — 워커가 만든 알림 존재
    await page.goto("/app/inbox");
    await expect(
      page.getByText(/테스트가 게시되었습니다|처리할 일이 없습니다|오늘 처리할 일/).first(),
    ).toBeVisible();

    // 감사 로그 — 자동·수동 기록
    await page.goto("/app/audit");
    await expect(
      page.getByText(/schedule\.materialize|assessment\.generate|grading\./).first(),
    ).toBeVisible();

    // 설정 — 정책 버전 표시
    await page.goto("/app/settings");
    await expect(page.getByText("일일테스트 기본")).toBeVisible();
    await expect(page.getByText("기본 숙련도 정책")).toBeVisible();

    // 외부 연동 — 경계 설명과 빈 상태
    await page.goto("/app/settings/integrations");
    await expect(
      page.getByText("연결된 외부 시스템이 없습니다."),
    ).toBeVisible();

    // 문제은행 — 시드 문항과 권한 상태
    await page.goto("/app/content/questions");
    await expect(page.getByText(/게시/).first()).toBeVisible();
    await expect(page.getByText(/사용 가능/).first()).toBeVisible();

    // 커리큘럼 — 내부 개념과 공식 구분 고지
    await page.goto("/app/content/curriculum");
    await expect(page.getByText(/공식 성취기준이 아닙니다/)).toBeVisible();
    await expect(page.getByText("연립방정식의 활용").first()).toBeVisible();
  });
});
