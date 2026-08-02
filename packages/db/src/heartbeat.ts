import type postgres from "postgres";

/* ─────────────────────────────────────────────────────────────
 * 워커 박동(heartbeat) — "지금 워커가 살아 있는가"의 유일한 답.
 *
 * 왜 테이블인가: 접속이 Supavisor 풀러를 거치므로 pg_stat_activity에는
 * 워커의 application_name이 남지 않는다(실측 — 풀러 자기 이름만 보인다).
 * 큐 지표(적체·고아 작업)는 **일이 있을 때만** 워커의 죽음을 드러낸다.
 * 유휴 상태의 죽음까지 보려면 워커가 스스로 박동을 남기는 수밖에 없다.
 * RB-04의 `worker_heartbeat_lost` 알림이 가리키던 것이 이것이다.
 *
 * 정상 종료는 stopped_at을 남긴다 — "내려간 것"과 "죽은 것"은 다른 사건이다.
 *
 * 테이블이 없어도(마이그레이션 0011a 미적용) 워커는 그대로 돈다. 박동만
 * 남지 않고 한 번 경고한다 — 관측 기능이 운영을 멈추게 하지 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface WorkerHeartbeatInput {
  workerId: string;
  hostname: string;
  pid: number;
  topics: readonly string[];
  /** 박동 주기(초). 관측자가 "얼마나 늦으면 죽은 것인가"를 여기서 읽는다 */
  beatIntervalSeconds: number;
  /** 마지막 루프 요약 — 살아 있지만 아무것도 못 하는 상태를 구분한다 */
  lastResult?: unknown;
}

export interface WorkerHeartbeatRow {
  worker_id: string;
  hostname: string | null;
  pid: number | null;
  topics: string[];
  beat_interval_seconds: number;
  started_at: Date;
  last_beat_at: Date;
  stopped_at: Date | null;
  stop_reason: string | null;
  last_result: unknown;
}

/** 마이그레이션 0011a 적용 여부 — 없으면 박동 경로를 통째로 건너뛴다 */
export async function heartbeatTableExists(
  sql: postgres.Sql,
): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`
    select to_regclass('public.worker_heartbeats') is not null as exists
  `;
  return row?.exists ?? false;
}

export async function recordHeartbeat(
  sql: postgres.Sql,
  input: WorkerHeartbeatInput,
): Promise<void> {
  await sql`
    insert into worker_heartbeats (
      worker_id, hostname, pid, topics, beat_interval_seconds,
      started_at, last_beat_at, stopped_at, stop_reason, last_result
    ) values (
      ${input.workerId}, ${input.hostname}, ${input.pid},
      ${input.topics as string[]}, ${input.beatIntervalSeconds},
      now(), now(), null, null,
      ${sql.json((input.lastResult ?? null) as never)}
    )
    on conflict (worker_id) do update
    set hostname = excluded.hostname,
        pid = excluded.pid,
        topics = excluded.topics,
        beat_interval_seconds = excluded.beat_interval_seconds,
        last_beat_at = now(),
        stopped_at = null,
        stop_reason = null,
        last_result = excluded.last_result
  `;
}

/** 정상 종료 표시 — 이 행은 "죽음"이 아니라 "내려감"으로 읽힌다 */
export async function markWorkerStopped(
  sql: postgres.Sql,
  workerId: string,
  reason: string,
): Promise<void> {
  await sql`
    update worker_heartbeats
    set stopped_at = now(), stop_reason = ${reason}, last_beat_at = now()
    where worker_id = ${workerId}
  `;
}

/**
 * 박동 목록 — 오래된 것부터 지우지 않는다. 죽은 워커의 마지막 박동이
 * "언제 죽었는가"의 유일한 증거다. 정리는 운영자가 status 도구로 판단한다.
 */
export async function readHeartbeats(
  sql: postgres.Sql,
): Promise<WorkerHeartbeatRow[]> {
  return sql<WorkerHeartbeatRow[]>`
    select worker_id, hostname, pid, topics, beat_interval_seconds,
           started_at, last_beat_at, stopped_at, stop_reason, last_result
    from worker_heartbeats
    order by last_beat_at desc
  `;
}

/**
 * 박동이 끊긴 것으로 볼 것인가 — 주기의 3배를 넘으면 끊긴 것이다.
 * 임계값을 런북 문장이 아니라 여기 한 곳에 둔다(주기를 바꿔도 같이 움직인다).
 */
export function isHeartbeatLost(row: WorkerHeartbeatRow, now = new Date()): boolean {
  if (row.stopped_at) return false; // 정상 종료 — 사건이 아니다
  const ageSeconds = (now.getTime() - row.last_beat_at.getTime()) / 1000;
  return ageSeconds > row.beat_interval_seconds * 3;
}
