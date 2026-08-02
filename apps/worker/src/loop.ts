import {
  claimJobs,
  completeJob,
  deferJob,
  dispatchOutbox,
  failJob,
  filterTopicsBySwitches,
  isDeferSignal,
  loadGloballyDisabledSwitches,
  type DispatchOutboxResult,
  type Sql,
} from "@su-maek/db";
import type { JobHandler } from "./registry";

/* ─────────────────────────────────────────────────────────────
 * 워커 루프 1회분 — outbox 디스패치 → kill switch 게이트 → 클레임 → 실행.
 *
 * main()에서 떼어냈다. 루프 자체(클레임→핸들러→완료/실패/연기)를 검증하는
 * 테스트가 0건이었던 이유가 "루프가 while 안에 갇혀 있어서"였다.
 * 조직 스코프를 주면 공유 DB에서도 남의 작업을 건드리지 않고 한 바퀴를
 * 돌려 볼 수 있다 (test/wiring/outbox-roundtrip.test.ts).
 * ───────────────────────────────────────────────────────────── */

export interface RunOnceOptions {
  sql: Sql;
  handlers: ReadonlyMap<string, JobHandler>;
  workerId: string;
  concurrency: number;
  /** 한 조직으로 한정 — 테스트·단일 테넌트 재처리용. 기본은 전역 */
  organizationId?: string | null | undefined;
  outboxLimit?: number | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface RunOnceResult {
  dispatch: DispatchOutboxResult;
  claimed: number;
  succeeded: number;
  /** 재시도 예정·DLQ·최종 실패를 합친 수 */
  failed: number;
  deferred: number;
  /** kill switch로 이번 회차에 클레임하지 않은 토픽 */
  blockedTopics: string[];
  /** 클레임됐지만 핸들러가 없던 작업 (있으면 배선 결손이다) */
  unhandled: number;
}

export async function runOnce(options: RunOnceOptions): Promise<RunOnceResult> {
  const { sql, handlers, workerId, concurrency } = options;
  const log = options.log ?? (() => {});
  const organizationId = options.organizationId ?? null;

  // 1) Outbox → 소비자 작업 변환
  const dispatch = await dispatchOutbox(sql, {
    limit: options.outboxLimit,
    organizationId,
  });
  if (dispatch.delivered + dispatch.acknowledged > 0) {
    log(
      `[outbox] 배달 ${dispatch.delivered}건 · 무소비 선언 ${dispatch.acknowledged}건 · 작업 ${dispatch.createdJobs}건 생성`,
    );
  }
  /* 실패는 조용히 지나가지 않는다. 특히 routing_gap은 재시도로 낫지 않는
   * 배선 결손이라 사람이 봐야 한다 (격리되어 적체로도 보인다). */
  for (const failure of dispatch.failures) {
    log(
      `[outbox:${failure.kind}] ${failure.eventType} ${failure.eventId} ` +
        `${failure.quarantined ? "격리" : "재시도 예정"}: ${failure.reason}`,
    );
  }

  // 2) kill switch 게이트 (인수 40) — 전역으로 중지된 스위치의 토픽은
  //    클레임하지 않는다. 작업은 큐에 남아 스위치 복구 시 그대로 재개.
  const disabled = await loadGloballyDisabledSwitches(sql);
  const allTopics = [...handlers.keys()];
  const activeTopics = filterTopicsBySwitches(allTopics, disabled);
  const blockedTopics = allTopics.filter((t) => !activeTopics.includes(t));
  if (blockedTopics.length > 0) {
    log(
      `[kill-switch] 중지: ${[...disabled].join(", ")} — 토픽 ${blockedTopics.length}개 클레임 제외`,
    );
  }

  // 3) 작업 클레임·실행
  const jobs = await claimJobs(sql, {
    topics: activeTopics,
    workerId,
    limit: concurrency,
    organizationId,
  });

  const result: RunOnceResult = {
    dispatch,
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    deferred: 0,
    blockedTopics,
    unhandled: 0,
  };

  await Promise.all(
    jobs.map(async (job) => {
      const handler = handlers.get(job.topic);
      if (!handler) {
        await failJob(sql, job, `핸들러 없음: ${job.topic}`, false);
        result.unhandled += 1;
        result.failed += 1;
        return;
      }
      try {
        const handled = await handler(job);
        if (isDeferSignal(handled)) {
          // 조직 스코프 kill switch 등 — 시도 소모 없이 뒤로 미룬다
          await deferJob(sql, job.id, handled.reason);
          result.deferred += 1;
          log(`[job:${job.topic}] ${job.id} 연기: ${handled.reason}`);
          return;
        }
        await completeJob(sql, job.id, handled);
        result.succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const outcome = await failJob(sql, job, message, isRetryable(error));
        result.failed += 1;
        log(`[job:${job.topic}] ${job.id} 실패 (${outcome}): ${message}`);
      }
    }),
  );

  return result;
}

/** 408·429·일시적 5xx·네트워크 오류만 재시도 (28장) */
export function isRetryable(error: unknown): boolean {
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

/** 이번 회차에 실제로 한 일이 있었는가 — 없으면 폴링 간격만큼 쉰다 */
export function wasIdle(result: RunOnceResult): boolean {
  return result.claimed === 0 && result.dispatch.claimed === 0;
}
