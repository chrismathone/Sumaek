import "server-only";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql, type TransactionSql } from "@su-maek/db";
import { answerKey, studentAnswer, type StudentAnswer } from "@su-maek/contracts";
import { gradeAnswer } from "@su-maek/core/grading";
import {
  DEFAULT_MASTERY_POLICY,
  estimateMastery,
  nextReviewDate,
  type MasteryEvidenceInput,
  type MasteryPolicySpec,
} from "@su-maek/core/mastery";

/* ─────────────────────────────────────────────────────────────
 * 응시·채점·숙련도 연쇄 (시퀀스 4·5 · 19장 · 20장).
 *
 * - 제출은 원자적 상태 전이 — 한 응시는 한 번만 제출된다 (불변 조건 9).
 * - 자동 채점: 게시 스냅샷(answer_snapshot) 기준. 저신뢰·서술형은 확정하지
 *   않고 채점 예외함으로 (원칙 8).
 * - 최종 채점 1건 → 개념별 숙련도 증거 정확히 1회 (불변 조건 10 — 유니크).
 * - ConceptMastery는 증거+정책으로 재계산되는 파생 (불변 조건 11).
 * - 오답 → 간격 복습 항목 생성 (정책 간격).
 * ───────────────────────────────────────────────────────────── */

const BAND_DIFFICULTY: Record<string, number> = { low: 0.3, mid: 0.5, high: 0.8 };

export interface StartResult {
  attemptId: string;
  status: string;
}

/** 응시 시작 (get-or-create). 이미 제출된 응시는 새로 만들지 않는다. */
export async function startAttempt(options: {
  organizationId: string;
  assessmentId: string;
  learnerId: string;
}): Promise<StartResult | { error: string }> {
  const sql = getSharedSql();
  const { organizationId, assessmentId, learnerId } = options;

  const [assessment] = await sql<{ status: string }[]>`
    select status from assessment_instances
    where id = ${assessmentId} and organization_id = ${organizationId}
  `;
  if (!assessment) return { error: "평가를 찾을 수 없습니다." };
  if (!["published", "open"].includes(assessment.status)) {
    return { error: "지금은 응시할 수 없는 평가입니다." };
  }
  const [assigned] = await sql<{ id: string }[]>`
    select id from assignments
    where assessment_id = ${assessmentId} and learner_id = ${learnerId}
      and status <> 'cancelled'
  `;
  if (!assigned) return { error: "이 평가에 배정되지 않았습니다." };

  const [existing] = await sql<{ id: string; status: string }[]>`
    select id, status from attempts
    where assessment_id = ${assessmentId} and learner_id = ${learnerId}
    order by attempt_no desc limit 1
  `;
  if (existing) {
    return { attemptId: existing.id, status: existing.status };
  }

  const attemptId = uuidv7();
  await sql`
    insert into attempts (id, organization_id, assessment_id, learner_id, attempt_no, status, started_at)
    values (${attemptId}, ${organizationId}, ${assessmentId}, ${learnerId}, 1, 'in_progress', now())
    on conflict (assessment_id, learner_id, attempt_no) do nothing
  `;
  const [row] = await sql<{ id: string; status: string }[]>`
    select id, status from attempts
    where assessment_id = ${assessmentId} and learner_id = ${learnerId} and attempt_no = 1
  `;
  return { attemptId: row?.id ?? attemptId, status: row?.status ?? "in_progress" };
}

/** 답안 임시 저장 — 증가 시퀀스로 여러 기기 충돌 감지 (2G) */
export async function saveResponse(options: {
  organizationId: string;
  attemptId: string;
  assessmentQuestionId: string;
  answer: unknown;
  clientSequence: number;
}): Promise<{ ok: boolean; message?: string; savedSequence?: number }> {
  const parsed = studentAnswer.safeParse(options.answer);
  if (!parsed.success) {
    return { ok: false, message: "답안 형식이 올바르지 않습니다." };
  }
  const sql = getSharedSql();

  const [attempt] = await sql<{ status: string }[]>`
    select status from attempts
    where id = ${options.attemptId} and organization_id = ${options.organizationId}
  `;
  if (!attempt) return { ok: false, message: "응시를 찾을 수 없습니다." };
  if (attempt.status !== "in_progress") {
    return { ok: false, message: "이미 제출된 응시입니다. 답안을 수정할 수 없습니다." };
  }

  const rows = await sql<{ saved_sequence: number }[]>`
    insert into responses (
      id, organization_id, attempt_id, assessment_question_id, answer, saved_sequence, saved_at
    ) values (
      ${uuidv7()}, ${options.organizationId}, ${options.attemptId},
      ${options.assessmentQuestionId}, ${sql.json(parsed.data as never)},
      ${options.clientSequence}, now()
    )
    on conflict (attempt_id, assessment_question_id) do update
      set answer = excluded.answer,
          saved_sequence = excluded.saved_sequence,
          saved_at = now()
      where responses.saved_sequence < excluded.saved_sequence
    returning saved_sequence
  `;
  if (rows.length === 0) {
    return {
      ok: false,
      message: "다른 기기에서 더 최신 답안이 저장되었습니다. 화면을 새로고침하세요.",
    };
  }
  return { ok: true, savedSequence: rows[0]?.saved_sequence ?? options.clientSequence };
}

