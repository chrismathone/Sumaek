import { describe, expect, it } from "vitest";
import {
  CallTimeoutError,
  CircuitBreaker,
  CircuitOpenError,
  withCircuitBreaker,
  type AiProvider,
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
