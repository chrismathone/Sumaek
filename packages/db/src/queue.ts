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
    /** 한 조직으로 한정 — 테스트와 단일 테넌트 재처리용 (dispatchOutbox와 짝) */
    organizationId?: string | null;
  },
): Promise<ClaimedJob[]> {
  const lease = options.leaseSeconds ?? 300;
  const maxPerOrg = options.maxPerOrganization ?? 4;
  const orgScope = options.organizationId ?? null;
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
        and (${orgScope}::uuid is null or organization_id = ${orgScope}::uuid)
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

/**
 * 작업 연기 — kill switch 등으로 실행을 미룰 때. 클레임이 올린 시도 수를
 * 되돌려 DLQ로 밀리지 않게 한다 (스위치 복구 시 그대로 재개).
 */
export async function deferJob(
  sql: postgres.Sql,
  jobId: string,
  reason: string,
  delaySeconds = 300,
): Promise<void> {
  await sql`
    update jobs
    set status = 'retry_scheduled',
        attempts = greatest(attempts - 1, 0),
        last_error = ${reason},
        run_at = now() + make_interval(secs => ${delaySeconds}),
        updated_at = now()
    where id = ${jobId}
  `;
}

/**
 * 지수 백오프 + 전체 지터 (28장) — 재시도 간격(초).
 * 작업 큐와 Outbox 디스패처가 같은 정책을 쓴다. 재시도가 동시에 몰려
 * 같은 실패를 반복 재현하는 것(thundering herd)을 지터가 흩는다.
 */
export function backoffSeconds(attempts: number, capSeconds = 600): number {
  const base = Math.min(capSeconds, 2 ** Math.max(attempts, 0) * 5);
  return Math.round(Math.random() * base); // full jitter
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
  const delaySeconds = backoffSeconds(job.attempts);
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

/**
 * 이벤트 타입 → 소비자(작업 토픽) 라우팅 테이블 — 코드가 단일 정의처.
 *
 * 여기 등록하는 토픽은 apps/worker/src/registry.ts의 핸들러와 **짝**이어야 한다.
 * 한쪽만 있으면 작업이 만들어지고도 아무도 클레임하지 않거나(핸들러 없음),
 * 이벤트가 소비자 없이 delivered가 된다. 짝은 apps/worker/test/wiring/
 * event-wiring.test.ts가 정적으로 검사한다.
 *
 * 소비자를 **두지 않기로 한** 이벤트는 빈 배열로 남기고 반드시
 * EVENT_WITHOUT_CONSUMER에 근거를 적는다 — 선언 없는 빈 배열은 라우팅 결손으로
 * 취급되어 디스패처가 격리한다(무음 폐기 방지).
 */
export const EVENT_CONSUMERS: Readonly<Record<string, readonly string[]>> = {
  RoutePublished: ["schedule.materialize", "readmodel.refresh"],
  SessionCompleted: ["schedule.recalculate", "readmodel.refresh"],
  LearningAvailabilityChanged: ["schedule.recalculate"],
  /* 학생 오버라이드 생성·취소 → 그 학습자의 개별 일정만 다시 실체화 (인수 4).
   * 반 공통(schedule.materialize)을 부르지 않는다 — 오버라이드는 반 루트와
   * 다른 학생에게 영향이 없어야 한다 (불변 조건 4). */
  LearnerRouteOverrideChanged: ["schedule.materialize-learner"],
  AssessmentPublished: ["notification.dispatch"],
  AttemptSubmitted: ["grading.auto"],
  GradeFinalized: ["mastery.update"],
  MasteryUpdated: ["review.plan", "schedule.recalculate"],
  ScheduleProposalCreated: ["notification.dispatch"],
  // 주의: 여기서 schedule.materialize를 다시 부르면 적용→이벤트→재적용의
  // 무한 피드백 루프가 된다 (실측 발견) — 적용 완료는 알림만.
  ScheduleProposalApplied: ["notification.dispatch"],
  ContentApproved: ["readmodel.refresh"],
  CurriculumReleasePublished: [],
  FormulaReviewRequired: ["notification.dispatch"],
  RenderArtifactValidated: [],
  /* assessment.exclude-question을 뺐다 — 핸들러가 없었고, 없어도 되기 때문이다.
   * 신규 출제 제외는 이미 두 겹으로 집행된다: 출제 풀 질의가
   * review_status='published'만 고르고(assessment.ts), 불변 조건 I-13이
   * 격리 문항의 is_auto_assignable=true를 위반으로 잡는다. 남는 것은
   * "이미 나간 테스트를 사람이 확인해야 한다"뿐이고 그게 알림이다
   * (ContentRightsRevoked가 택한 것과 같은 구조 — handlers/content.ts 주석). */
  QuestionQuarantined: ["notification.dispatch"],
  ContentRightsRevoked: ["content.rights-impact", "notification.dispatch"],
};

/**
 * 소비자를 두지 않기로 **선언한** 이벤트와 그 근거.
 *
 * 왜 따로 두는가: 디스패처는 소비자 0건이어도 delivered로 표시한다. 그래서
 * 「소비자 없음을 결정한 이벤트」와 「라우팅표에서 빠뜨린 이벤트」가 DB에서
 * 똑같이 보이고, 후자가 이벤트 영구 유실의 통로가 된다. 여기 선언된 것만
 * 무소비 배달을 허용하고, 선언 없는 미매핑 이벤트는 격리한다.
 *
 * 소비자가 생기면 EVENT_CONSUMERS에 토픽을 넣고 여기서 지운다.
 */
export const EVENT_WITHOUT_CONSUMER: Readonly<Record<string, string>> = {
  /* 설계상 소비자는 content-gatekeeper와 analytics다(event-catalog E-13).
   * 둘 다 구현되지 않았고, math_render_artifacts에 쓰는 코드가 없어 발행부도
   * 0건이다 — 즉 이 이벤트는 아직 도달 불가능한 경로다. 짐작으로 소비자를
   * 적어 두면 「있는 것처럼 보이는데 없는 것」이 하나 더 는다. */
  RenderArtifactValidated:
    "게시 게이트(content-gatekeeper) 소비자 미구현 — 발행부도 0건 (event-catalog E-13)",
  /* 개정 영향 분석(curriculum.impact-analysis)은 구현된 적이 없다. 발행부도
   * 0건이라 지금은 도달 불가능한 경로다. 있는 것처럼 보이게 두지 않는다 —
   * 소비자를 만들 때 EVENT_CONSUMERS에 토픽을 넣고 이 항목을 지운다. */
  CurriculumReleasePublished:
    "개정 영향 분석 소비자 미구현 (발행부도 0건) — 구현 시 라우팅 복원",
};

export type ConsumerResolution =
  | { kind: "consumers"; topics: readonly string[] }
  | { kind: "declared_none"; reason: string }
  | { kind: "routing_gap"; reason: string };

/** 이벤트 타입의 소비자 판정 — 「없다고 정한 것」과 「빠뜨린 것」을 가른다 */
export function resolveConsumers(eventType: string): ConsumerResolution {
  const topics = EVENT_CONSUMERS[eventType];
  if (topics && topics.length > 0) return { kind: "consumers", topics };
  const declared = EVENT_WITHOUT_CONSUMER[eventType];
  if (declared !== undefined) return { kind: "declared_none", reason: declared };
  if (topics) {
    return {
      kind: "routing_gap",
      reason: `소비자 0건인데 EVENT_WITHOUT_CONSUMER에 근거가 없다: ${eventType}`,
    };
  }
  return {
    kind: "routing_gap",
    reason: `EVENT_CONSUMERS에 없는 이벤트 타입: ${eventType}`,
  };
}

/**
 * Outbox 이벤트를 더 시도하지 않고 격리하는 시도 수.
 * 교육 정책이 아니라 운영 파라미터라 DB spec(ADR-0009)이 아닌 코드에 둔다.
 * 배포 없이 늘려야 하는 상황을 위해 환경변수로 덮을 수 있다.
 */
export const OUTBOX_MAX_ATTEMPTS = Number(
  process.env.OUTBOX_MAX_ATTEMPTS ?? 8,
);

/** 배치를 집은 뒤 delivering으로 굳어 있는 행을 회수하기까지의 시간(초) */
const OUTBOX_LEASE_SECONDS = 300;

interface OutboxRow {
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
}

export interface OutboxFailure {
  eventId: string;
  eventType: string;
  /** routing_gap은 재시도해도 낫지 않는다 — 코드 배포가 있어야 풀린다 */
  kind: "routing_gap" | "transient";
  reason: string;
  quarantined: boolean;
}

export interface DispatchOutboxResult {
  /** 이번 호출이 집은 이벤트 수 (0이면 할 일이 없었다) */
  claimed: number;
  /** 소비자 작업까지 만들고 delivered로 넘긴 수 */
  delivered: number;
  /** 소비자 0건으로 **선언된** 이벤트를 delivered로 넘긴 수 */
  acknowledged: number;
  createdJobs: number;
  /** 재시도 예정으로 되돌린 수 */
  failed: number;
  /** 더 시도하지 않기로 한 수 (라우팅 결손 또는 시도 한도 초과) */
  quarantined: number;
  failures: OutboxFailure[];
}

export interface DispatchOutboxOptions {
  /** exactOptionalPropertyTypes 아래에서도 호출부가 undefined를 넘길 수 있게 한다 */
  limit?: number | undefined;
  /**
   * 한 조직으로 한정한다. 기본(null)은 전역 — 워커가 쓰는 모드다.
   *
   * 왜 있는가: 전역 디스패처는 공유 DB에서 **남의 pending 이벤트까지** 소비해
   * 버려서 테스트가 부를 수 없었다. 그래서 outbox→job→핸들러 왕복을 한
   * 프로세스에서 검증하는 테스트가 0건이었다. 조직 스코프가 그 검증을
   * 가능하게 한다 (apps/worker/test/wiring/outbox-roundtrip.test.ts).
   * 운영에서는 한 조직만 재배달할 때 쓴다.
   */
  organizationId?: string | null | undefined;
  maxAttempts?: number | undefined;
}

/**
 * Outbox 디스패처 — 이벤트를 소비자 작업으로 변환하고 delivered 처리한다.
 * 작업 멱등성 키 = `{consumer}:{event_id}` — 재전달에도 중복 작업이 없다.
 *
 * ## 실패 격리
 * 배치 전체를 한 트랜잭션에 담지 않는다. 예전에는 그랬고, 그래서 한 건이
 * 던지면 배치 100건이 통째로 롤백되고 다음 루프가 **같은 배치를 같은 순서로**
 * 다시 집어 영원히 같은 자리에서 막혔다(attempts를 올리는 코드가 아예 없었다).
 * 지금은:
 *   1) 배치를 delivering으로 리스 잡아 다른 워커와 겹치지 않게 하고
 *   2) 이벤트마다 **자기 트랜잭션**으로 작업 삽입 + delivered를 커밋하고
 *   3) 실패한 건만 attempts를 올리고 next_attempt_at을 백오프로 미룬다
 *   4) 시도 한도를 넘기면 격리한다 (status='failed' and attempts >= 한도)
 *      — 이 조건이 재집기 대상에서 빠지는 것이 곧 격리다. 되살리려면
 *      `pnpm requeue-outbox`가 attempts를 0으로 되돌린다.
 *
 * 리스가 만료된 delivering 행은 다시 집는다 — 디스패치 도중 프로세스가 죽어도
 * 이벤트가 그 상태로 굳지 않는다. 중복 배달은 멱등성 키가 흡수한다.
 */
export async function dispatchOutbox(
  sql: postgres.Sql,
  options: DispatchOutboxOptions = {},
): Promise<DispatchOutboxResult> {
  const limit = options.limit ?? 100;
  const orgScope = options.organizationId ?? null;
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  const events = await sql<OutboxRow[]>`
    update outbox_events e
    set status = 'delivering',
        next_attempt_at = now() + make_interval(secs => ${OUTBOX_LEASE_SECONDS})
    from (
      select id from outbox_events
      where next_attempt_at <= now()
        and (
          status = 'pending'
          -- 리스 만료 회수 — 디스패치 중 죽은 워커가 남긴 행
          or status = 'delivering'
          -- 백오프 재시도. 한도를 넘긴 것은 여기서 빠진다 = 격리
          or (status = 'failed' and attempts < ${maxAttempts})
        )
        and (${orgScope}::uuid is null or organization_id = ${orgScope}::uuid)
      order by id asc
      limit ${limit}
      for update skip locked
    ) picked
    where e.id = picked.id
    returning e.id, e.organization_id, e.event_type, e.payload, e.aggregate_type,
              e.aggregate_id, e.aggregate_version, e.occurred_at,
              e.correlation_id, e.attempts
  `;

  const result: DispatchOutboxResult = {
    claimed: events.length,
    delivered: 0,
    acknowledged: 0,
    createdJobs: 0,
    failed: 0,
    quarantined: 0,
    failures: [],
  };

  for (const event of events) {
    const resolution = resolveConsumers(event.event_type);

    if (resolution.kind === "routing_gap") {
      /* 재시도해도 낫지 않는다 — 코드가 고쳐져야 풀린다. 백오프로 도는 대신
       * 즉시 격리해 운영자 눈에 띄게 한다 (그대로 delivered로 넘기면
       * 이벤트가 무음 폐기된다). */
      await markOutboxFailed(sql, event.id, maxAttempts, 0);
      result.quarantined += 1;
      result.failures.push({
        eventId: event.id,
        eventType: event.event_type,
        kind: "routing_gap",
        reason: resolution.reason,
        quarantined: true,
      });
      continue;
    }

    const topics =
      resolution.kind === "consumers" ? resolution.topics : ([] as const);

    try {
      const created = await sql.begin(async (tx) => {
        let inserted = 0;
        for (const topic of topics) {
          const rows = await tx<{ id: string }[]>`
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
            returning id
          `;
          inserted += rows.length;
        }
        await tx`
          update outbox_events
          set status = 'delivered',
              delivered_at = now(),
              attempts = attempts + 1,
              next_attempt_at = now()
          where id = ${event.id}
        `;
        return inserted;
      });
      result.createdJobs += created as number;
      if (resolution.kind === "declared_none") result.acknowledged += 1;
      else result.delivered += 1;
    } catch (error) {
      const attempts = event.attempts + 1;
      const quarantined = attempts >= maxAttempts;
      await markOutboxFailed(
        sql,
        event.id,
        attempts,
        quarantined ? 0 : backoffSeconds(attempts),
      );
      if (quarantined) result.quarantined += 1;
      else result.failed += 1;
      result.failures.push({
        eventId: event.id,
        eventType: event.event_type,
        kind: "transient",
        reason: error instanceof Error ? error.message : String(error),
        quarantined,
      });
    }
  }

  return result;
}

/**
 * 실패 기록 — outbox_events에는 last_error 컬럼이 없다. 이유는 워커 로그와
 * 코드(라우팅 결손이면 event_type만으로 재현된다)에 남고, DB에는 언제 다시
 * 시도할지(attempts·next_attempt_at)만 남는다.
 */
async function markOutboxFailed(
  sql: postgres.Sql,
  eventId: string,
  attempts: number,
  delaySeconds: number,
): Promise<void> {
  await sql`
    update outbox_events
    set status = 'failed',
        attempts = ${attempts},
        next_attempt_at = now() + make_interval(secs => ${delaySeconds})
    where id = ${eventId}
  `;
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
