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
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, organizationId, timestamps } from "./_shared";

/* ─────────────────────────────────────────────────────────────
 * 수학 수업 실행 컨텍스트
 * 소유: 과정 기간, 수업 가능일, 휴일, 학습 그룹, 최소 명단, 실제 수업,
 *       학습 불참 이벤트, 보강, 교사·그룹 시간 충돌 확정
 * 계획 모듈은 변경안만 만들고, 실제 수업 생성·충돌 확정은 이 모듈이 소유한다.
 * ───────────────────────────────────────────────────────────── */

export const coursePeriodStatus = pgEnum("course_period_status", [
  "draft",
  "active",
  "completed",
  "archived",
]);

/** 학년도·학기 등 과정 기간 */
export const coursePeriods = pgTable(
  "course_periods",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(), // 예: 2026학년도 2학기
    academicYear: integer("academic_year").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    status: coursePeriodStatus("status").notNull().default("draft"),
    ...timestamps(),
  },
  (t) => [
    index("course_periods_org_idx").on(t.organizationId, t.academicYear),
  ],
);

export const holidayKind = pgEnum("holiday_kind", [
  "national", // 공휴일
  "academy", // 자체 휴강일
  "school_exam", // 학교 시험 기간 (수업 정책에 따라 수업 유지·변경)
  "vacation", // 방학
]);

export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    organizationId: organizationId(),
    coursePeriodId: uuid("course_period_id"),
    kind: holidayKind("kind").notNull(),
    name: text("name").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    /** 특정 학습 그룹에만 적용할 때 — null이면 전체 */
    learningGroupId: uuid("learning_group_id"),
    ...timestamps(),
  },
  (t) => [
    index("holidays_org_range_idx").on(
      t.organizationId,
      t.startsOn,
      t.endsOn,
    ),
  ],
);

/**
 * 수업 가능 시간 규칙 — 요일·시간대 기반.
 * 버전 컬럼이 있는 이유: 일정 엔진 입력 스냅샷(수업 달력 버전)의 근거.
 */
export const calendarRules = pgTable(
  "calendar_rules",
  {
    id: id(),
    organizationId: organizationId(),
    /** 규칙 대상: 학습 그룹 정규 수업 시간 또는 교사 가용 시간 */
    subjectType: text("subject_type").notNull(), // learning_group | teacher
    subjectId: uuid("subject_id").notNull(),
    /** 0=일요일 … 6=토요일 */
    weekday: integer("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    index("calendar_rules_subject_idx").on(
      t.organizationId,
      t.subjectType,
      t.subjectId,
    ),
  ],
);

export const learnerStatus = pgEnum("learner_status", [
  "active",
  "paused",
  "archived",
]);

/**
 * 학습자 — 최소 데이터 원칙 (1A장).
 * 보호자 연락처, 주소, 생활기록, 상담, 결제 정보는 이 모델에 둘 수 없다.
 */
export const learners = pgTable(
  "learners",
  {
    id: id(),
    organizationId: organizationId(),
    displayName: text("display_name").notNull(),
    /** 학생 로그인 계정이 있는 경우에만 연결 */
    userId: uuid("user_id"),
    /** 적용 교육과정 버전 — 없으면 일정·평가 생성 입력으로 사용 불가 (2K-7) */
    curriculumVersionId: uuid("curriculum_version_id"),
    /** 예: middle-2 (학교급-학년) */
    gradeLevel: text("grade_level"),
    status: learnerStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    index("learners_org_idx").on(t.organizationId, t.status),
    uniqueIndex("learners_org_user_uq")
      .on(t.organizationId, t.userId)
      .where(sql`user_id is not null`),
  ],
);

export const learningGroupStatus = pgEnum("learning_group_status", [
  "planned",
  "operating",
  "completed",
  "archived",
]);

/** 반·학습 그룹 */
export const learningGroups = pgTable(
  "learning_groups",
  {
    id: id(),
    organizationId: organizationId(),
    coursePeriodId: uuid("course_period_id").notNull(),
    name: text("name").notNull(), // 예: 중2 심화 A
    /** 수학 과정 설명 (예: 중등 2-2 심화) */
    courseName: text("course_name"),
    curriculumVersionId: uuid("curriculum_version_id"),
    homeTeacherUserId: uuid("home_teacher_user_id"),
    /** 기본 평가 정책 — 평가 컨텍스트 소유 데이터의 참조 */
    assessmentPolicyId: uuid("assessment_policy_id"),
    status: learningGroupStatus("status").notNull().default("planned"),
    ...timestamps(),
  },
  (t) => [
    index("learning_groups_org_idx").on(t.organizationId, t.status),
    index("learning_groups_teacher_idx").on(
      t.organizationId,
      t.homeTeacherUserId,
    ),
  ],
);

