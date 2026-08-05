import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 서른 명이 같은 순간에 제출한다 (T6.3).
 *
 * 이것이 실제로 일어나는 순간은 정확히 하나다: 수업 종료 정각. 선생님이
 * 「그만」이라고 말하고 반 전체가 동시에 제출 버튼을 누른다. 그 순간에
 * 하나라도 유실되면 그 학생은 시험을 다시 봐야 하고, 하나라도 두 번 채점되면
 * 성적이 뒤집힌다.
 *
 * ── 이 테스트가 재는 것과 재지 않는 것 ─────────────────────
 * 재는 것: 제출·채점 **도메인 경로**의 정확성과 지연. 30개 트랜잭션이 같은
 * 평가를 두고 겹칠 때 유실·중복·교착이 없는가.
 *
 * 재지 **않는** 것: HTTP·Next 서버 액션·직렬화·네트워크. 그것까지 포함한
 * 수치는 k6가 낸다(scripts/load/). 여기 p95를 L-02(1초)와 나란히 두는 것은
 * **하한**으로서다 — 도메인 경로만으로 이미 1초를 넘으면 HTTP를 얹은 실제
 * 값은 반드시 넘는다. 통과했다고 SLO를 만족한다는 뜻은 아니다.
 *
 * 지연 수치를 임계값으로 걸지 않는다. 개발기·공유 DB·네트워크 왕복이 섞인
 * 값이라 그것으로 빌드를 깨면 「환경이 느린 날」에 빨간불이 켜지고, 그러면
 * 사람들은 임계값을 올린다. 대신 **정확성**을 임계값으로 걸고 지연은
 * 기록해서 보여 준다.
 *
 * 응시·응답·채점 결정은 증거라 지울 수 없다(grade_decisions는 append-only,
 * ADR-0015). 그래서 고정 ID를 재사용하고 회차를 이어 쌓는다.
 * ───────────────────────────────────────────────────────────── */

const { getSharedSql } = await import("@su-maek/db");
const { submitAndGrade } = await import("@/lib/domain/attempt");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";

/** 한 반의 크기 — 인수 조건이 정한 수 */
const CLASS_SIZE = 30;

/** 고정 ID. 실행마다 새로 만들면 지울 수 없는 행이 사라진 학습자를 가리킨다. */
const ASSESSMENT = "ffffffff-0000-7000-8000-000000063101";
const LEARNER_PREFIX = "ffffffff-0000-7000-8000-0000006320";

let sql: ReturnType<typeof getSharedSql>;
let assessmentQuestionId = "";
const learners: string[] = [];

/** 학습자 30명의 고정 ID — 접미사 두 자리 */
function learnerId(index: number): string {
  return `${LEARNER_PREFIX}${String(index).padStart(2, "0")}`;
}

