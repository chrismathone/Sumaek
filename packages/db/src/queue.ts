import type postgres from "postgres";

/* ─────────────────────────────────────────────────────────────
 * PostgreSQL 기반 작업 큐 + Transactional Outbox 디스패처.
 *
 * - at-least-once 전달. 소비자는 Inbox(consumer_name + event_id)로 멱등 처리.
 * - SKIP LOCKED 클레임 — 전역 잠금 없음.
 * - 408·429·일시적 5xx만 자동 재시도 (지수 백오프 + 전체 지터).
 * - 테넌트 공정성: 클레임 시 조직별 동시 실행 수를 제한.
 * ───────────────────────────────────────────────────────────── */

export interface EnqueueJobInput {
  topic: string;
  payload: unknown;
  organizationId?: string | null;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
  /** `조직+원본해시+판본+파이프라인버전+단계` 형태 권장 */
  idempotencyKey?: string;
}

export async function enqueueJob(
  sql: postgres.Sql,
  input: EnqueueJobInput,
): Promise<{ jobId: string; deduplicated: boolean }> {
  const rows = await sql<{ id: string }[]>`
    insert into jobs (organization_id, topic, priority, payload, run_at, max_attempts, idempotency_key)
    values (
      ${input.organizationId ?? null},
      ${input.topic},
      ${input.priority ?? 100},
      ${sql.json(input.payload as never)},
      ${input.runAt ?? new Date()},
      ${input.maxAttempts ?? 5},
      ${input.idempotencyKey ?? null}
    )
    on conflict (topic, idempotency_key) where idempotency_key is not null
    do nothing
    returning id
  `;
  if (rows.length > 0 && rows[0]) {
    return { jobId: rows[0].id, deduplicated: false };
  }
  // 멱등 충돌 — 기존 작업 반환
  const existing = await sql<{ id: string }[]>`
    select id from jobs
    where topic = ${input.topic} and idempotency_key = ${input.idempotencyKey ?? null}
    limit 1
  `;
  return { jobId: existing[0]?.id ?? "", deduplicated: true };
}

export interface ClaimedJob {
  id: string;
  organization_id: string | null;
  topic: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  checkpoint: unknown;
  meta: unknown;
}

/**
 * 작업 클레임 — SKIP LOCKED + 조직별 동시 실행 한도.
 * 우선순위(낮을수록 먼저)·run_at 순. lease 만료 시 다른 워커가 회수 가능.
 */
export async function claimJobs(
  sql: postgres.Sql,
  options: {
    topics: string[];
    workerId: string;
    limit: number;
    leaseSeconds?: number;
    maxPerOrganization?: number;
  },
): Promise<ClaimedJob[]> {
  const lease = options.leaseSeconds ?? 300;
  const maxPerOrg = options.maxPerOrganization ?? 4;
  return sql.begin(async (tx) => {
    const candidates = await tx<ClaimedJob[]>`
      select id, organization_id, topic, payload, attempts, max_attempts, checkpoint, meta
      from jobs
      where topic = any(${options.topics})
        and (
          status = 'queued'
          or status = 'retry_scheduled'
          or (status = 'running' and lease_expires_at < now())
        )
        and run_at <= now()
      order by priority asc, run_at asc, id asc
      limit ${options.limit * 3}
      for update skip locked
    `;

    // 조직별 공정성 — 이미 실행 중인 수 + 이번 클레임 수 합산 제한
    const runningByOrg = await tx<
      { organization_id: string | null; cnt: number }[]
    >`
      select organization_id, count(*)::int as cnt
      from jobs
      where status = 'running' and lease_expires_at >= now()
      group by organization_id
    `;
    const orgCounts = new Map<string, number>(
      runningByOrg.map((r) => [r.organization_id ?? "_system", r.cnt]),
    );

    const selected: ClaimedJob[] = [];
    for (const job of candidates) {
      if (selected.length >= options.limit) break;
      const orgKey = job.organization_id ?? "_system";
      const current = orgCounts.get(orgKey) ?? 0;
      if (job.organization_id !== null && current >= maxPerOrg) continue;
      orgCounts.set(orgKey, current + 1);
      selected.push(job);
    }

    if (selected.length > 0) {
      const ids = selected.map((j) => j.id);
      await tx`
        update jobs
        set status = 'running',
            attempts = attempts + 1,
            worker_id = ${options.workerId},
            lease_expires_at = now() + make_interval(secs => ${lease}),
            updated_at = now()
        where id = any(${ids})
      `;
    }
    return selected;
  }) as Promise<ClaimedJob[]>;
}

