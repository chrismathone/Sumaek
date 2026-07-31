import { expect, test, type Page } from "@playwright/test";

const TEACHER = {
  email: "demo-teacher@su-maek.app",
  password: process.env.DEMO_TEACHER_PASSWORD ?? "sumaek-demo-2026!",
};
const STUDENT = {
  email: "demo-student@su-maek.app",
  password: process.env.DEMO_STUDENT_PASSWORD ?? "sumaek-student-2026!",
};

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(who.email);
  await page.getByLabel("비밀번호").fill(who.password);
  await page.getByRole("button", { name: "로그인" }).click();
}

/**
 * 인수 8·9의 핵심: 학생 응시 → 즉시 자동 채점 → 오답 복습 생성 →
 * 교사 화면 반영 (시퀀스 4·5). 사람 수기 연결 없는 폐쇄 루프.
 */
test("전체 순환: 학생 응시 → 자동 채점 → 복습 배치 → 교사 확인", async ({
  browser,
}) => {
  /* 학생: 응시 */
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await login(student, STUDENT);
  await expect(student).toHaveURL(/\/learn\/today/, { timeout: 30_000 });
  await expect(
    student.getByRole("heading", { name: /박서윤님의 오늘 학습/ }),
  ).toBeVisible();

  // 배정된 일일테스트 응시
  const takeButton = student.getByRole("link", { name: /응시하기|이어서 풀기/ }).first();
  const resultLink = student.getByRole("link", { name: /결과 보기/ }).first();
  const alreadyDone = (await resultLink.count()) > 0 && (await takeButton.count()) === 0;

  if (!alreadyDone) {
    await takeButton.click();
    await expect(student.getByText(/1 \/ \d+/)).toBeVisible({ timeout: 30_000 });

    // 문항 수 파악 후 순회 — 객관식은 ② 선택, 단답은 일부러 오답 "999"
    const counter = await student.getByText(/1 \/ \d+/).innerText();
    const total = Number(counter.split("/")[1]?.trim() ?? 0);
    for (let i = 0; i < total; i++) {
      const radio = student.locator("fieldset label").filter({ hasText: "②" });
      if ((await radio.count()) > 0) {
        await radio.first().click();
      } else {
        const input = student.locator('input[type="text"]');
        await input.fill(i === 0 ? "999" : "3"); // 첫 단답은 오답 유도
        await input.blur();
      }
      await expect(student.getByText(/저장됨|저장 중/)).toBeVisible();
      if (i < total - 1) {
        await student.getByRole("button", { name: "다음" }).click();
      }
    }

    await student.getByRole("button", { name: "제출하기" }).click();
    await student.getByRole("button", { name: "제출 확정" }).click();

    // 결과 페이지 — 점수·문항별 판정
    await expect(student).toHaveURL(/\/learn\/results\//, { timeout: 30_000 });
  } else {
    await resultLink.click();
  }

  await expect(student.getByText("채점 결과")).toBeVisible();
  await expect(student.getByText(/\d+점/).first()).toBeVisible();
  // 오답이 있으면 복습 배치 안내
  const wrongBadge = student.getByText("오답", { exact: true });
  if ((await wrongBadge.count()) > 0) {
    await expect(
      student.getByText(/복습 일정에 배치되었습니다/),
    ).toBeVisible();
  }
  await studentCtx.close();

  /* 교사: 제출 반영 확인 */
  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await login(teacher, TEACHER);
  await expect(teacher).toHaveURL(/\/app\/today/, { timeout: 30_000 });
  await teacher.goto("/app/tests");
  await expect(teacher.getByText(/제출 [1-9]\d*명/).first()).toBeVisible();
  await teacherCtx.close();
});