/* 체크섬까지 가져온다 — 픽스처가 불변 조건을 어기지 않게 (I-08). 아무
 * 문자열을 넣으면 스냅샷과 원본이 달라져 `pnpm verify:recovery`에 위반이
 * 실행마다 쌓인다. */
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

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();

  for (let i = 0; i < CLASS_SIZE; i++) {
    const id = learnerId(i);
    learners.push(id);
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${id}, ${ORG}, ${`ITEST 동시제출 ${i + 1}`}, 'active')
      on conflict (id) do nothing
    `;
  }

  const { qid, vid, checksum } = await pickQuestionVersion();
  await sql`
    insert into assessment_instances (
      id, organization_id, purpose, title, scheduled_date, status, published_at)
    values (${ASSESSMENT}, ${ORG}, 'formative', 'ITEST 동시 제출',
            current_date, 'published', now())
    on conflict (id) do update set
      scheduled_date = current_date,
      published_at = coalesce(assessment_instances.published_at, now())
  `;
  /* 앞 실행이 중간에 죽어 남긴 미제출 응시를 치운다 — 같은 평가·학습자에
   * 진행 중 응시가 둘이면 I-09 위반이다. 지우지 않고 `invalidated`로 내린다
   * (제품이 「시작했다가 만 응시」를 부르는 이름). 채점 결정이 붙은 것은
   * 건드리지 않는다. */
  await sql`
    update attempts a
    set status = 'invalidated', updated_at = now()
    where a.assessment_id = ${ASSESSMENT} and a.status = 'in_progress'
      and not exists (
        select 1 from grade_decisions d
        join responses r on r.id = d.response_id
        where r.attempt_id = a.id
      )
  `;
  const [existingQuestion] = await sql<{ id: string }[]>`
    select id::text from assessment_questions where assessment_id = ${ASSESSMENT} limit 1
  `;
  if (existingQuestion) {
    assessmentQuestionId = existingQuestion.id;
  } else {
    assessmentQuestionId = uuidv7();
    await sql`
      insert into assessment_questions (
        id, organization_id, assessment_id, question_id, question_version_id,
        content_checksum, sort_order, points, selection_reason,
        answer_snapshot, concept_weights)
      values (${assessmentQuestionId}, ${ORG}, ${ASSESSMENT}, ${qid}, ${vid},
              ${checksum}, 1, 10, 'itest',
              ${sql.json({
                kind: "short_answer",
                accepted: [{ value: "42", form: "number", allowEquivalence: true }],
              } as never)},
              ${sql.json({} as never)})
    `;
  }
});

afterAll(() => {
  /* 아무것도 지우지 않는다 — 위 주석 참고. 고정 ID라 다음 실행이 이어 쌓는다. */
});

/** 이번 실행의 회차. (평가·학습자·회차)가 유일하므로 앞 실행 다음부터 센다. */
async function nextAttemptNo(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select coalesce(max(attempt_no), 0)::int as n from attempts
    where assessment_id = ${ASSESSMENT}
  `;
  return (row?.n ?? 0) + 1;
}

interface Measured {
  learnerId: string;
  attemptId: string;
  ok: boolean;
  message: string;
  ms: number;
}

