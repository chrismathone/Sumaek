import { sql } from "drizzle-orm";
import {
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
