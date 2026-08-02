import { expect, test, type Page } from "@playwright/test";
import { futureIso, isoAddDays, nthIsoDate, todayIso } from "../lib/dates";
import { gotoTableRow } from "../lib/table";
import { TEACHER } from "../lib/accounts";


async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(TEACHER.email);
  await page.getByLabel("비밀번호").fill(TEACHER.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });
}

/** 루트 목록에서 이 스펙 전용 루트 카드의 실체화 실행 → 상태 텍스트 반환 */
async function materialize(page: Page, routeName: string): Promise<string> {
  // 검색으로 좁힌다 — 표에 페이지네이션이 있어 목록 상단에 있으리란 보장이 없다
  const card = await gotoTableRow(page, "/app/routes", routeName);
  await card.getByRole("button", { name: "미래 일정 생성·재계산" }).click();
  const status = card.getByRole("status");
  await expect(status).toContainText(/미래 수업 \d+건을 생성했습니다/, {
    timeout: 30_000,
  });
  return status.innerText();
}

/**
 * 인수 2·5의 실동작: 휴강 접수 → 재계산이 해당 날짜를 비우고 미래를 민다 →
 * 무시(정정) → 이후 재계산은 안정적(변경 최소화 — 이미 옮긴 수업을 다시
 * 흔들지 않는다). 전용 반·루트를 스스로 만들어 실행 간 상태 누적이 없다.
 */
