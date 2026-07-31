import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../src/client";

/**
 * DLQ 재처리 — dead_lettered 작업을 다시 큐에 넣는다.
 *
 *   pnpm requeue-dlq --dry-run
 *   pnpm requeue-dlq --topic grading.auto --limit 50
 *   pnpm requeue-dlq --topic export.pdf --reason "RB-04 렌더러 수정 배포 후" --actor ops@example.com
 *
 * 근거: docs/runbooks/04-queue-backlog-dlq.md 5.7(DLQ 재처리)
 *
 * 규칙:
 * - **원인을 고친 뒤에** 실행한다. 같은 이유로 다시 죽으면 적체만 늘어난다.
 * - 멱등성 키를 그대로 두므로 중복 산출물이 생기지 않는다 (RB-04 5.7).
 * - payload는 손대지 않는다. last_error도 지우지 않는다 — 왜 죽었는지가 유일한 단서다.
 * - run_at에 0~600초 지터를 준다. 한꺼번에 몰리면 재발한다 (README 5.2 규약 6).
 *
 * 상태 전이는 packages/db/src/queue.ts의 failJob과 짝을 이룬다:
 *   dead_lettered --(이 스크립트)--> queued (attempts 0으로 초기화)
 */

interface Options {
  topic: string | null;
  limit: number;
  dryRun: boolean;
  reason: string | null;
  actor: string | null;
}

const DEFAULT_LIMIT = 100;
const JITTER_SECONDS = 600;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLATFORM_SCOPE_ORG = "00000000-0000-0000-0000-000000000000";

