import { expect, test, type Page } from "@playwright/test";
import { gotoTableRow, tableRow, tableRowIn } from "../lib/table";
import { TEACHER } from "../lib/accounts";


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

    // 반 목록 → 상세 (표 + 쪽넘김 — 검색으로 좁혀야 대상 행이 1쪽에 남는다)
    const classRow = (
      await gotoTableRow(page, "/app/classes", "중2 심화 A")
    ).first();
    await expect(classRow).toBeVisible();
    await classRow.getByRole("link", { name: /중2 심화 A/ }).click();
    /* 반 상세는 아직 표가 아니다 — **명단 구역**으로 스코프한다.
     *
     * 링크의 접근 이름으로 잡지 않는다: 명단의 링크는 이름·학년·최근 응시를
     * 각각 <p>로 담은 블록이라 계산된 접근 이름이 비어 있고, 그래서
     * `getByRole("link", { name: /박서윤/ })`은 아무것도 찾지 못한다(실측).
     * 구역으로 좁히면 불참 폼의 <option>에 있는 같은 이름과도 섞이지 않는다. */
    const roster = page.locator("section").filter({ hasText: /학생 \d+명/ });
    await expect(roster.getByText("박서윤", { exact: true })).toBeVisible();

    // 학습자 목록 → 상세 (숙련도 근거 표시)
    const learnerRow = (
      await gotoTableRow(page, "/app/students", "박서윤")
    ).first();
    await expect(learnerRow).toBeVisible();
    await learnerRow.getByRole("link", { name: /박서윤/ }).click();
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

    // 감사 로그 — 자동·수동 기록.
    // 표 본문으로 스코프한다 — 작업 필터의 <option>에도 같은 문자열이 있다.
    await page.goto("/app/audit");
    await expect(
      tableRow(
        page,
        /schedule\.materialize|assessment\.generate|grading\./,
      ).first(),
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

    // 문제은행 — 시드 문항과 권한 상태.
    // 검수·사용 권한이 서로 다른 칸으로 쪼개졌으므로 한 행에서 각각 단언한다.
    // (전체 화면 getByText는 검수 상태 필터의 <option value="published">게시</option>에 먼저 걸린다)
    /* 검수 상태 필터를 **화면의 것으로** 건다.
     *
     * 이름으로만 좁히고 첫 행을 잡던 것이, 교재 반입으로 초안 문항이 쌓이자
     * 조용히 깨졌다 — 「가감법」 문항 85건 중 게시·사용 가능한 것은 둘뿐이라
     * 첫 행이 검수 필요/확인 중으로 바뀌었다(실측). 재려는 것은 「검수·권한
     * 상태가 각각 칸으로 보이는가」이지 「첫 행이 게시본인가」가 아니다.
     * 필터를 걸면 문항이 얼마나 쌓이든 같은 것을 잰다. */
    await page.goto(
      `/app/content/questions?status=published&q=${encodeURIComponent("가감법")}`,
    );
    const questionRow = tableRow(page, "가감법").first();
    await expect(questionRow).toBeVisible();
    await expect(questionRow.getByText("게시", { exact: true })).toBeVisible();
    /* 사용권 칸은 **비어 있지 않기만** 하면 된다. 값을 못 박았더니
     * (「사용 가능」) 목록에 다른 사용권의 문항이 섞이는 순간 깨졌다 —
     * 콘텐츠가 플랫폼으로 가면서 공용 문항과 학원 문항이 한 목록에
     * 서고, 정렬이 최신순이라 어느 쪽이 첫 행일지는 그날 데이터가
     * 정한다(ADR-0020). 재려는 것은 「검수·권한이 각각 칸으로 보이는가」다. */
    await expect(
      questionRow.getByText(/^(초안|확인 중|사용 가능|제한적 사용|만료|차단)$/),
    ).toBeVisible();

    // 커리큘럼 — 내부 개념과 공식 구분 고지.
    // 개념 표는 플랫폼 공유 참조 데이터라 행이 계속 쌓인다 → 검색으로 좁힌다.
    await page.goto(
      `/app/content/curriculum?q=${encodeURIComponent("연립방정식의 활용")}`,
    );
    await expect(page.getByText(/공식 성취기준이 아닙니다/)).toBeVisible();
    const conceptSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "내부 개념 (canonical)" }),
    });
    await expect(
      tableRowIn(conceptSection, "연립방정식의 활용").first(),
    ).toBeVisible();
  });
});

/** 인수 45: 수직 진행 탐색 — 이전 학교급(초등)부터 다음 확장(고등)까지
 * 한 화면에 계통이 서고, 표상·대표 오개념이 함께 보인다. 읽기 전용. */
test("수직 진행 탐색: 초등→중1→중3→고등 계통 + 표상·오개념", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    "/app/content/curriculum/progression?concept=m1-prime-factorization",
  );

  // 내부 해석 고지 (2K 규칙 3)
  await expect(page.getByText(/공식 성취기준 체계가 아닙니다/)).toBeVisible();

  // 계통의 양 끝 — 이전 학교급(초등 선수)과 다음 확장(고등)이 **계통 사슬 안에**
  // 보인다. 상단 개념 선택 내비에도 같은 이름의 링크가 있으므로 반드시
  // 계통 섹션으로 스코프한다 (변이 검증이 잡은 약한 단언).
  const chain = page.getByRole("region", { name: "수직 계통" });
  await expect(
    chain.getByRole("link", { name: "약수와 배수 (초등)" }),
  ).toBeVisible();
  await expect(
    chain.getByRole("link", { name: "다항식의 인수분해 (고등)" }),
  ).toBeVisible();

  // 표상과 대표 오개념
  await expect(page.getByText("인수 나무").first()).toBeVisible();
  await expect(page.getByText("합성수 인수에서 멈춘 분해")).toBeVisible();

  // 계통 이동 — 고등 개념을 누르면 그 개념 중심으로 다시 선다
  await page
    .getByRole("navigation", { name: "개념 선택" })
    .getByRole("link", { name: "다항식의 인수분해 (고등)" })
    .click();
  await expect(page).toHaveURL(/concept=h1-polynomial-factorization/);
  await expect(
    page
      .getByRole("navigation", { name: "개념 선택" })
      .getByRole("link", { name: "다항식의 인수분해 (고등)" }),
  ).toHaveAttribute("aria-current", "page");
});

/** 인수 15: 1024px 미만에서도 메뉴 디스클로저로 전 화면에 도달할 수 있다 */
test("모바일(390px): 메뉴 디스클로저 → 화면 이동 + 스킵 링크 존재", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  // 데스크톱 사이드바는 숨고, 헤더의 메뉴 디스클로저가 대신한다
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" }),
  ).toBeHidden();
  await page.locator("summary").filter({ hasText: "메뉴" }).click();
  const mobileNav = page.getByRole("navigation", { name: "모바일 메뉴" });
  await expect(mobileNav).toBeVisible();
  await mobileNav.getByRole("link", { name: "학습 루트" }).click();
  await expect(page).toHaveURL(/\/app\/routes/, { timeout: 30_000 });

  // 키보드 스킵 링크 — 포커스 시에만 드러난다
  const skip = page.getByRole("link", { name: "본문으로 건너뛰기" });
  await skip.focus();
  await expect(skip).toBeVisible();
});
