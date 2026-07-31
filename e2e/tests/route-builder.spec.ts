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

  await page.goto("/app/students");
  await page.getByRole("link", { name: /박서윤/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "박서윤", exact: true }),
  ).toBeVisible();

  const section = page
    .locator("section")
    .filter({ hasText: "개별 경로 오버라이드" });
  await section.getByLabel("사유 (필수)").fill("가감법 확인테스트 미통과 보충");
  await section.getByLabel("보충 노드 제목").fill("가감법 집중 연습");
  await section.getByText("일차방정식 복습", { exact: true }).click();
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
  await expect(row.getByText("적용 중")).toBeVisible();

  // 감사 로그 기록
  await page.goto("/app/audit");
  await expect(page.getByText("route.create-override").first()).toBeVisible();

  // 취소 — 다음 실행의 멱등성 (이전 실행 잔재 포함 전부 정리)
  await page.goto("/app/students");
  await page.getByRole("link", { name: /박서윤/ }).first().click();
  const cancelButtons = page.getByRole("button", { name: "취소", exact: true });
  for (let i = 0; i < 10; i++) {
    const count = await cancelButtons.count();
    if (count === 0) break;
    await cancelButtons.first().click();
    await expect(cancelButtons).toHaveCount(count - 1, { timeout: 15_000 });
  }
  await expect(cancelButtons).toHaveCount(0);
});
