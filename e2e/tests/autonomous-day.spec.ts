import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  createAutonomousWorkspace,
  dropAutonomousWorkspace,
  type AutonomousWorkspace,
} from "../fixtures/autonomous-workspace";
import { futureIso, todayIso } from "../lib/dates";
import { gotoTableRow } from "../lib/table";

/* ─────────────────────────────────────────────────────────────
 * 빈 워크스페이스 → 학생 하루 완료, 실제 워커와 함께 (T6.2 · G-10).
 *
 * 기존 full-loop 스펙이 검증한 것은 **시드된 평가를 학생이 푸는 것**까지였다.
 * 그 앞의 절반 — 학원이 아무것도 없는 상태에서 스스로 여기까지 오는 것 —
 * 은 한 번도 자동으로 확인된 적이 없다. 그리고 그 절반에 사람 손이 필요한
 * 곳이 하나라도 있으면 제품은 「자율」이 아니다.
 *
 * 그래서 이 스펙은 시드를 쓰지 않는다. 조직·원장 계정·문제은행만 픽스처가
 * 놓고(제품에 만들 화면이 없는 것들), 과정 기간부터 학생의 하루 완료까지는
 * 전부 화면을 눌러서 간다. 그중 **평가 생성만은 아무도 누르지 않는다** —
 * 워커가 스스로 해야 하고, 안 하면 여기서 깨진다.
 *
 * ── 왜 설정 화면을 따라가는가 ────────────────────────────
 * 순서를 스펙이 알고 있으면 온보딩 화면이 틀려도 통과한다. 그래서 매 단계
 * 「지금 할 차례」를 화면에서 읽고 그 링크로 이동한다 — 화면이 시키는 대로만
 * 간다. 실제로 이 방식이 막다른 길 두 개를 찾아냈다(자료·루트 순서, 그리고
 * 「하러 가기」가 폼 없는 목록으로 보내던 것).
 *
 * ── 한 테스트가 아니라 이어지는 여러 테스트인 이유 ──────
 * 하나로 묶으면 어디서 깨졌는지 이름이 말해 주지 않는다. `describe.serial`은
 * 앞이 깨지면 뒤를 건너뛰므로, 실패한 이름 하나가 곧 「여기까지는 됐다」다.
 * 워크스페이스는 describe 하나당 하나이고, `--repeat-each`는 매번 새로
 * 만든다 — 두 번째 실행이 첫 번째의 흔적 위에서 돌면 「빈 학원」이 아니다.
 *
 * ── 아는 한계: 자정 ─────────────────────────────────────
 * 과정 기간 시작일과 오늘 수업은 ①이 도는 시점의 KST 날짜로 정해진다.
 * 실행이 자정을 넘기면 그 날짜가 어제가 되어 학생의 오늘이 비고 ⑤가
 * 깨진다. 한 바퀴가 1~2분이므로 하루 중 1분 남짓만 그렇고, 막으려면
 * 앱의 시계를 스펙이 조작해야 한다 — 그 대가가 더 크다. 자정 직전 실행이
 * 깨지면 이것을 먼저 의심할 것.
 * ───────────────────────────────────────────────────────────── */

const WCAG_TAGS = ["wcag2a", "wcag2aa"];
/** 실기기 최소폭 — 「열린다」가 아니라 「가로 스크롤 없이 조작된다」를 잰다 */
const NARROW = { width: 360, height: 780 };

