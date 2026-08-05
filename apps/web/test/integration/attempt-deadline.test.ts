import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 시험 제한 시간의 서버 강제 (T6.1 · G-09) — 라이브 DB.
 *
 * 제한 시간은 지금까지 **클라이언트 카운트다운**뿐이었다. 서버는
 * `status === 'in_progress'`만 보고 저장을 받았으므로, 탭을 열어 둔 채
 * 시계를 되돌리거나 카운트다운 스크립트를 멈추면 시간이 지나도 계속 쓸 수
 * 있었다. 시험의 공정성이 브라우저 한 줄에 달려 있었다는 뜻이다.
 *
 * 마감은 **DB 시계**로 잰다: `attempts.started_at + time_limit_minutes` 대
 * `now()`. 클라이언트가 무엇을 보내든 판정에 들어가지 않는다.
 *
 * 겨누는 것:
 *   1) 마감 전 저장은 그대로 된다
 *   2) 마감 후 저장은 거부되고 **그 자리에서 자동 제출**된다
 *   3) 마지막 정상 저장 답안이 보존된 채 제출된다
 *   4) 자동·수동 제출이 겹쳐도 전이는 한 번이다
 *   5) 제한 시간이 없는 시험은 마감이 없다
 * ───────────────────────────────────────────────────────────── */

const { getSharedSql } = await import("@su-maek/db");
const { saveResponse, submitAndGrade } = await import("@/lib/domain/attempt");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";

let sql: ReturnType<typeof getSharedSql>;
/* 고정 ID로 재사용한다 — 응시·응답·채점 결정은 증거라 지울 수 없다
 * (grade_decisions는 append-only, ADR-0015). 실행마다 새로 만들면 지울 수
 * 없는 행이 사라진 학습자를 가리키며 쌓인다. */
const LEARNER = "ffffffff-0000-7000-8000-000000061001";
/** 제한 30분 시험 · 무제한 시험 */
const TIMED = "ffffffff-0000-7000-8000-000000061002";
const UNTIMED = "ffffffff-0000-7000-8000-000000061003";

/* 체크섬까지 함께 가져온다.
 *
 * 픽스처가 **유효한 데이터**여야 한다는 것이 요지다. 예전에는 스냅샷
 * 체크섬에 'itest-deadline' 같은 아무 문자열을 넣었는데, I-08은 스냅샷과
 * 원본 버전의 체크섬이 같은지를 본다 — 그래서 이 테스트가 돌 때마다
 * `pnpm verify:recovery`에 위반이 하나씩 쌓였다. 늘 빨간 게이트는 아무도
 * 읽지 않으므로, 픽스처가 불변 조건을 어기지 않게 한다. */
async function pickQuestionVersion(): Promise<{
  qid: string;
  vid: string;
  checksum: string;
}> {
  const [row] = await sql<{ qid: string; vid: string; checksum: string }[]>`
    select q.id::text as qid, v.id::text as vid, v.content_checksum as checksum
    from questions q join question_versions v on v.question_id = q.id
    where q.organization_id = ${ORG}
    order by q.id limit 1
  `;
  return row!;
}

async function makeAssessment(
  id: string,
  timeLimit: number | null,
): Promise<string> {
  const { qid, vid, checksum } = await pickQuestionVersion();
  /* `published_at`을 채운다 — I-08은 「게시 상태인데 게시 기록 없음」도 본다. */
  await sql`
    insert into assessment_instances (
      id, organization_id, purpose, title, learner_id, scheduled_date, status,
      time_limit_minutes, published_at)
    values (${id}, ${ORG}, 'formative', ${`ITEST 마감 ${id.slice(-6)}`},
            ${LEARNER}, current_date, 'published', ${timeLimit}, now())
    on conflict (id) do update set published_at = coalesce(assessment_instances.published_at, now())
  `;
  const [existing] = await sql<{ id: string }[]>`
    select id::text from assessment_questions where assessment_id = ${id} limit 1
  `;
  if (existing) return existing.id;
  const aq = uuidv7();
  await sql`
    insert into assessment_questions (
      id, organization_id, assessment_id, question_id, question_version_id,
      content_checksum, sort_order, points, selection_reason,
      answer_snapshot, concept_weights)
    values (${aq}, ${ORG}, ${id}, ${qid}, ${vid}, ${checksum}, 1, 10, 'itest',
            ${sql.json({
              kind: "short_answer",
              accepted: [{ value: "42", form: "number", allowEquivalence: true }],
            } as never)},
            ${sql.json({} as never)})
  `;
  return aq;
}

