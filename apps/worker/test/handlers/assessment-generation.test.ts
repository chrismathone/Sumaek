import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  KILL_SWITCH_TOPICS,
  createSql,
  getSharedSql,
  isDeferSignal,
  type ClaimedJob,
} from "@su-maek/db";
import {
  ASSESSMENT_GENERATE_TOPIC,
  ASSESSMENT_GENERATION_SWITCH,
  assessmentJobKey,
  produceAssessmentJobs,
} from "@su-maek/db/domain";
import { handleAssessmentGenerate } from "../../src/handlers/assessment";
import { runOnce, wasIdle } from "../../src/loop";
import {
  createHandlerRegistry,
  TOPICS_WITHOUT_EVENT,
} from "../../src/registry";

/* ─────────────────────────────────────────────────────────────
 * 평가 자동 생성 — 생산자·핸들러 (T3.2 · G-04) — 라이브 DB 통합 테스트.
 *
 * 지금까지 일일·확인테스트는 **교사가 버튼을 눌러야만** 생겼다. 생성 서비스는
 * 처음부터 있었지만 부르는 곳이 화면 하나뿐이라, 선생님이 잊으면 학생은 그날
 * 시험 칸을 영원히 기다린다(노드 실행기는 그것을 `assessment_not_generated`로
 * 막는다 — 결손이 보이기는 하나 스스로 낫지는 않는다).
 *
 * 여기서 겨누는 것:
 *   1) 배선의 **짝** — 토픽·핸들러·kill switch 표가 함께 움직인다
 *   2) 수업일 전 설정된 시점에 due 수업이 발견되고 작업이 생긴다
 *   3) 같은 반·날짜·목적은 작업도 평가도 각각 1건뿐이다 (두 겹 멱등)
 *   4) 아직 이른 수업·창 밖 수업·이미 생성된 수업은 작업을 만들지 않는다
 *   5) kill switch 중에는 작업을 **만들지 않고**, 이미 만들어진 작업은
 *      클레임되지 않은 채 보존되어 복구 후 그대로 실행된다 (유실 0)
 *   6) 워커 재시작(= 같은 생산자·핸들러 재실행)에 누락도 중복도 없다
 *   7) 생성 시점 파라미터가 정책으로 조정된다
 *
 * 덮지 못하는 것 — 정직하게 적는다:
 *  - 문항 선정의 품질(버킷 비율·무반복·난이도)은 여기서 보지 않는다.
 *    `apps/web/test/integration/review-selection.test.ts`와 blueprint-chain의
 *    몫이다. 여기서는 「생성이 일어났는가 · 몇 건인가」만 본다.
 *  - 생성 실패의 알림·수동 복구(E-17)는 T3.4다. 여기서는 실패가 조용히
 *    성공으로 기록되지 않는다는 것까지만 확인한다.
 *
 * 픽스처 규약: 조직만 고정 ID(감사 행은 지울 수 없다). 시각은 전부 DB의
 * now() 기준 상대값으로 만든다 — 로컬 시계가 DB보다 앞서거나 뒤서면
 * "몇 시간 전에 만든다"가 통째로 밀린다(실측으로 다른 스펙을 깨뜨린 적이 있다).
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000032001";
const WORKER = "itest-assessment-worker";

const PERIOD = uuidv7();
const GROUP = uuidv7();
const LEARNER = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const NODE_CONCEPT = uuidv7();
const NODE_DAILY = uuidv7();
const NODE_CONFIRM = uuidv7();
const SESSION_DUE = uuidv7();
const SESSION_EARLY = uuidv7();
const SESSION_BEYOND = uuidv7();
const POLICY_DAILY = uuidv7();
const POLICY_CONFIRM = uuidv7();
const RIGHT = uuidv7();
const CONCEPT = uuidv7();
const QUESTIONS = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const VERSIONS = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];

/** 생산자 파라미터 — 창 안/밖을 시계와 무관하게 가르기 위해 명시한다 */
const LOOKAHEAD_DAYS = 7;
const BEFORE_HOURS = 24;

