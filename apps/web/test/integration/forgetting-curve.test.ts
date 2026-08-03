import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { saveResponse, startAttempt, submitAndGrade } from "@/lib/domain/attempt";
import { answerReview, listDueReviews } from "@/lib/domain/review";

/* ─────────────────────────────────────────────────────────────
 * 망각곡선 복습 — 라이브 DB 통합.
 *
 * 순수 함수는 `packages/core/test/mastery/forgetting.test.ts`가 덮는다.
 * 여기서 겨누는 것은 **그 계산이 실제로 DB에 반영되는가**다. 이 사슬은
 * 예전에 통째로 죽어 있었다:
 *   - 복습 항목이 전부 `interval_days = 1`로만 태어났고
 *   - 학생이 맞히면 그냥 닫혀 간격이 자랄 기회가 없었으며
 *   - 틀리면 언제나 `today + 1`이었다
 *
 * 그래서 단언의 중심은 "간격이 **자란다**"와 "정책이 실제로 쓰인다"이다.
 * ───────────────────────────────────────────────────────────── */

const ORG_ID = "00000000-0000-7000-8000-000000000001";
const TEACHER_ID = "00000000-0000-7000-8000-0000000000a1";
const hasDb = Boolean(process.env.DATABASE_URL);
const TZ = "Asia/Seoul";
/* 개념은 **고정 id**로 재사용한다. 실행마다 새로 만들면 canonical_concepts에
 * 영영 쌓인다 — 이 테스트가 남긴 증거(mastery_evidences)가 불변이라 정리
 * 스크립트가 지울 수 없기 때문이다(실측: itest 개념 126건이 그렇게 쌓여
 * 교사의 개념 선택 드롭다운을 덮었다). 학습자는 실행마다 새로 만든다 —
 * 복습 항목 조회가 학습자로 좁혀지므로 재실행이 서로를 밟지 않는다. */
const FIXTURE_CONCEPT_ID = "00000000-0000-7000-8000-0000000000fc";

