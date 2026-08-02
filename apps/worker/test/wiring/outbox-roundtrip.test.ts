import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  OUTBOX_MAX_ATTEMPTS,
  appendOutboxEvent,
  createSql,
  deferSignal,
  dispatchOutbox,
  enqueueJob,
  getSharedSql,
  type DispatchOutboxResult,
} from "@su-maek/db";
import { runOnce, type RunOnceResult } from "../../src/loop";
import { createHandlerRegistry, type JobHandler } from "../../src/registry";

/* ─────────────────────────────────────────────────────────────
 * outbox → 작업 → 핸들러 왕복 (한 프로세스에서) — 라이브 DB 통합 테스트.
 *
 * 이 검증이 0건이었다. 이유는 구조였다: dispatchOutbox가 **전역으로** pending
 * 이벤트를 소비하는 함수라 공유 DB에서 부르면 남의 이벤트까지 delivered로
 * 바꿔 버린다(실측 pending 1091건). 그래서 기존 테스트들은 발행·라우팅표·
 * 핸들러를 각각 단언하는 것으로 사슬을 "덮은 셈" 쳤고, 배선이 실제로 도는지는
 * 아무도 확인하지 않았다.
 *
 * 조직 스코프 디스패처를 만들어 그 회피를 없앴다. 여기서 도는 것은 전부
 * 진짜다 — 진짜 outbox 행, 진짜 디스패처, 진짜 클레임·리스, 진짜 핸들러
 * 레지스트리, 진짜 작업 상태 전이. 대역은 없다.
 *
 * 겨누는 것:
 *   1) 이벤트가 소비자 작업이 되고 delivered로 넘어간다 (멱등성 키 포함)
 *   2) 워커 루프 한 회차가 그 작업을 클레임·실행·완료한다 (Inbox 표시까지)
 *   3) 라우팅 결손 이벤트 한 건이 **배치 전체를 막지 못한다** (실패 격리)
 *   4) 라우팅 결손은 delivered로 넘어가지 않고 격리된다 (무음 폐기 방지)
 *   5) 무소비를 **선언한** 이벤트는 작업 0건으로 정상 배달된다 (3·4와 구분)
 *   6) 두 번째 디스패치는 아무것도 다시 집지 않는다 (중복 배달·중복 작업 없음)
 *   7) 루프의 실패·연기 분기가 작업 상태를 규약대로 바꾼다
 *
 * 덮지 못하는 것 — 정직하게 적는다:
 *  - 전역(조직 스코프 없는) 디스패치는 여기서 돌리지 않는다. 공유 DB의 남의
 *    이벤트를 소비하게 된다. 조직 필터가 빠지면 이 테스트가 아니라
 *    packages/db 단위 검사가 걸러야 한다.
 *  - 프로세스 강제 종료·리스 만료 회수는 handlers/schedule-resume.test.ts의 몫.
 *  - main.ts의 while 루프·시그널 처리 자체는 돌리지 않는다. 한 회차(runOnce)만
 *    본다 — 루프는 그 회차를 반복 호출할 뿐이다.
 *
 * 픽스처 규약: 조직·이벤트 ID를 고정한다 (inbox_events에는 organization_id가
 * 없어 실행마다 새 ID면 정리할 수 없다). 이벤트 ID는 **디스패치 순서**까지
 * 고정한다 — 디스패처가 id asc로 집으므로 결손 이벤트를 정상 이벤트보다
 * 앞에 두어야 "한 건이 배치를 막지 않는다"를 겨눌 수 있다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const ORG = "ffffffff-0000-7000-8000-0000000ab001";
/** 라우팅표에 없는 타입 — 정상 이벤트보다 **먼저** 집히도록 작은 ID */
const EVENT_GAP = "ffffffff-0000-7000-8000-0000000ab0e1";
/** GradeFinalized → mastery.update (Inbox 표시만 하는 소비자) */
const EVENT_OK = "ffffffff-0000-7000-8000-0000000ab0e2";
/** RenderArtifactValidated — 소비자를 두지 않기로 **선언한** 이벤트 */
const EVENT_NONE = "ffffffff-0000-7000-8000-0000000ab0e3";
/** 작업 삽입이 DB 수준에서 터지는 이벤트 — 일시 실패(catch) 분기용 */
const EVENT_POISON = "ffffffff-0000-7000-8000-0000000ab0e4";

const CONSUMER = "mastery.update";
const TOPIC_FAIL = "itest.roundtrip-fail";
const TOPIC_DEFER = "itest.roundtrip-defer";
const WORKER = "itest-roundtrip-worker";

