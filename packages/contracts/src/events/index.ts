import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * 도메인 이벤트 카탈로그 (골프롬프트 2D)
 *
 * 전달 의미: at-least-once. 소비자는 Inbox(consumer_name + event_id)로
 * 중복을 차단한다. 동일 aggregate 내부의 순서만 보장한다.
 * 스키마는 버전 관리하며 하위 호환(필드 추가만, 제거·의미 변경 금지)을 지킨다.
 * ───────────────────────────────────────────────────────────── */

export const eventEnvelope = z.object({
  eventId: z.uuid(),
  organizationId: z.uuid(),
  aggregateType: z.string(),
  aggregateId: z.uuid(),
  aggregateVersion: z.number().int().nonnegative(),
  eventType: z.string(),
  schemaVersion: z.number().int().min(1).default(1),
  occurredAt: z.iso.datetime(),
  correlationId: z.uuid().optional(),
  causationId: z.uuid().optional(),
});

export type EventEnvelope = z.infer<typeof eventEnvelope>;

/** payload는 최소 필요 정보만 — 개인정보·전체 원문 금지 */
const payloads = {
  RoutePublished: z.object({
    routePlanId: z.uuid(),
    routeVersionId: z.uuid(),
    learningGroupId: z.uuid().nullable(),
    publishedBy: z.uuid(),
  }),
  /* E-02. 교사가 **실제로 어디까지 나갔는지** 확인한 기록이다 (T4.2).
   * 학생 하루 완료(E-16)와 섞지 않는다 — 한 명이 다 했다고 반이 끝나지
   * 않고, 반이 끝났다고 학생 하루가 끝나지 않는다 (I-21). */
  SessionCompleted: z.object({
    sessionId: z.uuid(),
    learningGroupId: z.uuid(),
    sessionDate: z.iso.date(),
    timezoneId: z.string().optional(),
    /** 배정된 담당 교사 — 실제로 마감을 누른 사람은 closedBy다 */
    teacherId: z.uuid().nullable().optional(),
    closedBy: z.uuid().optional(),
    startedAt: z.iso.datetime({ offset: true }).optional(),
    completedAt: z.iso.datetime({ offset: true }).optional(),
    /** planning-engine이 partial·not_started면 미래 일정 preview를 만든다 */
    coverage: z.enum(["full", "partial", "not_started"]).optional(),
    note: z.string().nullable().optional(),
    /** 부분 완료·미진행 노드 요약 */
    progressSummary: z
      .object({
        completedNodeIds: z.array(z.uuid()),
        partialNodeIds: z.array(z.uuid()),
        skippedNodeIds: z.array(z.uuid()),
      })
      .optional(),
  }),
  /* E-16. 학습자 ③층(하루 실행 계획)의 완료를 나르는 **유일한** 경로다.
   * 반 수업 완료(SessionCompleted)와 섞지 않는다 — 한 학생의 완료가 반
   * 30명의 미래 일정을 잠그면 안 된다 (I-21 · ADR-0017 §1). */
  LearnerDayCompleted: z.object({
    learnerDayPlanId: z.uuid(),
    learnerId: z.uuid(),
    /** 복습만 있는 날이면 null */
    learningGroupId: z.uuid().nullable(),
    planDate: z.iso.date(),
    timezoneId: z.string(),
    completedAt: z.iso.datetime({ offset: true }),
    source: z.enum(["learner_schedule", "group_session", "review_only"]),
    /** 면제는 「했다」가 아니다 — planning-engine이 진도 계산에서 구분한다 */
    items: z.object({
      requiredTotal: z.number().int().nonnegative(),
      requiredCompleted: z.number().int().nonnegative(),
      requiredExempted: z.number().int().nonnegative(),
      optionalCompleted: z.number().int().nonnegative(),
    }),
    /** 오늘 항목이 나온 노드 — 복습 항목은 빠진다 */
    routeNodeIds: z.array(z.uuid()),
  }),
  LearningAvailabilityChanged: z.object({
    availabilityEventId: z.uuid(),
    kind: z.enum(["learner_absence", "learner_unavailable", "group_cancelled"]),
    learnerId: z.uuid().nullable(),
    learningGroupId: z.uuid().nullable(),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
  }),
  AssessmentPublished: z.object({
    assessmentId: z.uuid(),
    purpose: z.string(),
    learningGroupId: z.uuid().nullable(),
    learnerId: z.uuid().nullable(),
    questionCount: z.number().int(),
  }),
  AttemptSubmitted: z.object({
    attemptId: z.uuid(),
    assessmentId: z.uuid(),
    learnerId: z.uuid(),
    submittedAt: z.iso.datetime(),
  }),
  GradeFinalized: z.object({
    attemptId: z.uuid(),
    responseId: z.uuid(),
    gradeDecisionId: z.uuid(),
    decisionVersion: z.number().int(),
    isRegrade: z.boolean().default(false),
  }),
  MasteryUpdated: z.object({
    learnerId: z.uuid(),
    conceptId: z.uuid(),
    previousState: z.string().nullable(),
    newState: z.string(),
    policyVersionId: z.uuid().nullable(),
  }),
  /**
   * 학생 개별 경로 오버라이드가 생기거나 취소됐다 (인수 4).
   * 소비자는 그 학습자의 개별 일정을 다시 실체화한다 — 반 공통 일정은
   * 건드리지 않는다.
   */
  LearnerRouteOverrideChanged: z.object({
    overrideId: z.uuid(),
    learnerId: z.uuid(),
    kind: z.string(),
    changedTo: z.enum(["active", "cancelled"]),
    changedBy: z.uuid().nullable(),
  }),
  ScheduleProposalCreated: z.object({
    proposalId: z.uuid(),
    scopeType: z.enum(["learning_group", "learner"]),
    scopeId: z.uuid(),
    triggerType: z.string(),
    requiresApproval: z.boolean(),
  }),
  ScheduleProposalApplied: z.object({
    proposalId: z.uuid(),
    resultRevisionId: z.uuid(),
    appliedBy: z.uuid().nullable(),
  }),
  ContentApproved: z.object({
    questionId: z.uuid(),
    questionVersionId: z.uuid(),
    reviewerId: z.uuid(),
  }),
  CurriculumReleasePublished: z.object({
    releaseId: z.uuid(),
    curriculumVersionId: z.uuid(),
    releaseNumber: z.number().int(),
  }),
  FormulaReviewRequired: z.object({
    expressionId: z.uuid(),
    questionId: z.uuid().nullable(),
    reason: z.string(),
    gateFailures: z.array(z.string()),
  }),
  RenderArtifactValidated: z.object({
    artifactId: z.uuid(),
    subjectType: z.string(),
    subjectId: z.uuid(),
    target: z.enum(["web", "mobile", "print_css", "pdf", "hwpx"]),
    passed: z.boolean(),
  }),
  QuestionQuarantined: z.object({
    questionId: z.uuid(),
    reason: z.string(),
    /** 영향 분석: 미완료 테스트·완료 응시 수 */
    impact: z
      .object({
        openAssessments: z.number().int(),
        finalizedAttempts: z.number().int(),
      })
      .optional(),
  }),
  ContentRightsRevoked: z.object({
    contentRightId: z.uuid(),
    bookEditionId: z.uuid().nullable(),
    affectedQuestionCount: z.number().int(),
  }),
} as const;

export const eventPayloads = payloads;
export type EventType = keyof typeof payloads;
export const eventTypes = Object.keys(payloads) as EventType[];

/** 이벤트 타입별 완전한 스키마 (envelope + payload) */
export function eventSchema<T extends EventType>(type: T) {
  return eventEnvelope.extend({
    eventType: z.literal(type),
    payload: payloads[type],
  });
}

export type DomainEvent<T extends EventType = EventType> = EventEnvelope & {
  eventType: T;
  payload: z.infer<(typeof payloads)[T]>;
};
