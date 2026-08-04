import { hostname } from "node:os";
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });
import {
  createSql,
  heartbeatTableExists,
  markWorkerStopped,
  recordHeartbeat,
} from "@su-maek/db";
import { ASSESSMENT_PRODUCER_INTERVAL_MS } from "@su-maek/db/domain";
import { runOnce, wasIdle } from "./loop";
import { createHandlerRegistry } from "./registry";

/**
 * 수맥 백그라운드 워커 (2B).
 * - 일정·평가·리포트 / mathg-gen OCR·AI / 수식 검증·PDF·HWP 출력 워커가
 *   토픽 핸들러로 등록되어 하나의 프로세스에서 실행된다 (독립 배포·확장 가능).
 * - Outbox 디스패처가 이벤트를 소비자 작업으로 변환한다.
 * - 실시간 채점(grading.*)이 대량 OCR보다 높은 우선순위를 가진다.
 *
 * 띄우는 법과 죽었는지 아는 법: README「워커 운영」·docs/runbooks/04.
 * 이 파일은 진입점일 뿐이다 — 한 회차의 동작은 loop.ts, 배선은 registry.ts.
 */

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);
const POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_SECONDS = Number(
  process.env.WORKER_HEARTBEAT_SECONDS ?? 15,
);
/** 두 번째 시그널은 "지금 당장"이라는 뜻이다 — 기다리지 않는다 */
const SHUTDOWN_GRACE_MS = Number(process.env.WORKER_SHUTDOWN_GRACE_MS ?? 30_000);

let shuttingDown = false;
let stopReason = "정상 종료";

async function main(): Promise<void> {
  const sql = createSql();
  const handlers = createHandlerRegistry();
  const topics = [...handlers.keys()];
  console.log(
    `[su-maek worker] ${WORKER_ID} 시작 — 토픽 ${topics.length}개, 동시성 ${CONCURRENCY}`,
  );

  /* 박동 — 유휴 상태의 죽음까지 보이게 하는 유일한 수단.
   * 테이블이 없으면(마이그레이션 0011a 미적용) 경고 한 번만 남기고 그대로 돈다.
   * 관측 기능이 운영을 멈추게 하지 않는다 — 그래서 존재 확인도 실패를 삼킨다.
   * DB가 잠깐 끊긴 것뿐이라면 다음 박동에서 다시 물어본다(null = 아직 모름). */
  let heartbeatReady: boolean | null = null;
  let lastResult: unknown = null;
  const beat = async (): Promise<void> => {
    try {
      if (heartbeatReady === null) {
        heartbeatReady = await heartbeatTableExists(sql);
        if (!heartbeatReady) {
          console.warn(
            "[su-maek worker] worker_heartbeats 테이블이 없습니다 — 박동을 남기지 않습니다. " +
              "`pnpm db:migrate`(0011a) 후 `pnpm worker:status`가 생존을 보고합니다.",
          );
        }
      }
      if (!heartbeatReady) return;
      await recordHeartbeat(sql, {
        workerId: WORKER_ID,
        hostname: hostname(),
        pid: process.pid,
        topics,
        beatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
        lastResult,
      });
    } catch (error) {
      // 박동 실패로 워커를 죽이지 않는다 — 일은 계속 돈다
      console.error("[su-maek worker] 박동 실패", error);
    }
  };
  await beat();
  const beatTimer = setInterval(() => {
    void beat();
  }, HEARTBEAT_INTERVAL_SECONDS * 1_000);
  beatTimer.unref();

  const requestShutdown = (signal: string): void => {
    if (shuttingDown) {
      console.error(`[su-maek worker] ${signal} 재수신 — 즉시 종료`);
      process.exit(130);
    }
    shuttingDown = true;
    stopReason = `${signal} 수신`;
    console.log(
      `[su-maek worker] ${signal} — 새 클레임을 멈추고 진행 중 작업을 마칩니다`,
    );
    /* 진행 중 작업이 끝나지 않아도 유예 시간 뒤에는 내려간다. 남은 작업은
     * lease 만료로 다른 워커가 회수한다 (유실 0). */
    setTimeout(() => {
      console.error("[su-maek worker] 유예 시간 초과 — 강제 종료");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };
  process.on("SIGINT", () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));

  /* 평가 생성 생산자의 간격은 **여기서** 재고 회차에 넘긴다 — 루프가 시각
   * 상태를 숨겨 갖지 않게 한다(loop.ts RunOnceOptions 주석). 첫 회차는
   * 곧바로 돌린다: 워커가 죽어 있던 사이에 이미 due가 됐을 수 있다. */
  let lastProducedAt = 0;

  while (!shuttingDown) {
    try {
      const nowMs = Date.now();
      const produceAssessments =
        nowMs - lastProducedAt >= ASSESSMENT_PRODUCER_INTERVAL_MS;
      if (produceAssessments) lastProducedAt = nowMs;

      const result = await runOnce({
        sql,
        handlers,
        workerId: WORKER_ID,
        concurrency: CONCURRENCY,
        produceAssessments,
        log: (message) => console.log(message),
      });
      lastResult = {
        at: new Date().toISOString(),
        outboxClaimed: result.dispatch.claimed,
        delivered: result.dispatch.delivered,
        quarantined: result.dispatch.quarantined,
        claimed: result.claimed,
        succeeded: result.succeeded,
        failed: result.failed,
        deferred: result.deferred,
        /* 생산자 상태 — 「돌고는 있는데 평가가 안 생긴다」를 박동만 보고
         * 가릴 수 있어야 한다. 안 돌린 회차는 null이라 마지막 값이 아니라
         * 「이번엔 안 함」임이 드러난다. */
        assessmentProducer: result.produced
          ? {
              scanned: result.produced.scanned,
              enqueued: result.produced.enqueued,
              deduplicated: result.produced.deduplicated,
              suppressed: result.produced.suppressed,
              suppressedOrganizationIds:
                result.produced.suppressedOrganizationIds,
            }
          : null,
      };
      if (wasIdle(result)) await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      /* 루프 자체가 던지는 경우 — DB 연결 단절 같은 것. 개별 이벤트·작업의
       * 실패는 여기까지 오지 않는다 (dispatchOutbox·runOnce가 격리한다). */
      console.error("[su-maek worker] 루프 오류", error);
      lastResult = {
        at: new Date().toISOString(),
        loopError: error instanceof Error ? error.message : String(error),
      };
      await beat();
      await sleep(POLL_INTERVAL_MS);
    }
  }

  clearInterval(beatTimer);
  console.log("[su-maek worker] 종료 중 — 실행 중 작업은 lease 만료 후 재개된다");
  if (heartbeatReady === true) {
    try {
      await markWorkerStopped(sql, WORKER_ID, stopReason);
    } catch (error) {
      console.error("[su-maek worker] 종료 표시 실패", error);
    }
  }
  await sql.end();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("[su-maek worker] 치명적 오류", error);
  process.exit(1);
});