const AGGREGATE = uuidv7();

interface OutboxRow {
  status: string;
  attempts: number;
  delivered_at: Date | null;
  /** 백오프가 실제로 미뤘는지 보려면 이 값이 필요하다 */
  next_attempt_at: Date;
}

interface JobRow {
  id: string;
  topic: string;
  status: string;
  attempts: number;
  last_error: string | null;
  idempotency_key: string | null;
  meta: unknown;
}

async function outboxRow(eventId: string): Promise<OutboxRow> {
  const [row] = await sql<OutboxRow[]>`
    select status::text as status, attempts, delivered_at, next_attempt_at
    from outbox_events where id = ${eventId}
  `;
  return row!;
}

async function jobsOf(eventId: string): Promise<JobRow[]> {
  return sql<JobRow[]>`
    select id, topic, status::text as status, attempts, last_error,
           idempotency_key, meta
    from jobs
    where organization_id = ${ORG} and payload->>'eventId' = ${eventId}
    order by topic
  `;
}

async function jobById(jobId: string): Promise<JobRow> {
  const [row] = await sql<JobRow[]>`
    select id, topic, status::text as status, attempts, last_error,
           idempotency_key, meta
    from jobs where id = ${jobId}
  `;
  return row!;
}

async function inboxCount(eventId: string): Promise<number> {
  const [row] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from inbox_events
    where consumer_name = ${CONSUMER} and event_id = ${eventId}
  `;
  return row?.cnt ?? 0;
}

/** 클라이언트 시계가 DB보다 앞서면 run_at <= now()가 아직 거짓이라 클레임이 빈다 */
async function enqueueDueJob(topic: string): Promise<string> {
  const { jobId } = await enqueueJob(sql, {
    topic,
    organizationId: ORG,
    payload: { eventId: uuidv7(), eventType: "ITest", payload: {} },
  });
  await sql`update jobs set run_at = now() - interval '1 second' where id = ${jobId}`;
  return jobId;
}

async function publish(
  eventId: string,
  eventType: string,
  version: number,
): Promise<void> {
  await sql.begin((tx) =>
    appendOutboxEvent(tx as never, {
      eventId,
      organizationId: ORG,
      aggregateType: "itest_roundtrip",
      aggregateId: AGGREGATE,
      aggregateVersion: version,
      eventType,
      occurredAt: new Date(),
      payload: { note: "왕복 검증 픽스처" },
    }),
  );
}

async function cleanupFixtures(): Promise<void> {
  await sql`delete from jobs where organization_id = ${ORG}`;
  await sql`
    delete from inbox_events
    where event_id in (${EVENT_GAP}, ${EVENT_OK}, ${EVENT_NONE}, ${EVENT_POISON})
  `;
  await sql`delete from outbox_events where organization_id = ${ORG}`;
}

describe.skipIf(!hasDb)("outbox → 작업 → 핸들러 왕복 (조직 스코프)", () => {
  let firstDispatch: DispatchOutboxResult;
  let secondDispatch: DispatchOutboxResult;
  let gapRow: OutboxRow;
  let okRow: OutboxRow;
  let noneRow: OutboxRow;
  let okJobs: JobRow[];
  let gapJobs: JobRow[];
  let noneJobs: JobRow[];
  let loopRun: RunOnceResult;
  let okJobAfterLoop: JobRow;
  let inboxAfterLoop: number;
  let idleRun: RunOnceResult;
  let failJobRow: JobRow;
  let deferJobRow: JobRow;

  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 아웃박스 왕복', 'itest-outbox-roundtrip', 'Asia/Seoul')
      on conflict (id) do nothing
    `;
    await cleanupFixtures();

    /* ── 1) 발행: 결손 → 정상 → 무소비 선언 순서로 (id asc = 이 순서) ── */
    await publish(EVENT_GAP, "ITestUnroutedEvent", 1);
    await publish(EVENT_OK, "GradeFinalized", 2);
    await publish(EVENT_NONE, "RenderArtifactValidated", 3);

    /* ── 2) 디스패치 — **조직 스코프**. 남의 pending 이벤트는 건드리지 않는다 ── */
    firstDispatch = await dispatchOutbox(sql, {
      organizationId: ORG,
      limit: 10,
    });
    gapRow = await outboxRow(EVENT_GAP);
    okRow = await outboxRow(EVENT_OK);
    noneRow = await outboxRow(EVENT_NONE);
    okJobs = await jobsOf(EVENT_OK);
    gapJobs = await jobsOf(EVENT_GAP);
    noneJobs = await jobsOf(EVENT_NONE);

    /* ── 3) 두 번째 디스패치 — 다시 집을 것이 없어야 한다 ── */
    secondDispatch = await dispatchOutbox(sql, {
      organizationId: ORG,
      limit: 10,
    });

    /* ── 4) 워커 루프 한 회차 — 진짜 레지스트리로 클레임·실행·완료 ── */
    const handlers = createHandlerRegistry();
    loopRun = await runOnce({
      sql,
      handlers,
      workerId: WORKER,
      concurrency: 4,
      organizationId: ORG,
    });
    okJobAfterLoop = await jobById(okJobs[0]!.id);
    inboxAfterLoop = await inboxCount(EVENT_OK);

    /* ── 5) 더 할 일이 없는 회차 ── */
    idleRun = await runOnce({
      sql,
      handlers,
      workerId: WORKER,
      concurrency: 4,
      organizationId: ORG,
    });

    /* ── 6) 루프의 실패·연기 분기 ──
     * 이벤트로는 만들 수 없는 상황이다(모든 소비자가 성공한다). 전용 토픽에
     * 작업을 직접 넣고 대역 핸들러를 붙인다 — 큐·상태 전이는 전부 진짜다. */
    const throwing: JobHandler = async () => {
      throw new Error("ITEST 핸들러 실패");
    };
    const deferring: JobHandler = async () =>
      deferSignal("ITEST 연기 사유");
    const testHandlers = new Map<string, JobHandler>([
      [TOPIC_FAIL, throwing],
      [TOPIC_DEFER, deferring],
    ]);
    const failJobId = await enqueueDueJob(TOPIC_FAIL);
    const deferJobId = await enqueueDueJob(TOPIC_DEFER);
    await runOnce({
      sql,
      handlers: testHandlers,
      workerId: WORKER,
      concurrency: 4,
      organizationId: ORG,
    });
    failJobRow = await jobById(failJobId);
    deferJobRow = await jobById(deferJobId);
  });

  afterAll(async () => {
    await cleanupFixtures();
    await sql.end({ timeout: 5 });
    // 핸들러가 쓰는 공유 풀도 닫아야 프로세스가 바로 끝난다
    await getSharedSql().end({ timeout: 5 });
  });

  it("이벤트 3건을 집어 각각 다른 결말로 처리한다", () => {
    expect(firstDispatch.claimed).toBe(3);
    expect(firstDispatch.delivered).toBe(1); // 소비자가 있는 이벤트
    expect(firstDispatch.acknowledged).toBe(1); // 무소비를 선언한 이벤트
    expect(firstDispatch.quarantined).toBe(1); // 라우팅 결손
    expect(firstDispatch.createdJobs).toBe(1);
  });

  it("소비자가 있는 이벤트는 작업이 되고 delivered로 넘어간다", () => {
    expect(okRow.status).toBe("delivered");
    expect(okRow.delivered_at).not.toBeNull();
    expect(okJobs).toHaveLength(1);
    expect(okJobs[0]!.topic).toBe(CONSUMER);
    // 재전달에도 중복 작업이 없도록 하는 키 (ADR-0006)
    expect(okJobs[0]!.idempotency_key).toBe(`${CONSUMER}:${EVENT_OK}`);
    expect(okJobs[0]!.status).toBe("queued");
  });

  it("앞선 결손 이벤트 한 건이 뒤의 정상 이벤트를 막지 못한다 (실패 격리)", () => {
    /* 예전에는 배치 100건이 단일 트랜잭션이었다. 한 건이 던지면 전부 롤백되고
     * 다음 루프가 같은 배치를 같은 순서로 다시 집어 영원히 같은 자리에서
     * 막혔다. 결손 이벤트가 더 작은 ID라 **먼저** 처리되는데도 뒤의 정상
     * 이벤트가 배달됐다는 것이 격리의 증거다. */
    expect(gapRow.status).toBe("failed");
    expect(okRow.status).toBe("delivered");
  });

  it("라우팅 결손 이벤트는 배달되지 않고 즉시 격리된다 (무음 폐기 방지)", () => {
    /* 소비자 0건이어도 delivered로 표시하던 예전 동작에서는 라우팅표에서
     * 빠진 이벤트가 「작업 0건 + 배달 완료」로 보이며 영구 유실됐다.
     * 재시도해도 낫지 않으므로 백오프로 돌지 않고 바로 한도까지 올린다. */
    expect(gapRow.delivered_at).toBeNull();
    expect(gapRow.attempts).toBeGreaterThanOrEqual(OUTBOX_MAX_ATTEMPTS);
    expect(gapJobs).toEqual([]);
    const failure = firstDispatch.failures.find((f) => f.eventId === EVENT_GAP);
    expect(failure?.kind).toBe("routing_gap");
    expect(failure?.quarantined).toBe(true);
  });

  it("무소비를 선언한 이벤트는 작업 0건으로 정상 배달된다", () => {
    expect(noneRow.status).toBe("delivered");
    expect(noneJobs).toEqual([]);
    expect(firstDispatch.failures.map((f) => f.eventId)).not.toContain(
      EVENT_NONE,
    );
  });

  it("두 번째 디스패치는 아무것도 다시 집지 않는다", () => {
    // delivered는 대상이 아니고, 격리된 것은 시도 한도를 넘겨 빠진다
    expect(secondDispatch.claimed).toBe(0);
    expect(secondDispatch.createdJobs).toBe(0);
  });

  it("워커 루프 한 회차가 그 작업을 클레임·실행·완료한다", () => {
    expect(loopRun.claimed).toBe(1);
    expect(loopRun.succeeded).toBe(1);
    expect(loopRun.failed).toBe(0);
    expect(loopRun.unhandled).toBe(0);
    expect(okJobAfterLoop.status).toBe("succeeded");
    expect(okJobAfterLoop.attempts).toBe(1);
  });

  it("소비는 Inbox에 표시되어 재전달을 멱등하게 만든다", () => {
    expect(inboxAfterLoop).toBe(1);
  });

  it("할 일이 없는 회차는 아무것도 하지 않는다", () => {
    expect(idleRun.claimed).toBe(0);
    expect(idleRun.dispatch.claimed).toBe(0);
  });

  it("핸들러가 던지면 재시도 예정으로 되돌리고 사유를 남긴다", () => {
    expect(failJobRow.status).toBe("retry_scheduled");
    expect(failJobRow.attempts).toBe(1);
    expect(failJobRow.last_error).toContain("ITEST 핸들러 실패");
  });

  it("핸들러가 연기를 요청하면 시도를 소모하지 않고 미룬다", () => {
    /* kill switch로 멈춘 작업이 DLQ로 밀리면 안 된다 — 클레임이 올린 시도 수를
     * deferJob이 되돌린다 (queue.ts). */
    expect(deferJobRow.status).toBe("retry_scheduled");
    expect(deferJobRow.attempts).toBe(0);
    expect(deferJobRow.last_error).toContain("ITEST 연기 사유");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 일시 실패(transient) 분기 — 디스패처의 catch.
 *
 * 위 왕복 테스트가 덮는 격리는 **라우팅 결손** 한 가지뿐이다. 작업 삽입이
 * DB 수준에서 터지는 경로(catch 블록의 attempts 증가·백오프·한도 초과 격리)는
 * 전혀 다른 코드 경로인데 검사가 0건이었다 — 그 블록을
 * `const attempts = 0; const quarantined = false;` 로 통째로 무력화해도
 * 저장소의 어떤 테스트도 물지 않는 상태였다.
 *
 * 지금 코드에서 이 분기를 자연히 밟는 이벤트는 없다(작업 삽입에 FK가 없고
 * 중복은 ON CONFLICT가 흡수한다). 그래서 **DB에 고장을 심는다** — 이 픽스처
 * 이벤트의 작업 삽입에서만 예외를 던지는 트리거를 두고, 끝나면 지운다.
 * 대역 함수가 아니라 진짜 예외라 catch가 프로덕션과 똑같이 돈다.
 * ───────────────────────────────────────────────────────────── */
describe.skipIf(!hasDb)("아웃박스 일시 실패 (작업 삽입이 터질 때)", () => {
  const POISON_TOPIC_KEY = `%:${EVENT_POISON}`;
  let firstFail: DispatchOutboxResult;
  let afterFirst: OutboxRow;
  let quarantineRun: DispatchOutboxResult;
  let afterQuarantine: OutboxRow;
  let reclaimAfterQuarantine: DispatchOutboxResult;

  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 아웃박스 왕복', 'itest-outbox-roundtrip', 'Asia/Seoul')
      on conflict (id) do nothing
    `;
    await sql`delete from outbox_events where id = ${EVENT_POISON}`;
    await sql`delete from jobs where organization_id = ${ORG}`;

    await sql.unsafe(`
      create or replace function itest_outbox_poison() returns trigger
      language plpgsql as $$
      begin
        if new.idempotency_key like '${POISON_TOPIC_KEY}' then
          raise exception 'ITEST 주입 고장: 작업 삽입 실패';
        end if;
        return new;
      end $$;
      drop trigger if exists itest_outbox_poison_trg on jobs;
      create trigger itest_outbox_poison_trg
        before insert on jobs
        for each row execute function itest_outbox_poison();
    `);

    await publish(EVENT_POISON, "GradeFinalized", 9);

    /* 1회차 — 한도(8) 안이라 격리되지 않고 백오프로 미뤄져야 한다 */
    firstFail = await dispatchOutbox(sql, { organizationId: ORG, limit: 10 });
    afterFirst = await outboxRow(EVENT_POISON);

    /* 2회차 — 한도를 1로 낮추면 같은 실패가 곧바로 격리가 된다.
     * 시도 횟수를 되돌리는 이유: 1회차로 attempts가 1이 됐는데 재집기 조건이
     * `attempts < 한도`라 한도 1에서는 이미 집히지 않는다. 여기서 보려는 것은
     * "집힌 뒤 한도를 넘겨 격리되는가"이므로 집힐 수 있는 상태로 되돌린다. */
    await sql`
      update outbox_events
      set status = 'pending', attempts = 0, next_attempt_at = now()
      where id = ${EVENT_POISON}
    `;
    quarantineRun = await dispatchOutbox(sql, {
      organizationId: ORG,
      limit: 10,
      maxAttempts: 1,
    });
    afterQuarantine = await outboxRow(EVENT_POISON);

    /* 3회차 — 격리된 것은 시각을 당겨도 다시 집히지 않아야 한다 */
    await sql`update outbox_events set next_attempt_at = now() where id = ${EVENT_POISON}`;
    reclaimAfterQuarantine = await dispatchOutbox(sql, {
      organizationId: ORG,
      limit: 10,
      maxAttempts: 1,
    });
  });

  afterAll(async () => {
    await sql.unsafe(`
      drop trigger if exists itest_outbox_poison_trg on jobs;
      drop function if exists itest_outbox_poison();
    `);
    await sql`delete from outbox_events where id = ${EVENT_POISON}`;
    await sql`delete from jobs where organization_id = ${ORG}`;
    await sql.end({ timeout: 5 });
  });

  it("작업 삽입이 터지면 배달로 세지 않고 실패로 센다", () => {
    expect(firstFail.claimed).toBe(1);
    expect(firstFail.delivered).toBe(0);
    expect(firstFail.failed).toBe(1);
    expect(firstFail.quarantined).toBe(0);
    expect(firstFail.failures[0]?.kind).toBe("transient");
    expect(firstFail.failures[0]?.reason).toContain("ITEST 주입 고장");
  });

  it("시도 횟수가 오르고 다음 시도가 백오프 정책으로 다시 잡힌다", () => {
    expect(afterFirst.attempts).toBe(1);
    /* 리스(300초)가 그대로 남지 않고 백오프 창(1회차 상한 10초) 안으로
     * 다시 잡혀야 한다. **"미래여야 한다"고 단언하지 않는다** — 전체 지터라
     * 0초가 정상적으로 나온다(실측으로 이 스위트를 깨뜨렸다). 지터 정책
     * 자체는 packages/db/test/backoff.test.ts가 결정론적으로 덮는다. */
    const at = new Date(afterFirst.next_attempt_at).getTime();
    expect(at).toBeLessThan(Date.now() + 15_000);
    expect(at).toBeGreaterThan(Date.now() - 10_000);
  });

  it("터진 이벤트는 delivered로 넘어가지 않는다 — 무음 폐기 방지", async () => {
    expect(afterFirst.status).toBe("failed");
    expect(afterFirst.delivered_at).toBeNull();
    const [row] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from jobs where organization_id = ${ORG}
    `;
    expect(row?.cnt).toBe(0);
  });

  it("한도를 넘기면 격리된다", () => {
    expect(quarantineRun.claimed).toBe(1);
    expect(quarantineRun.quarantined).toBe(1);
    expect(quarantineRun.failed).toBe(0);
    expect(afterQuarantine.attempts).toBeGreaterThanOrEqual(1);
    expect(afterQuarantine.status).toBe("failed");
  });

  it("격리된 이벤트는 다시 집히지 않는다 — 그것이 곧 격리다", () => {
    expect(reclaimAfterQuarantine.claimed).toBe(0);
  });

  it("한도는 기본 8이다 — 한 번 터졌다고 바로 버리지 않는다", () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(8);
  });
});