interface JobRow {
  id: string;
  topic: string;
  status: string;
  idempotency_key: string;
  payload: { purpose?: string; planDate?: string; learningGroupId?: string };
}

async function assessmentJobs(): Promise<JobRow[]> {
  return sql<JobRow[]>`
    select id, topic, status::text as status, idempotency_key, payload
    from jobs
    where organization_id = ${ORG} and topic = ${ASSESSMENT_GENERATE_TOPIC}
    order by idempotency_key
  `;
}

interface AssessmentRow {
  id: string;
  purpose: string;
  scheduled_date: string;
  status: string;
  question_count: number;
}

async function assessments(): Promise<AssessmentRow[]> {
  return sql<AssessmentRow[]>`
    select a.id, a.purpose::text as purpose, a.scheduled_date::text as scheduled_date,
           a.status::text as status,
           (select count(*)::int from assessment_questions q where q.assessment_id = a.id)
             as question_count
    from assessment_instances a
    where a.organization_id = ${ORG} and a.status <> 'cancelled'
    /* enum을 그대로 정렬하면 선언 순서(formative가 confirmation보다 앞)로
     * 나온다 — 단언이 읽는 사람 기대와 어긋난다. 이름순으로 고정한다. */
    order by a.purpose::text, a.scheduled_date
  `;
}

/** 디스패처가 아니라 **생산자**가 만드는 모양의 작업 (이벤트 봉투가 없다) */
function generateJob(purpose: "formative" | "confirmation", planDate: string): ClaimedJob {
  return {
    id: uuidv7(),
    organization_id: ORG,
    topic: ASSESSMENT_GENERATE_TOPIC,
    payload: {
      organizationId: ORG,
      learningGroupId: GROUP,
      learnerId: null,
      planDate,
      purpose,
      sessionId: SESSION_DUE,
      routeNodeId: purpose === "formative" ? NODE_DAILY : NODE_CONFIRM,
    },
    attempts: 1,
    max_attempts: 5,
    checkpoint: null,
    meta: null,
  };
}

async function cleanupFixtures(): Promise<void> {
  await sql`delete from jobs where organization_id = ${ORG}`;
  await sql`delete from kill_switches where organization_id = ${ORG}`;
  await sql`
    delete from assignments where assessment_id in (
      select id from assessment_instances where organization_id = ${ORG})
  `;
  await sql`
    delete from assessment_questions where organization_id = ${ORG}
  `;
  await sql`delete from assessment_instances where organization_id = ${ORG}`;
  await sql`delete from assessment_blueprints where organization_id = ${ORG}`;
  await sql`delete from assessment_policies where organization_id = ${ORG}`;
  await sql`delete from outbox_events where organization_id = ${ORG}`;
  await sql`delete from sessions where organization_id = ${ORG}`;
  await sql`delete from learning_group_memberships where organization_id = ${ORG}`;
  await sql`
    delete from route_nodes where route_version_id in (
      select id from route_versions where organization_id = ${ORG})
  `;
  await sql`update route_plans set active_version_id = null where organization_id = ${ORG}`;
  await sql`delete from route_versions where organization_id = ${ORG}`;
  await sql`delete from route_plans where organization_id = ${ORG}`;
  await sql`delete from question_alignments where organization_id = ${ORG}`;
  await sql`delete from question_versions where organization_id = ${ORG}`;
  await sql`delete from questions where organization_id = ${ORG}`;
  await sql`delete from content_rights where organization_id = ${ORG}`;
  await sql`delete from learners where organization_id = ${ORG}`;
  await sql`delete from learning_groups where organization_id = ${ORG}`;
  await sql`delete from course_periods where organization_id = ${ORG}`;
  await sql`delete from canonical_concepts where id = ${CONCEPT}`;
}

/* ── 1) 배선의 짝 — DB 없이도 도는 회귀 검사 ────────────────── */