export const groupMembershipStatus = pgEnum("group_membership_status", [
  "active",
  "left",
]);

export const learningGroupMemberships = pgTable(
  "learning_group_memberships",
  {
    id: id(),
    organizationId: organizationId(),
    learningGroupId: uuid("learning_group_id").notNull(),
    learnerId: uuid("learner_id").notNull(),
    joinedOn: date("joined_on").notNull(),
    leftOn: date("left_on"),
    status: groupMembershipStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("lg_memberships_active_uq")
      .on(t.learningGroupId, t.learnerId)
      .where(sql`status = 'active'`),
    index("lg_memberships_learner_idx").on(t.organizationId, t.learnerId),
  ],
);

export const sessionStatus = pgEnum("session_status", [
  "planned",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "makeup_planned", // 취소 후 보강 계획됨
]);

/**
 * 실제 수업 (2F 상태 머신).
 * 완료된 수업은 자동 재계산으로 변경되지 않는다 (불변 조건 5).
 * 교사·학습 그룹 시간 충돌은 마이그레이션의 EXCLUDE 제약(tstzrange)으로 DB에서도 차단.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    organizationId: organizationId(),
    learningGroupId: uuid("learning_group_id").notNull(),
    teacherUserId: uuid("teacher_user_id"),
    /** 워크스페이스 시간대 기준 수업 날짜 — 시간대 ID와 함께 보존 (불변 조건 14) */
    sessionDate: date("session_date").notNull(),
    timezone: text("timezone").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: sessionStatus("status").notNull().default("planned"),
    /** 이 수업을 만든 활성 일정 리비전 */
    scheduleRevisionId: uuid("schedule_revision_id"),
    /** 계획된 루트 노드 참조 목록 */
    plannedNodeIds: jsonb("planned_node_ids").notNull().default(sql`'[]'::jsonb`),
    /** 실제 진행 범위 기록 (부분 완료·미진행 사유 포함) */
    actualProgress: jsonb("actual_progress"),
    teacherNote: text("teacher_note"),
    /** 선생님이 잠근 일정은 자동 재계산 대상에서 제외 (불변 조건 5) */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledReason: text("cancelled_reason"),
    ...timestamps(),
  },
  (t) => [
    // 2J 인덱스 계약
    index("sessions_group_starts_idx").on(
      t.organizationId,
      t.learningGroupId,
      t.startsAt,
    ),
    index("sessions_teacher_starts_idx").on(
      t.organizationId,
      t.teacherUserId,
      t.startsAt,
    ),
    index("sessions_date_idx").on(t.organizationId, t.sessionDate),
  ],
);

/**
 * 학습자 스코프 일정 항목 (인수 4) — 학생 개별 경로의 실체화 결과.
 *
 * 반 공통 수업(sessions)을 복제하지 않는다. 학생이 그 차시에 실제로 무엇을
 * 하는지만 기록하고, 같은 날짜·시간의 반 수업이 있으면 sessionId로 잇는다.
 * 그래서 학생 일정을 다시 계산해도 sessions 행은 하나도 변하지 않는다
 * (불변 조건 4 — 오버라이드는 반 루트·다른 학생에게 영향이 없다).
 *
 * 반 공통과 같은 계획이면 matchesGroup=true — 즉 이 차시에는 갈라지지 않는다.
 * isRejoin=true인 행이 "학생이 반 진도로 돌아오는 차시"다.
 */
