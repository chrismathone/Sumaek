import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSharedSql } from "@su-maek/db";
import { startAttempt } from "@/lib/domain/attempt";

/* ─────────────────────────────────────────────────────────────
 * 미래 테스트의 응시일 게이트 — 라이브 DB.
 *
 * 이 게이트는 실제 사고 뒤에 들어갔다(코드 주석의 실측: 8/5 테스트를 8/2에
 * 제출). 그런데 **검사가 0건이었다.** 지우거나 조건을 뒤집어도 저장소의
 * 어떤 테스트도 물지 않는 상태였다.
 *
 * T3.2가 그 게이트를 하중 부재로 만들었다. 이제 워커가 **수업 하루 전에**
 * 평가를 만들어 게시하고 학생에게 배정한다 — 즉 「아직 오면 안 되는 시험이
 * 배정된 상태로 존재하는 것」이 예외가 아니라 **평상시**다. 화면도 미래
 * 테스트를 가리지만, 화면 판정은 URL 직접 입력을 막지 못한다.
 *
 * 겨누는 것:
 *   1) 계획일이 미래면 거절하고, 언제부터 가능한지 말한다
 *   2) 계획일 당일에는 시작된다
 *   3) 지난 계획일은 막지 않는다 (밀린 것을 따라잡을 수 있어야 한다)
 *   4) 날짜 없는 평가(수시)는 게이트 대상이 아니다
 *   5) 배정되지 않은 학생은 날짜와 무관하게 못 본다
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);

const ORG = "ffffffff-0000-7000-8000-000000035001";
const LEARNER = uuidv7();
const OTHER_LEARNER = uuidv7();
const GROUP = uuidv7();
const PERIOD = uuidv7();

const FUTURE = uuidv7();
const TODAY_TEST = uuidv7();
const PAST = uuidv7();
const UNDATED = uuidv7();

const TODAY = "2026-09-20";
const TOMORROW = "2026-09-21";
const YESTERDAY = "2026-09-19";

describe.skipIf(!hasDb)("미래 테스트는 그날 전에 응시할 수 없다", () => {
  let sql: ReturnType<typeof getSharedSql>;

  async function cleanup(): Promise<void> {
    await sql`
      delete from attempts where assessment_id in (
        select id from assessment_instances where organization_id = ${ORG})
    `;
    await sql`
      delete from assignments where assessment_id in (
        select id from assessment_instances where organization_id = ${ORG})
    `;
    await sql`delete from assessment_instances where organization_id = ${ORG}`;
    await sql`delete from learning_group_memberships where organization_id = ${ORG}`;
    await sql`delete from learners where organization_id = ${ORG}`;
    await sql`delete from learning_groups where organization_id = ${ORG}`;
    await sql`delete from course_periods where organization_id = ${ORG}`;
  }

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 응시일 게이트', 'itest-attempt-date', 'Asia/Seoul')
      on conflict (id) do nothing
    `;
    await cleanup();

    await sql`
      insert into course_periods (
        id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026, '2026-08-01', '2026-12-31', 'active')
    `;
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 반', 'operating')
    `;
    for (const learner of [LEARNER, OTHER_LEARNER]) {
      await sql`
        insert into learners (id, organization_id, display_name, status)
        values (${learner}, ${ORG}, 'ITEST 학생', 'active')
      `;
    }

    /* 워커가 만든 것과 같은 모양 — 게시 상태로 배정까지 끝나 있다 */
    for (const [id, date, title] of [
      [FUTURE, TOMORROW, "내일 테스트"],
      [TODAY_TEST, TODAY, "오늘 테스트"],
      [PAST, YESTERDAY, "어제 테스트"],
      [UNDATED, null, "수시 테스트"],
    ] as const) {
      await sql`
        insert into assessment_instances (
          id, organization_id, purpose, title, learning_group_id, learner_id,
          scheduled_date, status, published_at)
        values (${id}, ${ORG}, 'formative', ${title}, ${GROUP}, null,
                ${date}::date, 'published', now())
      `;
      await sql`
        insert into assignments (
          id, organization_id, assessment_id, learner_id, mode, assigned_by)
        values (${uuidv7()}, ${ORG}, ${id}, ${LEARNER}, 'online', null)
      `;
    }
  });

  afterAll(async () => {
    await cleanup();
  });

  it("계획일이 미래면 거절하고 언제부터 가능한지 말한다", async () => {
    /* 「지금은 응시할 수 없습니다」로 끝나면 학생은 고장인 줄 안다.
     * 날짜를 말해야 기다리면 된다는 것을 안다. */
    const result = await startAttempt({
      organizationId: ORG,
      assessmentId: FUTURE,
      learnerId: LEARNER,
      today: TODAY,
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain(TOMORROW);

    const [attempts] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from attempts where assessment_id = ${FUTURE}
    `;
    // 거절이면 응시 행도 생기지 않아야 한다 — get-or-create가 먼저 돌면 안 된다
    expect(attempts!.cnt).toBe(0);
  });

  it("계획일 당일에는 시작된다", async () => {
    const result = await startAttempt({
      organizationId: ORG,
      assessmentId: TODAY_TEST,
      learnerId: LEARNER,
      today: TODAY,
    });
    expect(result).not.toHaveProperty("error");
    expect((result as { attemptId: string }).attemptId).toBeTruthy();
  });

  it("지난 계획일은 막지 않는다 — 밀린 것을 따라잡을 수 있다", () => {
    /* 결석·지각으로 밀린 테스트를 영영 못 보게 하면 복구 경로가 사라진다. */
    return expect(
      startAttempt({
        organizationId: ORG,
        assessmentId: PAST,
        learnerId: LEARNER,
        today: TODAY,
      }),
    ).resolves.not.toHaveProperty("error");
  });

  it("날짜 없는 평가는 게이트 대상이 아니다", () => {
    return expect(
      startAttempt({
        organizationId: ORG,
        assessmentId: UNDATED,
        learnerId: LEARNER,
        today: TODAY,
      }),
    ).resolves.not.toHaveProperty("error");
  });

  it("배정되지 않은 학생은 날짜와 무관하게 못 본다", async () => {
    const result = await startAttempt({
      organizationId: ORG,
      assessmentId: TODAY_TEST,
      learnerId: OTHER_LEARNER,
      today: TODAY,
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("배정");
  });
});