describe("평가 자동 생성 배선 (G-04)", () => {
  it("생성 토픽에 워커 핸들러가 등록되어 있다", () => {
    /* 등록이 빠지면 생산자가 만든 작업이 큐에 쌓이기만 하고 아무도 하지
     * 않는다 — 현황판은 「예약됨」이라 믿는데 학생 화면에는 영원히 없다. */
    expect(createHandlerRegistry().has(ASSESSMENT_GENERATE_TOPIC)).toBe(true);
  });

  it("이벤트가 아니라 생산자가 만드는 토픽임이 적혀 있다", () => {
    /* 이 토픽에는 자기를 부르는 이벤트가 없다 — 주기 생산자가 직접
     * enqueue한다 (ADR-0018 §4: 생성 요청은 이벤트가 아니라 작업이다).
     * 배선 검사가 이것을 「고아 핸들러」로 잘못 잡지 않도록 이유를 남긴다. */
    expect(Object.keys(TOPICS_WITHOUT_EVENT)).toContain(ASSESSMENT_GENERATE_TOPIC);
    expect(TOPICS_WITHOUT_EVENT[ASSESSMENT_GENERATE_TOPIC]!.length).toBeGreaterThan(10);
  });

  it("kill switch가 이 토픽을 덮는다 (인수 40)", () => {
    expect([...(KILL_SWITCH_TOPICS[ASSESSMENT_GENERATION_SWITCH] ?? [])]).toEqual([
      ASSESSMENT_GENERATE_TOPIC,
    ]);
  });

  it("작업 멱등 키가 인덱스와 같은 모양이다", () => {
    /* ADR-0018 §5 — `{topic}:{org}:{group ?? '-'}:{learner ?? '-'}:{date}:{purpose}`.
     * 반 공통은 학생 자리가 `-`로 접힌다. 학생 개별 보충 평가가 같은 날 같은
     * 반에 공존할 수 있으므로 학생이 키에 들어가야 한다. */
    expect(
      assessmentJobKey({
        organizationId: "org-1",
        learningGroupId: "grp-1",
        learnerId: null,
        planDate: "2026-08-20",
        purpose: "formative",
      }),
    ).toBe("assessment.generate:org-1:grp-1:-:2026-08-20:formative");
    expect(
      assessmentJobKey({
        organizationId: "org-1",
        learningGroupId: null,
        learnerId: "lnr-1",
        planDate: "2026-08-20",
        purpose: "retest",
      }),
    ).toBe("assessment.generate:org-1:-:lnr-1:2026-08-20:retest");
  });
});

/* ── 2) 생산자·핸들러의 실제 경로 ───────────────────────────── */

