import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, organizationId, timestamps } from "./_shared";

/* ─────────────────────────────────────────────────────────────
 * 학습 경로·계획 컨텍스트
 * 소유: 반 공통 루트, 학생 오버라이드, 루트 버전, 일정 계산 입력·변경안
 *
 * 원칙 3·4: 학생 계획 = 게시된 반 루트 버전 + 버전 있는 학생 오버라이드.
 * 학생별 차이를 위해 반 루트를 복사하지 않는다 — 차이 이벤트만 저장.
 * 실제 수업 생성·충돌 확정은 수업 실행 컨텍스트의 소유다.
 * ───────────────────────────────────────────────────────────── */

export const routeKind = pgEnum("route_kind", [
  "workspace_template",
  "grade_template",
  "group_route", // 반 루트
  "learner_route", // 학생 개별 루트
  "special_route", // 특강·시험 대비
]);

export const routeStatus = pgEnum("route_status", [
  "draft",
  "validating",
  "needs_fix",
  "publishable",
  "published",
  "superseded",
  "archived",
]);

/** 루트 계획 컨테이너 — 버전의 부모 */
export const routePlans = pgTable(
  "route_plans",
  {
    id: id(),
    organizationId: organizationId(),
    kind: routeKind("kind").notNull(),
    name: text("name").notNull(),
    learningGroupId: uuid("learning_group_id"),
    learnerId: uuid("learner_id"),
    coursePeriodId: uuid("course_period_id"),
    curriculumVersionId: uuid("curriculum_version_id"),
    /** 템플릿 복제 출처 */
    sourceTemplateId: uuid("source_template_id"),
    status: routeStatus("status").notNull().default("draft"),
    /** 현재 활성(게시) 버전 포인터 — 원자적 전환 (강한 일관성) */
    activeVersionId: uuid("active_version_id"),
    targetEndDate: date("target_end_date"),
    ...timestamps(),
  },
  (t) => [
    index("route_plans_org_idx").on(t.organizationId, t.kind, t.status),
    index("route_plans_group_idx").on(t.learningGroupId),
  ],
);

