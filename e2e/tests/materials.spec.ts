import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { createSql } from "@su-maek/db";
import { gotoTableRow } from "../lib/table";
import { TEACHER, STUDENT } from "../lib/accounts";


async function login(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(who.email);
  await page.getByLabel("비밀번호").fill(who.password);
  await page.getByRole("button", { name: "로그인" }).click();
}

/* ─────────────────────────────────────────────────────────────
 * 학습 자료의 저작 → 게시 → 학생 소비 왕복.
 *
 * 이 경로는 지금까지 자동 검증된 적이 **한 번도 없었다** — 시드에 자료가
 * 0건이었고 materials·learn/study·learn/watch·learn/practice를 여는 스펙도
 * 0건이었다. 그래서 「자료가 학생에게 도달하는가」는 늘 사람이 눌러 봐야만
 * 알 수 있었다.
 *
 * 오늘 학생이 무엇을 보는지는 「오늘 차시의 노드 → 그 노드의 개념」으로만
 * 정해진다. 반 공통 수업은 월·수·금에만 생겨 실행 요일에 따라 학생 화면이
 * 비었다 찼다 하므로, 시드가 데모 학생(박서윤)의 **오늘** 개별 일정을
 * 가감법 차시로 고정해 둔다. 이 스펙은 그 개념 위에서 왕복한다.
 *
 * 그 고정 항목은 영구적이지 않다(실측). route-builder 스펙의 「개별 일정
 * 계산」이 박서윤의 오늘 이후 미배정 항목을 교체하면서 시드 항목도 함께
 * 지운다 — 제품 동작으로는 옳다(그 항목은 어떤 루트에서도 나오지 않으므로).
 * 시드에만 기대면 스펙 실행 **순서**에 결과가 달렸다는 뜻이고, 그건 통과해도
 * 아무것도 증명하지 못한다. 그래서 이 스펙이 **자기 전제를 직접 세운다** —
 * 아래 beforeAll이 시드와 같은 고정 ID로 오늘 일정을 upsert한다. 시드가
 * 먼저 돌았든, 다른 스펙이 지웠든, 여기서 다시 세워지므로 순서와 무관하다.
 * ───────────────────────────────────────────────────────────── */

const CONCEPT = "가감법";
const DEMO_ORG = "00000000-0000-7000-8000-000000000001";
const DEMO_LEARNER = "00000000-0000-7000-8000-000000000101"; // 박서윤
const DEMO_GROUP = "00000000-0000-7000-8000-000000000010";
const ELIMINATION_NODE = "00000000-0000-7000-8000-000000000403"; // 가감법 차시
/** 시드와 **같은 고정 ID** — 둘이 서로를 덮어써도 행은 하나뿐이다 */
const SCHEDULE_ITEM = "00000000-0000-7000-8000-000000000080";

/* 오늘 학생이 가감법을 배우도록 개별 일정을 세운다. 반 일정은 건드리지
 * 않는다(불변 조건 4) — 개별 일정은 그 학생에게만 붙는다.
 * 09–10시로 두는 이유: 반 수업(16–18시)과 겹치면 학생 시간 배타 제약에 걸린다. */