export interface SubmitResult {
  ok: boolean;
  message: string;
  attemptStatus?: string;
  totalScore?: number;
  maxScore?: number;
  needsReview?: number;
}

/** 제출 + 자동 채점 + 숙련도 연쇄 — 시퀀스 4·5 */
export async function submitAndGrade(options: {
  organizationId: string;
  attemptId: string;
  learnerId: string;
  timezone: string;
}): Promise<SubmitResult> {
  const sql = getSharedSql();
  const { organizationId, attemptId, learnerId } = options;

  /* 1) 원자적 제출 전이 — in_progress에서만, 정확히 한 번 (불변 조건 9) */
  const transitioned = await sql<{ id: string; assessment_id: string }[]>`
    update attempts
    set status = 'submitted', submitted_at = now(), updated_at = now()
    where id = ${attemptId}
      and organization_id = ${organizationId}
      and learner_id = ${learnerId}
      and status = 'in_progress'
    returning id, assessment_id
  `;
  if (transitioned.length === 0) {
    const [current] = await sql<{ status: string }[]>`
      select status from attempts where id = ${attemptId}
    `;
    return {
      ok: false,
      message:
        current?.status === "in_progress"
          ? "제출할 수 없습니다."
          : "이미 제출된 응시입니다.",
      ...(current?.status ? { attemptStatus: current.status } : {}),
    };
  }
  const assessmentId = transitioned[0]?.assessment_id as string;

  /* 2) 스냅샷·답안 로드 */
  const questions = await sql<
    {
      aq_id: string;
      question_id: string;
      points: string;
      answer_snapshot: unknown;
      concept_weights: Record<string, number>;
      band: string | null;
      answer: unknown;
    }[]
  >`
    select aq.id as aq_id, aq.question_id, aq.points::text,
           aq.answer_snapshot, aq.concept_weights,
           v.difficulty->>'band' as band,
           r.answer
    from assessment_questions aq
    join question_versions v on v.id = aq.question_version_id
    left join responses r on r.assessment_question_id = aq.id and r.attempt_id = ${attemptId}
    where aq.assessment_id = ${assessmentId}
    order by aq.sort_order
  `;

  /* 3) 채점 + 증거 + 복습 — 단일 트랜잭션 */
  const evidenceDate = new Date().toLocaleDateString("en-CA", {
    timeZone: options.timezone,
  });
  let totalScore = 0;
  let maxScore = 0;
  let needsReview = 0;
  const touchedConcepts = new Set<string>();

  await sql.begin(async (tx) => {
    for (const q of questions) {
      const points = Number(q.points);
      maxScore += points;

      const keyParsed = answerKey.safeParse(q.answer_snapshot);
      const missingAnswer: StudentAnswer =
        keyParsed.success && keyParsed.data.kind === "multiple_choice"
          ? { kind: "multiple_choice", selectedChoiceIds: [] }
          : { kind: "short_answer", rawText: "" };
      const ansParsed = studentAnswer.safeParse(q.answer ?? missingAnswer);

      // 답안 행이 없으면(무응답) 생성 — 채점 결정의 부모
      let [resp] = await tx<{ id: string }[]>`
        select id from responses
        where attempt_id = ${attemptId} and assessment_question_id = ${q.aq_id}
      `;
      if (!resp) {
        const rid = uuidv7();
        await tx`
          insert into responses (id, organization_id, attempt_id, assessment_question_id, answer, saved_sequence)
          values (${rid}, ${organizationId}, ${attemptId}, ${q.aq_id},
                  ${tx.json(missingAnswer as never)}, 0)
        `;
        resp = { id: rid };
      }

      if (!keyParsed.success) {
        // 스냅샷 손상 — 자동 확정 금지, 예외함으로
        needsReview++;
        await insertException(tx, organizationId, resp.id, attemptId, "question_error_suspected", {
          reason: "정답 스냅샷 해석 실패",
        });
        continue;
      }

      const outcome = gradeAnswer(
        keyParsed.data,
        ansParsed.success ? ansParsed.data : missingAnswer,
        points,
        { minAutoConfidence: 0.9 },
      );

      const decisionId = uuidv7();
      const isFinal = outcome.verdict !== "needs_review";
      await tx`
        insert into grade_decisions (
          id, organization_id, response_id, version, source,
          is_correct, score, max_score, confidence, rationale, is_final, grader_version
        ) values (
          ${decisionId}, ${organizationId}, ${resp.id}, 1,
          ${outcome.source === "needs_human" ? "auto_rubric_ai" : outcome.source === "auto_exact" ? "auto_exact" : outcome.source === "auto_equivalence" ? "auto_equivalence" : "auto_normalized"},
          ${outcome.verdict === "correct" ? true : outcome.verdict === "incorrect" ? false : null},
          ${outcome.score}, ${outcome.maxScore}, ${outcome.confidence},
          ${tx.json(outcome.rationale as never)}, ${isFinal}, 'grading-engine/1.0.0'
        )
      `;

      if (!isFinal) {
        needsReview++;
        await insertException(tx, organizationId, resp.id, attemptId, outcome.exceptionKind ?? "low_confidence_ocr", {
          rationale: outcome.rationale,
        });
        continue;
      }

      totalScore += outcome.score ?? 0;
      const ratio = outcome.maxScore > 0 ? (outcome.score ?? 0) / outcome.maxScore : 0;

      /* 숙련도 증거 — 개념 가중치별, 결정당 정확히 1회 (유니크 인덱스) */
      for (const [conceptId] of Object.entries(q.concept_weights ?? {})) {
        touchedConcepts.add(conceptId);
        await tx`
          insert into mastery_evidences (
            id, organization_id, learner_id, concept_id, grade_decision_id,
            kind, signal, mapping_confidence, evidence_date, occurred_at
          ) values (
            ${uuidv7()}, ${organizationId}, ${learnerId}, ${conceptId}, ${decisionId},
            'graded_response',
            ${tx.json({
              correct: ratio >= 1,
              scoreRatio: ratio,
              difficulty: BAND_DIFFICULTY[q.band ?? "mid"] ?? 0.5,
              dimension: "procedural",
            } as never)},
            1.0, ${evidenceDate}, now()
          )
          on conflict do nothing
        `;

        /* 오답 → 간격 복습 (20장) */
        if (ratio < 1) {
          const review = nextReviewDate(
            DEFAULT_MASTERY_POLICY,
            0,
            false,
            evidenceDate,
          );
          if (review) {
            await tx`
              insert into review_items (
                id, organization_id, learner_id, concept_id, source_kind,
                source_response_id, question_id, due_on, interval_days, status
              ) values (
                ${uuidv7()}, ${organizationId}, ${learnerId}, ${conceptId},
                'wrong_answer', ${resp.id}, ${q.question_id},
                ${review.dueOn}, ${DEFAULT_MASTERY_POLICY.reviewIntervalsDays[0] ?? 1}, 'scheduled'
              )
            `;
          }
        }

        await tx`
          insert into outbox_events (
            id, organization_id, aggregate_type, aggregate_id, aggregate_version,
            event_type, occurred_at, payload
          ) values (
            ${uuidv7()}, ${organizationId}, 'attempt', ${attemptId}, 1,
            'GradeFinalized', now(),
            ${tx.json({ attemptId, responseId: resp.id, gradeDecisionId: decisionId, decisionVersion: 1, isRegrade: false } as never)}
          )
        `;
      }
    }

    /* 4) 응시 상태 확정 */
    const finalStatus = needsReview > 0 ? "review_required" : "finalized";
    await tx`
      update attempts
      set status = ${finalStatus},
          total_score = ${totalScore}, max_score = ${maxScore},
          finalized_at = ${needsReview > 0 ? null : new Date()},
          updated_at = now()
      where id = ${attemptId}
    `;
  });

  /* 5) 숙련도 재계산 — 파생 (트랜잭션 밖 최종 일관성, 실패해도 원본 보존).
   * cutoff은 반드시 트랜잭션 커밋 이후 시각 — 방금 만든 증거가 포함되어야 한다. */
  const nowIso = new Date(Date.now() + 1000).toISOString();
  const policy = await loadActivePolicy(organizationId);
  for (const conceptId of touchedConcepts) {
    await recomputeMastery(organizationId, learnerId, conceptId, policy, nowIso);
  }

  return {
    ok: true,
    message:
      needsReview > 0
        ? `제출 완료. ${needsReview}개 답안은 선생님 확인 후 확정됩니다.`
        : "제출과 채점이 완료되었습니다.",
    attemptStatus: needsReview > 0 ? "review_required" : "finalized",
    totalScore,
    maxScore,
    needsReview,
  };
}