export async function completeJob(
  sql: postgres.Sql,
  jobId: string,
  result?: unknown,
): Promise<void> {
  await sql`
    update jobs
    set status = 'succeeded',
        meta = meta || jsonb_build_object('result', ${sql.json((result ?? null) as never)}::jsonb),
        updated_at = now()
    where id = ${jobId}
  `;
}

export async function checkpointJob(
  sql: postgres.Sql,
  jobId: string,
  checkpoint: unknown,
): Promise<void> {
  await sql`
    update jobs
    set checkpoint = ${sql.json(checkpoint as never)},
        lease_expires_at = lease_expires_at + interval '60 seconds',
        updated_at = now()
    where id = ${jobId}
  `;
}

/** 지수 백오프 + 전체 지터 (28장). retryable=false면 즉시 최종 실패. */
export async function failJob(
  sql: postgres.Sql,
  job: { id: string; attempts: number; max_attempts: number },
  error: string,
  retryable: boolean,
): Promise<"retry_scheduled" | "dead_lettered" | "failed_final"> {
  if (!retryable) {
    await sql`
      update jobs set status = 'failed_final', last_error = ${error}, updated_at = now()
      where id = ${job.id}
    `;
    return "failed_final";
  }
  if (job.attempts >= job.max_attempts) {
    await sql`
      update jobs set status = 'dead_lettered', last_error = ${error}, updated_at = now()
      where id = ${job.id}
    `;
    return "dead_lettered";
  }
  const baseDelay = Math.min(600, 2 ** job.attempts * 5);
  const jitter = Math.random() * baseDelay; // full jitter
  const delaySeconds = Math.round(jitter);
  await sql`
    update jobs
    set status = 'retry_scheduled',
        last_error = ${error},
        run_at = now() + make_interval(secs => ${delaySeconds}),
        updated_at = now()
    where id = ${job.id}
  `;
  return "retry_scheduled";
}

/* ── Transactional Outbox ── */

export interface OutboxEventInput {
  eventId: string; // UUIDv7 — 앱 생성
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  schemaVersion?: number;
  occurredAt: Date;
  correlationId?: string | null;
  causationId?: string | null;
  payload: unknown;
}

/**
 * 상태 변경과 **같은 트랜잭션** 안에서 호출해야 한다.
 * tx는 호출자의 postgres.Sql 트랜잭션 핸들.
 */
export async function appendOutboxEvent(
  tx: postgres.Sql,
  event: OutboxEventInput,
): Promise<void> {
  await tx`
    insert into outbox_events (
      id, organization_id, aggregate_type, aggregate_id, aggregate_version,
      event_type, schema_version, occurred_at, correlation_id, causation_id, payload
    ) values (
      ${event.eventId}, ${event.organizationId}, ${event.aggregateType},
      ${event.aggregateId}, ${event.aggregateVersion}, ${event.eventType},
      ${event.schemaVersion ?? 1}, ${event.occurredAt},
      ${event.correlationId ?? null}, ${event.causationId ?? null},
      ${sql_json(tx, event.payload)}
    )
  `;
}

function sql_json(tx: postgres.Sql, value: unknown) {
  return tx.json(value as never);
}

