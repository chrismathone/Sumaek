import "server-only";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql, type TransactionSql } from "@su-maek/db";
import { answerKey, studentAnswer, type StudentAnswer } from "@su-maek/contracts";
import { gradeAnswer } from "@su-maek/core/grading";
import {
  DEFAULT_MASTERY_POLICY,
  estimateMastery,
  initialReviewSchedule,
  type MasteryEvidenceInput,
  type MasteryPolicySpec,
} from "@su-maek/core/mastery";
import type { IsoDate } from "@su-maek/core/shared";

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
  /** 조직 시간대의 오늘(YYYY-MM-DD). 응시일 게이트의 기준. */
  today: string;
}): Promise<StartResult | { error: string }> {
  const sql = getSharedSql();
  const { organizationId, assessmentId, learnerId, today } = options;

  const [assessment] = await sql<
    { status: string; scheduled_date: string | null }[]
  >`
    select status, scheduled_date::text as scheduled_date
    from assessment_instances
    where id = ${assessmentId} and organization_id = ${organizationId}
  `;
  if (!assessment) return { error: "평가를 찾을 수 없습니다." };
  if (!["published", "open"].includes(assessment.status)) {
    return { error: "지금은 응시할 수 없는 평가입니다." };
  }
  /* 응시일 게이트 — 생성 폼의 기본 날짜가 "다음 수업일"이라 **미래 테스트가
   * 기본 동작**인데, 여기가 없으면 학생이 오늘 바로 풀어 버린다(실측 확인:
   * 8/5 테스트를 8/2에 제출). 날짜가 없는 평가(수시)는 그대로 허용한다.
   * 화면에서도 같은 판정을 하지만, 화면 판정은 URL 직접 입력을 막지 못한다. */
  if (assessment.scheduled_date && assessment.scheduled_date > today) {
    return {
      error: `${assessment.scheduled_date} 수업의 테스트입니다. 그날부터 응시할 수 있습니다.`,
    };
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
  /** 저장하려는 사람 — 조직만 맞추면 남의 응시에 쓸 수 있다 (아래 주석) */
  learnerId: string;
  assessmentQuestionId: string;
  answer: unknown;
  clientSequence: number;
}): Promise<{ ok: boolean; message?: string; savedSequence?: number }> {
  const parsed = studentAnswer.safeParse(options.answer);
  if (!parsed.success) {
    return { ok: false, message: "답안 형식이 올바르지 않습니다." };
  }
  const sql = getSharedSql();

  /* 조회 조건에 learner_id가 **반드시** 있어야 한다.
   * organization_id만 보면 같은 학원의 다른 학생 attemptId를 아는 순간 그
   * 응시에 답안을 써 넣을 수 있고, 그 답안은 피해 학생의 채점·점수·숙련도로
   * 그대로 흘러간다. 제출 경로(submitAndGrade)는 처음부터 learner_id를
   * 검사했는데 저장 경로만 빠져 있었다 — 둘은 같은 기준이어야 한다. */
  const [attempt] = await sql<{ status: string }[]>`
    select status from attempts
    where id = ${options.attemptId}
      and organization_id = ${options.organizationId}
      and learner_id = ${options.learnerId}
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
  /* 복습 일정도 **정책**을 따른다. 예전에는 여기서 DEFAULT_MASTERY_POLICY를
   * 하드코딩해, DB에서 정책을 바꿔도 실제 만들어지는 복습에는 반영되지 않았다 —
   * "임계값 코드 상수 금지"(ADR-0009)를 어기는 유일한 지점이었다. */
  const policy = await loadActivePolicy(organizationId);
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

        /* 오답 → 망각곡선 복습 (20장) */
        if (ratio < 1) {
          const review = initialReviewSchedule({
            policy: policy.spec,
            occurredOn: evidenceDate as IsoDate,
          });
          await tx`
            insert into review_items (
              id, organization_id, learner_id, concept_id, source_kind,
              source_response_id, question_id, due_on, interval_days, status,
              stability_days, repetition_no, lapse_count
            ) values (
              ${uuidv7()}, ${organizationId}, ${learnerId}, ${conceptId},
              'wrong_answer', ${resp.id}, ${q.question_id},
              ${review.dueOn}, ${review.intervalDays}, 'scheduled',
              ${review.stabilityDays}, ${review.repetitionNo}, ${review.lapseCount}
            )
          `;
        } else {
          /* 정답 → 그 개념의 밀린 복습을 닫는다.
           * 이게 없으면 review_items에 insert만 있고 완료 경로가 없어
           * 학생 화면의 「복습 예정 N건」이 영원히 증가한다 (실측 결손).
           * 닫는 기준은 "그 개념을 **기한 이후에** 다시 맞혔다" — 오늘 이후로
           * 예정된 미래 복습까지 앞당겨 지우지는 않는다. */
          await tx`
            update review_items
            set status = 'completed', completed_at = now(),
                -- 다음 계산의 기준점 — 예측 기억률이 이 날짜부터 잰다
                last_reviewed_on = ${evidenceDate}::date,
                outcome = ${tx.json({
                  closedBy: "graded_response",
                  gradeDecisionId: decisionId,
                  scoreRatio: ratio,
                } as never)},
                updated_at = now()
            where organization_id = ${organizationId}
              and learner_id = ${learnerId}
              and concept_id = ${conceptId}
              and status = 'scheduled'
              and due_on <= ${evidenceDate}::date
          `;
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
          finalized_at = case when ${needsReview > 0} then null else now() end,
          updated_at = now()
      where id = ${attemptId}
    `;
  });

  /* 5) 숙련도 재계산 — 파생 (트랜잭션 밖 최종 일관성, 실패해도 원본 보존).
   * cutoff은 DB 시계 기준으로 recomputeMastery가 직접 잡는다. */
  for (const conceptId of touchedConcepts) {
    await recomputeMastery(organizationId, learnerId, conceptId, policy);
  }

  /* 6) 확인테스트 통과 판정 — 미통과면 재시험 계획 생성 (2N·인수 10).
   * 한 번의 실패를 즉시 전체 과정 실패로 해석하지 않는다 — 재확인 정책. */
  if (needsReview === 0) {
    await evaluateConfirmationOutcome(
      organizationId,
      assessmentId,
      attemptId,
      learnerId,
      totalScore,
      maxScore,
    );
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

/** 확인테스트 결과 판정 — 미통과 시 재시험 계획 + 알림. 멱등. */
async function evaluateConfirmationOutcome(
  organizationId: string,
  assessmentId: string,
  attemptId: string,
  learnerId: string,
  totalScore: number,
  maxScore: number,
): Promise<void> {
  const sql = getSharedSql();
  const [assessment] = await sql<
    {
      purpose: string;
      scheduled_date: string | null;
      learning_group_id: string | null;
      generation_context: { passingRules?: { passRatio?: number; maxAttempts?: number } } | null;
    }[]
  >`
    select purpose, scheduled_date::text, learning_group_id, generation_context
    from assessment_instances
    where id = ${assessmentId} and organization_id = ${organizationId}
  `;
  if (!assessment || assessment.purpose !== "confirmation") return;

  const rules = assessment.generation_context?.passingRules ?? {};
  const passRatio = rules.passRatio ?? 0.7;
  const maxAttempts = rules.maxAttempts ?? 2;
  const ratio = maxScore > 0 ? totalScore / maxScore : 0;
  if (ratio >= passRatio) return; // 통과 — 다음 개념 진행

  /* 멱등: 이 응시에 대한 계획이 이미 있으면 종료 */
  const [existingPlan] = await sql<{ id: string }[]>`
    select id from retry_plans
    where failed_attempt_id = ${attemptId}
  `;
  if (existingPlan) return;

  const [priorPlans] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from retry_plans
    where organization_id = ${organizationId}
      and learner_id = ${learnerId}
      and failed_assessment_id = ${assessmentId}
  `;
  const attemptNumber = (priorPlans?.cnt ?? 0) + 1;
  if (attemptNumber > maxAttempts) return; // 최대 횟수 초과 — 교사 판단 영역

  /* 다음 수업일 = 재시험 예정일 */
  const [nextSession] = await sql<{ session_date: string }[]>`
    select min(session_date)::text as session_date from sessions
    where organization_id = ${organizationId}
      and learning_group_id = ${assessment.learning_group_id}
      and session_date > coalesce(${assessment.scheduled_date}::date, current_date)
  `;

  await sql.begin(async (tx) => {
    await tx`
      insert into retry_plans (
        id, organization_id, learner_id, failed_assessment_id, failed_attempt_id,
        attempt_number, max_attempts, scheduled_on, status
      ) values (
        ${uuidv7()}, ${organizationId}, ${learnerId}, ${assessmentId}, ${attemptId},
        ${attemptNumber}, ${maxAttempts}, ${nextSession?.session_date ?? null}, 'planned'
      )
    `;
    /* 교사 알림 — 미통과는 판단이 필요한 예외 (원칙 6) */
    const teachers = await tx<{ user_id: string }[]>`
      select user_id from memberships
      where organization_id = ${organizationId} and status = 'active'
        and role in ('owner', 'program_director', 'teacher')
    `;
    for (const t of teachers) {
      await tx`
        insert into notifications (
          id, organization_id, recipient_user_id, kind, title, body, link_path,
          related_type, related_id
        ) values (
          ${uuidv7()}, ${organizationId}, ${t.user_id}, 'learner_risk',
          '확인테스트 미통과 — 재시험이 계획되었습니다',
          ${tx.json({
            what: `점수 ${totalScore}/${maxScore} (통과 기준 ${Math.round(passRatio * 100)}%)`,
            why: "확인테스트 통과 기준 미달",
            action: `재시험 ${attemptNumber}/${maxAttempts}회차${nextSession?.session_date ? ` — ${nextSession.session_date} 예정` : ""}. 같은 목표의 동등 문항으로 구성됩니다.`,
          } as never)},
          '/app/tests', 'attempt', ${attemptId}
        )
      `;
    }
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, action, target_type, target_id, reason, after
      ) values (
        ${uuidv7()}, ${organizationId}, 'automation',
        'assessment.confirmation-failed', 'attempt', ${attemptId},
        '확인테스트 미통과 자동 판정',
        ${tx.json({ ratio, passRatio, attemptNumber, scheduledOn: nextSession?.session_date ?? null } as never)}
      )
    `;
  });
}