test.describe.serial("빈 워크스페이스가 스스로 학생의 하루에 닿는다", () => {
  let ws: AutonomousWorkspace;
  let teacherCtx: BrowserContext;
  let teacher: Page;
  /** 화면이 한 번만 보여 주는 초기 비밀번호 — 학생 로그인에 그대로 쓴다 */
  const student = { name: "", email: "", password: "" };
  /** 마우스를 한 번도 쓰지 않고 하루를 마치는 학생 (T6.3 인수 4) */
  const keyboard = { name: "", email: "", password: "" };
  /** 로그인은 시키되 하루는 열지 않는 학생 — 교사 현황의 「기록 없음」 */
  const absent = { name: "", email: "", password: "" };
  let groupName = "";
  let materialTitle = "";
  /**
   * 키보드 학생이 실제로 완주했는가.
   *
   * ⑥의 기대 완료 수를 **여기서 가져온다.** 숫자를 박아 두면 ⑤-2가
   * 건너뛰어지는 엔진(WebKit)에서 ⑥이 엉뚱하게 깨진다 — 실측으로 그랬다.
   * 앞 단계가 한 일을 뒤 단계가 세는 편이 어느 쪽이 건너뛰든 맞는다.
   */
  let keyboardFinished = false;

  test.beforeAll(async ({ browser }) => {
    ws = await createAutonomousWorkspace();
    student.name = `E2E학생-${ws.stamp}`;
    student.email = `e2e-auto-${ws.stamp}-a@su-maek.test`;
    keyboard.name = `E2E키보드-${ws.stamp}`;
    keyboard.email = `e2e-auto-${ws.stamp}-c@su-maek.test`;
    absent.name = `E2E무기록-${ws.stamp}`;
    absent.email = `e2e-auto-${ws.stamp}-b@su-maek.test`;
    groupName = `E2E자율반-${ws.stamp}`;
    materialTitle = `E2E자료-${ws.stamp}`;

    teacherCtx = await browser.newContext();
    teacher = await teacherCtx.newPage();
    await login(teacher, ws.teacher);
    await expect(teacher).toHaveURL(/\/app\/today/, { timeout: 60_000 });
  });

  test.afterAll(async () => {
    await teacherCtx?.close();
    if (ws) await dropAutonomousWorkspace(ws);
  });

  /* ── ① 온보딩 (T5.1의 밀린 E2E) ──────────────────────────── */

  test("① 설정 화면이 시키는 대로만 가서 학생이 로그인할 수 있게 된다", async () => {
    await teacher.goto("/app/setup");
    /* 빈 학원은 0단계에서 시작한다. 시드가 든 조직으로 확인하면 이 줄은
     * 아무것도 못 잡는다 — 새 학원이 만나는 상태가 아니기 때문이다. */
    await expect(teacher.getByText("0 / 8 단계")).toBeVisible();

    /* 1) 과정 기간 — 오늘부터 시작해야 오늘이 수업일이 될 수 있다.
     *    (수업 요일 규칙의 적용 시작일이 과정 기간 시작일이다) */
    await followSetupStep(teacher, "과정 기간 만들기");
    const periodSection = section(teacher, "과정 기간 만들기");
    await periodSection.getByLabel("기간 이름").fill(`E2E기간-${ws.stamp}`);
    await periodSection.getByLabel("시작일").fill(todayIso());
    await periodSection.getByLabel("종료일").fill(futureIso(60));
    await periodSection.getByRole("button", { name: "과정 기간 만들기" }).click();
    await expect(
      periodSection.getByRole("status").filter({ hasText: "만들었습니다" }),
    ).toBeVisible();

    /* 2) 반 — 요일 일곱 개를 전부 켠다. 오늘이 무슨 요일이든 오늘 수업이
     *    생기고, 못 나간 진도가 밀릴 다음 수업일도 반드시 있다. */
    await followSetupStep(teacher, "반 만들기");
    const groupSection = section(teacher, "반 만들기");
    await groupSection.getByLabel("반 이름").fill(groupName);
    await groupSection.getByLabel("과정 설명").fill("자율 E2E");
    for (const day of ["월", "화", "수", "목", "금", "토", "일"]) {
      await groupSection.getByText(day, { exact: true }).click();
    }
    await groupSection.getByRole("button", { name: "반 만들기" }).click();
    await expect(
      groupSection.getByRole("status").filter({ hasText: "주 7회 수업" }),
    ).toBeVisible();

    /* 3) 학생 셋 — 마우스로 완주 · 키보드만으로 완주 · 로그인조차 안 함.
     *    교사 현황이 셋을 갈라 보여 주는지가 T4.4의 요지다. */
    await followSetupStep(teacher, "학생 등록");
    for (const name of [student.name, keyboard.name, absent.name]) {
      const learnerSection = section(teacher, "학습자 등록");
      await learnerSection.getByLabel("이름 (표시명)").fill(name);
      await learnerSection.getByLabel("학년").fill("middle-2");
      await learnerSection.getByLabel("소속 반").selectOption({ label: groupName });
      await learnerSection.getByRole("button", { name: "학습자 등록" }).click();
      await expect(
        learnerSection.getByRole("status").filter({ hasText: "등록했습니다" }),
      ).toBeVisible();
      await teacher.reload();
    }

    /* 4) 계정 — 초기 비밀번호는 이 화면에 **한 번만** 뜬다. 저장하지 않으므로
     *    여기서 읽지 못하면 학생은 영영 로그인할 수 없다(그래서 이 단언이
     *    곧 「교사가 실제로 쓸 수 있는가」다). */
    await followSetupStep(teacher, "학생 로그인 계정 연결");
    /* 이메일 칸은 **학생 이름으로 찾아** 채운다. 순서로 집으면 안 된다 —
     * 이 목록은 등록순이 아니고(실측: 「E2E무기록」이 「E2E학생」보다 먼저
     * 왔다), 그러면 A의 계정에 B의 이메일이 들어간다. 화면은 「발급 2건」이라
     * 말하고 스펙도 통과하는데, 그 비밀번호로는 아무도 로그인할 수 없다. */
    for (const who of [student, keyboard, absent]) {
      await teacher
        .locator("li")
        .filter({ hasText: who.name })
        .getByPlaceholder("이메일 (비우면 건너뜀)")
        .fill(who.email);
    }
    await teacher.getByRole("button", { name: "적은 학생에게 발급" }).click();

    const issued = teacher.getByRole("status").filter({ hasText: "발급 3건" });
    await expect(issued).toBeVisible();
    const rows = issued.locator("li");
    for (const who of [student, keyboard]) {
      const mine = rows.filter({ hasText: who.name });
      who.password = (await mine.locator("code").innerText()).trim();
      expect(who.password.length).toBeGreaterThan(6);
    }

    /* 진행률을 숫자로 박지 않는다 — 반을 만들 때 평가 정책이 함께 생겨서
     * (T5.1) 여기서 끝난 단계는 넷이 아니라 다섯이고, 그런 부수 효과가
     * 하나 늘 때마다 숫자만 틀린다. 확인할 것은 **계정 단계가 끝났고 다음이
     * 자료**라는 사실이다. */
    await teacher.goto("/app/setup");
    await expect(teacher.getByText("3명 전부 연결됨")).toBeVisible();
    await expect(
      teacher.locator("li").filter({ hasText: "지금 할 차례" }).first(),
    ).toContainText("학습 자료 등록");
  });

  /* ── ② 자료 → 루트 게시 → 일정 ───────────────────────────── */

  test("② 자료를 먼저 만들어야 루트가 게시되고, 그래야 일정이 생긴다", async () => {
    /* 순서가 뒤집히면 여기서 깨진다: 자료 없이 게시를 누르면 준비도
     * 게이트가 「자료가 없습니다」로 거부한다. 그 거부를 만나는 화면이
     * 자료 단계로 갈 길을 주지 않는 것이 원래의 막다른 길이었다. */
    await followSetupStep(teacher, "학습 자료 등록");
    await teacher.locator("input#cq").fill(ws.concept.name);
    await teacher.getByRole("button", { name: "찾기", exact: true }).click();
    const createForm = teacher.locator("form").filter({ hasText: "초안으로 만들기" });
    await createForm
      .getByLabel("개념", { exact: true })
      .selectOption({ label: ws.concept.name });
    await createForm.getByLabel("종류").selectOption("reading");
    await createForm.getByLabel("제목").fill(materialTitle);
    await createForm.getByLabel("본문").fill(`${ws.concept.name}을 정리한 자율 E2E 설명입니다.`);
    await createForm.getByRole("button", { name: "초안으로 만들기" }).click();
    await expect(
      teacher.getByRole("status").filter({ hasText: "초안으로 만들었습니다" }),
    ).toBeVisible();

    const materialRow = (
      await gotoTableRow(teacher, "/app/content/materials", materialTitle)
    ).first();
    await materialRow.getByRole("link").first().click();
    await expect(teacher).toHaveURL(/\/app\/content\/materials\/[0-9a-f-]{36}/);
    await teacher.getByRole("button", { name: "게시", exact: true }).click();
    await expect(teacher.getByRole("button", { name: "게시 취소" })).toBeVisible();

    /* 루트 — 다섯 노드. 60분씩이고 하루 한도가 120분이라 사흘로 갈린다:
     *   오늘   개념 차시 · 일일테스트      ← ④가 워커의 생성을 여기서 본다
     *   내일   개념 차시 · **확인테스트**  ← ⑦에서 밀릴 게이트
     *   모레   일일테스트                  ← ③이 「아직 안 만들어졌다」를 여기서 본다
     *
     * 모레가 필요한 이유: 생성은 수업 24시간 전부터 돈다. 오늘·내일 것은
     * 실행 시각에 따라 이미 만들어져 있을 수 있어(실측: 워커가 3초 만에
     * 만들어 ③이 졌다) 「아직 없음」을 안정적으로 볼 수 없다. 모레 16시는
     * 어떤 시각에 돌려도 아직 24시간 밖이다.
     *
     * 개념 차시 둘은 **같은 개념**이다 — 자료를 하나만 만들어도 둘 다
     * 막히지 않는다. 픽스처가 교육과정 모양을 더 타지 않게 한다. */
    await followSetupStep(teacher, "학습 루트 게시");
    const newRoute = teacher.locator("section").filter({ hasText: "새 루트 만들기" });
    await newRoute.getByLabel("루트 이름").fill(`E2E루트-${ws.stamp}`);
    await newRoute.getByLabel("대상 반").selectOption({ label: groupName });
    await newRoute.getByRole("button", { name: "루트 만들기" }).click();
    await expect(teacher).toHaveURL(/\/app\/routes\/[0-9a-f-]{36}/);

    const addForm = teacher.locator("form").filter({ hasText: "노드 추가" });
    const addNode = async (
      kindLabel: string,
      title: string,
      withConcept = false,
    ): Promise<void> => {
      await addForm.getByLabel("종류").selectOption({ label: kindLabel });
      await addForm.getByLabel("노드 제목").fill(title);
      if (withConcept) {
        /* 개념 체크박스는 **폼 안의 묶음**에서 고른다 — 추가된 노드 목록에도
         * 같은 개념명이 찍혀 화면 전체로는 둘이 잡힌다. */
        await addForm
          .getByRole("group")
          .getByText(ws.concept.name, { exact: true })
          .click();
      }
      await addForm.getByRole("button", { name: "노드 추가" }).click();
      await expect(
        addForm.getByRole("status").filter({ hasText: title }),
      ).toBeVisible();
    };

    await addNode("개념 수업", `${ws.concept.name} 개념 차시`, true);
    await addNode("일일테스트", "자율 일일테스트", false);
    await addNode("개념 수업", `${ws.concept.name} 이어서`, true);
    await addNode("확인테스트", "자율 확인테스트", false);
    await addNode("일일테스트", "자율 일일테스트 2", false);

    await teacher.getByRole("button", { name: "검증 실행" }).click();
    await expect(
      teacher.getByRole("status").filter({ hasText: "검증 통과" }),
    ).toBeVisible();
    await teacher.getByRole("button", { name: "게시", exact: true }).click();
    /* 게시가 준비도 게이트를 지났다는 것 — 자료를 먼저 만든 덕이다 */
    await expect(teacher.getByText("게시된 활성 버전")).toBeVisible();

    await teacher.getByRole("button", { name: "미래 일정 생성·재계산" }).click();
    await expect(teacher.getByRole("status")).toContainText(
      /미래 수업 \d+건을 생성했습니다/,
    );

    await teacher.goto("/app/setup");
    await expect(teacher.getByText("8 / 8 단계")).toBeVisible();
    await expect(
      teacher.getByText("학생이 오늘 학습을 시작할 수 있습니다."),
    ).toBeVisible();
  });

  /* ── ③ 준비도 미리보기 (T5.4의 밀린 E2E) ─────────────────── */

  test("③ 아직 시험이 없는 날을 교사가 학생보다 먼저 본다", async () => {
    /* 준비도 미리보기는 학생 화면과 **같은 투영기**를 계획을 남기지 않고
     * 돌린다 — 그것이 이 화면의 전부다: 학생이 로그인하기 전에 그날을
     * 미리 보는 것.
     *
     * 모레를 본다. 생성은 수업 24시간 전부터 도니까 모레 것은 지금 어떤
     * 시각에도 아직 없다. 오늘을 보면 워커가 이미 만들었을 수 있어(실측)
     * 이 단언이 실행 시각에 따라 뒤집힌다 — 그런 검사는 통과해도 아무것도
     * 증명하지 않는다. */
    await teacher.goto(`/app/readiness?date=${futureIso(2)}`);
    const groupCard = teacher.locator("li").filter({ hasText: groupName }).first();
    await expect(groupCard).toBeVisible();
    await expect(groupCard.getByText("준비됨 0 / 3")).toBeVisible();
    /* 교사에게는 **교사 문구**로 말한다. 학생 화면의 「오늘 시험이 아직
     * 만들어지지 않았습니다」와 같은 코드이되 다른 문장이다 — 학생에게는
     * 조치가 없고 교사에게는 그것이 곧 할 일이기 때문이다. 같은 사유가
     * 두 화면에서 같은 말로 나오면 이 구분이 무너진 것이다. */
    await expect(
      groupCard
        .getByText("예정된 평가가 아직 생성되지 않았습니다.")
        .first(),
    ).toBeVisible();
    /* 「고치러 가기」가 붙는다 — 사유만 보여 주고 끝내지 않는다 */
    await expect(
      groupCard.getByRole("link", { name: "고치러 가기" }).first(),
    ).toBeVisible();
    /* 학생별로도 갈라 보인다 — 「2명 막힘」만으로는 누구인지 모른다 */
    await expect(groupCard.getByRole("link", { name: student.name })).toBeVisible();
  });

  /* ── ④ 워커가 만든다 — 교사는 아무 버튼도 누르지 않는다 ──── */

  test("④ 교사가 평가 생성 버튼을 누르지 않아도 학생 테스트가 생긴다", async () => {
    /* 이 테스트에는 **클릭이 없다.** 새로 고치며 기다리기만 한다 — 그것이
     * 요지다. 워커가 죽어 있거나 생산자가 돌지 않으면 여기서 시간이 다
     * 가고, 다른 어떤 단언도 이 사실을 대신 말해 주지 않는다. */
    await expect(async () => {
      const row = await gotoTableRow(teacher, "/app/tests", "일일테스트");
      await expect(row.first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [2_000] });

    /* 배정까지 갔는가 — 평가만 생기고 배정이 없으면 학생 화면은 그대로 빈다 */
    const testRow = (await gotoTableRow(teacher, "/app/tests", "일일테스트")).first();
    const headers = await teacher.locator("table thead th").allInnerTexts();
    const assignedIndex = headers.findIndex((h) => h.startsWith("배정"));
    expect(assignedIndex).toBeGreaterThan(-1);
    await expect(
      testRow.locator(`td:nth-child(${assignedIndex + 1})`),
    ).toHaveText("3명");

    /* 준비도에서도 막힘이 사라진다 — 같은 사실을 두 화면이 같이 말한다 */
    await teacher.goto("/app/readiness");
    const groupCard = teacher.locator("li").filter({ hasText: groupName }).first();
    await expect(groupCard.getByText("준비됨 3 / 3")).toBeVisible();
    await expect(
      groupCard.getByText("이 반은 그날 학습을 시작할 수 있습니다."),
    ).toBeVisible();
  });

  /* ── ⑤ 학생의 하루 (T1.4의 밀린 E2E) ─────────────────────── */

  test("⑤ 학생이 자료를 보고 시험을 치러 하루를 마친다", async ({
    browser,
    browserName,
  }) => {
    const studentCtx = await browser.newContext();
    const page = await studentCtx.newPage();
    try {
      await login(page, student);
      await expect(page).toHaveURL(/\/learn\/today/, { timeout: 60_000 });
      await expect(
        page.getByRole("heading", { name: `${student.name}님의 오늘 학습` }),
      ).toBeVisible();

      /* 1) 개념 학습 — 오늘 배울 개념의 자료를 연다 */
      await page.goto("/learn/study");
      const card = page.locator("section").filter({ hasText: materialTitle });
      await expect(card).toBeVisible();
      const article = card.locator("article").filter({ hasText: materialTitle });
      await article.getByRole("button", { name: "다 봤어요" }).click();
      await expect(article.getByText("완료", { exact: true })).toBeVisible();

      /* 2) 테스트 — 문항 본문에 답이 적혀 있다. 화면에서 읽어 답한다.
       *    (정답을 스펙이 알고 있으면 러너가 엉뚱한 문항을 보여 줘도 통과한다) */
      await page.goto("/learn/today");
      await page.getByRole("link", { name: /응시하기|이어서 풀기/ }).first().click();
      await expect(page.getByText(/1 \/ \d+/)).toBeVisible();
      const counter = await page.getByText(/1 \/ \d+/).innerText();
      const total = Number(counter.split("/")[1]?.trim() ?? 0);
      expect(total).toBeGreaterThan(0);

      for (let i = 0; i < total; i++) {
        const body = await page.locator("main").innerText();
        const answer = /답은 (\d+)입니다/.exec(body)?.[1];
        expect(answer, "문항 본문에서 답을 읽지 못했습니다").toBeTruthy();
        const input = page.locator('input[type="text"]');
        await input.fill(answer!);
        await input.blur();
        await expect(page.getByText(/저장됨|저장 중/)).toBeVisible();
        if (i < total - 1) await page.getByRole("button", { name: "다음" }).click();
      }

      await page.getByRole("button", { name: "제출하기" }).click();
      await page.getByRole("button", { name: "제출 확정" }).click();
      await expect(page).toHaveURL(/\/learn\/results\//, { timeout: 60_000 });
      await expect(page.getByText("채점 결과")).toBeVisible();
      /* 전부 맞혔다 — 문항 본문이 말한 답을 그대로 냈으므로 만점이어야 한다.
       * 점수를 안 보면 「제출은 됐는데 채점이 엉뚱한」 상태를 놓친다.
       *
       * 만점을 숫자로 박지 않는다. 출제 문항 수는 정책과 문제은행이 정하고
       * (지금은 개념당 상한 3문항), 그 수가 바뀌면 총점만 달라진다. 재는
       * 것은 **얻은 점수와 총점이 같은가**이지 그 값이 얼마인가가 아니다. */
      const scoreLine = page.getByText(/^\d+(\.\d+)?점 \/ \d+(\.\d+)?점$/).first();
      await expect(scoreLine).toBeVisible();
      const [earned, outOf] = (await scoreLine.innerText())
        .split("/")
        .map((part) => Number(part.replace(/[^\d.]/g, "")));
      expect(outOf).toBeGreaterThan(0);
      expect(earned).toBe(outOf);
      /* 오답 배지가 하나도 없다 — 「총점은 맞는데 문항 판정이 뒤집힌」
       * 상태가 합계만으로는 드러나지 않는다 */
      await expect(page.getByText("오답", { exact: true })).toHaveCount(0);

      /* 3) 하루가 **스스로** 닫힌다 — 마치기 버튼이 따로 없다. 필수를 다
       *    마치면 재투영이 완료로 굳히고, 그 시각이 화면에 붙는다 (T4.1). */
      await page.goto("/learn/today");
      await expect(page.getByText("오늘 할 일을 모두 마쳤습니다.")).toBeVisible();

      /* 4) 360px — 완주 화면이 좁은 폭에서도 가로로 새지 않는다 */
      await page.setViewportSize(NARROW);
      await page.reload();
      await expect(page.getByText("오늘 할 일을 모두 마쳤습니다.")).toBeVisible();
      await expectNoHorizontalScroll(page);

      /* 5) 키보드만으로 다음 화면에 닿는다 — 학생 화면은 링크가 전부다.
       *
       * WebKit에서는 재지 않는다. Safari는 **기본 설정에서 링크를 탭 순서에
       * 넣지 않는다**(「Tab 키로 웹 페이지의 각 항목 강조」가 꺼져 있다).
       * 실측한 탭 순서:
       *   Chromium  A[href] > INPUT > INPUT > BUTTON > A[href] > …
       *   WebKit    INPUT > INPUT > BUTTON > … (A[href]가 아예 없다)
       * 페이지가 바꿀 수 있는 것이 아니라 브라우저 설정이므로, 여기서
       * 실패하면 제품이 아니라 엔진을 재는 것이 된다. 폼 요소(입력·버튼)는
       * WebKit에서도 탭으로 닿으므로 응시 경로 자체는 그쪽에서도 열려 있다. */
      if (browserName !== "webkit") {
        expect(await tabToLink(page, "지난 기록")).toBe(true);
      }

      /* 6) axe — 색 하나로만 말하는 상태가 없는지까지 본다 */
      const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        result.violations.map((v) => `${v.id}(${v.nodes.length})`),
      ).toEqual([]);
    } finally {
      await studentCtx.close();
    }
  });

  /* ── ⑤-2 마우스 없이 (T6.3 인수 4) ──────────────────────── */

  test("⑤-2 마우스를 한 번도 쓰지 않고 하루를 마친다", async ({
    browser,
    browserName,
  }) => {
    /* 「키보드로도 쓸 수 있다」는 축약 없이 재야 뜻이 있다. 이 테스트는
     * 클릭을 **한 번도** 하지 않는다 — 로그인 · 자료 완료 · 응시 · 제출까지
     * Tab·Enter·타이핑만 쓴다. 중간에 하나라도 닿지 않으면 거기서 멈춘다.
     *
     * WebKit은 제외한다. Safari가 기본 설정에서 링크를 탭 순서에 넣지 않아
     * (⑤의 실측 주석 참고) 페이지가 아니라 브라우저 설정을 재게 된다. */
    test.skip(browserName === "webkit", "WebKit은 기본 설정에서 링크를 탭 순서에 넣지 않는다");

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      /* 1) 로그인 — 폼 요소만으로 닿는다 */
      await page.goto("/login");
      expect(await focusByTab(page, (el) => el.tag === "INPUT")).toBe(true);
      await page.keyboard.type(keyboard.email);
      await page.keyboard.press("Tab");
      await page.keyboard.type(keyboard.password);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/learn\/today/, { timeout: 60_000 });

      /* 2) 개념 학습으로 — 오늘 화면의 「할 차례」 링크를 눌러 간다 */
      expect(
        await focusByTab(page, (el) => el.tag === "A" && /개념 학습/.test(el.text)),
      ).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/learn\/study/, { timeout: 60_000 });

      /* 3) 자료를 다 봤다고 표시 — 버튼도 탭으로 닿아야 한다 */
      expect(
        await focusByTab(page, (el) => el.tag === "BUTTON" && el.text.includes("다 봤어요")),
      ).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page.getByText("완료", { exact: true }).first()).toBeVisible();

      /* 4) 응시 — 오늘 화면으로 돌아가 시험 링크를 연다 */
      await page.goto("/learn/today");
      expect(
        await focusByTab(page, (el) => el.tag === "A" && /응시하기|이어서 풀기/.test(el.text)),
      ).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page.getByText(/1 \/ \d+/)).toBeVisible({ timeout: 60_000 });

      /* 5) 문항을 풀고 제출 — 답 칸도 「다음」도 탭으로 닿는다 */
      const counter = await page.getByText(/1 \/ \d+/).innerText();
      const total = Number(counter.split("/")[1]?.trim() ?? 0);
      expect(total).toBeGreaterThan(0);
      for (let i = 0; i < total; i++) {
        const body = await page.locator("main").innerText();
        const answer = /답은 (\d+)입니다/.exec(body)?.[1];
        expect(answer, "문항 본문에서 답을 읽지 못했습니다").toBeTruthy();
        expect(
          await focusByTab(page, (el) => el.tag === "INPUT" && el.type === "text"),
        ).toBe(true);
        await page.keyboard.type(answer!);
        /* Tab이 곧 blur다 — 저장은 blur에서 일어난다 */
        await page.keyboard.press("Tab");
        await expect(page.getByText(/저장됨|저장 중/)).toBeVisible();
        const nextLabel = i < total - 1 ? "다음" : "제출하기";
        expect(
          await focusByTab(page, (el) => el.tag === "BUTTON" && el.text.trim() === nextLabel),
        ).toBe(true);
        await page.keyboard.press("Enter");
      }
      expect(
        await focusByTab(page, (el) => el.tag === "BUTTON" && el.text.includes("제출 확정")),
      ).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/learn\/results\//, { timeout: 60_000 });

      /* 6) 하루가 닫혔다 — 마우스 없이 온 학생도 같은 자리에 도착한다 */
      await page.goto("/learn/today");
      await expect(page.getByText("오늘 할 일을 모두 마쳤습니다.")).toBeVisible();
      keyboardFinished = true;
    } finally {
      await ctx.close();
    }
  });

  /* ── ⑥ 교사 현황 (T4.4의 밀린 E2E) ───────────────────────── */

  test("⑥ 완주한 학생과 로그인조차 안 한 학생이 갈려 보인다", async () => {
    await teacher.goto("/app/today");
    const groupCard = teacher.locator("li").filter({ hasText: groupName }).first();
    await expect(groupCard).toBeVisible();

    /* 「완료 1 · 기록 없음 1」 — 기록 없음을 미시작에 합치면 로그인 문제가
     * 「아직 안 했나 보다」로 묻힌다. 그래서 다른 칸이다. */
    /* 세는 줄 하나를 잡고 그 안에서 본다. 「기록 없음」이라는 문자열은 이
     * 카드 안에 두 번 나온다 — 세는 줄과, 그 학생의 이름 옆 상태 배지.
     * 아무 쪽이나 잡으면 strict mode로 죽거나(실측) 엉뚱한 쪽을 잰다. */
    const counts = groupCard.locator("div").filter({ hasText: "기록 없음" }).last();
    /* 마우스로 완주한 한 명 + 키보드로 완주한 한 명. 뒤엣것이 건너뛰어진
     * 엔진에서는 그 학생이 로그인조차 안 한 것이 되므로 완료가 하나 줄고
     * 기록 없음이 하나 는다 — 두 칸이 함께 움직인다. 앞 단계가 실제로 한
     * 일을 세면 어느 쪽이 건너뛰든 맞는다. */
    await expect(counts).toContainText(`완료 ${keyboardFinished ? 2 : 1}`);
    await expect(counts).toContainText(`기록 없음 ${keyboardFinished ? 1 : 2}`);
    /* 막힘이 0이다 — 평가↔노드 연결이 끊기면 여기가 2가 된다 */
    await expect(counts).toContainText("막힘 0");
    /* 반 수업은 아직 마감 전이다 — 학생이 다 했다고 반이 끝나지 않는다 (I-21) */
    await expect(groupCard.getByText("수업 미마감")).toBeVisible();

    await teacher.setViewportSize(NARROW);
    await teacher.reload();
    await expect(
      teacher.locator("li").filter({ hasText: groupName }).first(),
    ).toBeVisible();
    await expectNoHorizontalScroll(teacher);

    const result = await new AxeBuilder({ page: teacher })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(result.violations.map((v) => `${v.id}(${v.nodes.length})`)).toEqual([]);
    await teacher.setViewportSize({ width: 1440, height: 900 });
  });

  /* ── ⑦ 못 나간 진도가 다음 일정 변경안이 된다 ───────────── */

  test("⑦ 교사가 「못 나감」으로 마감하면 워커가 변경안을 올린다", async () => {
    await teacher.goto("/app/today");
    await teacher.getByRole("link", { name: groupName }).first().click();
    await expect(teacher).toHaveURL(/\/app\/classes\/[0-9a-f-]{36}/);

    await teacher.getByRole("button", { name: "진행 확인하고 마감" }).first().click();
    /* 개념 차시를 못 나갔다고 적는다. 그러면 그 노드는 다음 수업일로 밀리고,
     * 뒤에 있던 확인테스트가 함께 밀린다 — 확인테스트는 진급 게이트라
     * 자동 적용하지 않고 승인을 받는다(checkpoint_moved). */
    const closeForm = teacher.locator("form").filter({ hasText: "이대로 마감" });
    await closeForm
      .locator("li")
      .filter({ hasText: "개념 차시" })
      .getByLabel("못 나감")
      .check();
    await closeForm.getByRole("button", { name: "이대로 마감" }).click();
    /* 결과로 확인한다. 마감 알림은 그 수업 행 **안에** 그려지는데, 마감이
     * 성공하면 그 행 자체가 목록에서 빠진다 — 알림을 든 컴포넌트가 사라지니
     * 알림은 뜰 자리가 없다(자료 게시 버튼과 같은 모양의 함정). */
    await expect(teacher.getByText("마감을 기다리는 수업이 없습니다.")).toBeVisible();
    await expect(teacher.getByText("수업 마감됨")).toBeVisible();

    /* 여기서도 클릭이 없다 — 마감이 낸 이벤트를 워커가 받아 다시 계산하고,
     * 위험한 변경은 적용하지 않고 승인함에 올린다 (T4.3).
     *
     * 「0건이 아니다」로 재지 않는다. 카드가 통째로 사라지거나 값이 비어도
     * 그 단언은 통과한다 — 없는 것을 세는 검사가 되는 셈이다. 1 이상의
     * 건수가 **있는 것**을 본다. */
    await expect(async () => {
      await teacher.goto("/app/today");
      await expect(
        teacher.getByText("승인 대기 일정 변경").locator(".."),
      ).toContainText(/[1-9]\d*건/, { timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [3_000] });
  });
});