/** 오늘 학생이 가감법을 배우도록 개별 일정을 세운다 (없으면 만들고, 있으면 갱신). */
async function ensureTodayScope(): Promise<void> {
  config({ path: ["../.env", ".env"] });
  if (!process.env.DATABASE_URL) return;
  const sql = createSql();
  try {
    /* 같은 시간대에 **다른 id**의 항목이 있으면 upsert가 시간 배타 제약
     * (learner_schedule_items_no_overlap)에 걸린다 — on conflict (id)는
     * 남의 행과의 겹침을 구해 주지 못한다(실측: 수동 데모 검증이 남긴
     * 09–22시 항목 하나로 이 스펙 전체가 insert에서 죽었다). 전제를 세우는
     * 쪽이 겹치는 것까지 치운다 — 이 학습자의 오늘, 우리 창과 겹치는
     * 항목만.
     *
     * 알려진 상호 파괴: seed-unit1-demo가 같은 학습자에게 오늘 09–22시
     * 항목을 만든다 — 이 삭제가 그 데모 하루를 지우고, 역방향으로는 우리
     * 09–10시 항목이 남아 있으면 그쪽 insert가 배타 제약으로 죽는다. 수동
     * 데모를 세운 날에는 E2E를 돌리지 말거나, 돌린 뒤 데모를 다시 세울 것. */
    await sql`
      delete from learner_schedule_items
      where learner_id = ${DEMO_LEARNER}
        and organization_id = ${DEMO_ORG}
        and item_date = (now() at time zone 'Asia/Seoul')::date
        and id <> ${SCHEDULE_ITEM}
        and starts_at < ((now() at time zone 'Asia/Seoul')::date + time '10:00') at time zone 'Asia/Seoul'
        and ends_at > ((now() at time zone 'Asia/Seoul')::date + time '09:00') at time zone 'Asia/Seoul'
    `;
    await sql`
      insert into learner_schedule_items (
        id, organization_id, learner_id, learning_group_id, session_id,
        item_date, timezone, starts_at, ends_at, planned_node_ids,
        reason_codes, matches_group, is_rejoin
      ) values (
        ${SCHEDULE_ITEM}, ${DEMO_ORG}, ${DEMO_LEARNER}, ${DEMO_GROUP}, null,
        (now() at time zone 'Asia/Seoul')::date, 'Asia/Seoul',
        ((now() at time zone 'Asia/Seoul')::date + time '09:00') at time zone 'Asia/Seoul',
        ((now() at time zone 'Asia/Seoul')::date + time '10:00') at time zone 'Asia/Seoul',
        ${sql.json([ELIMINATION_NODE] as never)}, ${sql.json(["e2e_materials"] as never)},
        false, false
      )
      on conflict (id) do update set
        item_date = excluded.item_date,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        planned_node_ids = excluded.planned_node_ids,
        updated_at = now()
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/* 전제를 **한 번만** 세우면 부족하다(실측): route-builder 스펙의 「개별 일정
 * 계산」이 이 학생의 미배정 항목을 갈아치우면서 이 항목도 지운다. 전체
 * 실행은 직렬이지만(workers:1·fullyParallel:false — 한 DB를 공유하므로)
 * 프로젝트마다 스펙 파일 전체가 다시 도는 순서라, 앞 프로젝트의
 * route-builder가 지운 뒤 다음 프로젝트의 이 스펙이 온다 — 실제로
 * tablet·mobile만 학생 화면이 비어 깨졌다. 그래서 학생 화면을 열기 직전에
 * 매번 다시 세운다. 제품 동작(미배정 항목 교체)은 옳으므로 고칠 것은
 * 스펙 쪽이다. */
test.beforeAll(ensureTodayScope);

/* 세우고 나면 **치운다.**
 *
 * 이 픽스처는 데모 학생의 오늘에 가감법(중2) 차시를 꽂는다. 남겨 두면 E2E를
 * 한 번 돌릴 때마다 데모 계정의 「오늘」이 중1(1단원) 데모와 섞인 채로 남는다
 * — 실측으로 그 상태를 사람이 먼저 발견했다. 스펙이 만든 것은 스펙이 지운다.
 *
 * 지우기만 하면 중1 데모 일정(seed-unit1-demo의 10:00–22:00)은 그대로 남아
 * 데모 계정은 중1로 돌아간다. 그 항목까지 지웠다면 재시드가 필요했을 것이다. */
test.afterAll(async () => {
  config({ path: ["../.env", ".env"] });
  if (!process.env.DATABASE_URL) return;
  const sql = createSql();
  try {
    await sql`delete from learner_schedule_items where id = ${SCHEDULE_ITEM}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("자료 왕복: 저작 → 고치기 → 게시 → 학생이 본다", async ({ browser }) => {
  /* 저작→게시를 읽기·인강 두 번 돌므로 기본 30초가 빠듯하다(실측: 데스크톱
   * 21→30초대, dev 서버 재컴파일이 겹치면 초과). 왕복 두 개 분량으로 늘린다. */
  test.setTimeout(90_000);
  const stamp = Date.now().toString(36).slice(-5);
  const title = `E2E자료-${stamp}`;
  const fixedTitle = `${title} 고친제목`;
  const disclosure = `E2E 고지-${stamp} · AI가 만든 자료입니다.`;
  /* 제목이 `E2E자료-`로 시작해야 티어다운이 지운다 (purge-test-data의
   * MATERIAL_TITLE_PATTERN). 다른 접두사를 쓰면 게시된 자료가 실행마다
   * 시드 개념에 쌓여 데모·수동 확인 화면을 오염시킨다 — 실측으로 7건이
   * 쌓인 뒤에야 드러났다. */
  const videoTitle = `E2E자료-${stamp} 인강`;

  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await login(teacher, TEACHER);
  await expect(teacher).toHaveURL(/\/app\/today/, { timeout: 30_000 });

  /* ── 1. 만들기 ── */
  await teacher.goto("/app/content/materials");
  await expect(
    teacher.getByRole("heading", { name: "학습 자료", exact: true }),
  ).toBeVisible();

  // 개념 선택지는 검색으로 좁힌다 — 개념이 쌓이면 기본 20개 안에 없을 수 있다
  await teacher.locator("input#cq").fill(CONCEPT);
  await teacher.getByRole("button", { name: "찾기", exact: true }).click();

  /* 「종류」라는 라벨은 목록 필터에도 있다 — 만들기 폼으로 좁히지 않으면
   * 두 개가 잡혀 스펙이 strict mode로 죽는다. */
  const createForm = teacher
    .locator("form")
    .filter({ hasText: "초안으로 만들기" });
  await createForm.getByLabel("개념", { exact: true }).selectOption({ label: CONCEPT });
  await createForm.getByLabel("종류").selectOption("reading");
  await createForm.getByLabel("제목").fill(title);
  await createForm
    .getByLabel("본문")
    .fill("가감법은 두 식을 더하거나 빼서 한 문자를 없애는 방법입니다.");
  await createForm.getByLabel("AI 고지").fill(disclosure);
  await createForm.getByRole("button", { name: "초안으로 만들기" }).click();

  /* 알림은 6초 뒤 스스로 사라지지만 그 전에 다음 액션을 실행하면 두 개가
   * 동시에 떠 strict mode에 걸린다 — 문구로 좁혀서 잡는다. */
  const toast = (text: string) =>
    teacher.getByRole("status").filter({ hasText: text });

  await expect(toast("초안으로 만들었습니다")).toBeVisible({ timeout: 30_000 });

  /* ── 2. 목록 → 상세 (행이 클릭된다) ── */
  const row = (await gotoTableRow(teacher, "/app/content/materials", title)).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("초안")).toBeVisible();
  await row.getByRole("link").first().click();
  await expect(teacher).toHaveURL(/\/app\/content\/materials\/[0-9a-f-]{36}/, {
    timeout: 30_000,
  });

  /* ── 3. 고치기 — 「보관 후 재생성」이 아니라 제자리 수정 ── */
  await expect(teacher.getByRole("heading", { name: title })).toBeVisible();
  // 종류는 못 바꾼다 (진도의 뜻이 달라지므로) — 입력이 아니라 고정 표시다
  await expect(teacher.getByText("종류는 바꿀 수 없습니다.")).toBeVisible();
  await teacher.getByLabel("제목").fill(fixedTitle);
  await teacher.getByRole("button", { name: "저장" }).click();
  await expect(toast("고쳤습니다")).toBeVisible({ timeout: 30_000 });

  /* ── 4. 게시 ──
   *
   * 여기서 토스트를 기다리면 안 된다(실측): 「게시」 버튼은 자기 알림을 자기
   * 안에 그리는데, 게시 액션이 이 화면을 revalidate하면 상태가 published가 되어
   * **그 버튼 자체가 「게시 취소」로 갈아치워진다** — 알림을 든 컴포넌트가
   * 사라지므로 알림은 뜰 자리가 없다. 그래서 교사가 실제로 보는 결과,
   * 곧 상태 배지와 버튼이 바뀌는 것을 단언한다. */
  await teacher.getByRole("button", { name: "게시", exact: true }).click();
  await expect(
    teacher.getByRole("button", { name: "게시 취소" }),
  ).toBeVisible({ timeout: 30_000 });

  // 목록에도 고친 제목·게시 상태가 반영된다
  const publishedRow = (
    await gotoTableRow(teacher, "/app/content/materials", fixedTitle)
  ).first();
  await expect(publishedRow.getByText("게시됨")).toBeVisible();

  /* ── 4b. 인강도 하나 저작·게시 ──
   *
   * 학생 쪽에서 인강 「다 봤어요」의 배선(materialId → 그 자료의 진도)을
   * 실제로 누르려면 우리 소유의 영상 자료가 필요하다 — 시드 인강의 진도를
   * 건드리면 실행 간 잔존해 스펙이 멱등이 아니게 된다. 유튜브 주소는
   * 시드처럼 합성 ID다(형식만 유튜브, 실재하지 않는 영상). */
  await teacher.goto("/app/content/materials");
  await teacher.locator("input#cq").fill(CONCEPT);
  await teacher.getByRole("button", { name: "찾기", exact: true }).click();
  const videoForm = teacher.locator("form").filter({ hasText: "초안으로 만들기" });
  await videoForm.getByLabel("개념", { exact: true }).selectOption({ label: CONCEPT });
  await videoForm.getByLabel("종류").selectOption("video");
  await videoForm.getByLabel("제목").fill(videoTitle);
  await videoForm
    .getByLabel("유튜브 주소")
    .fill("https://www.youtube.com/watch?v=E2EVIDEO001");
  await videoForm.getByRole("button", { name: "초안으로 만들기" }).click();
  await expect(toast("초안으로 만들었습니다")).toBeVisible({ timeout: 30_000 });

  const videoRow = (
    await gotoTableRow(teacher, "/app/content/materials", videoTitle)
  ).first();
  await videoRow.getByRole("link").first().click();
  await expect(teacher).toHaveURL(/\/app\/content\/materials\/[0-9a-f-]{36}/, {
    timeout: 30_000,
  });
  await teacher.getByRole("button", { name: "게시", exact: true }).click();
  await expect(
    teacher.getByRole("button", { name: "게시 취소" }),
  ).toBeVisible({ timeout: 30_000 });
  await teacherCtx.close();

  /* ── 5. 학생이 본다 ── */
  await ensureTodayScope();
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await login(student, STUDENT);
  await expect(student).toHaveURL(/\/learn\/today/, { timeout: 30_000 });

  /* 개념 학습은 **한 쪽에 한 개념**을 낸다 — 방금 만든 자료의 개념이 기본
   * 쪽이라는 보장이 없으므로(첫 미완료 개념이 기본이다) 개념 차례에서
   * 개념명으로 찾아 연다. */
  await student.goto("/learn/study");
  const pageLink = student.locator(
    `nav[aria-label="개념 차례"] a[title="${CONCEPT}"]`,
  );
  await expect(pageLink).toBeVisible({ timeout: 30_000 });
  await pageLink.click();

  /* **이 스펙의 요지**: 방금 만든 읽기 자료와 인강이 **같은 쪽**에 함께 있다.
   * 개념이 쪽의 단위이므로 둘은 갈릴 수 없다 — 갈리면 여기서 깨진다. */
  const card = student.locator("section").filter({ hasText: fixedTitle });
  /* exact — 이 쪽의 제목은 전부 「가감법」으로 시작한다(자료 제목·인강 제목·
   * 연습 묶음 제목). 부분 일치로 두면 넷이 잡혀 strict mode로 죽는다. */
  await expect(
    card.getByRole("heading", { name: CONCEPT, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  // 고친 제목이 그대로 도달한다 (재생성이었다면 진도가 갈렸을 자리다)
  await expect(card.getByRole("heading", { name: fixedTitle })).toBeVisible();
  await expect(card.getByRole("heading", { name: videoTitle })).toBeVisible();
  // 설명과 인강이 한 쪽에 나란히 — 연습은 다음 쪽이다
  for (const section of ["설명", "인강"]) {
    await expect(
      card.getByRole("heading", { name: section, exact: true }),
    ).toBeVisible();
  }
  /* AI 고지는 학생 화면에 **싣지 않는다**(소유자 결정 2026-08-04) — 출처·
   * 생성 경위는 교사 검수 화면의 정보다. 교사 상세에는 남아 있는 것을 위
   * 3단계에서 이미 지났다. 데이터는 그대로이므로 정책이 바뀌면 여기가
   * 먼저 깨진다. */
  await expect(card.getByText(disclosure)).toHaveCount(0);

  /* 「다 봤어요」 → 완료. 진도는 자료 id에 매달린다.
   * 한 쪽에 읽기·인강 카드가 함께 있어 버튼·「완료」 배지가 여럿이다 —
   * 시드 인강의 진도는 실행 간 잔존하므로 아무 「완료」나 잡으면 클릭과
   * 무관하게 이미 떠 있던 배지로 공허하게 통과한다(실측 지적). 그래서
   * 제목으로 좁힌 자료 안에서만 버튼→배지 전환을 본다. */
  const readingArticle = card.locator("article").filter({ hasText: fixedTitle });
  await readingArticle.getByRole("button", { name: "다 봤어요" }).click();
  await expect(readingArticle.getByText("완료", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  /* 인강 완료 배선 — materialId가 엉뚱한 자료로 이어지면 이 카드의 버튼이
   * 남아 실패한다. */
  const videoCard = card.locator("li").filter({ hasText: videoTitle });
  await videoCard.getByRole("button", { name: "다 봤어요" }).click();
  await expect(videoCard.getByText("완료", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await studentCtx.close();
});

/**
 * 시드가 넣은 자료가 학생에게 그대로 도달하는지 — 오늘 하루가 **개념 학습
 * 한 단계**로 서는 것, 한 개념 쪽에 설명·인강·연습이 함께 있는 것, 인강의
 * AI 고지, 연습문제의 **지정 순서**가 요지다. 지정 순서는 자동 선정(생성순)과
 * 일부러 반대로 시드해 두었으므로, 순서가 무시되면 이 단언이 먼저 깨진다.
 */
test("시드 자료: 개념 한 쪽에 설명·인강·연습이 함께 오고 지정 순서가 지켜진다", async ({
  page,
}) => {
  await ensureTodayScope();
  await login(page, STUDENT);
  await expect(page).toHaveURL(/\/learn\/today/, { timeout: 30_000 });

  /* 하루의 구조 — 설명·인강·연습이 각각 단계가 아니라 「개념 학습」 하나다.
   * 단계를 다시 쪼개면 분모(4)와 이 단언이 함께 깨진다. */
  await expect(page.getByRole("list", { name: "오늘 학습 4단계" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "개념 학습", exact: true }),
  ).toBeVisible();
  for (const gone of ["개념 공부", "개념 인강", "연습문제"]) {
    await expect(page.getByRole("heading", { name: gone, exact: true })).toHaveCount(
      0,
    );
  }

  /* 인강 화면 — 같은 개념의 설명으로 가는 길. AI 고지는 학생 화면에
   * 싣지 않으므로(소유자 결정 2026-08-04) 없는 것을 단언한다. */
  await page.goto("/learn/watch");
  const lecture = page.locator("li").filter({ hasText: "가감법 5분 정리" });
  await expect(lecture).toBeVisible({ timeout: 30_000 });
  await expect(
    lecture.getByText("선생님이 검수한 AI 보충 강의입니다."),
  ).toHaveCount(0);
  /* 역링크는 쪽 번호가 아니라 **개념**을 싣는다(?c=) — 번호는 렌더 시점
   * 순번이라 클릭 시점의 목록과 어긋날 수 있어서다. 형식만 보지 않고 실제로
   * 클릭해, 도착한 쪽이 정말 그 개념인지(?p로 정규화됨)까지 본다. */
  const backlink = lecture.getByRole("link", { name: "이 개념의 설명 읽기 →" });
  await expect(backlink).toHaveAttribute("href", /\/learn\/study\?c=[0-9a-f-]{36}/);
  await backlink.click();
  await expect(page).toHaveURL(/\/learn\/study\?p=\d+/, { timeout: 30_000 });

  /* 개념 학습 — 한 쪽에 설명과 인강이 **함께** 온다. 도착한 쪽이 가감법
   * 쪽이라는 것과, 그 쪽 안에 인강이 임베드로 있다는 것을 같이 본다. */
  const conceptPage = page.locator("section").filter({ hasText: "가감법 5분 정리" });
  await expect(
    conceptPage.getByRole("heading", { name: "가감법", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const lectureOnStudy = conceptPage.locator("li").filter({
    hasText: "가감법 5분 정리",
  });
  await expect(
    lectureOnStudy.locator('iframe[title="가감법 5분 정리"]'),
  ).toBeVisible();
  await expect(
    lectureOnStudy.getByText("선생님이 검수한 AI 보충 강의입니다."),
  ).toHaveCount(0);

  /* 연습은 **쪽을 넘겨** 간다 — 개념 id를 실어 보내고(?c=), 도착한 쪽은
   * 그 개념의 연습만 낸다. 링크가 개념을 잃으면 제목이 갈려 여기서 잡힌다. */
  await conceptPage.getByRole("link", { name: "연습문제 풀러 가기 →" }).click();
  await expect(page).toHaveURL(/\/learn\/practice\?c=[0-9a-f-]{36}/, {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { name: "가감법 — 연습문제" }),
  ).toBeVisible();

  /* 지정 순서: a+b 문항이 먼저, x+y=5 문항이 나중 (생성순은 그 반대다) */
  const practice = page.locator("form").filter({ hasText: "가감법 연습 2문항" });
  await expect(practice).toBeVisible({ timeout: 30_000 });
  const items = practice.locator("ol > li");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("값을 구하시오");
  await expect(items.nth(1)).toContainText("해를 구하시오");

  // 흐름이 이어진다 — 설명·인강으로 돌아가는 길과 다음으로 가는 길
  await expect(
    page.getByRole("link", { name: "← 설명·인강 다시 보기" }),
  ).toBeVisible();
});
