import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  claimJobs,
  completeJob,
  createSql,
  enqueueJob,
  getSharedSql,
  isFeatureEnabled,
  type ClaimedJob,
} from "@su-maek/db";

/* ─────────────────────────────────────────────────────────────
 * 워커 중단 후 재개 (인수 21) — 라이브 DB 통합 테스트.
 *
 * 재계산 핸들러는 그룹 경계마다 checkpointJob()으로 완료 그룹을 적어 둔다.
 * 실사용되는 코드였지만 "중단 후 재개"를 겨눈 자동 테스트가 0건이었다.
 *
 * 여기서 확인하는 사슬:
 *   1) 첫 워커가 클레임한다 — 리스가 살아 있는 동안 다른 워커는 못 가져간다
 *   2) 첫 그룹을 처리하고 체크포인트를 남긴 직후 중단된다
 *   3) 리스가 만료되면 다른 워커가 **체크포인트째로** 회수한다
 *   4) 재개는 완료 그룹을 건너뛰고 남은 그룹만 처리한다
 *      — 완료 그룹의 수업이 다시 만들어지지 않는 것으로 증명한다
 *   5) 재개는 inbox 중복 판정에 걸리지 않는다 (체크포인트 예외)
 *      — 체크포인트 없는 진짜 중복은 여전히 걸러진다 (대조군)
 *
 * ## 중단을 어떻게 만드는가 (그리고 무엇을 덮지 못하는가)
 * 프로세스를 실제로 SIGKILL하면 "체크포인트 이후·완료 이전"의 순간을
 * 맞히는 타이밍 경주가 되어 플레이키해진다. 그래서 중단은
 * materializeGroupSchedule 한 호출을 던지게 만들어 재현한다 — 이것만
 * 테스트 장치이고, 큐(claim·checkpoint·lease)·핸들러·실체화·DB는 전부 진짜다.
 * 던진 뒤 남는 durable 상태(작업 running + 체크포인트 [완료 그룹] + inbox 표시)는
 * 프로세스가 그 지점에서 죽었을 때와 같다. 죽은 워커의 작업을 되돌리는 것은
 * 리스 만료뿐이므로, 리스를 강제로 만료시켜 회수 경로를 그대로 탄다.
 *
 * 덮지 못하는 것 — 정직하게 적는다:
 *  - 프로세스 강제 종료 자체는 재현하지 않는다. 주입한 예외는 실체화
 *    트랜잭션을 열기 **전에** 던지므로, 진짜 SIGKILL이 만드는 상황
 *    (커넥션 강제 절단 → 열린 트랜잭션을 DB가 롤백)은 타지 않는다.
 *  - 한 그룹의 실체화 **도중** 중단되는 경우도 겨누지 않는다. 체크포인트
 *    단위가 그룹이라 그 그룹은 통째로 다시 도는 것이 설계다. 여기서 보는
 *    것은 그룹 경계까지 끝난 일이 두 번 되지 않는다는 것뿐이다.
 *  - main.ts 루프의 예외 경로(failJob → retry_scheduled)로 재개되는 경우는
 *    여기서 다루지 않는다. 이 테스트는 "아무도 실패를 기록하지 못하고 죽은"
 *    쪽, 즉 리스 만료 회수만 겨눈다.
 *
 * ## 픽스처 규약
 * 조직만 고정 ID다 — 실체화가 audit_events에 남기는 감사 행은 지울 수 없어
 * (before delete 트리거), 실행마다 새 조직을 만들면 사라진 조직을 가리키는
 * 행이 쌓인다. 이벤트 ID도 고정이다 — inbox_events에는 organization_id가 없어
 * 실행마다 새 ID를 쓰면 정리할 방법이 없다. 나머지는 전부 uuidv7이고
 * 자기 조직 스코프 안에서만 만들고 지운다.
 * ───────────────────────────────────────────────────────────── */

