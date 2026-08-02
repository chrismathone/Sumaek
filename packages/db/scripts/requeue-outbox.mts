import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../src/client";
import { OUTBOX_MAX_ATTEMPTS, resolveConsumers } from "../src/queue";

/**
 * Outbox 재배달 — 격리된(또는 재시도 대기 중인) 이벤트를 다시 pending으로.
 *
 *   pnpm requeue-outbox --dry-run
 *   pnpm requeue-outbox --event-type ContentRightsRevoked --limit 50
 *   pnpm requeue-outbox --reason "RB-04 소비자 수정 배포 후" --actor ops@example.com
 *
 * 근거: docs/runbooks/04-queue-backlog-dlq.md 5.6(Outbox 릴레이 복구).
 *
 * 규칙:
 * - **원인을 고친 뒤에** 실행한다. 같은 이유로 다시 격리되면 적체만 늘어난다.
 * - 소비자는 Inbox(consumer_name + event_id)로 멱등하므로 재배달은 안전하다.
 *   작업 멱등성 키 `{topic}:{event_id}`도 중복 작업을 막는다 (ADR-0006).
 * - delivered 이벤트는 건드리지 않는다. 이미 배달된 것을 되돌리는 것은
 *   재배달이 아니라 **재실행**이고, 그건 이 도구의 일이 아니다.
 * - run 지터를 준다 — 한꺼번에 몰리면 같은 실패를 그대로 재현한다.
 *
 * 상태 전이는 packages/db/src/queue.ts의 dispatchOutbox와 짝을 이룬다:
 *   failed(attempts >= 한도, 격리) --(이 스크립트)--> pending (attempts 0)
 */

interface Options {
  eventType: string | null;
  limit: number;
  dryRun: boolean;
  /** 격리된 것만이 기본. 재시도 대기 중인 것까지 앞당기려면 --include-retrying */
  includeRetrying: boolean;
  reason: string | null;
  actor: string | null;
}

const DEFAULT_LIMIT = 200;
const JITTER_SECONDS = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLATFORM_SCOPE_ORG = "00000000-0000-0000-0000-000000000000";

