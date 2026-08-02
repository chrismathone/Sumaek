import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { createSql } from "../src/client";
import {
  EVENT_CONSUMERS,
  EVENT_WITHOUT_CONSUMER,
  OUTBOX_MAX_ATTEMPTS,
} from "../src/queue";
import {
  heartbeatTableExists,
  isHeartbeatLost,
  readHeartbeats,
} from "../src/heartbeat";

/**
 * 큐·Outbox 적체 조회 — `pnpm queue:status`.
 *
 *   pnpm queue:status                 전체
 *   pnpm queue:status --top 40        이벤트 타입별 표를 더 길게
 *
 * 근거: docs/runbooks/04-queue-backlog-dlq.md 4장(진단)·6장(검증).
 *
 * 왜 있는가: 운영자가 적체를 보려면 커밋된 임시 스크립트(queue-status.mts)를
 * 손으로 고쳐 돌리는 수밖에 없었다. 그 스크립트는 outbox를 pending 건수 하나로만
 * 보여 줘서 「재시도 중」과 「격리되어 아무도 다시 집지 않는 것」이 구분되지
 * 않았다. 이 도구는 그 둘을 가른다.
 *
 * 읽기 전용이다 — update·delete 문장이 없다. 되살리는 것은
 * `pnpm requeue-outbox`(이벤트)와 `pnpm requeue-dlq`(작업)의 몫이다.
 */