/** 시작 시각을 과거로 밀어 마감을 지나게 한다 — DB 시계로만 움직인다. */
async function backdate(attemptId: string, minutes: number): Promise<void> {
  await sql`
    update attempts set started_at = now() - make_interval(mins => ${minutes})
    where id = ${attemptId}
  `;
}

/* (assessment, learner, attempt_no)가 유일하다 — 이전 실행분이 남아 있으므로
 * 최대 회차 다음부터 센다. */
let attemptNo = 0;
async function startAttemptRow(assessmentId: string): Promise<string> {
  const id = uuidv7();
  attemptNo += 1;
  await sql`
    insert into attempts (
      id, organization_id, assessment_id, learner_id, attempt_no, status, started_at)
    values (${id}, ${ORG}, ${assessmentId}, ${LEARNER}, ${attemptNo}, 'in_progress', now())
  `;
  return id;
}

async function statusOf(attemptId: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    select status::text as status from attempts where id = ${attemptId}
  `;
  return row!.status;
}

let TIMED_AQ = "";
let UNTIMED_AQ = "";

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${LEARNER}, ${ORG}, '마감 테스트 학생', 'active')
    on conflict (id) do nothing
  `;
  TIMED_AQ = await makeAssessment(TIMED, 30);
  UNTIMED_AQ = await makeAssessment(UNTIMED, null);
  /* 앞 실행이 남긴 미제출 응시를 치운다.
   *
   * 이 테스트는 `startAttempt`를 거치지 않고 응시 행을 직접 넣는다(마감을
   * 재려면 시작 시각을 과거로 밀어야 해서다). 그래서 제품 코드의 「같은
   * 평가에 진행 중 응시는 하나」 보장을 우회하고, 제출까지 가지 않은 응시가
   * 실행마다 하나씩 남아 I-09를 어긴다 — 실측으로 22건과 11건이 쌓여 있었다.
   * 지우지 않고 `invalidated`로 내린다 — 제품이 「시작했다가 만 응시」를
   * 부르는 이름이 그것이고, 기록을 없애는 것보다 상태를 맞추는 편이 맞다.
   * 채점 결정이 붙은 응시는 건드리지 않는다(그건 잔재가 아니라 기록이다). */
  await sql`
    update attempts a
    set status = 'invalidated', updated_at = now()
    where a.assessment_id in (${TIMED}, ${UNTIMED})
      and a.status = 'in_progress'
      and not exists (
        select 1 from grade_decisions d
        join responses r on r.id = d.response_id
        where r.attempt_id = a.id
      )
  `;
  const [max] = await sql<{ n: number }[]>`
    select coalesce(max(attempt_no), 0)::int as n from attempts
    where learner_id = ${LEARNER}
  `;
  attemptNo = max?.n ?? 0;
});

afterAll(async () => {
  /* 아무것도 지우지 않는다. 응시·응답·채점 결정은 증거이고
   * grade_decisions는 append-only다 (ADR-0015). 학습자·평가를 고정 ID로
   * 재사용하므로 다음 실행이 같은 자리에 이어 쌓는다. */
});

describe.skipIf(!hasDb)("마감 전에는 그대로 저장된다", () => {
  it("시작 직후 저장은 성공한다", async () => {
    const attempt = await startAttemptRow(TIMED);
    const r = await saveResponse({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
      assessmentQuestionId: TIMED_AQ,
      answer: { kind: "short_answer", rawText: "1" },
      clientSequence: 1,
    });
    expect(r.ok).toBe(true);
    expect(await statusOf(attempt)).toBe("in_progress");
  });

  it("경계 직전(29분)은 아직 열려 있다", async () => {
    const attempt = await startAttemptRow(TIMED);
    await backdate(attempt, 29);
    const r = await saveResponse({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
      assessmentQuestionId: TIMED_AQ,
      answer: { kind: "short_answer", rawText: "2" },
      clientSequence: 1,
    });
    expect(r.ok).toBe(true);
  });

  it("제한 시간이 없는 시험은 마감이 없다", async () => {
    const attempt = await startAttemptRow(UNTIMED);
    await backdate(attempt, 600);
    const r = await saveResponse({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
      assessmentQuestionId: UNTIMED_AQ,
      answer: { kind: "short_answer", rawText: "3" },
      clientSequence: 1,
    });
    expect(r.ok).toBe(true);
  });
});