/** 중단 주입 — vi.mock 팩토리가 참조하므로 hoisted여야 한다 */
const crash = vi.hoisted(() => ({ onGroupId: null as string | null }));

vi.mock("@su-maek/db/domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@su-maek/db/domain")>();
  return {
    ...actual,
    materializeGroupSchedule: (
      options: Parameters<typeof actual.materializeGroupSchedule>[0],
    ) => {
      if (crash.onGroupId && options.learningGroupId === crash.onGroupId) {
        // 프로세스 사망 대역 — 이 그룹은 손도 대지 못한 채 핸들러가 끊긴다
        throw new Error("워커 프로세스 중단(테스트 주입)");
      }
      return actual.materializeGroupSchedule(options);
    },
  };
});

// vi.mock은 import보다 먼저 등록되므로, 핸들러는 위 대역을 통해 실체화를 부른다
import { handleScheduleRecalculate } from "../../src/handlers/schedule";

const hasDb = Boolean(process.env.DATABASE_URL);
/* 연결은 beforeAll에서 만든다 — 최상단 createSql()은 DATABASE_URL이 없을 때
 * skipIf 판정 전에 던져 skip이 아니라 FAIL이 된다. */
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000210001";
const EVENT_ID = "ffffffff-0000-7000-8000-0000002100e1";
/** 실제 워커·다른 에이전트의 작업을 건드리지 않도록 전용 토픽을 쓴다.
 *  큐의 클레임·리스·체크포인트 동작은 토픽 문자열과 무관하다. */
const TOPIC = "schedule.recalculate.itest-resume";
const CONSUMER = "schedule.recalculate";
const WORKER_A = "itest-worker-a";
const WORKER_B = "itest-worker-b";

const PERIOD = uuidv7();
const LEARNER = uuidv7();
/* 핸들러는 그룹 ID를 정렬해 순회한다 — 어느 쪽이 먼저인지 못 박아야
 * "첫 그룹에서 중단"이 결정론적이다. */
const [GROUP_DONE, GROUP_REST] = [uuidv7(), uuidv7()].sort() as [
  string,
  string,
];

interface GroupFixture {
  groupId: string;
  planId: string;
  versionId: string;
  nodeId: string;
  ruleId: string;
  membershipId: string;
}

function fixtureFor(groupId: string): GroupFixture {
  return {
    groupId,
    planId: uuidv7(),
    versionId: uuidv7(),
    nodeId: uuidv7(),
    ruleId: uuidv7(),
    membershipId: uuidv7(),
  };
}