/* ── 도구 ─────────────────────────────────────────────────── */

async function login(
  page: Page,
  who: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(who.email);
  await page.getByLabel("비밀번호").fill(who.password);
  await page.getByRole("button", { name: "로그인" }).click();
}

/** 설정 화면의 「지금 할 차례」가 이 단계인지 보고, 그 링크로 간다 */
async function followSetupStep(page: Page, title: string): Promise<void> {
  await page.goto("/app/setup");
  const active = page.locator("li").filter({ hasText: "지금 할 차례" }).first();
  await expect(active).toContainText(title);
  await active.getByRole("link", { name: "하러 가기" }).click();
  /* 도착한 화면에 그 일을 할 폼이 있는지는 다음 줄들이 증명한다 — 없으면
   * getByLabel이 못 찾아 여기서 끝난다. 그것이 원래의 결함이었다. */
  await page.waitForLoadState("domcontentloaded");
}

function section(page: Page, heading: string) {
  return page.locator("section").filter({ hasText: heading });
}

/** 가로 스크롤이 생기지 않았는가 — 좁은 폭에서 화면이 새지 않는지 */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  /* 1px은 반올림이다. 그보다 크면 손가락으로 밀어야 보이는 것이 있다. */
  expect(overflow).toBeLessThanOrEqual(1);
}

