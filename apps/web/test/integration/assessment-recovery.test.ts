import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSharedSql } from "@su-maek/db";
import {
  ASSESSMENT_GENERATE_TOPIC,
  assessmentJobKey,
  listFailedAssessmentGenerations,
  retryAssessmentGeneration,
} from "@su-maek/db/domain";

/* ─────────────────────────────────────────────────────────────
 * 실패한 자동 생성의 수동 복구 (T3.4) — 라이브 DB.
 *
 * 교사가 원인을 고친 다음 눌러야 할 버튼이 있어야 한다. 그런데 「다시
 * 생성」이 새 작업을 만들면 **아무 일도 일어나지 않는다**: `jobs`의
 * (topic, idempotency_key) 유니크를 실패한 행이 이미 쥐고 있어
 * `on conflict do nothing`이 조용히 삼킨다. 버튼을 눌렀는데 아무 일도 안
 * 일어나는 것이 가장 나쁘다 — 교사는 기다리다 수업 시간을 맞는다.
 *
 * 그래서 **같은 행을 되살린다.** 멱등 키가 그대로이므로 자동 생성과 수동
 * 재실행이 겹쳐도 평가는 여전히 하나다.
 *
 * 겨누는 것:
 *   1) 최종 실패만 목록에 오른다 (재시도 대기 중인 것은 아직 실패가 아니다)
 *   2) 이미 평가가 만들어진 실패는 목록에서 빠진다 (해소된 것)
 *   3) 재실행이 **같은 행·같은 키**로 큐에 다시 선다
 *   4) 두 번 눌러도 두 번 서지 않는다 — 이미 대기 중이면 거절하고 그렇게 말한다
 *   5) 남의 조직 작업은 건드리지 못한다
 *   6) 재실행이 감사에 남는다
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);

const ORG = "ffffffff-0000-7000-8000-000000037001";
const OTHER_ORG = "ffffffff-0000-7000-8000-000000037002";
const TEACHER = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const PLAN_DATE = "2026-11-05";
const RESOLVED_DATE = "2026-11-06";
const RETRY_DATE = "2026-11-07";

describe.skipIf(!hasDb)("실패한 자동 생성의 복구", () => {
  let sql: ReturnType<typeof getSharedSql>;
  const jobs = {
    failed: uuidv7(),
    retrying: uuidv7(),
    resolved: uuidv7(),
    foreign: uuidv7(),
  };

  async function insertJob(
    id: string,
    organizationId: string,
    status: string,
    planDate: string,
  ): Promise<void> {
    await sql`
      insert into jobs (
        id, organization_id, topic, status, attempts, max_attempts,
        payload, idempotency_key, last_error)
      values (
        ${id}, ${organizationId}, ${ASSESSMENT_GENERATE_TOPIC},
        ${status}::job_status, 3, 5,
        ${sql.json({
          organizationId,
          learningGroupId: GROUP,
          learnerId: null,
          planDate,
          purpose: "formative",
        } as never)},
        ${assessmentJobKey({
          organizationId,
          learningGroupId: GROUP,
          learnerId: null,
          planDate,
          purpose: "formative",
        })},
        'ITEST 문항 부족'
      )
    `;
  }

  async function cleanup(): Promise<void> {
    for (const org of [ORG, OTHER_ORG]) {
      await sql`delete from jobs where organization_id = ${org}`;
      await sql`delete from outbox_events where organization_id = ${org}`;
      await sql`delete from assessment_instances where organization_id = ${org}`;
      await sql`delete from learning_groups where organization_id = ${org}`;
      await sql`delete from course_periods where organization_id = ${org}`;
    }
    /* 감사 행은 지우지 않는다 — append-only이고 DB가 그것을 강제한다
     * (불변 조건 15). 작업 ID가 실행마다 새로 나므로 단언은 그 ID로 좁힌다. */
  }

  beforeAll(async () => {
    sql = getSharedSql();
    for (const [org, name, slug] of [
      [ORG, "ITEST 복구", "itest-recovery"],
      [OTHER_ORG, "ITEST 복구 이웃", "itest-recovery-other"],
    ] as const) {
      await sql`
        insert into organizations (id, name, slug, timezone)
        values (${org}, ${name}, ${slug}, 'Asia/Seoul')
        on conflict (id) do nothing
      `;
    }
    await cleanup();

    await sql`
      insert into course_periods (
        id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026, '2026-08-01', '2026-12-31', 'active')
    `;
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 복구반', 'operating')
    `;

    await insertJob(jobs.failed, ORG, "failed_final", PLAN_DATE);
    await insertJob(jobs.retrying, ORG, "retry_scheduled", RETRY_DATE);
    await insertJob(jobs.resolved, ORG, "dead_lettered", RESOLVED_DATE);
    await insertJob(jobs.foreign, OTHER_ORG, "failed_final", PLAN_DATE);

    /* 사유 코드는 E-17이 나른다 — last_error(사람이 읽는 문장)가 아니라 */
    await sql`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${ORG}, 'learning_group', ${GROUP}, 1,
        'DailyAssessmentGenerationFailed', now(),
        ${sql.json({ jobId: jobs.failed, reason: "insufficient_questions" } as never)}
      )
    `;
    /* 해소된 실패 — 교사가 손으로 만들었거나 다른 경로로 생긴 평가가 있다 */
    await sql`
      insert into assessment_instances (
        id, organization_id, purpose, title, learning_group_id, learner_id,
        scheduled_date, status)
      values (${uuidv7()}, ${ORG}, 'formative', 'ITEST 손으로 만든 것',
              ${GROUP}, null, ${RESOLVED_DATE}::date, 'published')
    `;
  });

  afterAll(async () => {
    await cleanup();
  });

  it("최종 실패만 목록에 오른다", async () => {
    const list = await listFailedAssessmentGenerations(sql, {
      organizationId: ORG,
    });
    const ids = list.map((f) => f.jobId);
    expect(ids).toContain(jobs.failed);
    /* 재시도 대기는 아직 실패가 아니다 — 스스로 다시 돈다. 여기 띄우면
     * 교사가 필요 없는 조치를 한다. */
    expect(ids).not.toContain(jobs.retrying);
  });

  it("이미 평가가 만들어진 실패는 빠진다", async () => {
    /* 손으로 만들었으면 그 실패는 해소된 것이다. 남겨 두면 목록이 영원히
     * 줄지 않고, 줄지 않는 목록은 아무도 안 본다. */
    const list = await listFailedAssessmentGenerations(sql, {
      organizationId: ORG,
    });
    expect(list.map((f) => f.jobId)).not.toContain(jobs.resolved);
  });

  it("남의 조직 실패는 보이지 않는다", async () => {
    const list = await listFailedAssessmentGenerations(sql, {
      organizationId: ORG,
    });
    expect(list.map((f) => f.jobId)).not.toContain(jobs.foreign);
  });

  it("사유 코드와 반 이름을 함께 낸다 — 화면이 조치를 말할 수 있게", async () => {
    const [entry] = await listFailedAssessmentGenerations(sql, {
      organizationId: ORG,
    });
    expect(entry?.reason).toBe("insufficient_questions");
    expect(entry?.learningGroupName).toBe("ITEST 복구반");
    expect(entry?.planDate).toBe(PLAN_DATE);
    expect(entry?.purpose).toBe("formative");
  });

  it("재실행은 같은 행·같은 키로 큐에 다시 선다", async () => {
    const before = await sql<{ idempotency_key: string }[]>`
      select idempotency_key from jobs where id = ${jobs.failed}
    `;
    const result = await retryAssessmentGeneration(sql, {
      organizationId: ORG,
      jobId: jobs.failed,
      actorUserId: TEACHER,
    });
    expect(result.ok).toBe(true);

    const [after] = await sql<
      { status: string; attempts: number; idempotency_key: string; last_error: string | null }[]
    >`
      select status::text as status, attempts, idempotency_key, last_error
      from jobs where id = ${jobs.failed}
    `;
    expect(after!.status).toBe("queued");
    expect(after!.attempts).toBe(0);
    expect(after!.last_error).toBeNull();
    /* 키가 그대로여야 자동 생성과 수동 재실행이 겹쳐도 평가가 하나다 */
    expect(after!.idempotency_key).toBe(before[0]!.idempotency_key);

    // 작업 행이 늘지 않는다 — 새로 만든 것이 아니라 되살린 것이다
    const [count] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from jobs
      where organization_id = ${ORG} and topic = ${ASSESSMENT_GENERATE_TOPIC}
    `;
    expect(count!.cnt).toBe(3);
  });

  it("이미 대기 중인 작업은 거절하고 그렇게 말한다", async () => {
    /* 두 사람이 같은 버튼을 누르거나 한 사람이 두 번 누른다. 「예약했습니다」를
     * 두 번 말하면 두 번 돌 것처럼 들린다 — 안 한 일을 했다고 하지 않는다. */
    const result = await retryAssessmentGeneration(sql, {
      organizationId: ORG,
      jobId: jobs.failed,
      actorUserId: TEACHER,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("대기");
  });

  it("남의 조직 작업은 재실행되지 않는다", async () => {
    const result = await retryAssessmentGeneration(sql, {
      organizationId: ORG,
      jobId: jobs.foreign,
      actorUserId: TEACHER,
    });
    expect(result.ok).toBe(false);
    const [row] = await sql<{ status: string }[]>`
      select status::text as status from jobs where id = ${jobs.foreign}
    `;
    expect(row!.status).toBe("failed_final");
  });

  it("재실행이 감사에 남는다", async () => {
    const rows = await sql<{ actor_id: string; target_id: string }[]>`
      select actor_id::text as actor_id, target_id::text as target_id
      from audit_events
      where organization_id = ${ORG}
        and action = 'assessment.generation-retry'
        and target_id = ${jobs.failed}
    `;
    /* 거절된 두 번째 시도는 감사에 남지 않는다 — 하지 않은 일을 기록하지 않는다 */
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(TEACHER);
  });
});
