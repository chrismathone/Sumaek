import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps } from "./_shared";

/* ─────────────────────────────────────────────────────────────
 * 인프라 — Transactional Outbox/Inbox, 작업 큐, 멱등성 저장소
 * 큐 전달은 at-least-once. "정확히 한 번"이나 전역 순서를 가정하지 않는다.
 * ───────────────────────────────────────────────────────────── */

export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "delivering",
  "delivered",
  "failed",
]);

/** 상태 변경과 같은 트랜잭션에서 기록되는 Outbox 이벤트 (2D 필드 계약). */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    /** event_id — 앱에서 UUIDv7 생성 (시간순) */
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateVersion: integer("aggregate_version").notNull(),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    correlationId: uuid("correlation_id"),
    causationId: uuid("causation_id"),
    /** 최소 필요 payload — 개인정보·전체 원문 금지 */
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // 디스패처 폴링 경로 (2J 인덱스 계약)
    index("outbox_status_next_idx").on(t.status, t.nextAttemptAt, t.id),
    index("outbox_aggregate_idx").on(t.aggregateType, t.aggregateId),
  ],
);

/**
 * Inbox — consumer_name + event_id 고유 제약으로 중복 처리를 차단한다.
 * 동일 aggregate 내부의 순서만 보장한다.
 */
export const inboxEvents = pgTable(
  "inbox_events",
  {
    consumerName: text("consumer_name").notNull(),
    eventId: uuid("event_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumerName, t.eventId] })],
);

export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "waiting_review",
  "succeeded",
  "failed_retryable",
  "retry_scheduled",
  "failed_final",
  "dead_lettered",
  "cancel_requested",
  "cancelled",
]);

/**
 * PostgreSQL 기반 작업 큐 (SKIP LOCKED 폴링).
 * - 테넌트별 공정성: 워커가 조직별 동시 실행 한도를 적용
 * - 실시간 채점 토픽이 대량 OCR보다 높은 우선순위
 * - 페이지·문항 단위 checkpoint로 실패 단계부터 재개
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    /** null이면 시스템 작업 */
    organizationId: uuid("organization_id"),
    topic: text("topic").notNull(), // schedule.recalculate | assessment.generate | grading.auto | render.validate | export.pdf | export.hwpx | ingestion.ocr | report.generate | notification.send ...
    priority: integer("priority").notNull().default(100), // 낮을수록 우선. 실시간 채점 10, OCR 500
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: jobStatus("status").notNull().default("queued"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /** `조직 + 원본 해시 + 판본 + 파이프라인 버전 + 단계` 멱등성 키 */
    idempotencyKey: text("idempotency_key"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    workerId: text("worker_id"),
    /** 단계 재개용 체크포인트 */
    checkpoint: jsonb("checkpoint"),
    lastError: text("last_error"),
    /** 입력 해시, 엔진·모델·프롬프트 버전, 비용, 재시도 이력 */
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    ...timestamps(),
  },
  (t) => [
    index("jobs_poll_idx").on(t.status, t.runAt, t.priority),
    index("jobs_topic_status_idx").on(t.topic, t.status),
    index("jobs_org_idx").on(t.organizationId, t.status),
    uniqueIndex("jobs_idempotency_uq")
      .on(t.topic, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
  ],
);

/**
 * 워커 박동 — "지금 워커가 살아 있는가"를 관측 가능하게 만드는 유일한 행.
 *
 * 접속이 Supavisor 풀러를 거쳐 pg_stat_activity로는 워커를 식별할 수 없고,
 * 큐 지표는 일이 있을 때만 죽음을 드러낸다. 유휴 상태의 죽음까지 보려면
 * 워커가 직접 남기는 수밖에 없다 (RB-04 `worker_heartbeat_lost`).
 *
 * 조직 스코프가 없는 플랫폼 테이블이다 — jobs·outbox_events와 같이 RLS를
 * 켜되 정책을 두지 않아 서비스 롤만 접근한다.
 */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  /** 프로세스 단위 식별자 — 재시작하면 새 값이다 */
  workerId: text("worker_id").primaryKey(),
  hostname: text("hostname"),
  pid: integer("pid"),
  /** 이 워커가 처리하는 토픽 — 어느 소비자가 죽었는지 바로 보인다 */
  topics: text("topics").array().notNull().default(sql`'{}'::text[]`),
  /** 박동 주기(초). "얼마나 늦으면 죽은 것인가"를 관측자가 여기서 읽는다 */
  beatIntervalSeconds: integer("beat_interval_seconds").notNull().default(15),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastBeatAt: timestamp("last_beat_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** 정상 종료 표시 — 내려간 것과 죽은 것을 가른다 */
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  stopReason: text("stop_reason"),
  /** 마지막 루프 요약 — 살아 있지만 아무것도 못 하는 상태를 구분한다 */
  lastResult: jsonb("last_result"),
});

/**
 * 쓰기 API 멱등성 저장소 (2G).
 * 같은 키 + 같은 요청 해시 → 저장된 결과 반환. 같은 키 + 다른 payload → 409 거부.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    organizationId: uuid("organization_id").notNull(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    /** 처리 완료 시 직렬화된 응답 (재요청에 그대로 반환) */
    response: jsonb("response"),
    status: text("status").notNull().default("in_progress"), // in_progress | completed | failed
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.operation, t.idempotencyKey],
    }),
    index("idempotency_expires_idx").on(t.expiresAt),
  ],
);
