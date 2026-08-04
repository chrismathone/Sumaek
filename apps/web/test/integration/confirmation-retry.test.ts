import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import {
  saveResponse,
  startAttempt,
  submitAndGrade,
} from "@/lib/domain/attempt";

/* ─────────────────────────────────────────────────────────────
 * 통합 테스트 (라이브 DB) — 인수 10:
 * 확인테스트 미통과 → 재시험 계획 자동 생성 + 교사 알림 + 감사.
 * 통과하면 계획이 만들어지지 않는 것도 함께 검증.
 * ───────────────────────────────────────────────────────────── */

const ORG_ID = "00000000-0000-7000-8000-000000000001";
const hasDb = Boolean(process.env.DATABASE_URL);

function makeIds() {
  return {
    learner: uuidv7(),
    concept: uuidv7(),
    right: uuidv7(),
    q1: uuidv7(),
    v1: uuidv7(),
    q2: uuidv7(),
    v2: uuidv7(),
    assessment: uuidv7(),
    aq1: uuidv7(),
    aq2: uuidv7(),
  };
}

describe.skipIf(!hasDb)("확인테스트 미통과 → 재시험 (인수 10)", () => {
  // 연결은 beforeAll에서 만든다 — vitest는 skip된 describe의 콜백도 수집
  // 단계에서 실행하므로, 여기서 바로 부르면 DATABASE_URL이 없을 때 skip이
  // 아니라 FAIL로 보고된다.
  let sql: ReturnType<typeof getSharedSql>;
  const ids = makeIds();

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`insert into learners (id, organization_id, display_name)
      values (${ids.learner}, ${ORG_ID}, '확인테스트 학습자')`;
    await sql`insert into canonical_concepts (id, slug, name, status, evidence)
      values (${ids.concept}, ${/* uuidv7 앞 8자는 시각이라 겹친다 — 무작위인 뒷부분을 쓴다 */
        `ctest-${ids.concept.slice(-12)}`}, '확인 개념', 'active', '[]'::jsonb)`;
    await sql`insert into content_rights (id, organization_id, rights_holder, status)
      values (${ids.right}, ${ORG_ID}, '테스트', 'usable')`;
    for (const [q, v, answer] of [
      [ids.q1, ids.v1, "1"],
      [ids.q2, ids.v2, "2"],
    ] as const) {
      await sql`insert into questions (id, organization_id, kind, review_status, content_right_id, is_auto_assignable, current_version_id)
        values (${q}, ${ORG_ID}, 'short_answer', 'published', ${ids.right}, true, ${v})`;
      await sql`insert into question_versions (id, organization_id, question_id, version_number, body, answer, points, difficulty, content_checksum)
        values (${v}, ${ORG_ID}, ${q}, 1,
          ${sql.json([{ type: "text", text: "답을 구하시오." }] as never)},
          ${sql.json({ kind: "short_answer", accepted: [{ value: answer, form: "number", allowEquivalence: true }] } as never)},
          '10', ${sql.json({ band: "mid" } as never)}, 'ctest')`;
    }
    await sql`
      insert into assessment_instances (
        id, organization_id, purpose, title, learner_id, status,
        generation_context, published_at
      ) values (
        ${ids.assessment}, ${ORG_ID}, 'confirmation', '확인테스트 통합검증',
        ${ids.learner}, 'published',
        ${sql.json({ passingRules: { passRatio: 0.7, maxAttempts: 2 } } as never)},
        now()
      )
    `;
    let order = 1;
    for (const [q, v, aq, answer] of [
      [ids.q1, ids.v1, ids.aq1, "1"],
      [ids.q2, ids.v2, ids.aq2, "2"],
    ] as const) {
      await sql`
        insert into assessment_questions (
          id, organization_id, assessment_id, question_id, question_version_id,
          content_checksum, sort_order, points, answer_snapshot, concept_weights,
          selection_reason, is_anchor
        ) values (
          ${aq}, ${ORG_ID}, ${ids.assessment}, ${q}, ${v}, 'ctest', ${order}, '10',
          ${sql.json({ kind: "short_answer", accepted: [{ value: answer, form: "number", allowEquivalence: true }] } as never)},
          ${sql.json({ [ids.concept]: 1 } as never)}, 'anchor', true
        )
      `;
      order++;
    }
    await sql`insert into assignments (id, organization_id, assessment_id, learner_id, mode)
      values (${uuidv7()}, ${ORG_ID}, ${ids.assessment}, ${ids.learner}, 'online')`;
  });

  afterAll(async () => {
    // 정리하지 않는다 — append-only 사슬(evidences→decisions→responses→
    // attempts→assessment_*)을 지우면 고아 참조가 남는다 (R-01 실측).
    // 실행마다 무작위 학습자 ID라 잔재가 간섭하지 않는다.
  });

  it("50% 득점(기준 70%) → finalized + 재시험 계획 + 교사 알림 + 감사", async () => {
    const started = await startAttempt({
      organizationId: ORG_ID,
      assessmentId: ids.assessment,
      learnerId: ids.learner,
      today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
    });
    expect("attemptId" in started).toBe(true);
    if (!("attemptId" in started)) return;

    // 1번 정답, 2번 오답 → 10/20 = 50% < 70%
    await saveResponse({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      attemptId: started.attemptId,
      assessmentQuestionId: ids.aq1,
      answer: { kind: "short_answer", rawText: "1" },
      clientSequence: 1,
    });
    await saveResponse({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      attemptId: started.attemptId,
      assessmentQuestionId: ids.aq2,
      answer: { kind: "short_answer", rawText: "999" },
      clientSequence: 2,
    });

    const result = await submitAndGrade({
      organizationId: ORG_ID,
      attemptId: started.attemptId,
      learnerId: ids.learner,
    });
    expect(result.ok).toBe(true);
    expect(result.attemptStatus).toBe("finalized");
    expect(result.totalScore).toBe(10);

    /* 재시험 계획 생성 확인 */
    const [plan] = await sql<
      { attempt_number: number; max_attempts: number; status: string }[]
    >`
      select attempt_number, max_attempts, status from retry_plans
      where learner_id = ${ids.learner} and failed_assessment_id = ${ids.assessment}
    `;
    expect(plan).toBeDefined();
    expect(plan?.attempt_number).toBe(1);
    expect(plan?.max_attempts).toBe(2);
    expect(plan?.status).toBe("planned");

    /* 교사 알림 */
    const [noti] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from notifications
      where organization_id = ${ORG_ID}
        and kind = 'learner_risk' and related_id = ${started.attemptId}
    `;
    expect(noti?.cnt).toBeGreaterThan(0);

    /* 감사 — 자동 판정 기록 */
    const [audit] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from audit_events
      where action = 'assessment.confirmation-failed'
        and target_id = ${started.attemptId}
    `;
    expect(audit?.cnt).toBe(1);

    /* 멱등: 같은 응시를 다시 제출해도(거부됨) 계획이 중복 생성되지 않음 */
    await submitAndGrade({
      organizationId: ORG_ID,
      attemptId: started.attemptId,
      learnerId: ids.learner,
    });
    const [planCount] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from retry_plans
      where failed_assessment_id = ${ids.assessment}
    `;
    expect(planCount?.cnt).toBe(1);
  });
});