describe.skipIf(!hasDb)("due 수업 발견과 평가 생성 (인수: 반·날짜·목적당 1건)", () => {
  let dueDate: string;
  let earlyDate: string;

  let firstRun: Awaited<ReturnType<typeof produceAssessmentJobs>>;
  let jobsAfterFirst: JobRow[];
  let secondRun: Awaited<ReturnType<typeof produceAssessmentJobs>>;
  let jobsAfterSecond: JobRow[];

  let switchRun: Awaited<ReturnType<typeof produceAssessmentJobs>>;
  let jobsDuringSwitch: JobRow[];
  let loopDuringSwitch: Awaited<ReturnType<typeof runOnce>>;
  let jobStatusDuringSwitch: string[];

  let loopAfterSwitch: Awaited<ReturnType<typeof runOnce>>;
  let assessmentsAfterLoop: AssessmentRow[];
  let jobsAfterLoop: JobRow[];

  let restartRun: Awaited<ReturnType<typeof produceAssessmentJobs>>;
  let rerunResult: { deduplicated?: boolean; assessmentId?: string | null };
  let assessmentsAfterRerun: AssessmentRow[];

  let earlyRunDefault: Awaited<ReturnType<typeof produceAssessmentJobs>>;
  let producerCycle: Awaited<ReturnType<typeof runOnce>>;
  let consumerCycle: Awaited<ReturnType<typeof runOnce>>;
  let assessmentsAfterProducerLoop: AssessmentRow[];

  let deferResult: unknown;

  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 평가 자동생성', 'itest-assessment-auto', ${TZ})
      on conflict (id) do nothing
    `;
    await cleanupFixtures();

    /* 시각은 전부 DB now() 기준으로 만든다 — 창 안/밖이 로컬 시계에
     * 흔들리지 않게 한다. session_date도 starts_at의 KST 날짜로 맞춘다. */
    const [dates] = await sql<{ due: string; early: string; beyond: string }[]>`
      select ((now() + interval '2 hours')  at time zone ${TZ})::date::text as due,
             ((now() + interval '50 hours') at time zone ${TZ})::date::text as early,
             ((now() + interval '30 days')  at time zone ${TZ})::date::text as beyond
    `;
    dueDate = dates!.due;
    earlyDate = dates!.early;

    await sql`
      insert into course_periods (
        id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026,
              ${dueDate}::date - 30, ${dates!.beyond}::date + 30, 'active')
    `;
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 자동생성반', 'operating')
    `;
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${LEARNER}, ${ORG}, 'ITEST 자동생성학생', 'active')
    `;
    await sql`
      insert into learning_group_memberships (
        id, organization_id, learning_group_id, learner_id, status, joined_on)
      values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER}, 'active', ${dueDate}::date - 30)
    `;

    /* 출제 재료 — 문항 선정 품질은 여기서 보지 않으므로 최소로 둔다 */
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values (${CONCEPT}, ${`itest-auto-gen-${CONCEPT.slice(-12)}`},
              'ITEST 자동생성 개념', 'active', '[]'::jsonb)
      on conflict (id) do update set status = 'active'
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${RIGHT}, ${ORG}, 'ITEST', 'usable')
    `;
    for (const [i, questionId] of QUESTIONS.entries()) {
      const versionId = VERSIONS[i]!;
      await sql`
        insert into questions (
          id, organization_id, kind, review_status, content_right_id,
          is_auto_assignable, current_version_id)
        values (${questionId}, ${ORG}, 'short_answer', 'published', ${RIGHT},
                true, ${versionId})
      `;
      await sql`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, answer,
          points, difficulty, content_checksum)
        values (
          ${versionId}, ${ORG}, ${questionId}, 1,
          ${sql.json([{ type: "text", text: `ITEST 자동생성 문항 ${i + 1}` }] as never)},
          ${sql.json({ kind: "short_answer", accepted: [{ value: "1", form: "number" }] } as never)},
          '10', ${sql.json({ band: "mid" } as never)}, ${`itest-auto-${questionId}`}
        )
      `;
      await sql`
        insert into question_alignments (id, organization_id, question_id, concept_id, weight)
        values (${uuidv7()}, ${ORG}, ${questionId}, ${CONCEPT}, 1)
      `;
    }

    await sql`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, constraints, is_active)
      values (${POLICY_DAILY}, ${ORG}, 'ITEST 일일테스트 정책', 'formative', 1,
              ${sql.json({ today_concept: 100, weakness: 0, review: 0 } as never)},
              2, ${sql.json({} as never)}, true)
    `;
    await sql`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, constraints, passing_rules, is_active)
      values (${POLICY_CONFIRM}, ${ORG}, 'ITEST 확인테스트 정책', 'confirmation', 1,
              ${sql.json({} as never)}, 2, ${sql.json({} as never)},
              ${sql.json({ passRatio: 0.7 } as never)}, true)
    `;

    await sql`
      insert into route_plans (
        id, organization_id, kind, name, learning_group_id, course_period_id,
        status, active_version_id)
      values (${PLAN}, ${ORG}, 'group_route', 'ITEST 루트', ${GROUP}, ${PERIOD},
              'published', ${VERSION})
    `;
    await sql`
      insert into route_versions (id, organization_id, route_plan_id, version_number, status)
      values (${VERSION}, ${ORG}, ${PLAN}, 1, 'published')
    `;
    await sql`
      insert into route_nodes (
        id, organization_id, route_version_id, kind, title, sort_order, concept_ids)
      values
        (${NODE_CONCEPT}, ${ORG}, ${VERSION}, 'concept_lesson', 'ITEST 개념 차시', 1,
         ${sql.json([CONCEPT] as never)}),
        (${NODE_DAILY}, ${ORG}, ${VERSION}, 'daily_test', 'ITEST 일일테스트', 2,
         ${sql.json([CONCEPT] as never)}),
        (${NODE_CONFIRM}, ${ORG}, ${VERSION}, 'confirmation_test', 'ITEST 확인테스트', 3,
         ${sql.json([CONCEPT] as never)})
    `;

    /* 수업 3건 — 창 안 / 아직 이름 / 창 밖 */
    await sql`
      insert into sessions (
        id, organization_id, learning_group_id, session_date, timezone,
        starts_at, ends_at, status, planned_node_ids)
      values
        (${SESSION_DUE}, ${ORG}, ${GROUP}, ${dueDate}::date, ${TZ},
         now() + interval '2 hours', now() + interval '4 hours', 'planned',
         ${sql.json([NODE_CONCEPT, NODE_DAILY, NODE_CONFIRM] as never)}),
        (${SESSION_EARLY}, ${ORG}, ${GROUP}, ${earlyDate}::date, ${TZ},
         now() + interval '50 hours', now() + interval '52 hours', 'planned',
         ${sql.json([NODE_CONCEPT, NODE_DAILY] as never)}),
        (${SESSION_BEYOND}, ${ORG}, ${GROUP}, ${dates!.beyond}::date, ${TZ},
         now() + interval '30 days', now() + interval '30 days 2 hours', 'planned',
         ${sql.json([NODE_CONCEPT, NODE_DAILY] as never)})
    `;

    const producerOptions = {
      organizationId: ORG,
      lookaheadDays: LOOKAHEAD_DAYS,
      generateBeforeHours: BEFORE_HOURS,
    };

    /* ── 1회차: due 발견·enqueue ── */
    firstRun = await produceAssessmentJobs(sql, producerOptions);
    jobsAfterFirst = await assessmentJobs();

    /* ── 2회차: 같은 것을 다시 만들지 않는다 ── */
    secondRun = await produceAssessmentJobs(sql, producerOptions);
    jobsAfterSecond = await assessmentJobs();

    /* ── kill switch: 만들지 않고, 있는 것은 클레임되지 않는다 ── */
    await sql`
      insert into kill_switches (id, organization_id, key, enabled, reason)
      values (${uuidv7()}, ${ORG}, ${ASSESSMENT_GENERATION_SWITCH}, false,
              'ITEST 자동 평가 생성 중지')
    `;
    switchRun = await produceAssessmentJobs(sql, producerOptions);
    jobsDuringSwitch = await assessmentJobs();
    /* 핸들러 수준의 연기도 확인한다 — 전역 스위치는 클레임에서 빠지지만
     * 조직 스위치는 클레임된 뒤 핸들러가 미뤄야 한다 (시도 소모 없이). */
    deferResult = await handleAssessmentGenerate(generateJob("formative", dueDate));
    await sql`update jobs set run_at = now() - interval '1 second' where organization_id = ${ORG}`;
    loopDuringSwitch = await runOnce({
      sql,
      handlers: createHandlerRegistry(),
      workerId: WORKER,
      concurrency: 4,
      organizationId: ORG,
    });
    jobStatusDuringSwitch = (await assessmentJobs()).map((j) => j.status);

    /* ── 스위치 복구 후: 보존된 작업이 그대로 실행된다 ── */
    await sql`delete from kill_switches where organization_id = ${ORG}`;
    await sql`update jobs set run_at = now() - interval '1 second' where organization_id = ${ORG}`;
    loopAfterSwitch = await runOnce({
      sql,
      handlers: createHandlerRegistry(),
      workerId: WORKER,
      concurrency: 4,
      organizationId: ORG,
    });
    assessmentsAfterLoop = await assessments();
    jobsAfterLoop = await assessmentJobs();

    /* ── 워커 재시작 — 생산자·핸들러를 그대로 다시 돌린다 ── */
    restartRun = await produceAssessmentJobs(sql, producerOptions);
    rerunResult = (await handleAssessmentGenerate(
      generateJob("formative", dueDate),
    )) as typeof rerunResult;
    assessmentsAfterRerun = await assessments();

    /* ── 생성 시점 파라미터 — 정책이 조정한다 ── */
    earlyRunDefault = await produceAssessmentJobs(sql, producerOptions);
    await sql`
      update assessment_policies
      set constraints = constraints || ${sql.json({ generateBeforeHours: 72 } as never)}
      where id = ${POLICY_DAILY}
    `;

    /* ── 루프가 생산자를 품고 도는 회차 ──
     * 생산자를 직접 부르는 것과 **루프를 통해** 도는 것은 다른 경로다.
     * 루프 배선이 빠져 있으면 여기까지의 단언은 전부 통과하면서 실제
     * 워커는 아무것도 만들지 않는다 — 그 결손이 가장 늦게 드러난다.
     *
     * 같은 회차 안에서 실행까지 되는지는 단언하지 않는다: enqueue의
     * run_at은 **클라이언트 시계**라 DB보다 앞서면 그 회차에는 아직
     * 클레임 대상이 아니다(outbox-roundtrip이 같은 함정을 기록해 두었다).
     * 대신 wasIdle이 거짓이라 루프가 쉬지 않고 곧바로 다음 회차를 돈다. */
    producerCycle = await runOnce({
      sql,
      handlers: createHandlerRegistry(),
      workerId: WORKER,
      concurrency: 4,
      organizationId: ORG,
      produceAssessments: true,
    });
    await sql`update jobs set run_at = now() - interval '1 second' where organization_id = ${ORG} and status = 'queued'`;
    consumerCycle = await runOnce({
      sql,
      handlers: createHandlerRegistry(),
      workerId: WORKER,
      concurrency: 4,
      organizationId: ORG,
    });
    assessmentsAfterProducerLoop = await assessments();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await sql.end({ timeout: 5 });
    /* 공유 풀은 여기서 닫지 않는다 — 아래 스위트의 핸들러가 같은 풀을
     * 쓴다. 닫으면 그쪽이 CONNECTION_ENDED로 터지고, 「실패를 던진다」를
     * 겨눈 단언이 **엉뚱한 실패**로 통과할 뻔한다. 파일 끝에서 닫는다. */
  });

  it("창 안의 due 수업에서 목적별로 작업 하나씩 만든다", () => {
    expect(firstRun.enqueued).toBe(2);
    expect(firstRun.deduplicated).toBe(0);
    expect(jobsAfterFirst).toHaveLength(2);
    expect(jobsAfterFirst.map((j) => j.payload.purpose).sort()).toEqual([
      "confirmation",
      "formative",
    ]);
    expect(jobsAfterFirst.map((j) => j.payload.planDate)).toEqual([dueDate, dueDate]);
  });

  it("작업 키가 인덱스와 같은 모양으로 저장된다", () => {
    expect(jobsAfterFirst.map((j) => j.idempotency_key).sort()).toEqual(
      [
        assessmentJobKey({
          organizationId: ORG,
          learningGroupId: GROUP,
          learnerId: null,
          planDate: dueDate,
          purpose: "formative",
        }),
        assessmentJobKey({
          organizationId: ORG,
          learningGroupId: GROUP,
          learnerId: null,
          planDate: dueDate,
          purpose: "confirmation",
        }),
      ].sort(),
    );
  });

  it("아직 이른 수업·창 밖 수업은 작업을 만들지 않는다", () => {
    /* 50시간 뒤 수업은 24시간 창 밖이고, 30일 뒤 수업은 lookahead 밖이다.
     * 미리 만들면 생성 시점의 숙련도·복습이 아니라 **옛 상태**로 출제된다
     * (ADR-0018 §5 「생성 시점의 신선도」). */
    expect(jobsAfterFirst.every((j) => j.payload.planDate === dueDate)).toBe(true);
  });

  it("두 번째 회차는 같은 작업을 다시 만들지 않는다 (첫째 겹 멱등)", () => {
    expect(secondRun.enqueued).toBe(0);
    expect(secondRun.deduplicated).toBe(2);
    expect(jobsAfterSecond).toHaveLength(2);
  });

  it("kill switch 중에는 작업을 만들지 않는다", () => {
    expect(switchRun.enqueued).toBe(0);
    expect(switchRun.suppressed).toBe(2);
    expect(jobsDuringSwitch).toHaveLength(2); // 있던 것이 늘지 않는다
  });

  it("kill switch 중에도 이미 만들어진 작업은 보존된다 (유실 0)", () => {
    /* 전역 스위치는 클레임 단계에서, 조직 스위치는 핸들러의 연기로 막힌다.
     * 어느 쪽이든 작업이 큐에 남아 복구 후 그대로 재개되어야 한다. */
    expect(isDeferSignal(deferResult)).toBe(true);
    expect((deferResult as { reason: string }).reason).toContain(
      ASSESSMENT_GENERATION_SWITCH,
    );
    expect(loopDuringSwitch.succeeded).toBe(0);
    expect(loopDuringSwitch.deferred + loopDuringSwitch.blockedTopics.length).toBeGreaterThan(0);
    expect(jobStatusDuringSwitch.every((s) => s !== "succeeded")).toBe(true);
  });

  it("스위치 복구 후 보존된 작업이 그대로 실행돼 평가가 생긴다", () => {
    expect(loopAfterSwitch.claimed).toBe(2);
    expect(loopAfterSwitch.succeeded).toBe(2);
    expect(loopAfterSwitch.failed).toBe(0);
    expect(jobsAfterLoop.every((j) => j.status === "succeeded")).toBe(true);
    expect(assessmentsAfterLoop.map((a) => a.purpose)).toEqual([
      "confirmation",
      "formative",
    ]);
    expect(assessmentsAfterLoop.every((a) => a.question_count > 0)).toBe(true);
    expect(assessmentsAfterLoop.every((a) => a.scheduled_date === dueDate)).toBe(true);
  });

  it("워커 재시작 후 누락도 중복도 없다", () => {
    /* 생산자는 이미 평가가 있는 수업을 다시 집지 않고, 핸들러를 억지로 다시
     * 돌려도 기존 평가를 반환한다 (둘째 겹 멱등 — DB 인덱스가 마지막 방벽). */
    expect(restartRun.enqueued).toBe(0);
    expect(rerunResult.deduplicated).toBe(true);
    expect(assessmentsAfterRerun).toHaveLength(2);
    expect(assessmentsAfterRerun).toEqual(assessmentsAfterLoop);
  });

  it("생성 시점은 정책으로 조정된다", () => {
    /* 기본 24시간에서는 50시간 뒤 수업이 아직 이르다. 정책이 72시간으로
     * 넓히면 같은 수업이 due가 된다 — 「수업일 전 설정된 시점」이 실재한다. */
    expect(earlyRunDefault.enqueued).toBe(0);
    expect(producerCycle.produced?.enqueued).toBe(1);
  });

  it("워커 루프가 생산자를 품고 돈다 — 직접 호출이 아니라 배선으로", () => {
    expect(producerCycle.produced).not.toBeNull();
    expect(producerCycle.produced?.suppressed).toBe(0);
    // 만든 것이 있으면 쉬지 않는다 — 다음 회차가 곧바로 집는다
    expect(wasIdle(producerCycle)).toBe(false);
    expect(consumerCycle.claimed).toBe(1);
    expect(consumerCycle.succeeded).toBe(1);
    expect(
      assessmentsAfterProducerLoop.filter((a) => a.scheduled_date === earlyDate),
    ).toHaveLength(1);
  });

  it("생산자를 돌리지 않은 회차는 그 사실이 드러난다", () => {
    /* null이라 「이번엔 안 함」이고, 마지막 값이 남아 도는 것처럼 보이지
     * 않는다 — 박동만 보고 생산자 상태를 가릴 수 있어야 한다. */
    expect(consumerCycle.produced).toBeNull();
  });
});