interface Options {
  top: number;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { top: 20 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "help") {
      console.log("사용: pnpm queue:status [--top <n>]");
      process.exit(0);
    }
    if (arg === "--top") {
      const value = argv[i + 1];
      const parsed = Number.parseInt(value ?? "", 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--top 은 양의 정수여야 합니다: ${value}`);
      }
      options.top = parsed;
      i += 1;
      continue;
    }
    throw new Error(`알 수 없는 옵션입니다: ${arg}`);
  }
  return options;
}

function section(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`);
  console.log("");
}

function pad(value: unknown, width: number): string {
  return String(value ?? "-").padEnd(width);
}

function padStart(value: unknown, width: number): string {
  return String(value ?? "-").padStart(width);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const sql = createSql();

  try {
    const [now] = await sql<{ db_time: Date }[]>`select now() as db_time`;
    console.log("큐·Outbox 상태");
    console.log(`DB 시각: ${now?.db_time.toISOString() ?? "?"}`);
    console.log(`격리 기준: attempts >= ${OUTBOX_MAX_ATTEMPTS} (OUTBOX_MAX_ATTEMPTS)`);

    /* ── Outbox ── */
    section("Outbox 상태별");
    const outbox = await sql<
      {
        status: string;
        n: number;
        quarantined: number;
        oldest: string | null;
        due_now: number;
      }[]
    >`
      select status::text as status,
             count(*)::int as n,
             count(*) filter (
               where status = 'failed' and attempts >= ${OUTBOX_MAX_ATTEMPTS}
             )::int as quarantined,
             max(now() - created_at)::text as oldest,
             count(*) filter (where next_attempt_at <= now())::int as due_now
      from outbox_events
      group by 1
      order by 2 desc
    `;
    if (outbox.length === 0) {
      console.log("  outbox_events가 비어 있습니다.");
    } else {
      console.log(
        `  ${pad("status", 12)} ${padStart("건수", 8)} ${padStart("격리", 6)} ${padStart("지금 도래", 10)}  최고령`,
      );
      for (const row of outbox) {
        console.log(
          `  ${pad(row.status, 12)} ${padStart(row.n, 8)} ${padStart(row.quarantined, 6)} ${padStart(row.due_now, 10)}  ${row.oldest ?? "-"}`,
        );
      }
      console.log("");
      console.log(
        "  delivering = 디스패치 중(리스 보유). 리스가 만료되면 자동으로 다시 집는다.",
      );
      console.log(
        "  격리 = status='failed' and attempts >= 한도. **자동으로 다시 집지 않는다** → pnpm requeue-outbox",
      );
    }

    /* ── 이벤트 타입별 적체 ── */
    section(`미배달 이벤트 타입별 상위 ${options.top}`);
    const byType = await sql<
      {
        event_type: string;
        status: string;
        n: number;
        max_attempts: number;
        oldest: string | null;
      }[]
    >`
      select event_type, status::text as status, count(*)::int as n,
             max(attempts)::int as max_attempts,
             max(now() - created_at)::text as oldest
      from outbox_events
      where status <> 'delivered'
      group by 1, 2
      order by 3 desc
      limit ${options.top}
    `;
    if (byType.length === 0) {
      console.log("  미배달 이벤트가 없습니다.");
    } else {
      console.log(
        `  ${pad("event_type", 32)} ${pad("status", 11)} ${padStart("건수", 7)} ${padStart("최대시도", 9)}  최고령`,
      );
      for (const row of byType) {
        const routing = EVENT_CONSUMERS[row.event_type];
        const gap =
          routing === undefined
            ? "  ← 라우팅표에 없음"
            : routing.length === 0 &&
                EVENT_WITHOUT_CONSUMER[row.event_type] === undefined
              ? "  ← 소비자 0건 (근거 미선언)"
              : "";
        console.log(
          `  ${pad(row.event_type, 32)} ${pad(row.status, 11)} ${padStart(row.n, 7)} ${padStart(row.max_attempts, 9)}  ${row.oldest ?? "-"}${gap}`,
        );
      }
    }

    /* ── 무소비 선언 ── */
    section("소비자를 두지 않기로 선언한 이벤트");
    const declared = Object.entries(EVENT_WITHOUT_CONSUMER);
    if (declared.length === 0) {
      console.log("  없습니다.");
    } else {
      for (const [eventType, reason] of declared) {
        const [row] = await sql<{ n: number }[]>`
          select count(*)::int as n from outbox_events
          where event_type = ${eventType} and status = 'delivered'
        `;
        console.log(`  ${pad(eventType, 32)} 배달 ${row?.n ?? 0}건 · 작업 0건`);
        console.log(`      ${reason}`);
      }
      console.log("");
      console.log(
        "  이 이벤트들은 작업 0건으로 delivered가 되는 것이 **정상**이다.",
      );
      console.log(
        "  선언되지 않은 미매핑 이벤트는 delivered가 되지 않고 격리된다(무음 폐기 방지).",
      );
    }

    /* ── 작업 큐 ── */
    section("작업 큐 (jobs)");
    const jobs = await sql<
      {
        topic: string;
        status: string;
        n: number;
        oldest: string | null;
        avg_attempts: string | null;
      }[]
    >`
      select topic, status::text as status, count(*)::int as n,
             max(now() - created_at)::text as oldest,
             round(avg(attempts), 2)::text as avg_attempts
      from jobs
      group by 1, 2
      order by 1, 2
    `;
    if (jobs.length === 0) {
      console.log("  jobs가 비어 있습니다.");
    } else {
      console.log(
        `  ${pad("topic", 32)} ${pad("status", 16)} ${padStart("건수", 7)} ${padStart("평균시도", 9)}  최고령`,
      );
      for (const row of jobs) {
        console.log(
          `  ${pad(row.topic, 32)} ${pad(row.status, 16)} ${padStart(row.n, 7)} ${padStart(row.avg_attempts, 9)}  ${row.oldest ?? "-"}`,
        );
      }
    }

    const [orphan] = await sql<{ n: number; overdue: string | null }[]>`
      select count(*)::int as n, max(now() - lease_expires_at)::text as overdue
      from jobs where status = 'running' and lease_expires_at < now()
    `;
    console.log("");
    console.log(
      `  고아 작업(lease 만료 후 running): ${orphan?.n ?? 0}건 · 최장 초과 ${orphan?.overdue ?? "-"}`,
    );

    /* ── 소비자 처리 이력 ── */
    section("Inbox 소비자별 마지막 처리");
    const inbox = await sql<
      { consumer_name: string; n: number; since_last: string | null }[]
    >`
      select consumer_name, count(*)::int as n,
             (now() - max(processed_at))::text as since_last
      from inbox_events
      group by 1
      order by 1
    `;
    if (inbox.length === 0) {
      console.log("  처리 기록이 없습니다.");
    } else {
      console.log(`  ${pad("consumer_name", 32)} ${padStart("누적", 8)}  마지막 처리 이후`);
      for (const row of inbox) {
        console.log(
          `  ${pad(row.consumer_name, 32)} ${padStart(row.n, 8)}  ${row.since_last ?? "-"}`,
        );
      }
    }

    /* ── 워커 박동 ── */
    section("워커 박동");
    if (!(await heartbeatTableExists(sql))) {
      console.log(
        "  worker_heartbeats 테이블이 없습니다 (마이그레이션 0011a 미적용).",
      );
      console.log("  워커 생존은 위의 적체·고아 작업으로만 간접 판단됩니다.");
    } else {
      const beats = await readHeartbeats(sql);
      if (beats.length === 0) {
        console.log("  박동 기록이 없습니다 — 워커가 한 번도 뜨지 않았습니다.");
      } else {
        for (const row of beats) {
          const state = row.stopped_at
            ? `내려감(${row.stop_reason ?? "사유 없음"})`
            : isHeartbeatLost(row)
              ? "박동 끊김"
              : "살아 있음";
          console.log(
            `  ${pad(row.worker_id, 26)} ${pad(state, 22)} 마지막 ${row.last_beat_at.toISOString()}`,
          );
        }
      }
    }

    console.log("");
    console.log("다음 행동");
    console.log("  적체만 있고 워커가 살아 있다  → 기다린다. 처리량이 모자라면 워커 증설(RB-04 5.2)");
    console.log("  워커가 죽었다                → 재시작(README「워커 운영」)");
    console.log("  격리된 이벤트가 있다          → 원인 수정 후 pnpm requeue-outbox --dry-run");
    console.log("  dead_lettered 작업이 있다     → 원인 수정 후 pnpm requeue-dlq --dry-run");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(
    `[queue-status] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
