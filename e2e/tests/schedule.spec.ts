import { expect, test } from "@playwright/test";
import { nthIsoDate, todayIso } from "../lib/dates";
import { gotoTableRow, tableRow } from "../lib/table";

const DEMO_EMAIL = "demo-teacher@su-maek.app";
const DEMO_PASSWORD = process.env.DEMO_TEACHER_PASSWORD ?? "sumaek-demo-2026!";

/** 인수 3·5의 기초: 게시된 루트에서 날짜별 수업 생성 (시퀀스 1) */
test("루트 → 미래 일정 생성 → 오늘 운영실 반영", async ({ page }) => {
  // 로그인
  await page.goto("/login");
  await page.getByLabel("이메일").fill(DEMO_EMAIL);
  await page.getByLabel("비밀번호").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/today/, { timeout: 30_000 });

  // 학습 루트 목록 — 시드된 게시 루트 카드로 스코프
  //  (루트 빌더 E2E가 만든 다른 게시 루트와 구분한다)
  // 검색으로 좁혀서 잡는다 — 페이지네이션 뒤로 밀리면 못 찾는다
  const card = await gotoTableRow(
    page,
    "/app/routes",
    "연립방정식 단원",
    "중2 심화 A — 연립방정식 단원",
  );
  await expect(card).toBeVisible();
  // 표에서는 버전·상태·노드 수가 각각 다른 칸이다 (ADR-0016)
  await expect(card.getByText("게시됨")).toBeVisible();
  await expect(card.getByText("6개", { exact: true })).toBeVisible();

  // 일정 생성 실행
  await card.getByRole("button", { name: "미래 일정 생성·재계산" }).click();
  const status = card.getByRole("status");
  await expect(status).toContainText(/미래 수업 \d+건을 생성했습니다/, {
    timeout: 30_000,
  });
  // 실체화는 과거를 만들지 않는다 — 첫 수업일이 오늘 이후인지로 확인한다
  // (고정 날짜를 적으면 그날이 지나는 순간 스펙이 깨진다)
  const firstLesson = nthIsoDate(await status.innerText(), 0);
  expect(firstLesson >= todayIso()).toBe(true);

  // 멱등성: 같은 버튼을 다시 눌러도 같은 개수로 재생성 (중복 누적 없음)
  const firstMessage = await status.innerText();
  const match = firstMessage.match(/미래 수업 (\d+)건/);
  const firstCount = Number(match?.[1] ?? 0);
  expect(firstCount).toBeGreaterThan(0);

  await card.getByRole("button", { name: "미래 일정 생성·재계산" }).click();
  await expect(card.getByRole("status")).toContainText(
    `미래 수업 ${firstCount}건을 생성했습니다`,
    { timeout: 30_000 },
  );

  // 루트 목록의 미래 수업 수 반영
  await page.reload();
  await expect(
    tableRow(page, "중2 심화 A — 연립방정식 단원").getByText(`${firstCount}건`, {
      exact: true,
    }),
  ).toBeVisible();
  // (reload는 ?q=…를 유지하므로 검색 결과 안에서 그대로 찾는다)
});
