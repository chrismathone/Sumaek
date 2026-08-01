import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
 * break-glass 운영자 접근 승인 (27장 · 인수 28). 시간 제한·사유·승인·감사.
 * 일반 관리자는 감사 로그를 수정할 수 없다.
 *
 * 컬럼만으로는 아무것도 집행되지 않는다 — 불변식(사유 비어 있지 않음, 만료
 * 필수·최대 4시간, 승인자·승인시각 짝)은 CHECK로 테이블에 박혀 있고
 * (0006a_operator_access_enforcement.sql), 열림/닫힘 판정은
 * `@su-maek/core/authz`의 grantState 하나가 맡는다.
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
    /** 절대 시각. 조직 시간대와 무관하게 이 순간 접근이 닫힌다 */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** 워크스페이스 소유자에게 표시되었는가 */
    disclosedToOwner: timestamp("disclosed_to_owner", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("operator_grants_org_idx").on(t.organizationId, t.expiresAt),
    /** 세션 해석 경로 — 운영자 한 명의 살아있는 승인 찾기 */
    index("operator_grants_operator_idx").on(t.operatorUserId, t.expiresAt),
    check("operator_access_grants_reason_not_blank", sql`btrim(reason) <> ''`),
    check(
      "operator_access_grants_window",
      sql`expires_at > created_at and expires_at <= created_at + interval '4 hours'`,
    ),
    check(
      "operator_access_grants_approval_pair",
      sql`(approved_by is null) = (approved_at is null)`,
    ),
    check(
      "operator_access_grants_revocation",
      sql`revoked_at is null or revoked_at >= created_at`,
    ),
  ],
);

/**
 * AI 사용량 이벤트 (골프롬프트 28장 · 인수 37) — 조직별 비용 집계의 원본.
 * 목 공급자도 실제와 같은 형태로 기록해 한도 로직이 처음부터 검증된다.
 */
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: id(),
    organizationId: organizationId(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    operation: text("operation").notNull(), // extract_questions | ...
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** 추정 비용 (USD) — 가격표 버전과 함께 기록해 재계산 가능 */
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    pricingVersion: text("pricing_version").notNull(),
    relatedType: text("related_type"),
    relatedId: uuid("related_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ai_usage_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

/** 조직별 월 AI 예산 — 80% 경고, 100% 차단 (인수 37) */
export const aiBudgets = pgTable(
  "ai_budgets",
  {
    id: id(),
    organizationId: organizationId(),
    monthlyLimitUsd: numeric("monthly_limit_usd", { precision: 10, scale: 2 })
      .notNull(),
    warnRatio: numeric("warn_ratio", { precision: 3, scale: 2 })
      .notNull()
      .default("0.8"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("ai_budgets_org_uq").on(t.organizationId)],
);

/**
 * AI 모델 버전 레지스트리 (인수 36) — 무엇이 실사용이고 무엇이 카나리인가.
 *
 * 조직 스코프인 이유: 카나리에 얹히는 것은 **그 조직의 실사용 원문**이고,
 * 승격 판정도 그 조직에서 모인 표본으로 한다. 전역 롤아웃은 조직별 행을
 * 만드는 운영 절차(`pnpm ai-canary register`)로 갈음한다 — 데이터 경계를
 * 흐리는 것보다 행을 여러 개 만드는 편이 낫다.
 *
 * role 의미와 상태 전이는 packages/core/src/ai/model-registry.ts 가 단일 정의처.
 * 조직·작업당 active 1행·canary 1행은 부분 유니크 인덱스로 강제한다
 * (0008a 마이그레이션 — drizzle이 표현하지 못한다).
 */
export const aiModelVersions = pgTable(
  "ai_model_versions",
  {
    id: id(),
    organizationId: organizationId(),
    /** 담당 작업 — ai_usage_events.operation 과 같은 축 */
    operation: text("operation").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** candidate | canary | active | halted | retired */
    role: text("role").notNull().default("candidate"),
    notes: text("notes"),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    haltedAt: timestamp("halted_at", { withTimezone: true }),
    /** 중단 사유 — 사유 없는 중단은 CHECK가 막는다 */
    haltReason: text("halt_reason"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("ai_model_versions_identity_uq").on(
      t.organizationId,
      t.operation,
      t.provider,
      t.model,
    ),
    index("ai_model_versions_role_idx").on(
      t.organizationId,
      t.operation,
      t.role,
    ),
    check(
      "ai_model_versions_role_allowed",
      sql`role in ('candidate','canary','active','halted','retired')`,
    ),
    check(
      "ai_model_versions_halt_reason",
      sql`role <> 'halted' or (halted_at is not null and btrim(coalesce(halt_reason, '')) <> '')`,
    ),
  ],
);

/**
 * 섀도 평가 관측 (인수 36) — 카나리 호출 1회당 1행.
 *
 * **여기에 카나리의 산출물(문항)은 없다.** 일치도·지연·비용·실패만 남는다.
 * 산출물을 저장하면 언젠가 누군가 그것을 읽어 쓰게 되고, 그 순간 섀도가
 * 아니게 된다.
 */
export const aiShadowEvaluations = pgTable(
  "ai_shadow_evaluations",
  {
    id: id(),
    organizationId: organizationId(),
    operation: text("operation").notNull(),
    baselineProvider: text("baseline_provider").notNull(),
    baselineModel: text("baseline_model").notNull(),
    canaryProvider: text("canary_provider").notNull(),
    canaryModel: text("canary_model").notNull(),
    ok: boolean("ok").notNull(),
    /** circuit_open | timeout | unavailable | other */
    errorKind: text("error_kind"),
    errorMessage: text("error_message"),
    /** 0~1. 실패 표본은 null — 0으로 두면 "완전 불일치"와 구분되지 않는다 */
    agreement: numeric("agreement", { precision: 4, scale: 3 }),
    baselineLatencyMs: integer("baseline_latency_ms").notNull(),
    canaryLatencyMs: integer("canary_latency_ms").notNull(),
    /** null = 가격표에 없는 모델. 0(무료)과 구분한다 */
    baselineCostUsd: numeric("baseline_cost_usd", {
      precision: 10,
      scale: 6,
    }),
    canaryCostUsd: numeric("canary_cost_usd", { precision: 10, scale: 6 }),
    canaryInputTokens: integer("canary_input_tokens").notNull().default(0),
    canaryOutputTokens: integer("canary_output_tokens").notNull().default(0),
    /** 문항 수 차이·정답 불일치 수 등 일치도 내역 */
    detail: jsonb("detail"),
    relatedType: text("related_type"),
    relatedId: uuid("related_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ai_shadow_org_model_idx").on(
      t.organizationId,
      t.operation,
      t.canaryModel,
      t.createdAt,
    ),
    check(
      "ai_shadow_agreement_pairs_ok",
      sql`(ok and agreement is not null) or ((not ok) and agreement is null)`,
    ),
    check(
      "ai_shadow_error_kind_pairs_ok",
      sql`(ok and error_kind is null) or ((not ok) and error_kind is not null)`,
    ),
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