function usage(): void {
  console.log(
    "사용: pnpm requeue-outbox [--event-type <타입>] [--limit <n>] [--dry-run] [--include-retrying] [--reason <사유>] [--actor <이메일>]",
  );
  console.log("");
  console.log("  --dry-run           대상만 보여주고 아무것도 바꾸지 않는다 (먼저 이걸로 확인한다)");
  console.log(`  --limit             기본 ${DEFAULT_LIMIT}. 오래된 것부터 처리한다`);
  console.log("  --event-type        생략하면 전 타입");
  console.log(
    `  --include-retrying  아직 시도 한도(${OUTBOX_MAX_ATTEMPTS}) 안이라 자동 재시도될 것까지 지금 앞당긴다`,
  );
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    eventType: null,
    limit: DEFAULT_LIMIT,
    dryRun: false,
    includeRetrying: false,
    reason: null,
    actor: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--include-retrying") {
      options.includeRetrying = true;
      continue;
    }
    if (arg === "--help" || arg === "help") {
      usage();
      process.exit(0);
    }
    const value = argv[i + 1];
    if (
      arg === "--event-type" ||
      arg === "--limit" ||
      arg === "--reason" ||
      arg === "--actor"
    ) {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} 에 값이 없습니다.`);
      }
      if (arg === "--event-type") options.eventType = value;
      if (arg === "--reason") options.reason = value;
      if (arg === "--actor") options.actor = value;
      if (arg === "--limit") {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(`--limit 은 양의 정수여야 합니다: ${value}`);
        }
        options.limit = parsed;
      }
      i += 1;
      continue;
    }
    throw new Error(`알 수 없는 옵션입니다: ${arg}`);
  }
  return options;
}

interface StuckEvent {
  id: string;
  organization_id: string;
  event_type: string;
  status: string;
  attempts: number;
  created_at: Date;
  next_attempt_at: Date;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const sql = createSql();
  const minAttempts = options.includeRetrying ? 0 : OUTBOX_MAX_ATTEMPTS;

  try {
    const summary = await sql<
      { event_type: string; status: string; n: number; oldest: Date }[]
    >`
      select event_type, status::text as status, count(*)::int as n,
             min(created_at) as oldest
      from outbox_events
      where status = 'failed' and attempts >= ${OUTBOX_MAX_ATTEMPTS}
      group by 1, 2
      order by 3 desc
    `;

    console.log(
      `격리된 이벤트 현황 (status='failed' and attempts >= ${OUTBOX_MAX_ATTEMPTS})`,
    );
    console.log("");
    if (summary.length === 0) {
      console.log("  격리된 이벤트가 없습니다.");
    } else {
      console.log(`  ${"event_type".padEnd(32)} ${"건수".padStart(6)}  최초 발생`);
      for (const row of summary) {
        console.log(
          `  ${row.event_type.padEnd(32)} ${String(row.n).padStart(6)}  ${row.oldest.toISOString()}`,
        );
      }
    }
    console.log("");

    const targets = options.eventType
      ? await sql<StuckEvent[]>`
          select id, organization_id, event_type, status::text as status,
                 attempts, created_at, next_attempt_at
          from outbox_events
          where status = 'failed' and attempts >= ${minAttempts}
            and event_type = ${options.eventType}
          order by created_at asc
          limit ${options.limit}
        `
      : await sql<StuckEvent[]>`
          select id, organization_id, event_type, status::text as status,
                 attempts, created_at, next_attempt_at
          from outbox_events
          where status = 'failed' and attempts >= ${minAttempts}
          order by created_at asc
          limit ${options.limit}
        `;

    if (targets.length === 0) {
      console.log(
        `대상이 없습니다 (event_type=${options.eventType ?? "전체"}, ${
          options.includeRetrying ? "재시도 대기 포함" : "격리분만"
        }).`,
      );
      return;
    }

    /* 라우팅 결손으로 격리된 것은 재배달해도 같은 자리에서 다시 격리된다.
     * 코드가 고쳐졌는지 지금 판정해서 보여 준다 — "고쳤겠지"로 넘기지 않는다. */
    const stillBroken = targets.filter(
      (event) => resolveConsumers(event.event_type).kind === "routing_gap",
    );

    console.log(
      `대상 ${targets.length}건 (event_type=${options.eventType ?? "전체"}, limit=${options.limit}, 오래된 순)`,
    );
    console.log("");
    const header = `  ${"event_id".padEnd(38)} ${"event_type".padEnd(30)} ${"시도".padStart(5)}  발생`;
    console.log(header);
    console.log(`  ${"-".repeat(header.length)}`);
    for (const event of targets.slice(0, 30)) {
      console.log(
        `  ${event.id.padEnd(38)} ${event.event_type.padEnd(30)} ${String(event.attempts).padStart(5)}  ${event.created_at.toISOString()}`,
      );
    }
    if (targets.length > 30) console.log(`  … 외 ${targets.length - 30}건`);
    console.log("");

    if (stillBroken.length > 0) {
      const types = [...new Set(stillBroken.map((e) => e.event_type))];
      console.log(
        `경고: ${stillBroken.length}건은 지금 코드에서도 라우팅 결손입니다 — ${types.join(", ")}`,
      );
      console.log(
        "  EVENT_CONSUMERS에 소비자를 넣거나 EVENT_WITHOUT_CONSUMER에 근거를 적기 전에는",
      );
      console.log("  재배달해도 같은 이유로 다시 격리됩니다 (queue.ts).");
      console.log("");
    }

    if (options.dryRun) {
      console.log("--dry-run 이므로 아무것도 바꾸지 않았습니다.");
      console.log("");
      console.log("실제 재배달 전에 확인할 것 (RB-04 5.6):");
      console.log("  1. 격리 원인을 고쳤는가 (위 경고가 남아 있으면 아직이다)");
      console.log("  2. 소비자는 Inbox로 멱등하다 — 재배달 자체는 안전하다");
      console.log("  3. 워커가 살아 있는가 — 없으면 pending만 늘어난다 (pnpm worker:status)");
      return;
    }

    const ids = targets.map((event) => event.id);
    const updated = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string; event_type: string }[]>`
        update outbox_events
        set status = 'pending',
            attempts = 0,
            next_attempt_at = now() + make_interval(secs => (random() * ${JITTER_SECONDS})::int)
        where id = any(${ids}) and status = 'failed'
        returning id, event_type
      `;

      // 조직별로 감사 기록을 나눈다 — 조직 화면에서 자기 이벤트만 보여야 한다.
      const byOrg = new Map<string, string[]>();
      for (const event of targets) {
        const key = event.organization_id ?? PLATFORM_SCOPE_ORG;
        byOrg.set(key, [...(byOrg.get(key) ?? []), event.id]);
      }
      for (const [organizationId, eventIds] of byOrg) {
        await tx`
          insert into audit_events (
            id, organization_id, actor_type, actor_id, action,
            target_type, target_id, reason, after
          ) values (
            ${uuidv7()}, ${organizationId}, 'automation',
            ${options.actor && UUID_RE.test(options.actor) ? options.actor : null},
            'ops.requeue_outbox', 'outbox_events', null,
            ${options.reason},
            ${tx.json({
              eventType: options.eventType ?? "(전체)",
              requeued: eventIds.length,
              eventIds: eventIds.slice(0, 50),
              actor: options.actor ?? "(미지정)",
              jitterSeconds: JITTER_SECONDS,
              includeRetrying: options.includeRetrying,
              via: "packages/db/scripts/requeue-outbox.mts",
            } as never)}
          )
        `;
      }
      return rows;
    });

    console.log(`재배달 예약 완료 — ${updated.length}건을 pending으로 되돌렸습니다.`);
    if (updated.length !== targets.length) {
      console.log(
        `  주의: 대상 ${targets.length}건 중 ${targets.length - updated.length}건은 그사이 상태가 바뀌어 건너뛰었습니다.`,
      );
    }
    console.log("");
    console.log(`  attempts는 0으로 초기화, next_attempt_at은 지금부터 0~${JITTER_SECONDS}초 지터.`);
    console.log("  audit_events에 action='ops.requeue_outbox'로 기록했습니다.");
    console.log("");
    console.log("다음: pnpm queue:status 로 배달이 진행되는지, RB-04 6장 V-5·V-8로 결과를 확인하세요.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(
    `[requeue-outbox] ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error("");
  usage();
  process.exit(1);
});
