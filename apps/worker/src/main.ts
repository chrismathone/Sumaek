import { config } from "dotenv";
config({ path: [".env", "../../.env"] });
import {
  claimJobs,
  completeJob,
  createSql,
  deferJob,
  dispatchOutbox,
  failJob,
  filterTopicsBySwitches,
  isDeferSignal,
  loadGloballyDisabledSwitches,
  type ClaimedJob,
} from "@su-maek/db";

/**
 * 수맥 백그라운드 워커 (2B).
 * - 일정·평가·리포트 / mathg-gen OCR·AI / 수식 검증·PDF·HWP 출력 워커가
 *   토픽 핸들러로 등록되어 하나의 프로세스에서 실행된다 (독립 배포·확장 가능).
 * - Outbox 디스패처가 이벤트를 소비자 작업으로 변환한다.
 * - 실시간 채점(grading.*)이 대량 OCR보다 높은 우선순위를 가진다.
 */

type JobHandler = (job: ClaimedJob) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();

/** 토픽 핸들러 등록 — 도메인 모듈 구현이 이 레지스트리에 연결된다 */
function register(topic: string, handler: JobHandler): void {
  handlers.set(topic, handler);
}

// 등록되지 않은 토픽의 작업은 클레임되지 않으므로 유실되지 않는다.
import {
  handleLearnerScheduleMaterialize,
  handleNotificationDispatch,
  handleScheduleRecalculate,
  makeInboxNoop,
} from "./handlers/schedule";

import { handleRightsImpact } from "./handlers/content";

register("schedule.recalculate", handleScheduleRecalculate);
register("schedule.materialize", handleScheduleRecalculate);
/* EVENT_CONSUMERS.LearnerRouteOverrideChanged의 짝 (queue.ts).
 * 이 등록을 지우면 디스패처가 작업 0건을 만들고도 outbox를 delivered로
 * 표시해 이벤트가 영구 유실된다 — 소비자 등록과 반드시 함께 움직인다. */
register("schedule.materialize-learner", handleLearnerScheduleMaterialize);
register("notification.dispatch", handleNotificationDispatch);
register("content.rights-impact", handleRightsImpact);
// 인라인으로 파생이 이미 갱신된 이벤트 — 소비 확인만
register("mastery.update", makeInboxNoop("mastery.update"));
register("review.plan", makeInboxNoop("review.plan"));
register("grading.auto", makeInboxNoop("grading.auto"));
register("readmodel.refresh", makeInboxNoop("readmodel.refresh"));

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);
const POLL_INTERVAL_MS = 2_000;

let shuttingDown = false;

async function main(): Promise<void> {
  const sql = createSql();
  console.log(
    `[su-maek worker] ${WORKER_ID} 시작 — 토픽 ${handlers.size}개, 동시성 ${CONCURRENCY}`,
  );

  process.on("SIGINT", () => {
    shuttingDown = true;
  });
  process.on("SIGTERM", () => {
    shuttingDown = true;
  });

  while (!shuttingDown) {
    try {
      // 1) Outbox → 소비자 작업 변환
      const dispatched = await dispatchOutbox(sql);
      if (dispatched > 0) {
        console.log(`[outbox] ${dispatched}건 디스패치`);
      }

      // 2) kill switch 게이트 (인수 40) — 전역으로 중지된 스위치의 토픽은
      //    클레임하지 않는다. 작업은 큐에 남아 스위치 복구 시 그대로 재개.
      const disabled = await loadGloballyDisabledSwitches(sql);
      const activeTopics = filterTopicsBySwitches(
        [...handlers.keys()],
        disabled,
      );
      if (disabled.size > 0 && activeTopics.length < handlers.size) {
        console.log(
          `[kill-switch] 중지: ${[...disabled].join(", ")} — 토픽 ${
            handlers.size - activeTopics.length
          }개 클레임 제외`,
        );
      }

      // 3) 작업 클레임·실행
      const jobs = await claimJobs(sql, {
        topics: activeTopics,
        workerId: WORKER_ID,
        limit: CONCURRENCY,
      });

      if (jobs.length === 0 && dispatched === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      await Promise.all(
        jobs.map(async (job) => {
          const handler = handlers.get(job.topic);
          if (!handler) {
            await failJob(sql, job, `핸들러 없음: ${job.topic}`, false);
            return;
          }
          try {
            const result = await handler(job);
            if (isDeferSignal(result)) {
              // 조직 스코프 kill switch 등 — 시도 소모 없이 뒤로 미룬다
              await deferJob(sql, job.id, result.reason);
              console.log(`[job:${job.topic}] ${job.id} 연기: ${result.reason}`);
              return;
            }
            await completeJob(sql, job.id, result);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            const retryable = isRetryable(error);
            const outcome = await failJob(sql, job, message, retryable);
            console.error(
              `[job:${job.topic}] ${job.id} 실패 (${outcome}): ${message}`,
            );
          }
        }),
      );
    } catch (error) {
      console.error("[su-maek worker] 루프 오류", error);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log("[su-maek worker] 종료 중 — 실행 중 작업은 lease 만료 후 재개된다");
  await sql.end();
}

/** 408·429·일시적 5xx·네트워크 오류만 재시도 (28장) */
function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const status = (error as { status?: number }).status;
    if (status === 408 || status === 429) return true;
    if (status !== undefined && status >= 500) return true;
    if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|fetch failed/i.test(error.message)) {
      return true;
    }
    // 명시적 재시도 불가 표시
    if ((error as { retryable?: boolean }).retryable === false) return false;
    if ((error as { retryable?: boolean }).retryable === true) return true;
  }
  // 알 수 없는 오류는 재시도 (최대 시도 한도가 폭주를 막는다)
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("[su-maek worker] 치명적 오류", error);
  process.exit(1);
});