test("휴강 접수 → 재계산이 날짜를 비움 → 무시 후 안정", async ({ page }) => {
  await login(page);

  const stamp = Date.now().toString(36).slice(-5);
  const groupName = `E2E휴강반-${stamp}`;
  const routeName = `E2E휴강루트-${stamp}`;

  // 1. 월요일만 수업하는 반 (첫 수업일은 오늘 이후 첫 월요일로 결정된다)
  await page.goto("/app/settings");
  const groupSection = page.locator("section").filter({ hasText: "반 만들기" });
  await groupSection.getByLabel("반 이름").fill(groupName);
  await groupSection.getByLabel("과정 설명").fill("휴강 재계산 검증");
  await groupSection.getByText("월", { exact: true }).click();
  await groupSection.getByRole("button", { name: "반 만들기" }).click();
  await expect(
    groupSection.getByRole("status").filter({ hasText: "만들었습니다" }),
  ).toBeVisible({ timeout: 30_000 });

  // 2. 루트 작성·검증·게시 (60분 노드 3개 → 월요일 2회분: 8/3 두 개 + 8/10 한 개)
  await page.goto("/app/routes");
  const newRoute = page.locator("section").filter({ hasText: "새 루트 만들기" });
  await newRoute.getByLabel("루트 이름").fill(routeName);
  await newRoute.getByLabel("대상 반").selectOption({ label: groupName });
  await newRoute.getByRole("button", { name: "루트 만들기" }).click();
  await expect(page).toHaveURL(/\/app\/routes\/[0-9a-f-]{36}/, {
    timeout: 30_000,
  });

  const addForm = page.locator("form").filter({ hasText: "노드 추가" });
  for (const title of ["도형의 성질", "삼각형의 합동", "사각형의 성질"]) {
    await addForm.getByLabel("노드 제목").fill(title);
    await addForm.getByRole("button", { name: "노드 추가" }).click();
    await expect(
      addForm.getByRole("status").filter({ hasText: title }),
    ).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole("button", { name: "검증 실행" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "검증 통과" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "게시", exact: true }).click();
  await expect(page.getByText("게시된 활성 버전")).toBeVisible({
    timeout: 30_000,
  });

  // 3. 첫 실체화 — 월요일 2회분 (실제 날짜는 실행 시점에 따라 달라진다)
  const baseline = await materialize(page, routeName);
  expect(baseline).toContain("미래 수업 2건");
  const firstLesson = nthIsoDate(baseline, 0);
  const secondLesson = nthIsoDate(baseline, 1);
  // 주 1회(월요일) 반이므로 두 수업은 정확히 7일 간격이다
  expect(secondLesson).toBe(isoAddDays(firstLesson, 7));
  // 과거를 만들지 않는다 — 실체화는 오늘 이후만 배치한다
  expect(firstLesson >= todayIso()).toBe(true);

  // 4. 휴강 접수 (첫 수업일)
  await page.goto("/app/classes");
  await page.getByRole("link", { name: groupName }).click();
  await expect(
    page.getByRole("heading", { name: groupName, exact: true }),
  ).toBeVisible();

  const upcoming = page.locator("section").filter({ hasText: "다가오는 수업" });
  await expect(upcoming.getByText(firstLesson).first()).toBeVisible();

  const availability = page.locator("section").filter({ hasText: "불참·휴강" });
  await availability.getByLabel("구분").selectOption({ label: "휴강 (반 전체)" });
  await availability.getByLabel("시작일").fill(firstLesson);
  await availability.getByLabel("종료일").fill(firstLesson);
  await availability.getByLabel("사유").fill("시설 점검");
  await availability.getByRole("button", { name: "접수", exact: true }).click();
  await expect(
    availability.getByRole("status").filter({ hasText: "휴강" }),
  ).toContainText(firstLesson, { timeout: 30_000 });

  // 5. 재계산 — 첫 수업일이 비고 한 주씩 밀린다
  const shifted = `${secondLesson} ~ ${isoAddDays(secondLesson, 7)}`;
  const cancelled = await materialize(page, routeName);
  expect(cancelled).toContain(shifted);

  await page.goto("/app/classes");
  await page.getByRole("link", { name: groupName }).click();
  await expect(upcoming.getByText(secondLesson).first()).toBeVisible();
  await expect(upcoming.getByText(firstLesson)).toHaveCount(0);

  // 이벤트가 반영됨으로 전이 (어떤 변경안이 소비했는지 추적됨)
  const eventRow = page.locator("li").filter({ hasText: "시설 점검" }).first();
  await expect(eventRow.getByText("반영됨")).toBeVisible();

  // 6. 무시(정정) → 이후 재계산은 안정적 — 이미 옮긴 수업을 다시 흔들지 않는다
  //    (변경 최소화 원칙: 무시는 "더 이상 입력이 아님"을 보장할 뿐,
  //     교사가 잠그지 않은 미래를 임의로 되당기지 않는다)
  await eventRow.getByRole("button", { name: "무시" }).click();
  await expect(eventRow.getByText("무시됨")).toBeVisible({ timeout: 15_000 });

  const afterDismiss = await materialize(page, routeName);
  expect(afterDismiss).toContain("미래 수업 2건");
  expect(afterDismiss).toContain(shifted);
});

/** 이 화면의 접수 이벤트 전부 무시 — 이전(실패한) 실행의 잔재 정리 (멱등) */
async function dismissAll(page: Page) {
  const dismissButtons = page.getByRole("button", { name: "무시" });
  for (let i = 0; i < 15; i++) {
    const count = await dismissButtons.count();
    if (count === 0) break;
    await dismissButtons.first().click();
    await expect(dismissButtons).toHaveCount(count - 1, { timeout: 15_000 });
  }
  await expect(dismissButtons).toHaveCount(0);
}

/** 학습 불참 — 반 공통 일정은 바꾸지 않고 기록·표시만 한다 (원칙 3) */
test("학습 불참: 학생 필수 검증 + 반 일정 비영향", async ({ page }) => {
  await login(page);
  await page.goto("/app/classes");
  await page.getByRole("link", { name: /중2 심화 A/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "중2 심화 A", exact: true }),
  ).toBeVisible();
  await dismissAll(page);

  const upcoming = page.locator("section").filter({ hasText: "다가오는 수업" });
  const scheduleBefore = await upcoming.innerText();

  const availability = page.locator("section").filter({ hasText: "불참·휴강" });
  const absentOn = futureIso(30); // 고정 날짜 금지 — 오늘 기준 미래로 잡는다

  // 학생 없이 불참 접수 → 정직한 오류
  await availability
    .getByLabel("구분")
    .selectOption({ label: "학습 불참 (학생)" });
  await availability.getByLabel("시작일").fill(absentOn);
  await availability.getByLabel("종료일").fill(absentOn);
  await availability.getByRole("button", { name: "접수", exact: true }).click();
  await expect(availability.getByRole("status")).toContainText(
    "불참 학생을 선택하세요",
    { timeout: 30_000 },
  );

  // 학생 지정 → 접수 성공 (React 19가 액션 후 폼을 리셋하므로 전부 다시 채운다)
  await availability
    .getByLabel("구분")
    .selectOption({ label: "학습 불참 (학생)" });
  await availability.getByLabel("대상 학생").selectOption({ label: "박서윤" });
  await availability.getByLabel("시작일").fill(absentOn);
  await availability.getByLabel("종료일").fill(absentOn);
  await availability.getByRole("button", { name: "접수", exact: true }).click();
  await expect(availability.getByRole("status")).toContainText(
    "반 공통 일정은 유지",
    { timeout: 30_000 },
  );

  // 반 일정은 그대로 (불참은 세션을 만들거나 지우지 않는다)
  await page.reload();
  expect(await upcoming.innerText()).toBe(scheduleBefore);

  // 잔재 정리 — 다음 실행의 멱등성
  await dismissAll(page);
});
