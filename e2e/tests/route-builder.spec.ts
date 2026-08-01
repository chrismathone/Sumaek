import { expect, test, type Page } from "@playwright/test";
import { gotoTableRow, tableRowIn } from "../lib/table";

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

/**
 * 인수 3의 후반: 시드 없이 반 → 루트 작성 → 검증 게이트 → 게시 →
 * 일정 실체화까지 앱 안에서 완주한다. 게시는 검증 통과 없이는 불가능하다.
 */
test("루트 빌더: 반 만들기 → 노드 작성 → 검증 → 게시 → 일정 실체화", async ({
  page,
}) => {
  await login(page);

  const stamp = Date.now().toString(36).slice(-5);
  const groupName = `E2E루트반-${stamp}`;
  const routeName = `E2E루트-${stamp}`;

  // 1. 반 만들기 (화·목 수업)
  await page.goto("/app/settings");
  const groupSection = page.locator("section").filter({ hasText: "반 만들기" });
  await groupSection.getByLabel("반 이름").fill(groupName);
  await groupSection.getByLabel("과정 설명").fill("E2E 루트 빌더 검증");
  await groupSection.getByText("화", { exact: true }).click();
  await groupSection.getByText("목", { exact: true }).click();
  await groupSection.getByRole("button", { name: "반 만들기" }).click();
  await expect(
    groupSection.getByRole("status").filter({ hasText: "만들었습니다" }),
  ).toBeVisible({ timeout: 30_000 });

  // 2. 새 루트 만들기 → 빌더로 이동
  await page.goto("/app/routes");
  const newRoute = page.locator("section").filter({ hasText: "새 루트 만들기" });
  await newRoute.getByLabel("루트 이름").fill(routeName);
  await newRoute.getByLabel("대상 반").selectOption({ label: groupName });
  await newRoute.getByRole("button", { name: "루트 만들기" }).click();
  await expect(page).toHaveURL(/\/app\/routes\/[0-9a-f-]{36}/, {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  // 3. 빈 루트는 검증 실패 — 정직한 오류
  await page.getByRole("button", { name: "검증 실행" }).click();
  await expect(page.getByRole("status")).toContainText("노드가 없습니다", {
    timeout: 30_000,
  });

  // 4. 노드 3개 추가 (개념 수업 2 + 확인테스트)
  const addForm = page.locator("form").filter({ hasText: "노드 추가" });
  await addForm.getByLabel("노드 제목").fill("일차함수의 뜻");
  await addForm.getByRole("button", { name: "노드 추가" }).click();
  await expect(
    addForm.getByRole("status").filter({ hasText: "일차함수의 뜻" }),
  ).toBeVisible({ timeout: 30_000 });

  await addForm.getByLabel("노드 제목").fill("일차함수의 그래프");
  await addForm.getByRole("button", { name: "노드 추가" }).click();
  await expect(
    addForm.getByRole("status").filter({ hasText: "일차함수의 그래프" }),
  ).toBeVisible({ timeout: 30_000 });

  await addForm.getByLabel("종류").selectOption({ label: "확인테스트" });
  await addForm.getByLabel("노드 제목").fill("확인테스트 — 일차함수");
  await addForm.getByRole("button", { name: "노드 추가" }).click();
  await expect(
    addForm.getByRole("status").filter({ hasText: "확인테스트 — 일차함수" }),
  ).toBeVisible({ timeout: 30_000 });

  // 4b. 낙관적 동시성 (인수 20) — 낡은 lock_version으로 제출하면
  //     마지막 저장이 조용히 이기는 대신 VERSION_CONFLICT로 거부된다
  await addForm
    .locator('input[name="expectedLockVersion"]')
    .evaluate((el) => {
      (el as HTMLInputElement).value = "1"; // 노드 3개 추가로 이미 지나간 버전
    });
  await addForm.getByLabel("노드 제목").fill("충돌 유발 노드");
  await addForm.getByRole("button", { name: "노드 추가" }).click();
  await expect(
    addForm.getByRole("status").filter({ hasText: "VERSION_CONFLICT" }),
  ).toBeVisible({ timeout: 30_000 });
  // 거부되었으므로 노드는 3개 그대로, 새로 고침 후 재시도는 성공한다
  await page.reload();
  await expect(page.getByText("충돌 유발 노드")).toHaveCount(0);

  // 4c. 충돌 diff (인수 20 완결) — 진짜 두 사용자를 만든다.
  //     같은 초안을 두 화면에서 열고 두 번째가 먼저 저장하면, 첫 화면의 제출은
  //     거부되면서 "무엇이 어떻게 달라졌는지"를 항목 단위로 보여 준다.
  const routeUrl = page.url();
  const other = await page.context().newPage();
  await other.goto(routeUrl);
  const otherAddForm = other.locator("form").filter({ hasText: "노드 추가" });
  await otherAddForm.getByLabel("노드 제목").fill("다른 사용자 노드");
  await otherAddForm.getByRole("button", { name: "노드 추가" }).click();
  await expect(
    otherAddForm.getByRole("status").filter({ hasText: "다른 사용자 노드" }),
  ).toBeVisible({ timeout: 30_000 });
  await other.close();

  // 첫 화면은 아직 옛 상태(토큰 + 노드 스냅샷)를 들고 있다
  await addForm.getByLabel("노드 제목").fill("내 노드");
  await addForm.getByRole("button", { name: "노드 추가" }).click();

  const conflictPanel = page.getByRole("dialog", { name: "동시 수정 충돌" });
  await expect(conflictPanel).toBeVisible({ timeout: 30_000 });
  // "충돌했습니다"의 다른 표현이 아니다 — 양쪽 변경이 항목으로 찍힌다
  await expect(
    conflictPanel.getByText('"다른 사용자 노드" 노드가 새로 생겼습니다'),
  ).toBeVisible();
  await expect(
    conflictPanel.getByText('"내 노드" 노드가 새로 생겼습니다'),
  ).toBeVisible();
  // 나란히 놓인 두 목록 — 내 쪽에는 아직 저장되지 않았다고 표시된다
  await expect(conflictPanel.getByText("저장된 최신 상태")).toBeVisible();
  await expect(
    conflictPanel.getByText("(저장 안 됨)", { exact: true }),
  ).toBeVisible();

  // 다음에 할 수 있는 일이 분명하고, 내 변경을 잃지 않는다
  await conflictPanel
    .getByRole("button", { name: "내 변경을 최신 상태에 다시 적용" })
    .click();
  await expect(conflictPanel).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText("내 노드", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("다른 사용자 노드", { exact: true })).toBeVisible();

  // 정리 — 이후 검증·게시는 원래의 3개 노드 기준이다
  for (const title of ["내 노드", "다른 사용자 노드"]) {
    await page
      .locator("li")
      .filter({ hasText: title })
      .first()
      .getByRole("button", { name: "삭제" })
      .click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
  }

  // 검증 전에는 게시 버튼이 없다 (게이트)
  await expect(page.getByRole("button", { name: "게시", exact: true })).toHaveCount(0);

  // 5. 검증 통과 → 게시 버튼 등장
  await page.getByRole("button", { name: "검증 실행" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "검증 통과" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("검증 결과 — 통과")).toBeVisible();

  // 6. 게시 — 성공하면 revalidate로 초안 편집 화면이 게시본 화면으로 바뀐다
  //    (상태 메시지는 언마운트로 사라질 수 있어 결과로 검증)
  await page.getByRole("button", { name: "게시", exact: true }).click();
  await expect(page.getByText("게시된 활성 버전")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("일차함수의 뜻")).toBeVisible();

  // 7. 일정 실체화 — 화·목 슬롯으로 미래 수업 생성
  await page.getByRole("button", { name: "미래 일정 생성·재계산" }).click();
  await expect(page.getByRole("status")).toContainText(
    /미래 수업 \d+건을 생성했습니다/,
    { timeout: 30_000 },
  );
});

/**
 * 인수 4: 학생 오버라이드는 차이만 저장하며 반 공통 루트·다른 학생에게
 * 영향을 주지 않는다.
 */
test("학생 오버라이드: 생성·표시·취소 (반 루트 비영향)", async ({ page }) => {
  await login(page);

  // 학습자 목록은 표 + 페이지네이션이라 이름으로 좁힌 뒤 행의 링크로 들어간다
  const studentRow = await gotoTableRow(page, "/app/students", "박서윤");
  await studentRow.first().getByRole("link").first().click();
  await expect(
    page.getByRole("heading", { name: "박서윤", exact: true }),
  ).toBeVisible();

  const section = page
    .locator("section")
    .filter({ hasText: "개별 경로 오버라이드" });
  await section.getByLabel("사유 (필수)").fill("가감법 확인테스트 미통과 보충");
  await section.getByLabel("보충 노드 제목").fill("가감법 집중 연습");
  // 재합류 지점 — 이 학생이 어느 차시에서 반 진도로 돌아오는가
  await section.getByLabel("재합류 지점").selectOption({ label: "가감법" });
  /* 건너뛸 노드는 체크박스 묶음(fieldset) 안에서 고른다 — 같은 제목이
   * 재합류 지점 <select>의 <option>에도 있어 화면 전체로는 둘이 잡힌다. */
  await section
    .getByRole("group")
    .getByText("일차방정식 복습", { exact: true })
    .click();
  await section.getByRole("button", { name: "오버라이드 만들기" }).click();

  const status = section.getByRole("status").filter({ hasText: "만들었습니다" });
  await expect(status).toBeVisible({ timeout: 30_000 });
  await expect(status).toContainText("반 공통 일정은 변경되지 않습니다");

  // 목록 반영: 종류·차이 요약·적용 중
  const row = section
    .locator("li")
    .filter({ hasText: "가감법 확인테스트 미통과 보충" })
    .first();
  await expect(row.getByText("건너뛰기 1개")).toBeVisible();
  await expect(row.getByText("보충: 가감법 집중 연습")).toBeVisible();
  await expect(row.getByText("재합류: 가감법")).toBeVisible();
  await expect(row.getByText("적용 중")).toBeVisible();

  /* ── 개별 일정 실체화 (인수 4) — 오버라이드가 실제 차시가 되는 지점.
   * 이 버튼이 없으면 계산은 있어도 제품 안에서 도달할 수 없다. ── */
  const scheduleSection = page
    .locator("section")
    .filter({ hasText: "개별 일정" });
  await scheduleSection
    .getByRole("button", { name: "개별 일정 계산" })
    .click();
  const scheduleToast = scheduleSection
    .getByRole("status")
    .filter({ hasText: "개별 일정" });
  await expect(scheduleToast).toBeVisible({ timeout: 30_000 });
  await expect(scheduleToast).toContainText("반 공통 일정은 변경되지 않았습니다");

  // 표에 반 공통과 다른 차시와 재합류 차시가 눈에 보인다
  await expect(
    tableRowIn(scheduleSection, "재합류 차시").first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    tableRowIn(scheduleSection, "다름").first(),
  ).toBeVisible();

  // 감사 로그 기록 — 작업 필터의 <option>에도 같은 문구가 있으므로
  // 표 본문 행에서 확인한다. 사유로 검색해 이번 실행의 기록으로 좁힌다.
  const auditRow = await gotoTableRow(
    page,
    "/app/audit",
    "가감법 확인테스트 미통과 보충",
    "route.create-override",
  );
  await expect(auditRow.first()).toContainText("가감법 확인테스트 미통과 보충");

  // 취소 — 다음 실행의 멱등성 (이전 실행 잔재 포함 전부 정리)
  const studentRowAgain = await gotoTableRow(page, "/app/students", "박서윤");
  await studentRowAgain.first().getByRole("link").first().click();
  /* 상세 화면이 실제로 그려질 때까지 기다린다.
   * 클릭 직후에 세면 아직 목록 화면이라 취소 버튼이 0개로 보이고 루프가
   * 곧장 break한다 — 정리가 통째로 건너뛰어져도 단언은 통과한다.
   * 실측 결과 이 경주 때문에 시드 학습자에게 활성 오버라이드가 31건까지
   * 쌓여 있었다 (학생 경로가 보충 차시로만 채워질 정도로). */
  const cancelButtons = page.getByRole("button", { name: "취소", exact: true });
  await expect(
    page.getByRole("heading", { name: "박서윤", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(cancelButtons.first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 12; i++) {
    const count = await cancelButtons.count();
    if (count === 0) break;
    await cancelButtons.first().click();
    await expect(cancelButtons).toHaveCount(count - 1, { timeout: 15_000 });
  }
  await expect(cancelButtons).toHaveCount(0);

  /* 취소 뒤 다시 계산하면 재합류 차시가 사라진다 — 오버라이드가 빠지면
   * 학생 경로는 반 공통으로 되돌아온다. */
  const scheduleAfterCancel = page
    .locator("section")
    .filter({ hasText: "개별 일정" });
  await scheduleAfterCancel
    .getByRole("button", { name: "개별 일정 계산" })
    .click();
  await expect(
    scheduleAfterCancel.getByRole("status").filter({ hasText: "개별 일정" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(tableRowIn(scheduleAfterCancel, "재합류 차시")).toHaveCount(0, {
    timeout: 30_000,
  });
});

/**
 * 인수 4: 아직 계산하지 않은 학생의 개별 일정은 빈 표가 아니라 **정직한
 * 빈 상태**로 보인다 — 무엇이 없는지와 무엇을 하면 되는지가 함께 있다.
 * (계산을 한 번도 돌리지 않는 학생을 대상으로 한다.)
 */
test("개별 일정: 계산 전에는 정직한 빈 상태를 보여 준다", async ({ page }) => {
  await login(page);

  const studentRow = await gotoTableRow(page, "/app/students", "정하린");
  await studentRow.first().getByRole("link").first().click();
  await expect(
    page.getByRole("heading", { name: "정하린", exact: true }),
  ).toBeVisible();

  const scheduleSection = page
    .locator("section")
    .filter({ hasText: "개별 일정" });
  await expect(
    scheduleSection.getByText("아직 계산하지 않았습니다."),
  ).toBeVisible();
  // 다음에 할 일이 적혀 있다 — 빈 표만 덩그러니 두지 않는다
  await expect(
    scheduleSection.getByText(/개별 일정 계산/).first(),
  ).toBeVisible();
});