describe.skipIf(!hasDb)("반 전체가 같은 순간에 제출한다", () => {
  let measured: Measured[] = [];
  let attemptNo = 0;

  beforeAll(async () => {
    attemptNo = await nextAttemptNo();

    /* 응시를 먼저 세운다 — 30개를 한꺼번에 넣고 각자 답을 하나씩 적는다.
     * 준비 단계는 겹치지 않게 순차로 한다: 재려는 것은 **제출**의 경합이지
     * 준비의 경합이 아니다. */
    const attempts: Array<{ learnerId: string; attemptId: string }> = [];
    for (const learner of learners) {
      const attemptId = uuidv7();
      await sql`
        insert into attempts (
          id, organization_id, assessment_id, learner_id, attempt_no,
          status, started_at)
        values (${attemptId}, ${ORG}, ${ASSESSMENT}, ${learner}, ${attemptNo},
                'in_progress', now())
      `;
      await sql`
        insert into responses (
          id, organization_id, attempt_id, assessment_question_id,
          answer, saved_sequence, saved_at)
        values (${uuidv7()}, ${ORG}, ${attemptId}, ${assessmentQuestionId},
                ${sql.json({ kind: "short_answer", rawText: "42" } as never)}, 1, now())
      `;
      attempts.push({ learnerId: learner, attemptId });
    }

    /* 여기서만 겹친다. Promise.all이 30개 트랜잭션을 같은 창에 밀어 넣는다. */
    measured = await Promise.all(
      attempts.map(async ({ learnerId: id, attemptId }) => {
        const started = performance.now();
        try {
          const result = await submitAndGrade({
            organizationId: ORG,
            attemptId,
            learnerId: id,
          });
          return {
            learnerId: id,
            attemptId,
            ok: result.ok,
            message: result.message,
            ms: performance.now() - started,
          };
        } catch (error) {
          return {
            learnerId: id,
            attemptId,
            ok: false,
            message: `던짐: ${(error as Error).message}`,
            ms: performance.now() - started,
          };
        }
      }),
    );
  });

  it("서른 건 전부 접수된다 — 유실 0건", () => {
    const failed = measured.filter((m) => !m.ok);
    /* 실패를 수로만 세면 무엇이 틀렸는지 알 수 없다 — 메시지를 그대로 낸다 */
    expect(failed.map((f) => `${f.learnerId}: ${f.message}`)).toEqual([]);
  });

  it("아무도 예외로 죽지 않는다 — 경합이 오류 화면이 되지 않는다", () => {
    expect(measured.filter((m) => m.message.startsWith("던짐:"))).toEqual([]);
  });

  it("응시는 각자 한 번만 제출로 전이된다", async () => {
    const rows = await sql<{ status: string; cnt: number }[]>`
      select status::text as status, count(*)::int as cnt from attempts
      where assessment_id = ${ASSESSMENT} and attempt_no = ${attemptNo}
      group by status
    `;
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.cnt]));
    /* in_progress가 남아 있으면 그 학생의 제출이 삼켜진 것이다 */
    expect(byStatus["in_progress"] ?? 0).toBe(0);
    const done = Object.entries(byStatus)
      .filter(([s]) => s !== "in_progress")
      .reduce((sum, [, n]) => sum + n, 0);
    expect(done).toBe(CLASS_SIZE);
  });

  it("채점 결정도 응시당 하나다 — 성적이 두 번 매겨지지 않는다", async () => {
    /* grade_decisions는 append-only라 잘못 쌓이면 되돌릴 수 없다 (ADR-0015).
     * 여기서 새는 것은 나중에 고칠 수 없는 종류의 오류다. */
    /* 채점 결정은 **응답**에 매달린다(response_id) — 응시가 아니다. 응시당
     * 하나인지 보려면 응답을 거쳐 되짚어야 한다. 이번 실행은 학생마다
     * 응답이 하나이므로 응시 수와 최종 결정 수가 같아야 한다. */
    const [row] = await sql<{ attempts_with_final: number; finals: number }[]>`
      select count(distinct r.attempt_id)::int as attempts_with_final,
             count(*)::int as finals
      from grade_decisions d
      join responses r on r.id = d.response_id
      join attempts a on a.id = r.attempt_id
      where a.assessment_id = ${ASSESSMENT} and a.attempt_no = ${attemptNo}
        and d.is_final = true
    `;
    expect(row!.attempts_with_final).toBe(CLASS_SIZE);
    expect(row!.finals).toBe(CLASS_SIZE);
  });

  it("지연을 기록한다 — 임계값이 아니라 관측값이다", () => {
    const sorted = measured.map((m) => m.ms).sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
    const summary = {
      n: sorted.length,
      p50: Math.round(at(0.5)),
      p95: Math.round(at(0.95)),
      max: Math.round(sorted[sorted.length - 1]!),
    };
    /* 콘솔로 남긴다. 개발기·공유 DB·네트워크 왕복이 섞인 값이라 임계값으로
     * 걸면 「환경이 느린 날」에 빨간불이 켜지고, 그러면 사람들은 임계값을
     * 올린다 — 그 순간 이 줄은 아무것도 지키지 않게 된다. */
    console.log(
      `[동시 제출] ${summary.n}건 · p50 ${summary.p50}ms · p95 ${summary.p95}ms · 최대 ${summary.max}ms` +
        `  (도메인 경로만 — HTTP 제외. L-02 p95 1,000ms의 하한)`,
    );
    /* 재는 것이 실제로 재졌는지만 본다 — 0ms면 측정이 안 된 것이다 */
    expect(summary.n).toBe(CLASS_SIZE);
    expect(summary.p95).toBeGreaterThan(0);
  });

  it("한 번 더 제출해도 두 번 채점되지 않는다", async () => {
    /* 학생이 제출 버튼을 두 번 누르거나, 자동 제출과 수동 제출이 겹치는 경우.
     * 앞의 「접수」와 달리 여기서는 **이미 낸 뒤**를 본다. */
    const [first] = measured;
    const again = await submitAndGrade({
      organizationId: ORG,
      attemptId: first!.attemptId,
      learnerId: first!.learnerId,
    });
    /* 실패로 돌려주든 성공으로 돌려주든 상관없다 — 채점이 하나면 된다 */
    expect(again).toBeDefined();
    const [row] = await sql<{ finals: number }[]>`
      select count(*)::int as finals from grade_decisions d
      join responses r on r.id = d.response_id
      where r.attempt_id = ${first!.attemptId} and d.is_final = true
    `;
    expect(row!.finals).toBe(1);
  });
});