function isoAddDays(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

describe.skipIf(!hasDb)("망각곡선 복습 (라이브 DB)", () => {
  let sql: ReturnType<typeof getSharedSql>;
  const ids = {
    learner: uuidv7(),
    concept: FIXTURE_CONCEPT_ID,
    right: uuidv7(),
    question: uuidv7(),
    version: uuidv7(),
    assessment: uuidv7(),
    aq: uuidv7(),
  };
  let reviewItemId: string;

  const ANSWER = {
    kind: "short_answer",
    accepted: [{ value: "7", form: "number", allowEquivalence: true }],
  };

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into learners (id, organization_id, display_name, grade_level)
      values (${ids.learner}, ${ORG_ID}, '통합테스트 학습자', 'middle-2')
    `;
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values (${ids.concept}, 'itest-forgetting-curve', '통합테스트 개념 (망각곡선)', 'active', '[]'::jsonb)
      on conflict (id) do nothing
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${ids.right}, ${ORG_ID}, '통합테스트', 'usable')
    `;
    await sql`
      insert into questions (id, organization_id, kind, review_status, content_right_id, is_auto_assignable, current_version_id)
      values (${ids.question}, ${ORG_ID}, 'short_answer', 'published', ${ids.right}, true, ${ids.version})
    `;
    await sql`
      insert into question_versions (id, organization_id, question_id, version_number, body, answer, points, difficulty, content_checksum)
      values (
        ${ids.version}, ${ORG_ID}, ${ids.question}, 1,
        ${sql.json([{ type: "text", text: "3 + 4 는?" }] as never)},
        ${sql.json(ANSWER as never)}, '10',
        ${sql.json({ band: "mid" } as never)}, 'itest-fc'
      )
    `;
    await sql`
      insert into assessment_instances (id, organization_id, purpose, title, learner_id, status, scheduled_date, published_at)
      values (${ids.assessment}, ${ORG_ID}, 'formative', '통합테스트 망각곡선', ${ids.learner}, 'published', ${TODAY}::date, now())
    `;
    await sql`
      insert into assessment_questions (
        id, organization_id, assessment_id, question_id, question_version_id,
        content_checksum, sort_order, points, answer_snapshot, concept_weights, selection_reason
      ) values (
        ${ids.aq}, ${ORG_ID}, ${ids.assessment}, ${ids.question}, ${ids.version},
        'itest-fc', 1, '10', ${sql.json(ANSWER as never)},
        ${sql.json({ [ids.concept]: 1 } as never)}, 'today_concept'
      )
    `;
    await sql`
      insert into assignments (id, organization_id, assessment_id, learner_id, mode, assigned_by)
      values (${uuidv7()}, ${ORG_ID}, ${ids.assessment}, ${ids.learner}, 'online', ${TEACHER_ID})
    `;

    // 오답 제출 → 복습 항목 생성
    const started = await startAttempt({
      organizationId: ORG_ID,
      assessmentId: ids.assessment,
      learnerId: ids.learner,
      today: TODAY,
    });
    if (!("attemptId" in started)) throw new Error("응시 시작 실패");
    await saveResponse({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      attemptId: started.attemptId,
      assessmentQuestionId: ids.aq,
      answer: { kind: "short_answer", rawText: "999" },
      clientSequence: 1,
    });
    await submitAndGrade({
      organizationId: ORG_ID,
      attemptId: started.attemptId,
      learnerId: ids.learner,
    });
  });

  afterAll(async () => {
    // 증거 계열은 불변이라 지우지 않는다 (다른 통합 테스트와 같은 이유).
  });

  it("오답이 만든 복습에 안정성이 기록된다 — 예전에는 interval_days=1뿐이었다", async () => {
    const [row] = await sql<
      {
        id: string;
        stability_days: string | null;
        repetition_no: number;
        lapse_count: number;
        due_on: string;
        interval_days: number | null;
      }[]
    >`
      select id::text, stability_days::text as stability_days, repetition_no,
             lapse_count, due_on::text as due_on, interval_days
      from review_items
      where organization_id = ${ORG_ID} and learner_id = ${ids.learner}
        and concept_id = ${ids.concept}
    `;
    expect(row).toBeDefined();
    reviewItemId = row!.id;
    expect(Number(row!.stability_days)).toBeGreaterThan(0);
    expect(row!.repetition_no).toBe(0);
    expect(row!.lapse_count).toBe(0);
    expect(row!.due_on).toBe(isoAddDays(TODAY, 1));
  });

  it("맞히면 간격이 자란다 — 이 사슬이 예전에는 통째로 죽어 있었다", async () => {
    // 기한을 오늘로 당겨 풀 수 있게 한다 (초기 간격이 내일이라)
    await sql`
      update review_items set due_on = ${TODAY}::date where id = ${reviewItemId}
    `;
    const before = await sql<{ s: string | null; d: string }[]>`
      select stability_days::text as s, due_on::text as d from review_items where id = ${reviewItemId}
    `;

    const result = await answerReview({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      reviewItemId,
      answer: { kind: "short_answer", rawText: "7" },
      today: TODAY,
    });
    expect(result.ok).toBe(true);
    expect(result.correct).toBe(true);

    const [after] = await sql<
      {
        s: string | null;
        d: string;
        status: string;
        rep: number;
        last: string | null;
        interval_days: number | null;
      }[]
    >`
      select stability_days::text as s, due_on::text as d, status::text as status,
             repetition_no as rep, last_reviewed_on::text as last, interval_days
      from review_items where id = ${reviewItemId}
    `;
    expect(Number(after!.s)).toBeGreaterThan(Number(before[0]!.s));
    // **닫히지 않는다** — 닫으면 늘어난 간격이 영영 쓰이지 않는다
    expect(after!.status).toBe("scheduled");
    expect(after!.d > TODAY).toBe(true);
    expect(after!.rep).toBe(1);
    expect(after!.last).toBe(TODAY);
    expect(after!.interval_days).toBeGreaterThan(1);
  });

  it("간격이 자란 항목은 오늘 할 복습에서 빠진다", async () => {
    const due = await listDueReviews({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      today: TODAY,
    });
    expect(due.some((r) => r.id === reviewItemId)).toBe(false);
  });

  it("틀리면 간격이 줄고 놓친 횟수가 늘어난다", async () => {
    await sql`update review_items set due_on = ${TODAY}::date where id = ${reviewItemId}`;
    const [before] = await sql<{ s: string | null; lapse: number }[]>`
      select stability_days::text as s, lapse_count as lapse from review_items where id = ${reviewItemId}
    `;

    const result = await answerReview({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      reviewItemId,
      answer: { kind: "short_answer", rawText: "999" },
      today: TODAY,
    });
    expect(result.ok).toBe(true);
    expect(result.correct).toBe(false);
    // 학생에게 "내일"이라고 거짓말하지 않는다 — 실제 날짜를 말한다
    expect(result.message).toContain("다시 올라옵니다");

    const [after] = await sql<{ s: string | null; lapse: number; status: string }[]>`
      select stability_days::text as s, lapse_count as lapse, status::text as status
      from review_items where id = ${reviewItemId}
    `;
    expect(Number(after!.s)).toBeLessThan(Number(before!.s));
    expect(after!.lapse).toBe(before!.lapse + 1);
    expect(after!.status).toBe("scheduled");
  });

  it("정책의 상한이 실제로 지켜진다 — 어떤 이력으로도 한 달을 넘지 않는다", async () => {
    // 안정성을 상한 근처로 올려 두고 여러 번 맞혀도 넘지 않는지
    await sql`
      update review_items
      set stability_days = 25, due_on = ${TODAY}::date, status = 'scheduled'
      where id = ${reviewItemId}
    `;
    for (let i = 0; i < 3; i++) {
      await sql`update review_items set due_on = ${TODAY}::date, status = 'scheduled' where id = ${reviewItemId}`;
      await answerReview({
        organizationId: ORG_ID,
        learnerId: ids.learner,
        reviewItemId,
        answer: { kind: "short_answer", rawText: "7" },
        today: TODAY,
      });
      const [row] = await sql<{ s: string | null; interval_days: number | null }[]>`
        select stability_days::text as s, interval_days from review_items where id = ${reviewItemId}
      `;
      expect(Number(row!.s)).toBeLessThanOrEqual(30);
      expect(row!.interval_days ?? 0).toBeLessThanOrEqual(30);
    }
  });

  it("상한에 도달하면 졸업한다 — 영원히 도는 복습은 복습이 아니다", async () => {
    const [row] = await sql<{ status: string; interval_days: number | null }[]>`
      select status::text as status, interval_days from review_items where id = ${reviewItemId}
    `;
    expect(row!.interval_days).toBe(30);
    expect(row!.status).toBe("completed");
  });

  it("남의 복습은 풀 수 없다 (learner 스코프)", async () => {
    const other = uuidv7();
    await sql`
      insert into learners (id, organization_id, display_name, grade_level)
      values (${other}, ${ORG_ID}, '통합테스트 학습자', 'middle-2')
    `;
    const result = await answerReview({
      organizationId: ORG_ID,
      learnerId: other,
      reviewItemId,
      answer: { kind: "short_answer", rawText: "7" },
      today: TODAY,
    });
    expect(result.ok).toBe(false);
  });

  /* ── 채점이 학생의 복습 흔적을 덮지 않는다 ──
   *
   * 이 저장소의 두 단언이 각각은 통과하면서 **이어 붙이면 결함**이 되던
   * 자리다. (1) 위 「간격이 자란 항목」은 복습이 status='scheduled'로
   * 남는다고 단언하고, (2) learner-flow는 채점이 바로 그 상태의 행을
   * 닫는다고 단언한다. 둘을 이으면 — 학생이 복습한 뒤 같은 개념을 채점으로
   * 맞히면 — outcome이 통째로 치환되고 last_reviewed_on이 채점일로 옮겨져
   * 학생이 복습한 날이 DB 어디에도 남지 않았다. answerReview는 outbox도
   * audit도 쓰지 않으므로 그 두 컬럼이 유일한 기록이다. 지난 기록 화면은
   * closedBy='learner_review'로 거르므로 복습이 화면에서 아예 사라졌다.
   *
   * 「교사가 채점해야 터진다」가 아니다 — 주경로는 **학생 자신의 다음 제출**이
   * 자동 채점되는 것이다. */
  it("학생이 복습한 날과 closedBy는 이후 채점이 덮지 않는다", async () => {
    const reviewedOn = isoAddDays(TODAY, -3);
    await sql`
      update review_items
      set status = 'scheduled', completed_at = null,
          due_on = ${TODAY}::date,
          last_reviewed_on = ${reviewedOn}::date,
          outcome = ${sql.json({ closedBy: "learner_review", correct: true } as never)}
      where id = ${reviewItemId}
    `;

    /* 같은 개념을 채점으로 맞힌다 — 밀린 복습을 닫는 바로 그 경로.
     * beforeAll의 응시는 이미 제출됐고 submitAndGrade는 멱등이라(같은 결과를
     * 되돌려 줄 뿐 채점을 다시 돌지 않는다) 전용 평가를 새로 만든다. */
    const fresh = { assessment: uuidv7(), aq: uuidv7() };
    await sql`
      insert into assessment_instances (id, organization_id, purpose, title, learner_id, status, scheduled_date, published_at)
      values (${fresh.assessment}, ${ORG_ID}, 'formative', '통합테스트 복습보존', ${ids.learner}, 'published', ${TODAY}::date, now())
    `;
    await sql`
      insert into assessment_questions (
        id, organization_id, assessment_id, question_id, question_version_id,
        content_checksum, sort_order, points, answer_snapshot, concept_weights, selection_reason
      ) values (
        ${fresh.aq}, ${ORG_ID}, ${fresh.assessment}, ${ids.question}, ${ids.version},
        'itest-fc', 1, '10', ${sql.json(ANSWER as never)},
        ${sql.json({ [ids.concept]: 1 } as never)}, 'today_concept'
      )
    `;
    await sql`
      insert into assignments (id, organization_id, assessment_id, learner_id, mode, assigned_by)
      values (${uuidv7()}, ${ORG_ID}, ${fresh.assessment}, ${ids.learner}, 'online', ${TEACHER_ID})
    `;

    const started = await startAttempt({
      organizationId: ORG_ID,
      assessmentId: fresh.assessment,
      learnerId: ids.learner,
      today: TODAY,
    });
    if (!("attemptId" in started)) throw new Error("응시 시작 실패");
    await saveResponse({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      attemptId: started.attemptId,
      assessmentQuestionId: fresh.aq,
      answer: { kind: "short_answer", rawText: "7" },
      clientSequence: 1,
    });
    await submitAndGrade({
      organizationId: ORG_ID,
      attemptId: started.attemptId,
      learnerId: ids.learner,
    });

    const [row] = await sql<
      {
        status: string;
        last: string | null;
        closed_by: string | null;
        graded_close: string | null;
        graded_on: string | null;
      }[]
    >`
      select status::text as status, last_reviewed_on::text as last,
             outcome ->> 'closedBy' as closed_by,
             outcome -> 'gradedClose' ->> 'closedBy' as graded_close,
             outcome ->> 'gradedOn' as graded_on
      from review_items where id = ${reviewItemId}
    `;

    // 닫히는 것 자체는 그대로다 — 안 닫으면 「복습 예정 N건」이 영영 자란다
    expect(row!.status).toBe("completed");
    // 학생의 흔적은 그대로 (이 둘이 무너지면 지난 기록에서 복습이 사라진다)
    expect(row!.last).toBe(reviewedOn);
    expect(row!.closed_by).toBe("learner_review");
    // 채점 정보는 지우지 않고 곁에 얹는다
    expect(row!.graded_close).toBe("graded_response");
    expect(row!.graded_on).toBe(TODAY);
  });
});
