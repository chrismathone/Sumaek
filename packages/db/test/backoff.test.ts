import { describe, expect, it } from "vitest";
import { backoffSeconds } from "../src/queue";

/* ─────────────────────────────────────────────────────────────
 * 재시도 백오프 — 작업 큐와 아웃박스 디스패처가 공유하는 정책.
 *
 * 이 함수에 테스트가 0건이었다. 무작위가 들어 있어 "다음 시도가 미래다"
 * 같은 단언은 통합 테스트에서 간헐적으로 깨진다(실측: 전체 지터라 0초가
 * 정상적으로 나온다). 그러니 무작위를 품은 성질은 **여기서 결정론적으로**
 * 고정하고, 통합 테스트는 경계만 본다.
 *
 * 지터가 있는 이유는 재시도가 한꺼번에 몰려 같은 실패를 동시에 재현하는
 * 것(thundering herd)을 흩기 위해서다. 그래서 "값이 흩어지는가"도 규격이다.
 * ───────────────────────────────────────────────────────────── */

const DRAWS = 400;

describe("재시도 백오프 (지수 + 전체 지터)", () => {
  it("음수를 내지 않는다 — 과거로 예약하면 쉼 없이 재시도한다", () => {
    for (let attempts = 0; attempts <= 12; attempts++) {
      for (let i = 0; i < 20; i++) {
        expect(backoffSeconds(attempts)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("회차별 상한 2^n×5초를 넘지 않는다", () => {
    for (const attempts of [0, 1, 2, 3, 5]) {
      const cap = 2 ** attempts * 5;
      for (let i = 0; i < DRAWS; i++) {
        expect(backoffSeconds(attempts)).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("상한(기본 600초)을 넘지 않는다 — 무한정 미루지 않는다", () => {
    for (let i = 0; i < DRAWS; i++) {
      expect(backoffSeconds(30)).toBeLessThanOrEqual(600);
    }
  });

  it("상한을 인자로 낮출 수 있다", () => {
    for (let i = 0; i < DRAWS; i++) {
      expect(backoffSeconds(10, 30)).toBeLessThanOrEqual(30);
    }
  });

  it("회차가 오르면 평균 간격이 늘어난다 (지수)", () => {
    const mean = (attempts: number) => {
      let sum = 0;
      for (let i = 0; i < DRAWS; i++) sum += backoffSeconds(attempts);
      return sum / DRAWS;
    };
    // 상한이 4배 차이 나므로 평균도 뚜렷하게 벌어진다
    expect(mean(4)).toBeGreaterThan(mean(2));
  });

  it("값이 흩어진다 — 고정 간격이면 재시도가 한꺼번에 몰린다", () => {
    const seen = new Set<number>();
    for (let i = 0; i < DRAWS; i++) seen.add(backoffSeconds(6));
    expect(seen.size).toBeGreaterThan(10);
  });

  it("음수 회차도 0회차처럼 다룬다 (터지지 않는다)", () => {
    for (let i = 0; i < 50; i++) {
      expect(backoffSeconds(-3)).toBeLessThanOrEqual(5);
      expect(backoffSeconds(-3)).toBeGreaterThanOrEqual(0);
    }
  });
});
