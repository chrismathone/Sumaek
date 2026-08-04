import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import {
  resolveGradingException,
  saveResponse,
  startAttempt,
  submitAndGrade,
} from "@/lib/domain/attempt";

/* ─────────────────────────────────────────────────────────────
 * 통합 테스트 (라이브 DB) — 인수 9:
 * 값은 맞고 단위만 다른 답 → 자동 확정 금지 → 예외함 → 교사 판정 →
 * 점수·숙련도·복습 일관 갱신.
 * 전용 픽스처를 만들고 끝나면 정리한다 (시드 데이터 오염 금지).
 * ───────────────────────────────────────────────────────────── */

const ORG_ID = "00000000-0000-7000-8000-000000000001";
const TEACHER_ID = "00000000-0000-7000-8000-0000000000a1";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("채점 예외 통합 (인수 9)", () => {
  // 연결은 beforeAll에서 만든다 — vitest는 skip된 describe의 콜백도 수집
  // 단계에서 실행하므로, 여기서 바로 부르면 DATABASE_URL이 없을 때 skip이
  // 아니라 FAIL로 보고된다.
  let sql: ReturnType<typeof getSharedSql>;
  const ids = {
    learner: uuidv7(),
    concept: uuidv7(),
    question: uuidv7(),
    version: uuidv7(),
    assessment: uuidv7(),
    aq: uuidv7(),
    right: uuidv7(),
  };
  let attemptId: string;

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into learners (id, organization_id, display_name, grade_level)
      values (${ids.learner}, ${ORG_ID}, '통합테스트 학습자', 'middle-2')
    `;
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values (${ids.concept}, ${/* uuidv7의 앞 8자는 **시각**이라 비슷한 때에 만들면 겹친다.
         * 무작위인 뒷부분을 쓴다 — 실제로 slug 유니크 위반으로 깨졌다. */
        `itest-${ids.concept.slice(-12)}`}, '통합테스트 개념', 'active', '[]'::jsonb)
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
        ${sql.json([{ type: "text", text: "물의 양을 구하시오." }] as never)},
        ${sql.json({
          kind: "short_answer",
          accepted: [{ value: "120", form: "number", unit: "g", allowEquivalence: true }],
        } as never)},
        '10', ${sql.json({ band: "mid" } as never)}, 'itest'
      )
    `;
    await sql`
      insert into assessment_instances (id, organization_id, purpose, title, learner_id, status, published_at)
      values (${ids.assessment}, ${ORG_ID}, 'formative', '통합테스트 평가', ${ids.learner}, 'published', now())
    `;
    await sql`
      insert into assessment_questions (
        id, organization_id, assessment_id, question_id, question_version_id,
        content_checksum, sort_order, points, answer_snapshot, concept_weights, selection_reason
      ) values (
        ${ids.aq}, ${ORG_ID}, ${ids.assessment}, ${ids.question}, ${ids.version},
        'itest', 1, '10',
        ${sql.json({
          kind: "short_answer",
          accepted: [{ value: "120", form: "number", unit: "g", allowEquivalence: true }],
        } as never)},
        ${sql.json({ [ids.concept]: 1 } as never)}, 'today_concept'
      )
    `;
    await sql`
      insert into assignments (id, organization_id, assessment_id, learner_id, mode, assigned_by)
      values (${uuidv7()}, ${ORG_ID}, ${ids.assessment}, ${ids.learner}, 'online', ${TEACHER_ID})
    `;
  });

  afterAll(async () => {
    // 정리하지 않는다 — mastery_evidences는 append-only 불변이라 지울 수 없고,
    // 그 부모(grade_decisions→responses→attempts→assessment_*)를 지우면
    // 고아 참조가 남는다 (verify-recovery R-01 실측). 실행마다 무작위
    // 학습자 ID를 쓰므로 잔재가 다른 실행·스펙과 간섭하지 않는다.
  });

  it("단위 누락 답 → 예외함 → 교사 정답 판정 → 점수·숙련도 갱신", async () => {
    /* 1) 응시 시작 */
    const started = await startAttempt({
      organizationId: ORG_ID,
      assessmentId: ids.assessment,
      learnerId: ids.learner,
      today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
    });
    expect("attemptId" in started).toBe(true);
    if (!("attemptId" in started)) return;
    attemptId = started.attemptId;

    /* 2) 값은 맞고 단위 없는 답 저장 */
    const saved = await saveResponse({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      attemptId,
      assessmentQuestionId: ids.aq,
      answer: { kind: "short_answer", rawText: "120" },
      clientSequence: 1,
    });
    expect(saved.ok).toBe(true);

    /* 3) 제출 — 자동 오답 확정 금지, 예외함으로 */
    const submitted = await submitAndGrade({
      organizationId: ORG_ID,
      attemptId,
      learnerId: ids.learner,
    });
    expect(submitted.ok).toBe(true);
    expect(submitted.attemptStatus).toBe("review_required");
    expect(submitted.needsReview).toBe(1);

    const [exception] = await sql<{ id: string; kind: string }[]>`
      select id, kind from grading_exceptions
      where attempt_id = ${attemptId} and status = 'open'
    `;
    expect(exception?.kind).toBe("format_mismatch");

    // 이 시점에 점수는 확정되지 않았다
    const [beforeAttempt] = await sql<{ total_score: string | null }[]>`
      select total_score::text from attempts where id = ${attemptId}
    `;
    expect(Number(beforeAttempt?.total_score ?? 0)).toBe(0);

    /* 4) 멱등: 같은 응시 재제출은 거부된다 (불변 조건 9) */
    const resubmit = await submitAndGrade({
      organizationId: ORG_ID,
      attemptId,
      learnerId: ids.learner,
    });
    expect(resubmit.ok).toBe(false);

    /* 5) 교사 판정: 정답 확정 */
    const resolved = await resolveGradingException({
      organizationId: ORG_ID,
      exceptionId: exception?.id as string,
      resolverUserId: TEACHER_ID,
      verdict: "correct",
      note: "값이 정확하고 단위는 문항 맥락상 명확 — 정답 인정",
    });
    expect(resolved.ok).toBe(true);

    /* 6) 일관 갱신 검증 */
    const [afterAttempt] = await sql<
      { status: string; total_score: string | null }[]
    >`
      select status, total_score::text from attempts where id = ${attemptId}
    `;
    expect(afterAttempt?.status).toBe("finalized");
    expect(Number(afterAttempt?.total_score)).toBe(10);

    const [evidence] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from mastery_evidences
      where learner_id = ${ids.learner} and concept_id = ${ids.concept}
    `;
    expect(evidence?.cnt).toBe(1); // 최종 결정당 정확히 1회 (불변 조건 10)

    const [mastery] = await sql<
      { state: string; point_estimate: string | null }[]
    >`
      select state, point_estimate::text from concept_masteries
      where learner_id = ${ids.learner} and concept_id = ${ids.concept}
    `;
    expect(mastery?.state).toBe("exploring"); // 증거 1건 — 확정 금지 (원칙 14)
    expect(Number(mastery?.point_estimate)).toBe(1);

    // 정답이므로 복습 항목은 없다
    const [reviews] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from review_items where learner_id = ${ids.learner}
    `;
    expect(reviews?.cnt).toBe(0);

    // 감사 로그에 판정 기록
    const [audit] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from audit_events
      where organization_id = ${ORG_ID} and action = 'grading.resolve-exception'
    `;
    expect(audit?.cnt).toBeGreaterThan(0);
  });
});