const GROUPS = [fixtureFor(GROUP_DONE), fixtureFor(GROUP_REST)];

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOfIso(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

interface JobRow {
  status: string;
  attempts: number;
  worker_id: string | null;
  checkpoint: { doneGroupIds?: string[] } | null;
}

async function jobRow(jobId: string): Promise<JobRow> {
  const [row] = await sql<JobRow[]>`
    select status::text, attempts, worker_id, checkpoint
    from jobs where id = ${jobId}
  `;
  return row!;
}

async function sessionIds(groupId: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from sessions
    where organization_id = ${ORG} and learning_group_id = ${groupId}
    order by id
  `;
  return rows.map((r) => r.id);
}

/**
 * 이벤트 작업을 큐에 넣고 **DB 시계 기준으로** 도래시킨다.
 * enqueueJob의 run_at은 클라이언트 시계다. 실제 워커는 2초마다 폴링하므로
 * 수백 ms의 시계 오차가 묻히지만, 넣자마자 클레임하는 테스트에서는
 * run_at > now()가 되어 클레임이 비는 일이 생긴다 (실측 400ms 앞섬).
 */
async function enqueueDueJob(): Promise<string> {
  const { jobId } = await enqueueJob(sql, {
    topic: TOPIC,
    organizationId: ORG,
    payload: {
      eventId: EVENT_ID,
      eventType: "MasteryUpdated",
      payload: { learnerId: LEARNER },
    },
  });
  await sql`
    update jobs set run_at = now() - interval '1 second' where id = ${jobId}
  `;
  return jobId;
}

async function inboxCount(): Promise<number> {
  const [row] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from inbox_events
    where consumer_name = ${CONSUMER} and event_id = ${EVENT_ID}
  `;
  return row?.cnt ?? 0;
}

/** 이 조직에 남은 운영 행 제거 — 조직은 전용이라 통째로 지워도 안전하다.
 *  중단된 이전 실행의 잔재도 여기서 정리된다 (self-healing).
 *  R-01(고아 참조)이 나지 않도록 자식 → 부모 순서를 지킨다. */
async function cleanupFixtures(): Promise<void> {
  await sql`delete from jobs where organization_id = ${ORG}`;
  await sql`
    delete from inbox_events
    where consumer_name = ${CONSUMER} and event_id = ${EVENT_ID}
  `;
  await sql`delete from sessions where organization_id = ${ORG}`;
  await sql`delete from schedule_revisions where organization_id = ${ORG}`;
  await sql`delete from schedule_change_proposals where organization_id = ${ORG}`;
  await sql`delete from outbox_events where organization_id = ${ORG}`;
  await sql`delete from calendar_rules where organization_id = ${ORG}`;
  await sql`delete from learning_group_memberships where organization_id = ${ORG}`;
  await sql`delete from learners where organization_id = ${ORG}`;
  await sql`
    delete from route_nodes where route_version_id in (
      select id from route_versions where organization_id = ${ORG})
  `;
  // route_versions.route_plan_id가 실제 FK다 — 버전을 먼저 지운다
  await sql`delete from route_versions where organization_id = ${ORG}`;
  await sql`delete from route_plans where organization_id = ${ORG}`;
  await sql`delete from learning_groups where organization_id = ${ORG}`;
  await sql`delete from course_periods where organization_id = ${ORG}`;
}

describe.skipIf(!hasDb)("워커 중단 후 재개 (인수 21)", () => {
  const today = todayIso();
  const periodEnd = addDaysIso(today, 30);
  // 수업 요일은 내일 — 기간 안에 넉넉히 반복되어 배치가 항상 성공한다
  const lessonWeekday = weekdayOfIso(addDaysIso(today, 1));

  let jobId: string;
  let featureEnabled: boolean;
  let claimedA: ClaimedJob | undefined;
  let stolenWhileLeased: ClaimedJob[];
  let run1Error: unknown;
  let jobAfterCrash: JobRow;
  let doneSessionsAfterCrash: string[];
  let restSessionsAfterCrash: string[];
  let inboxAfterCrash: number;
  let reclaimed: ClaimedJob | undefined;
  let jobAfterReclaim: JobRow;
  let resumeResult: Record<
    string,
    { skipped?: string; ok?: boolean; created?: number }
  >;
  let jobAfterResume: JobRow;
  let doneSessionsAfterResume: string[];
  let restSessionsAfterResume: string[];
  let finalStatus: string;
  let duplicateResult: unknown;

  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 워커 재개', 'itest-worker-resume', ${TZ})
      on conflict (id) do nothing
    `;
    await cleanupFixtures();

    await sql`
      insert into course_periods (
        id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026, ${today}, ${periodEnd}, 'active')
    `;
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${LEARNER}, ${ORG}, 'ITEST 학생', 'active')
    `;
    for (const g of GROUPS) {
      await sql`
        insert into learning_groups (id, organization_id, course_period_id, name, status)
        values (${g.groupId}, ${ORG}, ${PERIOD}, ${`ITEST 반 ${g.groupId.slice(0, 8)}`}, 'operating')
      `;
      await sql`
        insert into learning_group_memberships (
          id, organization_id, learning_group_id, learner_id, joined_on, status)
        values (${g.membershipId}, ${ORG}, ${g.groupId}, ${LEARNER}, ${today}, 'active')
      `;
      await sql`
        insert into calendar_rules (
          id, organization_id, subject_type, subject_id,
          weekday, start_time, end_time, effective_from)
        values (${g.ruleId}, ${ORG}, 'learning_group', ${g.groupId},
                ${lessonWeekday}, '16:00', '18:00', ${today})
      `;
      await sql`
        insert into route_plans (
          id, organization_id, kind, name, learning_group_id,
          course_period_id, status, active_version_id)
        values (${g.planId}, ${ORG}, 'group_route', 'ITEST 루트', ${g.groupId},
                ${PERIOD}, 'published', ${g.versionId})
      `;
      await sql`
        insert into route_versions (id, organization_id, route_plan_id, version_number, status)
        values (${g.versionId}, ${ORG}, ${g.planId}, 1, 'published')
      `;
      await sql`
        insert into route_nodes (
          id, organization_id, route_version_id, kind, title, sort_order, expected_minutes)
        values (${g.nodeId}, ${ORG}, ${g.versionId}, 'concept_lesson', 'ITEST 노드', 1, 60)
      `;
    }

    /* 전제 — kill switch가 켜져 있으면 핸들러가 곧장 defer해 이 테스트는
     * 아무것도 검증하지 못한다. 조용히 통과시키지 않고 드러낸다. */
    featureEnabled = await isFeatureEnabled(sql, "auto_reschedule", ORG);

    /* ── 1) 이벤트가 큐에 들어온다 ── */
    jobId = await enqueueDueJob();

    /* ── 2) 워커 A가 클레임 ── */
    [claimedA] = await claimJobs(sql, {
      topics: [TOPIC],
      workerId: WORKER_A,
      limit: 5,
      leaseSeconds: 300,
    });

    // 대조군: 리스가 살아 있는 동안 워커 B는 같은 작업을 가져갈 수 없다
    stolenWhileLeased = await claimJobs(sql, {
      topics: [TOPIC],
      workerId: WORKER_B,
      limit: 5,
    });

    /* ── 3) 첫 그룹까지 처리하고 중단 ── */
    crash.onGroupId = GROUP_REST;
    run1Error = await handleScheduleRecalculate(claimedA!).then(
      () => null,
      (error: unknown) => error,
    );
    jobAfterCrash = await jobRow(jobId);
    doneSessionsAfterCrash = await sessionIds(GROUP_DONE);
    restSessionsAfterCrash = await sessionIds(GROUP_REST);
    inboxAfterCrash = await inboxCount();

    /* ── 4) 죽은 워커의 리스가 풀린다 — 시간 경과의 대역 ── */
    await sql`
      update jobs set lease_expires_at = now() - interval '1 second'
      where id = ${jobId}
    `;

    /* ── 5) 워커 B가 회수하고 재개한다 ── */
    crash.onGroupId = null; // 새 프로세스 — 중단 요인은 사라졌다
    [reclaimed] = await claimJobs(sql, {
      topics: [TOPIC],
      workerId: WORKER_B,
      limit: 5,
    });
    jobAfterReclaim = await jobRow(jobId);
    resumeResult = (await handleScheduleRecalculate(
      reclaimed!,
    )) as typeof resumeResult;
    jobAfterResume = await jobRow(jobId);
    doneSessionsAfterResume = await sessionIds(GROUP_DONE);
    restSessionsAfterResume = await sessionIds(GROUP_REST);

    await completeJob(sql, jobId, resumeResult);
    finalStatus = (await jobRow(jobId)).status;

    /* ── 6) 대조군: 체크포인트 없는 같은 이벤트의 재전달 ── */
    const dupJobId = await enqueueDueJob();
    const [dupJob] = await claimJobs(sql, {
      topics: [TOPIC],
      workerId: WORKER_B,
      limit: 5,
    });
    expect(dupJob?.id).toBe(dupJobId);
    duplicateResult = await handleScheduleRecalculate(dupJob!);
  });

  afterAll(async () => {
    await cleanupFixtures();
    await sql.end({ timeout: 5 });
    // 도메인·핸들러가 쓰는 공유 풀도 닫아야 프로세스가 바로 끝난다
    await getSharedSql().end({ timeout: 5 });
  });

  it("전제: auto_reschedule kill switch가 켜져 있다", () => {
    expect(featureEnabled).toBe(true);
  });

  it("리스가 살아 있는 동안에는 다른 워커가 회수하지 못한다", () => {
    expect(claimedA?.id).toBe(jobId);
    expect(stolenWhileLeased).toHaveLength(0);
  });

  it("중단 지점까지의 체크포인트가 DB에 남는다", () => {
    expect(run1Error).toBeInstanceOf(Error);
    expect((run1Error as Error).message).toContain("중단");
    // 죽은 워커는 실패를 기록하지 못한다 — 작업은 running으로 굳는다
    expect(jobAfterCrash.status).toBe("running");
    expect(jobAfterCrash.worker_id).toBe(WORKER_A);
    expect(jobAfterCrash.attempts).toBe(1);
    expect(jobAfterCrash.checkpoint?.doneGroupIds).toEqual([GROUP_DONE]);
  });

  it("중단 전 그룹은 실제로 처리됐고, 중단된 그룹은 손대지 않았다", () => {
    expect(doneSessionsAfterCrash.length).toBeGreaterThan(0);
    expect(restSessionsAfterCrash).toHaveLength(0);
    // 재개가 inbox 중복 판정에 걸릴 조건 — 첫 실행이 이미 표시했다
    expect(inboxAfterCrash).toBe(1);
  });

  it("리스가 만료되면 다른 워커가 체크포인트째로 회수한다", () => {
    expect(reclaimed?.id).toBe(jobId);
    expect(
      (reclaimed?.checkpoint as { doneGroupIds?: string[] } | null)
        ?.doneGroupIds,
    ).toEqual([GROUP_DONE]);
    /* 시도 수·소유자는 DB 행으로 본다 — claimJobs가 돌려주는 객체는
     * update 이전에 뜬 후보 스냅샷이라 attempts가 1 뒤처져 있다. */
    expect(jobAfterReclaim.status).toBe("running");
    expect(jobAfterReclaim.worker_id).toBe(WORKER_B);
    expect(jobAfterReclaim.attempts).toBe(2);
  });

  it("재개는 완료 그룹을 건너뛰고 남은 그룹만 처리한다", () => {
    expect(resumeResult[GROUP_DONE]).toEqual({ skipped: "체크포인트 완료분" });
    expect(resumeResult[GROUP_REST]?.ok).toBe(true);
    expect(resumeResult[GROUP_REST]?.created).toBeGreaterThan(0);
  });

  it("완료 그룹의 수업은 다시 만들어지지 않는다 (재작업 없음)", () => {
    /* 실체화는 미래의 planned 수업을 지우고 새 ID로 다시 넣는다.
     * ID 집합이 그대로면 그 경로를 아예 타지 않았다는 뜻이다. */
    expect(doneSessionsAfterResume).toEqual(doneSessionsAfterCrash);
    expect(restSessionsAfterResume.length).toBeGreaterThan(0);
  });

  it("재개 후 체크포인트에 두 그룹이 모두 들어가고 작업이 완료된다", () => {
    expect(jobAfterResume.checkpoint?.doneGroupIds).toEqual([
      GROUP_DONE,
      GROUP_REST,
    ]);
    expect(finalStatus).toBe("succeeded");
  });

  it("체크포인트 없는 재전달은 여전히 inbox 중복으로 걸러진다 (대조군)", () => {
    // 재개가 통과한 이유가 "inbox가 안 걸려서"가 아님을 보인다
    expect(duplicateResult).toEqual({ skipped: "중복 이벤트 (inbox)" });
  });
});
