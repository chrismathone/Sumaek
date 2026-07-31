/* ─────────────────────────────────────────────────────────────
 * AI·OCR 공급자 회로 차단기 (골프롬프트 28장 · 인수 23·36).
 *
 * 공급자별 독립 차단 — 한 공급자의 장애가 다른 기능의 SLO를 깎지 않는다.
 * 상태: closed(정상) → open(차단, 빠른 실패) → half_open(시험 1회) →
 * 성공 시 closed 복귀 / 실패 시 다시 open.
 *
 * 시계를 주입받아 결정론적으로 테스트한다 — 엔진 계층에 현재 시각을
 * 직접 읽는 코드를 두지 않는 저장소 원칙과 같은 이유.
 * ───────────────────────────────────────────────────────────── */

import type { AiProvider } from "./provider";

export type BreakerState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** 연속 실패 이 횟수에서 회로가 열린다 */
  failureThreshold: number;
  /** 열린 뒤 이 시간이 지나면 half_open 시험을 허용한다 (ms) */
  cooldownMs: number;
  /** 개별 호출 제한 시간 (ms) — 초과는 실패로 센다 */
  timeoutMs: number;
  /** 현재 시각 (ms) — 테스트 주입용. 기본은 Date.now */
  now?: () => number;
}

/** 회로가 열려 있어 호출 자체를 거부했다 — 공급자에 도달하지 않음 */
export class CircuitOpenError extends Error {
  readonly retryAfterMs: number;
  constructor(providerName: string, retryAfterMs: number) {
    super(
      `회로 차단기 열림: ${providerName} — ${Math.ceil(retryAfterMs / 1000)}초 후 재시험`,
    );
    this.name = "CircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class CallTimeoutError extends Error {
  constructor(providerName: string, timeoutMs: number) {
    super(`공급자 응답 시간 초과: ${providerName} (${timeoutMs}ms)`);
    this.name = "CallTimeoutError";
  }
}

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly now: () => number;

  constructor(
    readonly providerName: string,
    private readonly options: CircuitBreakerOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  /** 현재 상태 (open은 cooldown 경과 시 half_open으로 보고) */
  currentState(): BreakerState {
    if (
      this.state === "open" &&
      this.now() - this.openedAt >= this.options.cooldownMs
    ) {
      return "half_open";
    }
    return this.state;
  }

  /**
   * 보호된 호출. 열려 있으면 공급자에 도달하지 않고 CircuitOpenError.
   * half_open에서는 시험 호출 1회를 통과시키고 결과로 상태를 정한다.
   */
  async execute<T>(call: () => Promise<T>): Promise<T> {
    const state = this.currentState();
    if (state === "open") {
      throw new CircuitOpenError(
        this.providerName,
        this.options.cooldownMs - (this.now() - this.openedAt),
      );
    }
    if (state === "half_open") {
      this.state = "half_open";
    }

    try {
      const result = await this.withTimeout(call);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private withTimeout<T>(call: () => Promise<T>): Promise<T> {
    const { timeoutMs } = this.options;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return call();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new CallTimeoutError(this.providerName, timeoutMs)),
        timeoutMs,
      );
      call().then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (
      this.state === "half_open" ||
      this.consecutiveFailures >= this.options.failureThreshold
    ) {
      this.state = "open";
      this.openedAt = this.now();
      this.consecutiveFailures = 0;
    }
  }
}

/** 기본 정책 — 5회 연속 실패에 열리고 60초 후 시험, 호출 30초 제한 */
export const DEFAULT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  cooldownMs: 60_000,
  timeoutMs: 30_000,
};

/** 공급자를 회로 차단기로 감싼다 — 인터페이스는 그대로 (호출부 무변경) */
export function withCircuitBreaker(
  provider: AiProvider,
  breaker: CircuitBreaker,
): AiProvider {
  return {
    name: provider.name,
    extractQuestions: (input) =>
      breaker.execute(() => provider.extractQuestions(input)),
  };
}

/** 공급자 이름별 차단기 공유 저장소 — 프로세스 수명 동안 상태 유지 */
const sharedBreakers = new Map<string, CircuitBreaker>();

export function getSharedBreaker(
  providerName: string,
  options: CircuitBreakerOptions = DEFAULT_BREAKER_OPTIONS,
): CircuitBreaker {
  let breaker = sharedBreakers.get(providerName);
  if (!breaker) {
    breaker = new CircuitBreaker(providerName, options);
    sharedBreakers.set(providerName, breaker);
  }
  return breaker;
}
