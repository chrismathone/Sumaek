import { describe, expect, it } from "vitest";
import { isHeartbeatLost, type WorkerHeartbeatRow } from "../src/heartbeat";

/* 박동 판정의 순수 부분 — "워커가 죽었는가"의 답을 내는 함수 그 자체.
 * DB 왕복 부분(recordHeartbeat·markWorkerStopped·readHeartbeats)은 SQL이고
 * 마이그레이션 0011a가 적용된 뒤 pnpm worker:status가 덮는다.
 *
 * 왜 이 함수만 따로 검사하는가: 임계값이 여기 한 곳에만 있다. 런북·알림·
 * status 도구가 전부 이 판정을 그대로 쓴다 — 여기가 틀리면 죽은 워커를
 * 살아 있다고 보고하고, 아무도 그걸 알아채지 못한다. */

const NOW = new Date("2026-08-02T12:00:00.000Z");

function row(overrides: Partial<WorkerHeartbeatRow> = {}): WorkerHeartbeatRow {
  return {
    worker_id: "worker-1",
    hostname: "host",
    pid: 1,
    topics: ["schedule.recalculate"],
    beat_interval_seconds: 15,
    started_at: new Date("2026-08-02T11:00:00.000Z"),
    last_beat_at: NOW,
    stopped_at: null,
    stop_reason: null,
    last_result: null,
    ...overrides,
  };
}

/** NOW보다 seconds초 전에 박동한 행 */
function beatAgo(seconds: number, overrides: Partial<WorkerHeartbeatRow> = {}) {
  return row({
    last_beat_at: new Date(NOW.getTime() - seconds * 1000),
    ...overrides,
  });
}

describe("isHeartbeatLost", () => {
  it("방금 박동한 워커는 살아 있다", () => {
    expect(isHeartbeatLost(beatAgo(0), NOW)).toBe(false);
  });

  it("주기의 3배를 넘기면 끊긴 것이다", () => {
    // 주기 15초 → 45초까지는 봐 주고, 그 뒤는 죽은 것으로 본다
    expect(isHeartbeatLost(beatAgo(46), NOW)).toBe(true);
  });

  it("정확히 3배는 아직 끊긴 것이 아니다", () => {
    /* 경계를 닫아 두는 이유: 박동 한 번을 놓친 것과 프로세스가 죽은 것은
     * 다르다. 3배 안쪽의 지연으로 운영자를 깨우지 않는다. */
    expect(isHeartbeatLost(beatAgo(45), NOW)).toBe(false);
    expect(isHeartbeatLost(beatAgo(44), NOW)).toBe(false);
  });

  it("정상 종료한 워커는 아무리 오래돼도 끊김이 아니다", () => {
    /* 「내려감」과 「죽음」은 다른 사건이다. stopped_at이 찍힌 행을 끊김으로
     * 세면 배포 때마다 거짓 경보가 뜨고, 그러면 진짜 죽음도 무시된다. */
    const stopped = beatAgo(86_400, {
      stopped_at: new Date(NOW.getTime() - 86_400_000),
      stop_reason: "SIGTERM 수신",
    });
    expect(isHeartbeatLost(stopped, NOW)).toBe(false);
  });

  it("임계값은 행이 들고 다니는 주기를 따라 함께 움직인다", () => {
    /* 임계값을 런북 문장이나 상수에 박지 않고 beat_interval_seconds에서
     * 유도하는 이유 — 주기를 늘린 워커가 살아 있는데 죽었다고 보고되면 안 된다. */
    const slow = beatAgo(100, { beat_interval_seconds: 60 }); // 한도 180초
    expect(isHeartbeatLost(slow, NOW)).toBe(false);
    const fast = beatAgo(100, { beat_interval_seconds: 5 }); // 한도 15초
    expect(isHeartbeatLost(fast, NOW)).toBe(true);
  });

  it("기본 now는 현재 시각이다 — 호출자가 시계를 넘기지 않아도 판정한다", () => {
    expect(isHeartbeatLost(row({ last_beat_at: new Date() }))).toBe(false);
  });
});