export interface ResolveExceptionInput {
  organizationId: string;
  exceptionId: string;
  resolverUserId: string;
  timezone: string;
  verdict: "correct" | "incorrect" | "partial";
  /** partial일 때 획득 점수 */
  partialScore?: number;
  note?: string;
}

/**
 * 채점 예외 판정 (시퀀스 5 · 19장).
 * 사람 판정 → 새 GradeDecision(최종) → 응시 점수·상태 재계산 →
 * 숙련도 증거·복습 반영. 변경 전후를 감사 로그에 남긴다.
 */
export async function resolveGradingException(
  input: ResolveExceptionInput,
): Promise<{ ok: boolean; message: string }> {
  const sql = getSharedSql();

  const [exception] = await sql<
    {
      id: string;
      response_id: string;
      attempt_id: string;
      status: string;
      learner_id: string;
      aq_id: string;
      points: string;
      concept_weights: Record<string, number>;
      band: string | null;
      question_id: string;
    }[]
  >`
    select ge.id, ge.response_id, ge.attempt_id, ge.status,
           t.learner_id, aq.id as aq_id, aq.points::text, aq.concept_weights,
           v.difficulty->>'band' as band, aq.question_id
    from grading_exceptions ge
    join attempts t on t.id = ge.attempt_id
    join responses r on r.id = ge.response_id
    join assessment_questions aq on aq.id = r.assessment_question_id
    join question_versions v on v.id = aq.question_version_id
    where ge.id = ${input.exceptionId}
      and ge.organization_id = ${input.organizationId}
  `;
  if (!exception) return { ok: false, message: "예외 항목을 찾을 수 없습니다." };
  if (exception.status === "resolved") {
    return { ok: false, message: "이미 판정된 예외입니다." };
  }

  const maxPoints = Number(exception.points);
  const score =
    input.verdict === "correct"
      ? maxPoints
      : input.verdict === "incorrect"
        ? 0
        : Math.max(0, Math.min(maxPoints, input.partialScore ?? 0));
  const ratio = maxPoints > 0 ? score / maxPoints : 0;
  const evidenceDate = new Date().toLocaleDateString("en-CA", {
    timeZone: input.timezone,
  });
  const touched = Object.keys(exception.concept_weights ?? {});
  // 복습 일정도 정책을 따른다 — 트랜잭션 안에서 쓰므로 미리 읽는다
  const policy = await loadActivePolicy(input.organizationId);

  await sql.begin(async (tx) => {
    const [next] = await tx<{ v: number }[]>`
      select coalesce(max(version), 0) + 1 as v from grade_decisions
      where response_id = ${exception.response_id}
    `;
    /* 기존 최종 결정 해제 — 최종은 답안당 하나(부분 유니크)이고, 이 해제가
     * append-only 가드가 허용하는 유일한 변경이다. 새 결정이 이전 결정을
     * supersedes로 가리켜 이력이 사슬로 남는다 (ADR-0015). */
    const [prevFinal] = await tx<{ id: string }[]>`
      update grade_decisions set is_final = false
      where response_id = ${exception.response_id} and is_final = true
      returning id
    `;
    const decisionId = uuidv7();
    await tx`
      insert into grade_decisions (
        id, organization_id, response_id, version, source,
        is_correct, score, max_score, confidence, rationale, is_final,
        decided_by, supersedes_id, change_reason
      ) values (
        ${decisionId}, ${input.organizationId}, ${exception.response_id}, ${next?.v ?? 1},
        'human',
        ${input.verdict === "correct" ? true : input.verdict === "incorrect" ? false : null},
        ${score}, ${maxPoints}, 1.0,
        ${tx.json([`교사 판정: ${input.verdict}`, input.note ?? ""] as never)},
        true, ${input.resolverUserId}, ${prevFinal?.id ?? null},
        ${input.note ?? "채점 예외 판정"}
      )
    `;

    await tx`
      update grading_exceptions
      set status = 'resolved',
          resolution = ${tx.json({ verdict: input.verdict, score, note: input.note ?? null } as never)},
          resolved_by = ${input.resolverUserId}, resolved_at = now(), updated_at = now()
      where id = ${exception.id}
    `;

    /* 숙련도 증거 — 결정당 1회 */
    for (const conceptId of touched) {
      await tx`
        insert into mastery_evidences (
          id, organization_id, learner_id, concept_id, grade_decision_id,
          kind, signal, mapping_confidence, evidence_date, occurred_at, recorded_by
        ) values (
          ${uuidv7()}, ${input.organizationId}, ${exception.learner_id}, ${conceptId},
          ${decisionId}, 'graded_response',
          ${tx.json({
            correct: ratio >= 1,
            scoreRatio: ratio,
            difficulty: BAND_DIFFICULTY[exception.band ?? "mid"] ?? 0.5,
            dimension: "procedural",
          } as never)},
          1.0, ${evidenceDate}, now(), ${input.resolverUserId}
        )
        on conflict do nothing
      `;
      if (ratio < 1) {
        const review = initialReviewSchedule({
          policy: policy.spec,
          occurredOn: evidenceDate as IsoDate,
        });
        await tx`
          insert into review_items (
            id, organization_id, learner_id, concept_id, source_kind,
            source_response_id, question_id, due_on, interval_days, status,
            stability_days, repetition_no, lapse_count
          ) values (
            ${uuidv7()}, ${input.organizationId}, ${exception.learner_id}, ${conceptId},
            'wrong_answer', ${exception.response_id}, ${exception.question_id},
            ${review.dueOn}, ${review.intervalDays}, 'scheduled',
            ${review.stabilityDays}, ${review.repetitionNo}, ${review.lapseCount}
          )
        `;
      } else {
        // 교사가 정답으로 판정한 경우도 밀린 복습을 닫는다 (자동 채점과 같은 기준)
        await tx`
          update review_items
          set status = 'completed', completed_at = now(),
              last_reviewed_on = ${evidenceDate}::date,
              outcome = ${tx.json({
                closedBy: "grading_exception",
                gradeDecisionId: decisionId,
                scoreRatio: ratio,
              } as never)},
              updated_at = now()
          where organization_id = ${input.organizationId}
            and learner_id = ${exception.learner_id}
            and concept_id = ${conceptId}
            and status = 'scheduled'
            and due_on <= ${evidenceDate}::date
        `;
      }
    }

    /* 응시 점수·상태 재계산 — 남은 예외 없으면 finalized */
    const [openLeft] = await tx<{ cnt: number }[]>`
      select count(*)::int as cnt from grading_exceptions
      where attempt_id = ${exception.attempt_id} and status <> 'resolved'
    `;
    const [totals] = await tx<{ total: string | null }[]>`
      select sum(d.score)::text as total
      from grade_decisions d
      join responses r on r.id = d.response_id
      where r.attempt_id = ${exception.attempt_id} and d.is_final = true
    `;
    await tx`
      update attempts
      set total_score = ${totals?.total ?? "0"},
          status = ${openLeft?.cnt === 0 ? "finalized" : "review_required"},
          finalized_at = case when ${openLeft?.cnt === 0} then now() else null end,
          updated_at = now()
      where id = ${exception.attempt_id}
    `;

    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${input.organizationId}, 'attempt', ${exception.attempt_id}, 1,
        'GradeFinalized', now(),
        ${tx.json({ attemptId: exception.attempt_id, responseId: exception.response_id, gradeDecisionId: decisionId, decisionVersion: next?.v ?? 1, isRegrade: false } as never)}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, reason, after
      ) values (
        ${uuidv7()}, ${input.organizationId}, 'user', ${input.resolverUserId},
        'grading.resolve-exception', 'response', ${exception.response_id},
        ${input.note ?? "채점 예외 판정"},
        ${tx.json({ verdict: input.verdict, score } as never)}
      )
    `;
  });

  /* 숙련도 파생 재계산 — cutoff은 DB 시계 기준 */
  for (const conceptId of touched) {
    await recomputeMastery(
      input.organizationId,
      exception.learner_id,
      conceptId,
      policy,
    );
  }

  return { ok: true, message: "판정을 반영했습니다. 점수·숙련도·복습이 갱신되었습니다." };
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

/** 개념 숙련도 재계산 — 원본 증거 + 정책 버전 + cutoff (불변 조건 11).
 * cutoff은 DB 시계 기준 — 로컬·DB 시계 skew로 방금 증거가 제외되지 않게 한다. */
export async function recomputeMastery(
  organizationId: string,
  learnerId: string,
  conceptId: string,
  policy: { id: string | null; spec: MasteryPolicySpec },
  asOfOverride?: string,
): Promise<void> {
  const sql = getSharedSql();
  const [clock] = await sql<{ t: Date }[]>`
    select now() + interval '1 second' as t
  `;
  const asOf = asOfOverride ?? new Date(clock?.t ?? Date.now()).toISOString();
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
