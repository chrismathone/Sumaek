import { config } from "dotenv";
config({ path: [".env", "../../.env"] });
import {
  createSql,
  heartbeatTableExists,
  isHeartbeatLost,
  readHeartbeats,
  type WorkerHeartbeatRow,
} from "@su-maek/db";
import { createHandlerRegistry, TOPICS_WITHOUT_HANDLER } from "./registry";

/**
 * 워커 생존 확인 — `pnpm --filter @su-maek/worker status`.
 *
 * RB-04 4-2·5.2·6장 V-3이 부르는 명령이다(그 자리에 스크립트가 없어 런북이
 * 실행 불가였다). 여기서 답하는 질문은 하나다: **워커가 살아 있는가.**
 * 큐가 얼마나 밀렸는지는 `pnpm queue:status`가 본다.
 *
 * 종료 코드: 살아 있는 워커가 하나라도 있으면 0, 없거나 박동이 끊긴 워커가
 * 있으면 1. 모니터링에서 그대로 쓸 수 있게 한다.
 */

function ageText(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds}초 전`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}분 전`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}시간 전`;
  return `${Math.round(seconds / 86_400)}일 전`;
}

function describe(row: WorkerHeartbeatRow, now: Date): string {
  if (row.stopped_at) return `내려감 (${row.stop_reason ?? "사유 없음"})`;
  return isHeartbeatLost(row, now) ? "박동 끊김" : "살아 있음";
}

async function main(): Promise<void> {
  const sql = createSql();
  const now = new Date();
  let unhealthy = false;

  try {
    console.log("워커 상태");
    console.log("");

    if (!(await heartbeatTableExists(sql))) {
      console.log(
        "  worker_heartbeats 테이블이 없습니다 — 마이그레이션 0011a가 아직 적용되지 않았습니다.",
      );
      console.log("  `pnpm db:migrate` 후 다시 확인하세요.");
      console.log("");
      console.log(
        "  그 전까지 워커 생존은 간접 신호로만 판단합니다: `pnpm queue:status`의",
      );
      console.log(
        "  「outbox 적체 최고령」과 「고아 작업」이 늘고 있으면 워커가 죽은 것입니다.",
      );
      process.exitCode = 1;
      return;
    }

    const rows = await readHeartbeats(sql);
    if (rows.length === 0) {
      console.log("  박동 기록이 없습니다 — 워커가 한 번도 뜨지 않았습니다.");
      console.log("  띄우는 법: README「워커 운영」 / docs/runbooks/04 5.2");
      process.exitCode = 1;
      return;
    }

    const header = `  ${"worker_id".padEnd(24)} ${"상태".padEnd(10)} ${"마지막 박동".padEnd(12)} 호스트/PID`;
    console.log(header);
    console.log(`  ${"-".repeat(header.length)}`);
    let alive = 0;
    for (const row of rows) {
      const state = describe(row, now);
      if (state === "살아 있음") alive += 1;
      if (state === "박동 끊김") unhealthy = true;
      console.log(
        `  ${row.worker_id.padEnd(24)} ${state.padEnd(10)} ${ageText(row.last_beat_at, now).padEnd(12)} ${row.hostname ?? "?"}/${row.pid ?? "?"}`,
      );
      if (row.last_result) {
        console.log(`      마지막 루프: ${JSON.stringify(row.last_result)}`);
      }
    }
    if (alive === 0) unhealthy = true;
    console.log("");
    console.log(`  살아 있는 워커 ${alive}명 (박동 주기의 3배를 넘으면 끊긴 것으로 본다)`);

    /* 워커가 살아 있어도 lease가 만료된 채 running으로 굳은 작업이 있으면
     * 이전 세대가 죽었다는 뜻이다 — 재클레임은 자동이지만 보고는 한다. */
    const [orphan] = await sql<{ n: number; overdue: string | null }[]>`
      select count(*)::int as n,
             max(now() - lease_expires_at)::text as overdue
      from jobs
      where status = 'running' and lease_expires_at < now()
    `;
    console.log("");
    console.log(
      `  고아 작업(lease 만료 후 running): ${orphan?.n ?? 0}건${
        orphan?.n ? ` · 최장 초과 ${orphan.overdue}` : ""
      }`,
    );

    const handlers = createHandlerRegistry();
    console.log("");
    console.log(`  등록 토픽 ${handlers.size}개: ${[...handlers.keys()].join(", ")}`);
    const gaps = Object.entries(TOPICS_WITHOUT_HANDLER);
    if (gaps.length > 0) {
      console.log("");
      console.log("  핸들러가 없는 토픽 (이름만 있는 것 — 아무것도 처리되지 않는다):");
      for (const [topic, reason] of gaps) {
        console.log(`    ${topic.padEnd(16)} ${reason}`);
      }
    }

    if (unhealthy) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[worker status] 실패");
  console.error(error);
  process.exit(1);
});
