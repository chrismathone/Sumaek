import { describe, expect, it } from "vitest";
import {
  AiProviderUnavailableError,
  CallTimeoutError,
  CircuitBreaker,
  CircuitOpenError,
  FailingAiProvider,
  getSharedBreaker,
  withCircuitBreaker,
  type AiProvider,
  type CircuitBreakerOptions,
} from "../../src/ai";

/* 회로 차단기 (인수 23) — 주입 시계로 결정론적 검증.
 * 공급자별 독립 차단·빠른 실패·half-open 시험·복귀. */

function makeBreaker(nowRef: { t: number }, overrides?: Partial<{
  failureThreshold: number;
  cooldownMs: number;
  timeoutMs: number;
}>) {
  return new CircuitBreaker("test-provider", {
    failureThreshold: overrides?.failureThreshold ?? 3,
    cooldownMs: overrides?.cooldownMs ?? 60_000,
    timeoutMs: overrides?.timeoutMs ?? 0, // 0 = 시간 제한 없음 (타이머 미사용)
    now: () => nowRef.t,
  });
}

const fail = () => Promise.reject(new Error("공급자 5xx"));
const ok = () => Promise.resolve("결과");

describe("CircuitBreaker", () => {
  it("임계 미만 실패는 회로를 열지 않는다", async () => {
    const now = { t: 0 };
    const breaker = makeBreaker(now);
    await expect(breaker.execute(fail)).rejects.toThrow("공급자 5xx");
    await expect(breaker.execute(fail)).rejects.toThrow("공급자 5xx");
    expect(breaker.currentState()).toBe("closed");
  });

  it("연속 실패 임계에서 열리고, 이후 호출은 공급자에 도달하지 않는다", async () => {
    const now = { t: 0 };
    const breaker = makeBreaker(now);
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    expect(breaker.currentState()).toBe("open");

    let reached = false;
    await expect(
      breaker.execute(() => {
        reached = true;
        return ok();
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(reached).toBe(false); // 빠른 실패 — 공급자 미호출
  });

  it("성공이 끼면 연속 실패 계수가 초기화된다", async () => {
    const now = { t: 0 };
    const breaker = makeBreaker(now);
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(ok)).resolves.toBe("결과");
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.currentState()).toBe("closed");
  });

  it("cooldown 경과 후 half-open 시험 — 성공이면 닫힌다", async () => {
    const now = { t: 0 };
    const breaker = makeBreaker(now);
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    now.t = 60_000; // cooldown 경과
    expect(breaker.currentState()).toBe("half_open");
    await expect(breaker.execute(ok)).resolves.toBe("결과");
    expect(breaker.currentState()).toBe("closed");
  });

  it("half-open 시험 실패는 즉시 다시 연다 (임계 대기 없음)", async () => {
    const now = { t: 0 };
    const breaker = makeBreaker(now);
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    now.t = 60_000;
    await expect(breaker.execute(fail)).rejects.toThrow("공급자 5xx");
    expect(breaker.currentState()).toBe("open");
    // 새 cooldown이 다시 시작된다
    now.t = 90_000;
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("호출 시간 초과는 실패로 센다", async () => {
    const now = { t: 0 };
    const breaker = makeBreaker(now, { timeoutMs: 10, failureThreshold: 1 });
    const hang = () => new Promise<string>(() => {});
    await expect(breaker.execute(hang)).rejects.toBeInstanceOf(
      CallTimeoutError,
    );
    expect(breaker.currentState()).toBe("open");
  });
});

describe("withCircuitBreaker", () => {
  it("공급자 인터페이스를 유지하며 차단을 적용한다", async () => {
    const now = { t: 0 };
    const breaker = makeBreaker(now, { failureThreshold: 1 });
    let calls = 0;
    const flaky: AiProvider = {
      name: "flaky",
      extractQuestions: () => {
        calls++;
        return Promise.reject(new Error("연결 거부"));
      },
    };
    const guarded = withCircuitBreaker(flaky, breaker);
    const input = { fileName: "a.pdf", checksum: "x", pageCount: 1 };

    await expect(guarded.extractQuestions(input)).rejects.toThrow("연결 거부");
    await expect(guarded.extractQuestions(input)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(calls).toBe(1); // 열린 뒤에는 공급자 호출 없음
    expect(guarded.name).toBe("flaky");
  });
});

/* 공급자 이름별 독립 차단 (인수 23 근거) — 이전 테스트는 전부 단일
 * "test-provider"만 써서 "한 공급자의 장애가 다른 공급자를 깎지 않는다"는
 * 주장이 검증된 적이 없었다. 여기서는 실패 주입 공급자(FailingAiProvider)로
 * 실제 장애를 만들어 둘의 상태가 서로 섞이지 않음을 확인한다.
 *
 * getSharedBreaker는 프로세스 전역 Map이므로 테스트마다 고유 이름을 쓴다. */
const EXTRACT_INPUT = { fileName: "단원평가.pdf", checksum: "c1", pageCount: 2 };

function sharedOptions(
  nowRef: { t: number },
  failureThreshold = 2,
  cooldownMs = 60_000,
): CircuitBreakerOptions {
  return { failureThreshold, cooldownMs, timeoutMs: 0, now: () => nowRef.t };
}

describe("getSharedBreaker — 공급자 이름별 독립 차단", () => {
  it("같은 이름은 같은 인스턴스, 다른 이름은 다른 인스턴스", () => {
    const a = getSharedBreaker("iso-same-a");
    const b = getSharedBreaker("iso-same-b");
    expect(a).not.toBe(b);
    // 같은 이름이 같은 인스턴스여야 프로세스 수명 동안 상태가 유지된다
    expect(getSharedBreaker("iso-same-a")).toBe(a);
    expect(a.providerName).toBe("iso-same-a");
  });

  it("A 공급자가 열려도 B 공급자는 계속 통과한다", async () => {
    const now = { t: 0 };
    const down = new FailingAiProvider({ name: "iso-vendor-down" });
    const healthy = new FailingAiProvider({
      name: "iso-vendor-healthy",
      failures: 0, // 실패 0회 = 항상 성공
    });
    const downGuarded = withCircuitBreaker(
      down,
      getSharedBreaker(down.name, sharedOptions(now)),
    );
    const healthyGuarded = withCircuitBreaker(
      healthy,
      getSharedBreaker(healthy.name, sharedOptions(now)),
    );

    // A를 임계까지 실패시켜 연다
    await expect(
      downGuarded.extractQuestions(EXTRACT_INPUT),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);
    await expect(
      downGuarded.extractQuestions(EXTRACT_INPUT),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);
    await expect(
      downGuarded.extractQuestions(EXTRACT_INPUT),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(down.calls).toBe(2); // 3번째는 공급자에 도달하지 않았다

    // B는 A의 장애와 무관하게 정상 응답한다
    const result = await healthyGuarded.extractQuestions(EXTRACT_INPUT);
    expect(result.provider).toBe("iso-vendor-healthy");
    expect(result.questions.length).toBeGreaterThan(0);
    expect(healthy.calls).toBe(1);

    expect(getSharedBreaker(down.name).currentState()).toBe("open");
    expect(getSharedBreaker(healthy.name).currentState()).toBe("closed");
  });

  it("B가 성공을 이어가도 A의 차단은 풀리지 않는다", async () => {
    const now = { t: 0 };
    const down = new FailingAiProvider({ name: "iso-cross-down" });
    const healthy = new FailingAiProvider({
      name: "iso-cross-healthy",
      failures: 0,
    });
    const downBreaker = getSharedBreaker(down.name, sharedOptions(now));
    const healthyBreaker = getSharedBreaker(healthy.name, sharedOptions(now));
    const downGuarded = withCircuitBreaker(down, downBreaker);
    const healthyGuarded = withCircuitBreaker(healthy, healthyBreaker);

    for (let i = 0; i < 2; i++) {
      await expect(downGuarded.extractQuestions(EXTRACT_INPUT)).rejects.toThrow();
    }
    expect(downBreaker.currentState()).toBe("open");

    for (let i = 0; i < 3; i++) {
      await expect(
        healthyGuarded.extractQuestions(EXTRACT_INPUT),
      ).resolves.toBeDefined();
    }
    // 성공 계수는 B의 차단기에만 반영된다 — A는 여전히 열려 있다
    expect(downBreaker.currentState()).toBe("open");
    expect(down.calls).toBe(2);
    await expect(
      downGuarded.extractQuestions(EXTRACT_INPUT),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(down.calls).toBe(2);
  });

  it("장애가 끝나면 cooldown 뒤 half-open 시험으로 복귀한다", async () => {
    const now = { t: 0 };
    // 2회만 실패하고 이후 복구하는 공급자 — 회로 복귀를 실제 호출로 확인
    const flapping = new FailingAiProvider({
      name: "iso-recovering",
      failures: 2,
    });
    const breaker = getSharedBreaker(
      flapping.name,
      sharedOptions(now, 2, 30_000),
    );
    const guarded = withCircuitBreaker(flapping, breaker);

    for (let i = 0; i < 2; i++) {
      await expect(guarded.extractQuestions(EXTRACT_INPUT)).rejects.toThrow();
    }
    expect(breaker.currentState()).toBe("open");
    // cooldown 전에는 공급자에 도달하지 않는다
    await expect(
      guarded.extractQuestions(EXTRACT_INPUT),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(flapping.calls).toBe(2);

    now.t = 30_000;
    const result = await guarded.extractQuestions(EXTRACT_INPUT);
    expect(result.questions.length).toBeGreaterThan(0);
    expect(flapping.calls).toBe(3);
    expect(breaker.currentState()).toBe("closed");
  });
});