interface FocusedElement {
  tag: string;
  text: string;
  type: string;
}

/**
 * 조건에 맞는 요소에 **탭으로** 닿는다. 닿으면 그 요소가 포커스된 채로 true.
 *
 * 클릭으로 대신하지 않는 것이 요지다 — 「보인다」와 「키보드로 닿는다」는
 * 다른 말이고, 후자가 깨지는 것은 대개 focus 순서나 `tabindex`가 아니라
 * **버튼처럼 보이는 div**를 썼을 때다. 탭으로 훑으면 그것이 드러난다.
 */
async function focusByTab(
  page: Page,
  match: (el: FocusedElement) => boolean,
  limit = 80,
): Promise<boolean> {
  await page.locator("body").press("Tab");
  for (let i = 0; i < limit; i++) {
    const el = await page.evaluate<FocusedElement>(() => {
      const active = document.activeElement as HTMLElement | null;
      return {
        tag: active?.tagName ?? "",
        text: (active?.textContent ?? "").replace(/\s+/g, " ").trim(),
        type: active?.getAttribute("type") ?? "",
      };
    });
    if (el.tag && el.tag !== "BODY" && match(el)) return true;
    await page.keyboard.press("Tab");
  }
  return false;
}

/** Tab만 눌러 그 이름의 링크에 닿는가 */
async function tabToLink(page: Page, name: string): Promise<boolean> {
  await page.locator("body").press("Tab");
  for (let i = 0; i < 40; i++) {
    const text = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.tagName}:${(el.textContent ?? "").trim()}` : "";
    });
    if (text.startsWith("A:") && text.includes(name)) return true;
    await page.keyboard.press("Tab");
  }
  return false;
}
