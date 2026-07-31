import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, organizationId, timestamps } from "./_shared";

/* ─────────────────────────────────────────────────────────────
 * 평가 컨텍스트 — 정책, 자동 출제, 평가 버전, 문항 스냅샷, 배정
 * 응시·채점 컨텍스트 — 응시, 답안, 제출, 자동 채점, 검토 예외, 재채점
 *
 * 게시된 평가는 문항·정답·해설·채점 기준·배점·개념 연결·정책 버전을
 * 고정한 스냅샷이다 (불변 조건 8). 원본 수정은 기존 응시를 바꾸지 않는다.
 * ───────────────────────────────────────────────────────────── */

export const assessmentPurpose = pgEnum("assessment_purpose", [
  "diagnostic", // 진단
  "formative", // 형성 (일일테스트)
  "confirmation", // 확인테스트
  "cumulative_review", // 누적 복습
  "transfer", // 전이
  "summative", // 총괄
  "retest", // 재시험
]);

/**
 * 평가 정책 — 조직·반·테스트 유형별 자동화 수준과 구성 비율.
 * 자동화 수준: auto_apply | approve_first | manual (원칙 7).
 */
export const assessmentPolicies = pgTable(
  "assessment_policies",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    purpose: assessmentPurpose("purpose").notNull(),
    version: integer("version").notNull().default(1),
    /** 출제 풀 비율 (예: 오늘 학습 50 / 약점 30 / 오답·간격 복습 20) */
    poolWeights: jsonb("pool_weights").notNull(),
    questionCount: integer("question_count").notNull(),
    timeLimitMinutes: integer("time_limit_minutes"),
    /** 난이도 분포, 유형 비율, 재출제 제한, 출처 제한, 개인화 수준 */
    constraints: jsonb("constraints").notNull().default(sql`'{}'::jsonb`),
    /** 통과 점수·개념별 최소 숙련도·미통과 보충·재시험 규칙 */
    passingRules: jsonb("passing_rules"),
    /** 즉시 피드백 여부 등 응시 정책 */
    attemptRules: jsonb("attempt_rules").notNull().default(sql`'{}'::jsonb`),
    automationLevel: text("automation_level").notNull().default("approve_first"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("assessment_policies_org_idx").on(t.organizationId, t.purpose),
    uniqueIndex("assessment_policies_ver_uq").on(
      t.organizationId,
      t.name,
      t.version,
    ),
  ],
);

/**
 * 평가 블루프린트 (2N) — 생성 전 버전으로 고정.
 * 정렬 사슬: 성취기준 → 개념 → 학습 목표 → 기대 증거 → 블루프린트 → 문항.
 */