/** 루트 버전 — 게시되면 불변 (불변 조건 2) */
export const routeVersions = pgTable(
  "route_versions",
  {
    id: id(),
    organizationId: organizationId(),
    routePlanId: uuid("route_plan_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: routeStatus("status").notNull().default("draft"),
    /** 검증 리포트 (시뮬레이션 결과: 커버리지·학습량·선수 공백) */
    validationReport: jsonb("validation_report"),
    /** 게시 시 고정: 교육과정 릴리스, 정책 버전 */
    curriculumReleaseId: uuid("curriculum_release_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by"),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("route_versions_uq").on(t.routePlanId, t.versionNumber),
    index("route_versions_org_idx").on(t.organizationId, t.status),
  ],
);

export const routeNodeKind = pgEnum("route_node_kind", [
  "concept_lesson",
  "problem_solving",
  "book_range",
  "homework",
  "daily_test",
  "confirmation_test",
  "wrong_answer_review",
  "remediation",
  "cumulative_review",
  "buffer",
  "break", // 휴강·시험 기간
  "custom",
]);

/** 루트 노드 — 버전에 속하는 불변 행 */
export const routeNodes = pgTable(
  "route_nodes",
  {
    id: id(),
    organizationId: organizationId(),
    routeVersionId: uuid("route_version_id").notNull(),
    kind: routeNodeKind("kind").notNull(),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull(),
    /** 연결: 개념·학습 목표·성취기준 (정렬 사슬) */
    conceptIds: jsonb("concept_ids").notNull().default(sql`'[]'::jsonb`),
    objectiveIds: jsonb("objective_ids").notNull().default(sql`'[]'::jsonb`),
    /** 교재 범위 */
    bookEditionId: uuid("book_edition_id"),
    pageRange: jsonb("page_range"),
    /** 예상 소요 (분) */
    expectedMinutes: integer("expected_minutes"),
    /** 표상·예/비예·오개념·교수전략 선택과 이유 */
    instructionPlan: jsonb("instruction_plan"),
    /** 숙제 정의 */
    homework: jsonb("homework"),
    /** 평가 노드의 블루프린트 참조 */
    blueprintId: uuid("blueprint_id"),
    /** 완료 조건 */
    completionCriteria: jsonb("completion_criteria"),
    /** 자동 조정 허용 범위 */
    autoAdjustPolicy: jsonb("auto_adjust_policy"),
    ...timestamps(),
  },
  (t) => [
    index("route_nodes_version_idx").on(t.routeVersionId, t.sortOrder),
  ],
);

/** 노드 간 순서·의존 관계 (선수 관계 반영) */
export const routeDependencies = pgTable(
  "route_dependencies",
  {
    id: id(),
    organizationId: organizationId(),
    routeVersionId: uuid("route_version_id").notNull(),
    fromNodeId: uuid("from_node_id").notNull(),
    toNodeId: uuid("to_node_id").notNull(),
    kind: text("kind").notNull().default("sequence"), // sequence | prerequisite | checkpoint_gate
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("route_dependencies_uq").on(t.fromNodeId, t.toNodeId),
    index("route_dependencies_version_idx").on(t.routeVersionId),
  ],
);

export const overrideKind = pgEnum("override_kind", [
  "temporary_advance", // 일시적 선행
  "absence_makeup", // 학습 불참 보강
  "remediation", // 취약 개념 보충
  "retest_relearn", // 확인테스트 재학습
  "book_substitution", // 교재 대체
  "permanent_individual", // 영구 개별 진도
  "rejoin", // 반 공통 재합류
  "skip", // 진도 건너뛰기
  "deadline_change", // 기한 변경
]);

export const overrideStatus = pgEnum("override_status", [
  "active",
  "completed",
  "cancelled",
]);

/**
 * 학생 오버라이드 — 버전이 있으며 반 루트나 다른 학생을 직접 변경하지 않는다
 * (불변 조건 4). 경로 유형(2M): 생성 이유·목표·시작/성공 조건·최대 기간·재합류 지점.
 */
export const studentRouteOverrides = pgTable(
  "student_route_overrides",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id").notNull(),
    /** 기준이 되는 게시된 반 루트 버전 */
    baseRouteVersionId: uuid("base_route_version_id").notNull(),
    kind: overrideKind("kind").notNull(),
    version: integer("version").notNull().default(1),
    status: overrideStatus("status").notNull().default("active"),
    /** 경로 유형: CORE|REMEDIATION|PRACTICE|REVIEW|ADVANCE|TRANSFER|ASSESSMENT_PREP|REJOIN */
    pathType: text("path_type"),
    reason: text("reason").notNull(),
    goal: text("goal"),
    startCondition: jsonb("start_condition"),
    successCondition: jsonb("success_condition"),
    maxDurationDays: integer("max_duration_days"),
    /** 재합류 지점 (반 루트 노드 참조) */
    rejoinNodeId: uuid("rejoin_node_id"),
    /** 차이 내용: 추가·대체·건너뛰기 노드, 기한 변경 등 구조화 diff */
    delta: jsonb("delta").notNull(),
    createdBy: uuid("created_by"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    ...timestamps(),
  },
  (t) => [
    index("overrides_learner_idx").on(
      t.organizationId,
      t.learnerId,
      t.status,
    ),
    index("overrides_base_version_idx").on(t.baseRouteVersionId),
  ],
);

/** 루트 게시 기록 — 게시·롤백 감사의 근거 */
export const routePublications = pgTable(
  "route_publications",
  {
    id: id(),
    organizationId: organizationId(),
    routePlanId: uuid("route_plan_id").notNull(),
    routeVersionId: uuid("route_version_id").notNull(),
    /** 게시 전 diff 요약 (변경 반·학생, 이동·추가·삭제 차시, 종료일 변화) */
    impactSummary: jsonb("impact_summary"),
    publishedBy: uuid("published_by").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** 예약 게시 시각 */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  },
  (t) => [index("route_publications_plan_idx").on(t.routePlanId)],
);

export const proposalStatus = pgEnum("proposal_status", [
  "calculating",
  "proposed",
  "approved",
  "rejected",
  "applying",
  "applied",
  "failed",
  "expired", // 원본 버전 변경으로 stale — apply 불가 (2G preview/apply)
]);

/**
 * 일정 변경안 (2H). 엔진 입력은 불변 스냅샷이며 같은 입력·엔진 버전·시드는
 * 같은 결과 해시를 만든다 (불변 조건 12).
 */
export const scheduleChangeProposals = pgTable(
  "schedule_change_proposals",
  {
    id: id(),
    organizationId: organizationId(),
    /** 대상 범위: learning_group | learner */
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    /** 트리거: absence | cancellation | partial_completion | test_failure | manual … */
    triggerType: text("trigger_type").notNull(),
    triggerRef: uuid("trigger_ref"),
    status: proposalStatus("status").notNull().default("calculating"),
    /** 입력 스냅샷 (2H 목록 전체) — 재현의 근거 */
    inputSnapshot: jsonb("input_snapshot").notNull(),
    inputHash: text("input_hash").notNull(),
    engineVersion: text("engine_version").notNull(),
    seed: text("seed").notNull(),
    /** 완료 진도 기준 시각 — 이 이전 과거는 변경하지 않는다 */
    cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
    /** 변경 전후 diff + 이유 코드 + 충돌 + 적용 범위 */
    diff: jsonb("diff"),
    reasonCodes: jsonb("reason_codes").notNull().default(sql`'[]'::jsonb`),
    conflicts: jsonb("conflicts"),
    outputHash: text("output_hash"),
    /** 승인·적용 */
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /** 적용으로 만들어진 일정 리비전 */
    resultRevisionId: uuid("result_revision_id"),
    failureReason: text("failure_reason"),
    ...timestamps(),
  },
  (t) => [
    index("proposals_org_status_idx").on(t.organizationId, t.status),
    index("proposals_scope_idx").on(t.scopeType, t.scopeId),
  ],
);

/**
 * 일정 리비전 — 계산 완료·검증된 일정의 원자적 활성 포인터 전환 대상.
 * 실패한 중간 결과는 노출하지 않는다 (2H).
 */
export const scheduleRevisions = pgTable(
  "schedule_revisions",
  {
    id: id(),
    organizationId: organizationId(),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    /** 이 리비전을 만든 변경안 */
    proposalId: uuid("proposal_id"),
    isActive: boolean("is_active").notNull().default(false),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("schedule_revisions_uq").on(
      t.scopeType,
      t.scopeId,
      t.revisionNumber,
    ),
    // 활성 리비전은 스코프당 하나
    uniqueIndex("schedule_revisions_active_uq")
      .on(t.scopeType, t.scopeId)
      .where(sql`is_active = true`),
  ],
);

/**
 * 계획 범위·대상·기간 단위 lease (2H) — 전역 잠금 금지.
 * 같은 스코프의 동시 재계산을 직렬화한다.
 */
export const scheduleLeases = pgTable(
  "schedule_leases",
  {
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    organizationId: organizationId(),
    holderId: text("holder_id").notNull(), // worker id
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("schedule_leases_uq").on(t.scopeType, t.scopeId),
  ],
);

/** 진도 이벤트 — 실제 수행 기록 (append-only). 미래 예측·속도 계산의 원본. */
export const progressEvents = pgTable(
  "progress_events",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id"),
    learningGroupId: uuid("learning_group_id"),
    sessionId: uuid("session_id"),
    routeNodeId: uuid("route_node_id"),
    kind: text("kind").notNull(), // node_completed | node_partial | node_skipped | rejoined | branched
    detail: jsonb("detail"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedBy: uuid("recorded_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("progress_events_learner_idx").on(
      t.organizationId,
      t.learnerId,
      t.occurredAt,
    ),
    index("progress_events_group_idx").on(
      t.organizationId,
      t.learningGroupId,
      t.occurredAt,
    ),
  ],
);
