import { expect, test, type Page } from "@playwright/test";
import { gotoTableRow } from "../lib/table";

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

  /* 끝난 테스트는 「지난 테스트 N건 보기」 안에 접혀 있다 (6단계 흐름).
   * 닫힌 <details>의 내용은 접근성 트리에 노출되지 않아 getByRole이 0을
   * 돌려준다 — 펴 놓고 세지 않으면 "이미 완료"를 못 알아본다. */
  const pastDisclosure = student.getByText(/지난 테스트 \d+건 보기/);
  if ((await pastDisclosure.count()) > 0) await pastDisclosure.first().click();

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
  // 교사 목록에서 같은 테스트 행을 집기 위해 제목을 확보한다
  const testTitle = (
    await student.getByRole("heading", { level: 1 }).innerText()
  ).trim();
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
  // 목록이 표로 바뀌면서 "제출 N명" 한 줄이 배정·제출 칸으로 쪼개졌다 (ADR-0016).
  // 페이지네이션(기본 10행)에 밀리지 않도록 학생이 응시한 테스트 제목으로 좁힌다.
  const testRows = await gotoTableRow(teacher, "/app/tests", testTitle);
  await expect(testRows.first()).toBeVisible();

  // '제출' 열이 몇 번째 칸인지 열 머리에서 읽는다 (열 순서 변경에 흔들리지 않게)
  const headers = await teacher.locator("table thead th").allInnerTexts();
  const submittedIndex = headers.findIndex((h) => h.startsWith("제출"));
  expect(submittedIndex).toBeGreaterThan(-1);

  // 같은 제목의 행 중 최소 하나는 제출 인원이 1명 이상 — 학생 제출이 교사 화면에 반영됐다
  const submittedCells = testRows.locator(
    `td:nth-child(${submittedIndex + 1})`,
  );
  await expect(
    submittedCells.filter({ hasText: /^[1-9]\d*명$/ }).first(),
  ).toBeVisible();
  await teacherCtx.close();
});