/** 이벤트 타입 → 소비자(작업 토픽) 라우팅 테이블 — 코드가 단일 정의처 */
export const EVENT_CONSUMERS: Readonly<Record<string, readonly string[]>> = {
  RoutePublished: ["schedule.materialize", "readmodel.refresh"],
  SessionCompleted: ["schedule.recalculate", "readmodel.refresh"],
  LearningAvailabilityChanged: ["schedule.recalculate"],
  AssessmentPublished: ["notification.dispatch"],
  AttemptSubmitted: ["grading.auto"],
  GradeFinalized: ["mastery.update"],
  MasteryUpdated: ["review.plan", "schedule.recalculate"],
  ScheduleProposalCreated: ["notification.dispatch"],
  // 주의: 여기서 schedule.materialize를 다시 부르면 적용→이벤트→재적용의
  // 무한 피드백 루프가 된다 (실측 발견) — 적용 완료는 알림만.
  ScheduleProposalApplied: ["notification.dispatch"],
  ContentApproved: ["readmodel.refresh"],
  CurriculumReleasePublished: ["curriculum.impact-analysis"],
  FormulaReviewRequired: ["notification.dispatch"],
  RenderArtifactValidated: [],
  QuestionQuarantined: ["assessment.exclude-question", "notification.dispatch"],
  ContentRightsRevoked: ["content.rights-impact", "notification.dispatch"],
};

/**
 * Outbox 디스패처 — pending 이벤트를 소비자 작업으로 변환하고 delivered 처리.
 * 작업 멱등성 키 = `{consumer}:{event_id}` — 재전달에도 중복 작업 없음.
 */
export async function dispatchOutbox(
  sql: postgres.Sql,
  limit = 100,
): Promise<number> {
  return sql.begin(async (tx) => {
    const events = await tx<
      {
        id: string;
        organization_id: string;
        event_type: string;
        payload: unknown;
        aggregate_type: string;
        aggregate_id: string;
        aggregate_version: number;
        occurred_at: Date;
        correlation_id: string | null;
        attempts: number;
      }[]
    >`
      select id, organization_id, event_type, payload, aggregate_type,
             aggregate_id, aggregate_version, occurred_at, correlation_id, attempts
      from outbox_events
      where status in ('pending', 'failed') and next_attempt_at <= now()
      order by id asc
      limit ${limit}
      for update skip locked
    `;

    for (const event of events) {
      const consumers = EVENT_CONSUMERS[event.event_type] ?? [];
      for (const topic of consumers) {
        await tx`
          insert into jobs (organization_id, topic, priority, payload, idempotency_key)
          values (
            ${event.organization_id},
            ${topic},
            ${topic.startsWith("grading.") ? 10 : 100},
            ${tx.json({
              eventId: event.id,
              eventType: event.event_type,
              aggregateType: event.aggregate_type,
              aggregateId: event.aggregate_id,
              aggregateVersion: event.aggregate_version,
              occurredAt: event.occurred_at,
              correlationId: event.correlation_id,
              payload: event.payload,
            } as never)},
            ${`${topic}:${event.id}`}
          )
          on conflict (topic, idempotency_key) where idempotency_key is not null
          do nothing
        `;
      }
      await tx`
        update outbox_events
        set status = 'delivered', delivered_at = now(), attempts = attempts + 1
        where id = ${event.id}
      `;
    }
    return events.length;
  }) as Promise<number>;
}

/** Inbox 멱등 처리 — 처음이면 true(처리 진행), 중복이면 false(건너뜀) */
export async function tryMarkInbox(
  tx: postgres.Sql,
  consumerName: string,
  eventId: string,
): Promise<boolean> {
  const rows = await tx<{ inserted: boolean }[]>`
    insert into inbox_events (consumer_name, event_id)
    values (${consumerName}, ${eventId})
    on conflict do nothing
    returning true as inserted
  `;
  return rows.length > 0;
}