async function insertException(
  tx: TransactionSql,
  organizationId: string,
  responseId: string,
  attemptId: string,
  kind: string,
  autoResult: unknown,
): Promise<void> {
  await tx`
    insert into grading_exceptions (
      id, organization_id, response_id, attempt_id, kind, status, auto_result
    ) values (
      ${uuidv7()}, ${organizationId}, ${responseId}, ${attemptId},
      ${kind}, 'open', ${tx.json(autoResult as never)}
    )
  `;
}

async function loadActivePolicy(
  organizationId: string,
): Promise<{ id: string | null; spec: MasteryPolicySpec }> {
  const sql = getSharedSql();
  const [row] = await sql<{ id: string; spec: MasteryPolicySpec }[]>`
    select id, spec from mastery_policy_versions
    where organization_id = ${organizationId} and is_active = true
    order by version desc limit 1
  `;
  return row ?? { id: null, spec: DEFAULT_MASTERY_POLICY };
}

/** 개념 숙련도 재계산 — 원본 증거 + 정책 버전 + cutoff (불변 조건 11) */
export async function recomputeMastery(
  organizationId: string,
  learnerId: string,
  conceptId: string,
  policy: { id: string | null; spec: MasteryPolicySpec },
  asOf: string,
): Promise<void> {
  const sql = getSharedSql();
  const evidences = await sql<
    {
      id: string;
      evidence_date: string;
      occurred_at: Date;
      signal: MasteryEvidenceInput["signal"];
      mapping_confidence: string | null;
    }[]
  >`
    select e.id, e.evidence_date::text, e.occurred_at, e.signal, e.mapping_confidence::text
    from mastery_evidences e
    left join grade_decisions d on d.id = e.grade_decision_id
    where e.organization_id = ${organizationId}
      and e.learner_id = ${learnerId} and e.concept_id = ${conceptId}
      and (e.grade_decision_id is null or d.is_final = true)
  `;

  const inputs: MasteryEvidenceInput[] = evidences.map((e) => ({
    evidenceId: e.id,
    evidenceDate: e.evidence_date,
    occurredAt: new Date(e.occurred_at).toISOString(),
    signal: e.signal,
    mappingConfidence: e.mapping_confidence ? Number(e.mapping_confidence) : 1,
  }));

  const estimate = estimateMastery(inputs, policy.spec, asOf);

  await sql`
    insert into concept_masteries (
      id, organization_id, learner_id, concept_id, state, point_estimate,
      uncertainty, evidence_count, distinct_days, last_evidence_at,
      dimensions, next_check, policy_version_id, evidence_cutoff_at
    ) values (
      ${uuidv7()}, ${organizationId}, ${learnerId}, ${conceptId},
      ${estimate.state}, ${estimate.pointEstimate}, ${estimate.uncertainty},
      ${estimate.evidenceCount}, ${estimate.distinctDays},
      ${estimate.lastEvidenceAt ? new Date(estimate.lastEvidenceAt) : null},
      ${sql.json(estimate.dimensions as never)}, ${sql.json(estimate.nextCheck as never)},
      ${policy.id}, ${new Date(asOf)}
    )
    on conflict (learner_id, concept_id) do update set
      state = excluded.state,
      point_estimate = excluded.point_estimate,
      uncertainty = excluded.uncertainty,
      evidence_count = excluded.evidence_count,
      distinct_days = excluded.distinct_days,
      last_evidence_at = excluded.last_evidence_at,
      dimensions = excluded.dimensions,
      next_check = excluded.next_check,
      policy_version_id = excluded.policy_version_id,
      evidence_cutoff_at = excluded.evidence_cutoff_at,
      updated_at = now()
  `;

  const sqlOutbox = getSharedSql();
  await sqlOutbox`
    insert into outbox_events (
      id, organization_id, aggregate_type, aggregate_id, aggregate_version,
      event_type, occurred_at, payload
    ) values (
      ${uuidv7()}, ${organizationId}, 'mastery', ${learnerId}, 1,
      'MasteryUpdated', now(),
      ${sqlOutbox.json({ learnerId, conceptId, previousState: null, newState: estimate.state, policyVersionId: policy.id } as never)}
    )
  `;
}