export const learnerScheduleItems = pgTable(
  "learner_schedule_items",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id").notNull(),
    learningGroupId: uuid("learning_group_id").notNull(),
    /** 이 항목을 만든 학습자 스코프 일정 리비전 */
    scheduleRevisionId: uuid("schedule_revision_id"),
    /** 같은 날짜·시간의 반 공통 수업 — 반 일정 밖으로 밀린 항목이면 null */
    sessionId: uuid("session_id"),
    /** 워크스페이스 시간대 기준 날짜 — 시간대 ID와 함께 보존 (불변 조건 14) */
    itemDate: date("item_date").notNull(),
    timezone: text("timezone").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    plannedNodeIds: jsonb("planned_node_ids").notNull().default(sql`'[]'::jsonb`),
    /** 이 차시 배치의 엔진 이유 코드 */
    reasonCodes: jsonb("reason_codes").notNull().default(sql`'[]'::jsonb`),
    /** 반 공통 계획과 노드가 같은가 — false면 이 차시에서 학생이 갈라진다 */
    matchesGroup: boolean("matches_group").notNull().default(false),
    /** 이 차시에서 반 공통 경로로 재합류한다 */
    isRejoin: boolean("is_rejoin").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("learner_schedule_items_learner_idx").on(
      t.organizationId,
      t.learnerId,
      t.itemDate,
    ),
    index("learner_schedule_items_session_idx").on(t.sessionId),
    index("learner_schedule_items_revision_idx").on(t.scheduleRevisionId),
  ],
);

export const availabilityEventKind = pgEnum("availability_event_kind", [
  "learner_absence", // 학습 불참 (외부 전달 또는 수동)
  "learner_unavailable", // 특정 슬롯 수업 불가
  "group_cancelled", // 휴강
]);

export const availabilityEventStatus = pgEnum("availability_event_status", [
  "received",
  "applied", // 일정 변경안에 반영됨
  "dismissed",
]);

/**
 * 학습 불참·수업 불가 이벤트 — 전자출결 기능이 아니다.
 * 외부에서 이미 확정된 사실만 수신하며, 일정 재계산의 입력이 된다.
 */
