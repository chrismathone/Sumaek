import { expect, test } from "@playwright/test";
import { isoAddDays, nthIsoDate, todayIso } from "../lib/dates";
import { gotoTableRow } from "../lib/table";
import { TEACHER } from "../lib/accounts";

const DEMO_EMAIL = TEACHER.email;
const DEMO_PASSWORD = TEACHER.password;

/** 인수 7의 기초: 검수·권한 통과 문항만 자동 선정 + 멱등 생성 (시퀀스 3) */
test("일일테스트 생성·게시 → 배정 → 중복 생성 방지", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(DEMO_EMAIL);
  await page.getByLabel("비밀번호").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });

  // 선행 조건 자립: 먼저 일정을 실체화하고 첫 수업일을 실행 시점에서 읽는다
  //  (고정 날짜를 적으면 그날이 지나는 순간 "예정된 수업이 없습니다"로 깨진다)
  //  시드 루트 카드로 스코프 — 다른 E2E가 만든 게시 루트와 구분
  const card = await gotoTableRow(
    page,
    "/app/routes",
    "연립방정식 단원",
    "중2 심화 A — 연립방정식 단원",
  );
  await card.getByRole("button", { name: "미래 일정 생성·재계산" }).click();
  const materializeStatus = card.getByRole("status");
  await expect(materializeStatus).toContainText(/미래 수업 \d+건/, {
    timeout: 30_000,
  });
  const lessonDate = nthIsoDate(await materializeStatus.innerText(), 0);
  expect(lessonDate >= todayIso()).toBe(true);
  // 월·수·금 반이므로 첫 수업 다음 날은 항상 수업이 없는 날이다
  const noLessonDate = isoAddDays(lessonDate, 1);

  await page.goto("/app/tests");
  await expect(page.getByRole("heading", { name: "일일·확인테스트" })).toBeVisible();

  // 대상 반 명시 선택 (다른 테스트가 만든 반이 기본 선택을 가로채지 않게)
  await page.getByLabel("학습 그룹").selectOption({ label: "중2 심화 A" });
  // 첫 수업일로 생성
  await page.getByLabel("수업 날짜").fill(lessonDate);
  await page.getByRole("button", { name: "생성·게시" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText(/일일테스트 \d+문항을 생성·게시|이미 생성된/, {
    timeout: 30_000,
  });

  /* 목록에 게시 상태·배정 인원 표시 (표에서는 각각 다른 칸이다 — ADR-0016).
   * 검색으로 좁혀서 잡는다 — 통합 테스트가 만드는 평가가 같은 날짜대에 쌓이면
   * 기본 정렬(scheduled_date desc)에서 대상이 1쪽 밖으로 밀린다 (실측). */
  const testRow = (
    await gotoTableRow(page, "/app/tests", `일일테스트 · ${lessonDate}`)
  ).first();
  await expect(testRow).toBeVisible();
  await expect(testRow.getByText("5명", { exact: true })).toBeVisible();
  await expect(testRow.getByText("게시됨")).toBeVisible();

  // 멱등: 같은 날짜 재생성 → 중복 생성 안 함
  await page.getByLabel("학습 그룹").selectOption({ label: "중2 심화 A" });
  await page.getByLabel("수업 날짜").fill(lessonDate);
  await page.getByRole("button", { name: "생성·게시" }).click();
  await expect(page.getByRole("status")).toContainText(
    "이미 생성된 일일테스트가 있습니다",
    { timeout: 30_000 },
  );

  // 수업 없는 날짜는 정직한 오류
  await page.getByLabel("학습 그룹").selectOption({ label: "중2 심화 A" });
  await page.getByLabel("수업 날짜").fill(noLessonDate);
  await page.getByRole("button", { name: "생성·게시" }).click();
  await expect(page.getByRole("status")).toContainText(
    "예정된 수업이 없습니다",
    { timeout: 30_000 },
  );
});