describe.skipIf(!hasDb)("마감 뒤에는 서버가 닫는다", () => {
  it("마감 후 저장은 거부되고 그 자리에서 자동 제출된다", async () => {
    /* 거부만 하고 열어 두면 응시가 in_progress로 영영 남는다 — 학생은
     * 「제출됨」을 못 보고, 교사 현황판에는 미제출로 남는다. */
    const attempt = await startAttemptRow(TIMED);
    await saveResponse({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
      assessmentQuestionId: TIMED_AQ,
      answer: { kind: "short_answer", rawText: "42" },
      clientSequence: 1,
    });
    await backdate(attempt, 31);

    const late = await saveResponse({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
      assessmentQuestionId: TIMED_AQ,
      answer: { kind: "short_answer", rawText: "999" },
      clientSequence: 2,
    });

    expect(late.ok).toBe(false);
    expect(late.message).toContain("시간");
    expect(await statusOf(attempt)).not.toBe("in_progress");

    /* 마지막 정상 저장 답안이 보존된다 — 늦은 답안이 덮어쓰지 않는다 */
    const [saved] = await sql<{ answer: { rawText: string } }[]>`
      select answer from responses where attempt_id = ${attempt}
    `;
    expect(saved!.answer.rawText).toBe("42");
  });

  it("기기 시계를 어떻게 보내도 판정은 DB 시계다", async () => {
    /* clientSequence는 순서 판정에만 쓰이고 시각 판정에는 들어가지 않는다.
     * 클라이언트가 보낼 수 있는 시간 값 자체가 이 경로에 없다. */
    const attempt = await startAttemptRow(TIMED);
    await backdate(attempt, 45);
    const r = await saveResponse({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
      assessmentQuestionId: TIMED_AQ,
      answer: { kind: "short_answer", rawText: "x" },
      clientSequence: 999_999,
    });
    expect(r.ok).toBe(false);
  });

  it("자동 제출과 수동 제출이 겹쳐도 전이는 한 번이다", async () => {
    const attempt = await startAttemptRow(TIMED);
    await saveResponse({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
      assessmentQuestionId: TIMED_AQ,
      answer: { kind: "short_answer", rawText: "42" },
      clientSequence: 1,
    });
    await backdate(attempt, 31);

    /* 저장이 자동 제출을 일으키고, 그 직후 학생이 제출 단추를 누른다 */
    await saveResponse({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
      assessmentQuestionId: TIMED_AQ,
      answer: { kind: "short_answer", rawText: "y" },
      clientSequence: 2,
    });
    const manual = await submitAndGrade({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
    });

    expect(manual.ok).toBe(false);
    expect(manual.message).toContain("이미");
    const [row] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from attempts
      where id = ${attempt} and submitted_at is not null
    `;
    expect(row!.cnt).toBe(1);
  });

  it("마감이 지난 응시는 제출 경로에서도 답안이 보존된 채 채점된다", async () => {
    const attempt = await startAttemptRow(TIMED);
    await saveResponse({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
      assessmentQuestionId: TIMED_AQ,
      answer: { kind: "short_answer", rawText: "42" },
      clientSequence: 1,
    });
    await backdate(attempt, 40);

    const r = await submitAndGrade({
      organizationId: ORG,
      attemptId: attempt,
      learnerId: LEARNER,
    });

    /* 마감이 지났다고 제출을 거부하면 학생이 푼 답안이 영영 채점되지 않는다.
     * 마감은 **더 쓰지 못하게** 하는 것이지 낸 것을 버리는 것이 아니다. */
    expect(r.ok).toBe(true);
    expect(await statusOf(attempt)).not.toBe("in_progress");
  });
});