export const learningAvailabilityEvents = pgTable(
  "learning_availability_events",
  {
    id: id(),
    organizationId: organizationId(),
    kind: availabilityEventKind("kind").notNull(),
    learnerId: uuid("learner_id"),
    learningGroupId: uuid("learning_group_id"),
    sessionId: uuid("session_id"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    source: text("source").notNull().default("manual"), // manual | integration:<id>
    reason: text("reason"),
    status: availabilityEventStatus("status").notNull().default("received"),
    /** 이 이벤트가 만든 일정 변경안 */
    scheduleProposalId: uuid("schedule_proposal_id"),
    ...timestamps(),
  },
  (t) => [
    index("availability_events_org_idx").on(
      t.organizationId,
      t.status,
      t.startsOn,
    ),
    index("availability_events_learner_idx").on(
      t.organizationId,
      t.learnerId,
    ),
  ],
);

export const makeupSessionStatus = pgEnum("makeup_session_status", [
  "proposed",
  "confirmed",
  "completed",
  "cancelled",
]);

/* ─────────────────────────────────────────────────────────────
 * 학생 실행층 (③) — ADR-0018 §1·§2.
 *
 * 위의 learner_schedule_items(②)를 **대체하지 않는다.** ②는 "이 학생이
 * 언제 어떤 노드를 하나"까지만 답하는 엔진 산출물이고, 일정이 바뀔 때마다
 * 덮어써야 한다. ③은 "이 학생이 오늘 무엇을 하고 끝냈나"이고 완료 이력이
 * 역행하면 안 된다. 한 테이블에 두면 재계산마다 「덮어써도 되는 행」과
 * 「건드리면 안 되는 행」을 런타임에 갈라야 하고, 그 판단이 틀리는 순간
 * 학생의 완료 기록이 사라진다.
 *
 * ②의 노드 목록을 자료·평가·복습·숙제 항목으로 **펼친** 결과가 ③이다.
 * 펼치는 규칙은 노드 실행기(packages/core/src/learning)가 가진다.
 * ───────────────────────────────────────────────────────────── */

/** 하루 계획이 어디서 나왔나 — ②가 있으면 ①을 섞지 않는다 */
export const learnerDayPlanSource = pgEnum("learner_day_plan_source", [
  "learner_schedule", // learner_schedule_items (개인 경로)
  "group_session", // sessions (반 공통 fallback)
  "review_only", // 수업 없는 날의 복습만
]);

/**
 * 하루 상태. `empty`는 저장하지 않는다 — 항목이 없는 날은 행 자체가 없거나
 * 항목이 0건이며, 화면이 파생으로 계산한다 (packages/core decideDayStatus).
 */
export const learnerDayPlanStatus = pgEnum("learner_day_plan_status", [
  "not_started",
  "in_progress",
  "blocked",
  "completed",
]);

export const learnerDayPlanItemKind = pgEnum("learner_day_plan_item_kind", [
  "reading",
  "video",
  "practice",
  "assessment",
  "review",
  "book_range",
  "homework",
]);

/**
 * 항목 상태. `blocked`(고쳐야 할 사고)와 `exempted`(교사의 판단)를 합치지
 * 않는다 — 합치면 자료를 안 올린 사고가 「면제됨」으로 위장된다 (ADR-0017 §2).
 */
export const learnerDayPlanItemStatus = pgEnum("learner_day_plan_item_status", [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "exempted",
]);

/** 학생 하루 실행 계획 — 한 학생·한 날짜에 하나 */
export const learnerDayPlans = pgTable(
  "learner_day_plans",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id").notNull(),
    /** 워크스페이스 시간대(KST) 기준 날짜 — 시간대 ID와 함께 보존 (I-14) */
    planDate: date("plan_date").notNull(),
    timezone: text("timezone").notNull(),
    /** 복습만 있는 날이면 null */
    learningGroupId: uuid("learning_group_id"),
    source: learnerDayPlanSource("source").notNull(),
    /** learner_schedule_items.id 또는 sessions.id */
    sourceRefId: uuid("source_ref_id"),
    status: learnerDayPlanStatus("status").notNull().default("not_started"),
    /** 학생이 그날 처음 연 시각 — 이후 필수 분모는 늘지 않는다 (ADR-0017 §4) */
    materializedAt: timestamp("materialized_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** 설정 후 불변 (I-22). 완료 취소도 이 값을 지우지 않는다 */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** 교사의 완료 취소 — completed_at을 지우는 대신 이것을 더한다 */
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenedBy: uuid("reopened_by"),
    reopenReason: text("reopen_reason"),
    /** 같은 입력이면 같은 값 — 투영 결정론 검증 (I-12 계열) */
    projectionHash: text("projection_hash").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("learner_day_plans_uq").on(
      t.organizationId,
      t.learnerId,
      t.planDate,
    ),
    // 교사 현황판(T4.4)이 날짜·상태로 훑는다
    index("learner_day_plans_date_status_idx").on(
      t.organizationId,
      t.planDate,
      t.status,
    ),
    index("learner_day_plans_group_date_idx").on(
      t.organizationId,
      t.learningGroupId,
      t.planDate,
    ),
  ],
);

/** 하루 계획의 항목 — 노드를 펼친 결과 */
export const learnerDayPlanItems = pgTable(
  "learner_day_plan_items",
  {
    id: id(),
    organizationId: organizationId(),
    learnerDayPlanId: uuid("learner_day_plan_id").notNull(),
    /**
     * 투영기가 만드는 안정 키(`kind:refId` 꼴). 재투영 멱등의 기준이라
     * 같은 항목은 언제 투영해도 같은 키를 가져야 한다.
     */
    itemKey: text("item_key").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    kind: learnerDayPlanItemKind("kind").notNull(),
    required: boolean("required").notNull(),
    /** 복습처럼 노드에서 나오지 않는 항목은 null */
    routeNodeId: uuid("route_node_id"),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    /** 그날 학생이 실제로 본 문구 — 원본 제목이 바뀌어도 기록은 그대로 (I-08 성질) */
    titleSnapshot: text("title_snapshot").notNull(),
    status: learnerDayPlanItemStatus("status").notNull().default("pending"),
    /** 준비도 게이트(T2.4)와 같은 코드 레지스트리를 쓴다 */
    blockedReason: text("blocked_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** 확정 후에 붙은 항목은 선택이다 — 왜 선택인지를 데이터로 남긴다 */
    addedAfterMaterialization: boolean("added_after_materialization")
      .notNull()
      .default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("learner_day_plan_items_uq").on(t.learnerDayPlanId, t.itemKey),
    index("learner_day_plan_items_order_idx").on(t.learnerDayPlanId, t.ordinal),
  ],
);

/** 보강 수업 — 원 수업과 대상 학습자를 연결 */
export const makeupSessions = pgTable(
  "makeup_sessions",
  {
    id: id(),
    organizationId: organizationId(),
    originalSessionId: uuid("original_session_id").notNull(),
    /** 개별 보강이면 학습자, 반 전체 보강이면 null */
    learnerId: uuid("learner_id"),
    /** 보강으로 생성된 실제 수업 */
    makeupSessionId: uuid("makeup_session_id"),
    status: makeupSessionStatus("status").notNull().default("proposed"),
    reason: text("reason"),
    ...timestamps(),
  },
  (t) => [
    index("makeup_sessions_org_idx").on(t.organizationId, t.status),
    index("makeup_sessions_original_idx").on(t.originalSessionId),
  ],
);