function usage(): void {
  console.log("사용: pnpm requeue-dlq [--topic <토픽>] [--limit <n>] [--dry-run] [--reason <사유>] [--actor <이메일>]");
  console.log("");
  console.log("  --dry-run  대상만 보여주고 아무것도 바꾸지 않는다 (먼저 이걸로 확인한다)");
  console.log(`  --limit    기본 ${DEFAULT_LIMIT}. 오래된 것부터 처리한다`);
  console.log("  --topic    생략하면 전 토픽");
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    topic: null,
    limit: DEFAULT_LIMIT,
    dryRun: false,
    reason: null,
    actor: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "help") {
      usage();
      process.exit(0);
    }
    const value = argv[i + 1];
    if (arg === "--topic" || arg === "--limit" || arg === "--reason" || arg === "--actor") {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} 에 값이 없습니다.`);
      }
      if (arg === "--topic") options.topic = value;
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

interface DeadJob {
  id: string;
  organization_id: string | null;
  topic: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  idempotency_key: string | null;
  updated_at: Date;
}

function shorten(text: string | null, width: number): string {
  if (!text) return "-";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= width ? oneLine : `${oneLine.slice(0, width - 1)}…`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const sql = createSql();

  try {
    const summary = await sql<{ topic: string; n: number; oldest: Date; newest: Date }[]>`
      select topic, count(*)::int as n, min(updated_at) as oldest, max(updated_at) as newest
      from jobs
      where status = 'dead_lettered'
      group by topic
      order by n desc
    `;

    console.log("DLQ 현황 (jobs.status = 'dead_lettered')");
    console.log("");
    if (summary.length === 0) {
      console.log("  dead_lettered 작업이 없습니다.");
      console.log("");
      console.log("재처리할 것이 없습니다. (RB-04 6장 V-8 관점에서는 정상)");
      return;
    }
    console.log(`  ${"토픽".padEnd(32)} ${"건수".padStart(6)}  최초 실패 → 최근 실패`);
    for (const row of summary) {
      console.log(
        `  ${row.topic.padEnd(32)} ${String(row.n).padStart(6)}  ${row.oldest.toISOString()} → ${row.newest.toISOString()}`,
      );
    }
    console.log("");

    const targets = options.topic
      ? await sql<DeadJob[]>`
          select id, organization_id, topic, attempts, max_attempts,
                 last_error, idempotency_key, updated_at
          from jobs
          where status = 'dead_lettered' and topic = ${options.topic}
          order by updated_at asc
          limit ${options.limit}
        `
      : await sql<DeadJob[]>`
          select id, organization_id, topic, attempts, max_attempts,
                 last_error, idempotency_key, updated_at
          from jobs
          where status = 'dead_lettered'
          order by updated_at asc
          limit ${options.limit}
        `;

    if (targets.length === 0) {
      console.log(`대상이 없습니다 (topic=${options.topic ?? "전체"}).`);
      return;
    }

    console.log(
      `대상 ${targets.length}건 (topic=${options.topic ?? "전체"}, limit=${options.limit}, 오래된 순)`,
    );
    console.log("");
    const header = `  ${"job_id".padEnd(38)} ${"토픽".padEnd(26)} ${"시도".padStart(5)}  마지막 오류`;
    console.log(header);
    console.log(`  ${"-".repeat(header.length)}`);
    for (const job of targets) {
      console.log(
        `  ${job.id.padEnd(38)} ${job.topic.padEnd(26)} ${`${job.attempts}/${job.max_attempts}`.padStart(5)}  ${shorten(job.last_error, 60)}`,
      );
    }
    console.log("");

    if (options.dryRun) {
      console.log("--dry-run 이므로 아무것도 바꾸지 않았습니다.");
      console.log("");
      console.log("실제 재처리 전에 확인할 것 (RB-04 5.7):");
      console.log("  1. 죽은 원인을 고쳤는가. 안 고쳤으면 같은 이유로 다시 죽는다");
      console.log("  2. 마지막 오류가 여러 종류면 --topic 으로 나눠서 처리한다");
      console.log("  3. 멱등성 키를 유지하므로 중복 산출물은 생기지 않는다");
      return;
    }

    const ids = targets.map((job) => job.id);
    const updated = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string; topic: string; run_at: Date }[]>`
        update jobs
        set status = 'queued',
            attempts = 0,
            worker_id = null,
            lease_expires_at = null,
            run_at = now() + make_interval(secs => (random() * ${JITTER_SECONDS})::int),
            updated_at = now()
        where id = any(${ids}) and status = 'dead_lettered'
        returning id, topic, run_at
      `;

      // 조직별로 감사 기록을 나눈다 — 조직 화면에서 자기 작업만 보여야 한다.
      const byOrg = new Map<string, string[]>();
      for (const job of targets) {
        const key = job.organization_id ?? PLATFORM_SCOPE_ORG;
        byOrg.set(key, [...(byOrg.get(key) ?? []), job.id]);
      }
      for (const [organizationId, jobIds] of byOrg) {
        await tx`
          insert into audit_events (
            id, organization_id, actor_type, actor_id, action,
            target_type, target_id, reason, after
          ) values (
            ${uuidv7()}, ${organizationId}, 'automation',
            ${options.actor && UUID_RE.test(options.actor) ? options.actor : null},
            'ops.requeue_dlq', 'jobs', null,
            ${options.reason},
            ${tx.json({
              topic: options.topic ?? "(전체)",
              requeued: jobIds.length,
              jobIds: jobIds.slice(0, 50),
              actor: options.actor ?? "(미지정)",
              jitterSeconds: JITTER_SECONDS,
              via: "packages/db/scripts/requeue-dead-letters.mts",
            } as never)}
          )
        `;
      }
      return rows;
    });

    console.log(`재처리 완료 — ${updated.length}건을 queued로 되돌렸습니다.`);
    if (updated.length !== targets.length) {
      console.log(
        `  주의: 대상 ${targets.length}건 중 ${targets.length - updated.length}건은 그사이 상태가 바뀌어 건너뛰었습니다.`,
      );
    }
    console.log("");
    console.log(`  attempts는 0으로 초기화, run_at은 지금부터 0~${JITTER_SECONDS}초 지터.`);
    console.log("  last_error와 payload는 그대로 두었습니다 (원인 추적용).");
    console.log("  audit_events에 action='ops.requeue_dlq'로 기록했습니다.");
    console.log("");
    console.log("다음: RB-04 6장 V-1·V-8·V-9로 처리 결과를 확인하세요.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`[requeue-dlq] ${error instanceof Error ? error.message : String(error)}`);
  console.error("");
  usage();
  process.exit(1);
});
