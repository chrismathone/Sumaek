import { sql } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id, organizationId, timestamps } from "./_shared";

/* ─────────────────────────────────────────────────────────────
 * 지원 기능 컨텍스트 — 알림, 리포트, 가져오기
 * (검색·대시보드 읽기 모델은 파생 계층이므로 뷰·머티리얼라이즈드 뷰로 구현)
 * ───────────────────────────────────────────────────────────── */

export const notificationStatus = pgEnum("notification_status", [
  "unread",
  "read",
  "in_progress",
  "done",
  "snoozed",
]);

/**
 * 알림·업무함 (22장). 무슨 일이·왜·영향 대상·권장 행동·기한을 반드시 포함.
 * 외부 알림 제공자 장애 시에도 앱 내부 업무함은 유지된다.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: organizationId(),
    recipientUserId: uuid("recipient_user_id").notNull(),
    kind: text("kind").notNull(), // today_task | route_approval | schedule_conflict | test_generation_failed | grading_exception | learner_risk | content_review | import_error | system_notice
    title: text("title").notNull(),
    /** what/why/impact/action/deadline 구조 */
    body: jsonb("body").notNull(),
    /** 관련 화면 딥링크 */
    linkPath: text("link_path"),
    relatedType: text("related_type"),
    relatedId: uuid("related_id"),
    /** 유사 알림 묶기 키 */
    groupKey: text("group_key"),
    status: notificationStatus("status").notNull().default("unread"),
    assignedTo: uuid("assigned_to"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // 오늘 업무 조회 경로 (2J: organization_id, status, due_at)
    index("notifications_org_status_due_idx").on(
      t.organizationId,
      t.status,
      t.dueAt,
    ),
    index("notifications_recipient_idx").on(
      t.recipientUserId,
      t.status,
    ),
  ],
);

export const reportStatus = pgEnum("report_status", [
  "draft",
  "generating",
  "review_required",
  "approved",
  "exported",
  "failed",
  "archived",
]);

/** 리포트 (21장) — 자동 서술에는 사용 데이터·기간 표시, 승인 후 내보내기 */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    organizationId: organizationId(),
    kind: text("kind").notNull(), // learner_weekly | learner_monthly | group_session | test_results | progress_plan | mastery | program_coverage
    subjectType: text("subject_type").notNull(), // learner | learning_group | assessment | workspace
    subjectId: uuid("subject_id"),
    /** 데이터 기간·기준 버전 */
    dataWindow: jsonb("data_window").notNull(),
    status: reportStatus("status").notNull().default("draft"),
    /** 구조화 본문 (렌더는 파생) */
    content: jsonb("content"),
    generatedBy: text("generated_by"), // system | user:<id>
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    exportRefs: jsonb("export_refs"),
    failureReason: text("failure_reason"),
    ...timestamps(),
  },
  (t) => [
    index("reports_org_idx").on(t.organizationId, t.kind, t.status),
    index("reports_subject_idx").on(t.subjectType, t.subjectId),
  ],
);

export const importJobStatus = pgEnum("import_job_status", [
  "uploaded",
  "previewing",
  "preview_ready", // 행 단위 오류 미리보기 제공
  "applying",
  "partially_applied",
  "applied",
  "failed",
  "cancelled",
]);

/**
 * 가져오기 (7장 온보딩·23장). 업로드 전 미리보기 — 중복 학생, 잘못된 날짜,
 * 알 수 없는 반, 필수값 누락을 행 단위로 보고, 오류 행만 수정해 재처리.
 */
export const importJobs = pgTable(
  "import_jobs",
  {
    id: id(),
    organizationId: organizationId(),
    kind: text("kind").notNull(), // learner_roster_csv | group_roster_csv | external_sis
    fileRef: text("file_ref"),
    fileChecksum: text("file_checksum"),
    status: importJobStatus("status").notNull().default("uploaded"),
    /** 행 단위 검증 결과: [{row, level, field, message}] */
    previewReport: jsonb("preview_report"),
    /** 적용 결과: 생성·갱신·건너뜀·실패 수 */
    resultCounts: jsonb("result_counts"),
    createdBy: uuid("created_by").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("import_jobs_org_idx").on(t.organizationId, t.status)],
);

/**
 * 도입 문의 (공개 랜딩 /request-demo). 테넌트 이전 데이터 — 조직 스코프 없음.
 * RLS: authenticated 정책 없음 (서버 전용 쓰기·운영 콘솔 조회).
 */
export const demoRequests = pgTable(
  "demo_requests",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    organizationName: text("organization_name"),
    role: text("role"), // 개인 교사 | 교무·교육과정 책임자 | 콘텐츠팀 | 기타
    message: text("message"),
    status: text("status").notNull().default("new"), // new | contacted | closed
    ...timestamps(),
  },
  (t) => [index("demo_requests_status_idx").on(t.status, t.createdAt)],
);

/**
 * break-glass 운영자 접근 승인 (27장). 시간 제한·사유·승인·감사.
 * 일반 관리자는 감사 로그를 수정할 수 없다.
 */
export const operatorAccessGrants = pgTable(
  "operator_access_grants",
  {
    id: id(),
    organizationId: organizationId(),
    operatorUserId: uuid("operator_user_id").notNull(),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** 워크스페이스 소유자에게 표시되었는가 */
    disclosedToOwner: timestamp("disclosed_to_owner", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("operator_grants_org_idx").on(t.organizationId, t.expiresAt),
  ],
);

export const deletionRequestStatus = pgEnum("deletion_request_status", [
  "received",
  "processing",
  "completed",
  "rejected",
]);

/**
 * 개인정보 삭제 요청 (ADR-0015 §5·§7 · 인수 39).
 * 처리 방식은 익명화다 — display_name 토큰 치환 + 서술 답안 본문 삭제,
 * 점수·학습 증거는 안정 토큰(UUID)으로 보존한다.
 * PITR 복원 후 "미처리 삭제 요청 재실행" 목록이기도 하다 (F-5).
 */
export const dataDeletionRequests = pgTable(
  "data_deletion_requests",
  {
    id: id(),
    organizationId: organizationId(),
    subjectType: text("subject_type").notNull().default("learner"), // learner | organization
    learnerId: uuid("learner_id"),
    requestedBy: uuid("requested_by").notNull(),
    reason: text("reason").notNull(),
    status: deletionRequestStatus("status").notNull().default("received"),
    /** 처리 기한 — 영업일 10일 (ADR-0015 §5) */
    dueOn: date("due_on").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    executedBy: uuid("executed_by"),
    /** 백업(PITR) 만료 예정일 — 요청자 고지 의무 (ADR-0015 §7) */
    backupExpiresOn: date("backup_expires_on"),
    /** 처리 요약: 토큰화·본문 삭제·보존 항목 수 */
    summary: jsonb("summary"),
    ...timestamps(),
  },
  (t) => [
    index("deletion_requests_org_idx").on(t.organizationId, t.status),
    index("deletion_requests_learner_idx").on(t.learnerId),
  ],
);