export const assessmentBlueprints = pgTable(
  "assessment_blueprints",
  {
    id: id(),
    organizationId: organizationId(),
    policyId: uuid("policy_id"),
    purpose: assessmentPurpose("purpose").notNull(),
    version: integer("version").notNull().default(1),
    curriculumVersionId: uuid("curriculum_version_id"),
    /** 목표·개념별 문항 수·가중치·인지 요구·난이도 분포·표상 다양성 */
    spec: jsonb("spec").notNull(),
    /** 공통 앵커 영역과 개인화 가능 영역의 분리 */
    anchorSpec: jsonb("anchor_spec"),
    /** 자동 채점 가능 영역과 사람 채점 영역 */
    gradingSplit: jsonb("grading_split"),
    accessibilityChecks: jsonb("accessibility_checks"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("blueprints_org_idx").on(t.organizationId, t.purpose)],
);

export const assessmentStatus = pgEnum("assessment_status", [
  "generating",
  "draft",
  "ready",
  "review_required", // 문항 부족·게이트 실패
  "published",
  "open",
  "closed",
  "grading",
  "finalized",
  "cancelled",
]);

/**
 * 평가 인스턴스. 게시 시 스냅샷 고정 (2I 목록 전체).
 * 학생·날짜·유형 조합 멱등 생성 — 중복 테스트 금지 (17장).
 */
export const assessmentInstances = pgTable(
  "assessment_instances",
  {
    id: id(),
    organizationId: organizationId(),
    blueprintId: uuid("blueprint_id"),
    policyId: uuid("policy_id"),
    policyVersion: integer("policy_version"),
    purpose: assessmentPurpose("purpose").notNull(),
    title: text("title").notNull(),
    learningGroupId: uuid("learning_group_id"),
    /** 개인화 평가면 대상 학습자 */
    learnerId: uuid("learner_id"),
    /** 멱등 생성 키의 구성: 대상+날짜+유형 */
    scheduledDate: date("scheduled_date"),
    routeNodeId: uuid("route_node_id"),
    status: assessmentStatus("status").notNull().default("generating"),
    /** 생성 시드 — 같은 입력·시드는 같은 선택 (불변 조건 12) */
    generationSeed: text("generation_seed"),
    /** 생성 시점 입력 고정: 숙련도 스냅샷·증거 cutoff·루트·교육과정 버전 */
    generationContext: jsonb("generation_context"),
    /** AI 관여 시 모델·프롬프트·파서 버전 */
    aiInvolvement: jsonb("ai_involvement"),
    timeLimitMinutes: integer("time_limit_minutes"),
    totalPoints: numeric("total_points", { precision: 8, scale: 2 }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by"),
    opensAt: timestamp("opens_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("assessments_org_status_idx").on(t.organizationId, t.status),
    index("assessments_group_date_idx").on(
      t.organizationId,
      t.learningGroupId,
      t.scheduledDate,
    ),
    // 멱등 생성: 같은 (그룹|학습자)+날짜+목적 조합은 한 번만
    uniqueIndex("assessments_idempotent_uq")
      .on(
        t.organizationId,
        t.learningGroupId,
        t.learnerId,
        t.scheduledDate,
        t.purpose,
      )
      .where(sql`status <> 'cancelled' and scheduled_date is not null`),
  ],
);

/**
 * 평가 문항 스냅샷 — 게시 시 QuestionVersion·체크섬·배점·개념 가중치·선정 이유 고정.
 * 원본 문항이 수정되어도 이 스냅샷은 불변 (2I).
 */
export const assessmentQuestions = pgTable(
  "assessment_questions",
  {
    id: id(),
    organizationId: organizationId(),
    assessmentId: uuid("assessment_id").notNull(),
    questionId: uuid("question_id").notNull(),
    questionVersionId: uuid("question_version_id").notNull(),
    /** 렌더링 payload 체크섬 — 응시 전 자산 무결성 검증에 사용 */
    contentChecksum: text("content_checksum").notNull(),
    sortOrder: integer("sort_order").notNull(),
    points: numeric("points", { precision: 6, scale: 2 }).notNull(),
    /** 정답·해설·루브릭 스냅샷 (게시 시점 복사) */
    answerSnapshot: jsonb("answer_snapshot").notNull(),
    rubricSnapshot: jsonb("rubric_snapshot"),
    /** 개념별 기여 가중치 스냅샷 */
    conceptWeights: jsonb("concept_weights").notNull(),
    /** 문항 선정 이유: today_concept | weakness | wrong_answer_review | spaced | anchor | adaptive */
    selectionReason: text("selection_reason").notNull(),
    /** 앵커(공통 기준) 문항 여부 */
    isAnchor: boolean("is_anchor").notNull().default(false),
    /** 격리·오류로 무효화된 경우 */
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedReason: text("invalidated_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("assessment_questions_uq").on(t.assessmentId, t.sortOrder),
    index("assessment_questions_question_idx").on(t.questionId),
  ],
);

export const assignmentStatus = pgEnum("assignment_status", [
  "assigned",
  "notified",
  "reassigned", // 학습 불참 재배정
  "cancelled",
]);

/** 배정 — 평가를 학습자에게 연결 (온라인·인쇄·혼합) */
export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    organizationId: organizationId(),
    assessmentId: uuid("assessment_id").notNull(),
    learnerId: uuid("learner_id").notNull(),
    mode: text("mode").notNull().default("online"), // online | print | hybrid
    status: assignmentStatus("status").notNull().default("assigned"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    assignedBy: uuid("assigned_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("assignments_uq").on(t.assessmentId, t.learnerId),
    index("assignments_learner_idx").on(
      t.organizationId,
      t.learnerId,
      t.status,
    ),
  ],
);

export const attemptStatus = pgEnum("attempt_status", [
  "not_started",
  "in_progress",
  "submitted",
  "auto_graded",
  "review_required",
  "finalized",
  "invalidated",
]);

/**
 * 응시 — (assessment, learner, attempt_no) 고유 (2J 인덱스 계약).
 * 한 응시는 한 번만 제출된다 (불변 조건 9). 제출은 원자적 상태 전이.
 */
export const attempts = pgTable(
  "attempts",
  {
    id: id(),
    organizationId: organizationId(),
    assessmentId: uuid("assessment_id").notNull(),
    learnerId: uuid("learner_id").notNull(),
    attemptNo: integer("attempt_no").notNull().default(1),
    status: attemptStatus("status").notNull().default("not_started"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** 응시 시작 전 자산 체크섬 검증 결과 (18장) */
    preflightReport: jsonb("preflight_report"),
    /** 여러 기기 충돌 감지용 증가 시퀀스 */
    clientSequence: integer("client_sequence").notNull().default(0),
    totalScore: numeric("total_score", { precision: 8, scale: 2 }),
    maxScore: numeric("max_score", { precision: 8, scale: 2 }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    invalidatedReason: text("invalidated_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("attempts_uq").on(t.assessmentId, t.learnerId, t.attemptNo),
    index("attempts_learner_idx").on(t.organizationId, t.learnerId),
    index("attempts_status_idx").on(t.organizationId, t.status),
  ],
);

/** 답안 — (attempt, assessment_question) 고유. 임시 저장은 시퀀스 비교로 충돌 감지. */
export const responses = pgTable(
  "responses",
  {
    id: id(),
    organizationId: organizationId(),
    attemptId: uuid("attempt_id").notNull(),
    assessmentQuestionId: uuid("assessment_question_id").notNull(),
    /** 구조화 답안: 선택지 ID | 정규화 전 원문 | 다중 빈칸 배열 | 서술 텍스트 */
    answer: jsonb("answer"),
    /** 마지막 저장 시퀀스 — 낮은 시퀀스 저장은 거부 */
    savedSequence: integer("saved_sequence").notNull().default(0),
    savedAt: timestamp("saved_at", { withTimezone: true }),
    /** 풀이 흔적 (선택) */
    workArtifacts: jsonb("work_artifacts"),
    hintUsed: integer("hint_used").notNull().default(0),
    elapsedSeconds: integer("elapsed_seconds"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("responses_uq").on(t.attemptId, t.assessmentQuestionId),
  ],
);

export const gradeDecisionSource = pgEnum("grade_decision_source", [
  "auto_exact", // 객관식 정확 일치
  "auto_normalized", // 단답 정규화 비교
  "auto_equivalence", // 기호적 동치 검증
  "auto_rubric_ai", // AI 루브릭 보조 (최종 권한 없음)
  "human", // 교사 판정
  "regrade", // 정정 재채점
]);

/**
 * 채점 결정 — 버전 있는 append-only. 정정은 완료 상태를 과거로 되돌리지 않고
 * 새 버전을 만든다 (2F). 최종 결정 한 건만 숙련도 증거에 반영 (불변 조건 10).
 */
export const gradeDecisions = pgTable(
  "grade_decisions",
  {
    id: id(),
    organizationId: organizationId(),
    responseId: uuid("response_id").notNull(),
    version: integer("version").notNull().default(1),
    source: gradeDecisionSource("source").notNull(),
    isCorrect: boolean("is_correct"),
    score: numeric("score", { precision: 6, scale: 2 }),
    maxScore: numeric("max_score", { precision: 6, scale: 2 }),
    /** 부분 점수·루브릭 항목별 판단 */
    rubricBreakdown: jsonb("rubric_breakdown"),
    /** 자동 채점 신뢰도 — 낮으면 확정하지 않고 예외함 (원칙 8) */
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    /** 판단 근거 (정규화 결과·동치 검사 로그·AI 근거 문장) */
    rationale: jsonb("rationale"),
    /** 이 결정이 최종인가 — 최종만 숙련도 반영 */
    isFinal: boolean("is_final").notNull().default(false),
    decidedBy: uuid("decided_by"),
    graderVersion: text("grader_version"),
    supersedesId: uuid("supersedes_id"),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("grade_decisions_uq").on(t.responseId, t.version),
    // 최종 결정은 답안당 하나
    uniqueIndex("grade_decisions_final_uq")
      .on(t.responseId)
      .where(sql`is_final = true`),
  ],
);

export const gradingExceptionKind = pgEnum("grading_exception_kind", [
  "low_confidence_ocr",
  "multiple_valid_answers",
  "format_mismatch",
  "essay_partial",
  "answer_explanation_conflict",
  "question_error_suspected",
  "scan_missing",
  "identity_unresolved",
  "resubmission_required",
  "regrade_required",
]);

export const gradingExceptionStatus = pgEnum("grading_exception_status", [
  "open",
  "assigned",
  "reviewing",
  "resolved",
  "escalated",
]);

/** 채점 예외함 (19장) */
export const gradingExceptions = pgTable(
  "grading_exceptions",
  {
    id: id(),
    organizationId: organizationId(),
    responseId: uuid("response_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    kind: gradingExceptionKind("kind").notNull(),
    status: gradingExceptionStatus("status").notNull().default("open"),
    /** 자동 채점 결과·신뢰도·판단 근거 */
    autoResult: jsonb("auto_result"),
    assignedTo: uuid("assigned_to"),
    resolution: jsonb("resolution"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("grading_exceptions_org_idx").on(
      t.organizationId,
      t.status,
      t.dueAt,
    ),
    index("grading_exceptions_attempt_idx").on(t.attemptId),
  ],
);
