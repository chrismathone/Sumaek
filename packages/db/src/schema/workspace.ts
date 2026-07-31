import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, timestamps } from "./_shared";

/* ─────────────────────────────────────────────────────────────
 * 워크스페이스·권한 컨텍스트
 * 소유: 조직/개인 워크스페이스, 사용자, 멤버십, 역할, 권한, 테넌트 격리
 * ───────────────────────────────────────────────────────────── */

export const workspaceKind = pgEnum("workspace_kind", [
  "organization",
  "personal",
]);

export const workspaceStatus = pgEnum("workspace_status", [
  "active",
  "suspended",
  "archived",
]);

/** 조직 또는 개인 워크스페이스. 테넌트 경계의 루트. */
export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: workspaceKind("kind").notNull().default("organization"),
    status: workspaceStatus("status").notNull().default("active"),
    /** IANA 시간대 ID — 일정 엔진 입력 스냅샷에 복사되어 보존된다. */
    timezone: text("timezone").notNull().default("Asia/Seoul"),
    /** 학년도 시작 월 등 워크스페이스 기본값 (비밀값 금지) */
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    ...timestamps(),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

/**
 * auth.users의 public 미러. 역할·테넌트 판정은 JWT app_metadata가 아니라
 * 항상 이 테이블에서 읽는다 (드리프트 0 — eywa 실사고 반영).
 */
export const users = pgTable("users", {
  /** auth.users.id와 동일 */
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  defaultOrganizationId: uuid("default_organization_id"),
  ...timestamps(),
});

export const memberRole = pgEnum("member_role", [
  "owner", // 워크스페이스 소유자
  "program_director", // 수학 프로그램 책임자
  "teacher", // 선생님
  "grader", // 평가 조교·채점자
  "content_manager", // 콘텐츠 관리자
  "content_reviewer", // 콘텐츠 검수자
  "student", // 학생
]);

export const membershipStatus = pgEnum("membership_status", [
  "invited",
  "active",
  "suspended",
  "left",
]);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: organizationId(),
    userId: uuid("user_id").notNull(),
    role: memberRole("role").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    invitedBy: uuid("invited_by"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const scopeKind = pgEnum("scope_kind", [
  "all", // 워크스페이스 전체 (owner, program_director 기본)
  "learning_group", // 담당 반·학습 그룹
  "student", // 개별 학생
]);

/**
 * 대상 범위 권한 — 역할 권한과 직교. scoped 역할(teacher, grader)은
 * 메뉴 접근과 별개로 이 스코프가 쿼리 필터의 근거가 된다.
 */
export const membershipScopes = pgTable(
  "membership_scopes",
  {
    id: id(),
    organizationId: organizationId(),
    membershipId: uuid("membership_id").notNull(),
    scopeKind: scopeKind("scope_kind").notNull(),
    /** scope_kind가 all이면 null */
    scopeId: uuid("scope_id"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("membership_scopes_uq").on(
      t.membershipId,
      t.scopeKind,
      t.scopeId,
    ),
    index("membership_scopes_org_idx").on(t.organizationId),
  ],
);

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
]);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: organizationId(),
    email: text("email").notNull(),
    role: memberRole("role").notNull(),
    /** 원문 토큰은 저장하지 않는다 — sha256 해시만 */
    tokenHash: text("token_hash").notNull(),
    status: invitationStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull(),
    acceptedBy: uuid("accepted_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_uq").on(t.tokenHash),
    index("invitations_org_email_idx").on(t.organizationId, t.email),
  ],
);

/**
 * 외부 SIS·LMS 식별자 연결. 허용 목록 밖 필드(결제·상담·출결 원장·보호자
 * 연락처)는 payload에 저장할 수 없다 — 어댑터가 수신 시 폐기하고,
 * 스키마 리뷰·boundary-check가 이를 강제한다.
 */
export const externalIdentities = pgTable(
  "external_identities",
  {
    id: id(),
    organizationId: organizationId(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    /** 연결 대상: users.id 또는 learning_groups.id 등 */
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    /** 허용 목록 필드만 (표시명, 학년 등) */
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("external_identities_uq").on(
      t.organizationId,
      t.provider,
      t.externalId,
    ),
    index("external_identities_target_idx").on(t.targetType, t.targetId),
  ],
);

export const integrationKind = pgEnum("integration_kind", [
  "sis", // 학사 시스템 — 사용자/학습 그룹 동기화
  "lms", // 평가 결과 내보내기, 오늘 학습 링크
  "erp_adapter", // 수업 참여 이벤트 수신 (전자출결 제품이 아님)
]);

export const integrationStatus = pgEnum("integration_status", [
  "connected",
  "paused",
  "error",
  "disconnected",
]);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    organizationId: organizationId(),
    kind: integrationKind("kind").notNull(),
    name: text("name").notNull(),
    status: integrationStatus("status").notNull().default("connected"),
    /** 비밀값 금지 — 비밀은 별도 비밀 관리, 여기는 참조 키만 */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    /** 수신·송신 허용 필드 목록 — 이 밖의 필드는 저장 전 폐기 */
    allowedFields: jsonb("allowed_fields").notNull().default(sql`'[]'::jsonb`),
    ...timestamps(),
  },
  (t) => [index("integration_connections_org_idx").on(t.organizationId)],
);

/**
 * 동기화 커서·상태. 이슈는 error 필드에만 쌓지 말고 issueCount를 UI 배지로
 * 노출한다 (write-only orphan 실사고 반영).
 */
export const integrationSyncCursors = pgTable(
  "integration_sync_cursors",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: uuid("connection_id").notNull(),
    resource: text("resource").notNull(),
    cursor: text("cursor"),
    lastStatus: text("last_status").notNull().default("ok"),
    lastError: text("last_error"),
    issueCount: jsonb("issue_count").notNull().default(sql`'0'::jsonb`),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("integration_sync_cursors_uq").on(t.connectionId, t.resource),
  ],
);

export const auditActorType = pgEnum("audit_actor_type", [
  "user",
  "system",
  "automation",
  "operator", // break-glass 운영자
]);

/**
 * 감사 로그 — 관측 로그와 분리. 일반 수정 API로 변경·삭제 불가(RLS로 강제).
 * 수행자, 시각, 변경 이유, 변경 전후, 영향 대상, 자동화 규칙 버전 보존.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    organizationId: organizationId(),
    actorType: auditActorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    reason: text("reason"),
    before: jsonb("before"),
    after: jsonb("after"),
    /** 자동화가 수행한 경우 적용된 규칙·정책 버전 */
    ruleVersion: text("rule_version"),
    traceId: text("trace_id"),
    /** break-glass 접근 시 승인 근거 */
    accessGrantId: uuid("access_grant_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_events_target_idx").on(t.targetType, t.targetId),
  ],
);

/** 독립 kill switch (28장) — 꺼도 수동 운영과 확정 데이터 열람은 가능해야 한다. */
export const killSwitches = pgTable(
  "kill_switches",
  {
    id: id(),
    /** null이면 전역 스위치 */
    organizationId: uuid("organization_id"),
    key: text("key").notNull(), // auto_reschedule | auto_publish_questions | auto_grading | curriculum_release | formula_autofix | document_export | external_notifications | ai_provider:<name>
    enabled: boolean("enabled").notNull().default(true),
    reason: text("reason"),
    changedBy: uuid("changed_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("kill_switches_scope_key_uq").on(t.organizationId, t.key),
  ],
);