/* ── 3) 생성이 실패했을 때 — 조용히 성공으로 기록되지 않는다 ── */

describe.skipIf(!hasDb)("생성 실패는 성공으로 기록되지 않는다", () => {
  const FAIL_ORG = "ffffffff-0000-7000-8000-000000032002";
  const FAIL_GROUP = uuidv7();
  let failSql: ReturnType<typeof createSql>;

  beforeAll(async () => {
    failSql = createSql();
    await failSql`
      insert into organizations (id, name, slug, timezone)
      values (${FAIL_ORG}, 'ITEST 평가 생성실패', 'itest-assessment-fail', ${TZ})
      on conflict (id) do nothing
    `;
    await failSql`delete from assessment_policies where organization_id = ${FAIL_ORG}`;
  });

  afterAll(async () => {
    await failSql`delete from jobs where organization_id = ${FAIL_ORG}`;
    /* outbox도 함께 지운다. 작업만 지우면 「배달 완료인데 소비자 작업이
     * 없는」 이벤트가 남아 R-04가 영구 위반이 된다 — 실측으로 46건이
     * 쌓여 있었고, 그 때문에 `pnpm verify:recovery`가 늘 빨간불이었다.
     * 늘 빨간 게이트는 아무도 읽지 않는다. */
    await failSql`delete from outbox_events where organization_id = ${FAIL_ORG}`;
    await failSql.end({ timeout: 5 });
  });

  it("정책이 없으면 던져서 실패로 남긴다 — 재시도로 낫지 않는다", async () => {
    /* 결과를 그대로 돌려주면 작업이 `succeeded`가 되고, 실패 사실은
     * meta 안에만 남는다. 현황판은 초록인데 학생 화면에는 시험이 없다.
     * 재시도해도 낫지 않으므로(사람이 정책을 만들어야 한다) 재시도 불가로
     * 표시해 즉시 최종 실패로 보낸다 — 그 목록이 T3.4의 복구 대상이다. */
    const job: ClaimedJob = {
      id: uuidv7(),
      organization_id: FAIL_ORG,
      topic: ASSESSMENT_GENERATE_TOPIC,
      payload: {
        organizationId: FAIL_ORG,
        learningGroupId: FAIL_GROUP,
        learnerId: null,
        planDate: "2026-08-20",
        purpose: "formative",
      },
      attempts: 1,
      max_attempts: 5,
      checkpoint: null,
      meta: null,
    };
    await expect(handleAssessmentGenerate(job)).rejects.toMatchObject({
      retryable: false,
    });
  });

  it("생산자가 만들지 않은 모양의 작업은 재시도하지 않고 실패한다", async () => {
    /* 반·날짜·목적이 없는 작업은 손으로 넣었거나 payload 계약이 바뀐 것이다.
     * 다섯 번 재시도해도 같은 값이 온다 — 사유를 남기고 즉시 끝낸다. */
    const base = {
      id: uuidv7(),
      organization_id: FAIL_ORG,
      topic: ASSESSMENT_GENERATE_TOPIC,
      attempts: 1,
      max_attempts: 5,
      checkpoint: null,
      meta: null,
    };
    await expect(
      handleAssessmentGenerate({ ...base, payload: {} }),
    ).rejects.toThrow(/payload가 불완전/);
    await expect(
      handleAssessmentGenerate({
        ...base,
        payload: {
          learningGroupId: FAIL_GROUP,
          planDate: "2026-08-20",
          purpose: "summative",
        },
      }),
    ).rejects.toThrow(/자동 생성 대상이 아닌 목적/);
  });

  it("조직 없는 작업은 던지지 않고 건너뛴다", async () => {
    /* 시스템 작업(organization_id null)이 이 토픽에 섞이는 경로는 없지만,
     * 섞였을 때 DLQ를 채우는 것보다 결과로 남기는 편이 낫다. */
    const result = await handleAssessmentGenerate({
      id: uuidv7(),
      organization_id: null,
      topic: ASSESSMENT_GENERATE_TOPIC,
      payload: {},
      attempts: 1,
      max_attempts: 5,
      checkpoint: null,
      meta: null,
    });
    expect(result).toEqual({ skipped: "조직 없음" });
  });
});

/** 핸들러·도메인이 쓰는 공유 풀 — 파일의 모든 스위트가 끝난 뒤에 닫는다 */
afterAll(async () => {
  if (!hasDb) return;
  await getSharedSql().end({ timeout: 5 });
});
