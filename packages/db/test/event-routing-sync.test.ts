import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EVENT_CONSUMERS,
  EVENT_WITHOUT_CONSUMER,
  resolveConsumers,
} from "../src/queue";

/* ─────────────────────────────────────────────────────────────
 * 이벤트 라우팅 표의 이중 관리 방어.
 *
 * 라우팅 표는 두 곳에 있다:
 *   1) packages/db/src/queue.ts  — 디스패처가 실제로 읽는 것
 *   2) packages/db/src/checks/invariants.sql  R-04 — 사슬 단절을 잡는 검사
 *
 * SQL 쪽을 코드에서 생성하지 않는 이유는 그 파일을 장애 때 `psql -f`로 그대로
 * 돌리기 때문이다(RB-04 V-10). 대신 어긋나면 여기서 잡는다 — 실제로
 * LearnerRouteOverrideChanged 한 줄이 SQL에만 빠져 있었고, 54건짜리 경로에서
 * 사슬이 끊겨도 `pnpm verify:recovery`가 못 잡는 상태였다.
 *
 * DB가 없어도 도는 검사다 — CI에서 항상 실행된다.
 * ───────────────────────────────────────────────────────────── */

const INVARIANTS = readFileSync(
  fileURLToPath(new URL("../src/checks/invariants.sql", import.meta.url)),
  "utf8",
);

/** R-04의 consumers CTE에서 (event_type, topic) 쌍을 뽑는다 */
function sqlConsumerPairs(): string[] {
  const block = /with consumers\(event_type, topic\) as \(\s*values([\s\S]*?)\n\),/.exec(
    INVARIANTS,
  );
  if (!block?.[1]) throw new Error("invariants.sql에서 consumers CTE를 찾지 못했습니다");
  return [...block[1].matchAll(/\('([^']+)',\s*'([^']+)'\)/g)]
    .map((m) => `${m[1]} → ${m[2]}`)
    .sort();
}

/** R-04의 no_consumer CTE에서 이벤트 타입을 뽑는다 */
function sqlNoConsumerTypes(): string[] {
  const block = /no_consumer\(event_type\) as \(\s*values([\s\S]*?)\n\)/.exec(
    INVARIANTS,
  );
  if (!block?.[1]) {
    throw new Error("invariants.sql에서 no_consumer CTE를 찾지 못했습니다");
  }
  return [...block[1].matchAll(/\('([^']+)'\)/g)].map((m) => m[1]!).sort();
}

function codeConsumerPairs(): string[] {
  return Object.entries(EVENT_CONSUMERS)
    .flatMap(([eventType, topics]) => topics.map((t) => `${eventType} → ${t}`))
    .sort();
}

describe("이벤트 라우팅 표 동기화 (R-04)", () => {
  it("invariants.sql의 consumers 표가 EVENT_CONSUMERS와 정확히 같다", () => {
    expect(sqlConsumerPairs()).toEqual(codeConsumerPairs());
  });

  it("invariants.sql의 no_consumer 표가 EVENT_WITHOUT_CONSUMER와 정확히 같다", () => {
    expect(sqlNoConsumerTypes()).toEqual(
      Object.keys(EVENT_WITHOUT_CONSUMER).sort(),
    );
  });

  it("소비자 0건인 이벤트는 전부 근거가 선언되어 있다", () => {
    /* 선언 없는 빈 배열은 「소비자를 두지 않기로 정한 것」과 구분되지 않아
     * 이벤트 무음 폐기의 통로가 된다. 디스패처는 그것을 격리하지만,
     * 애초에 코드에서 걸러 낸다. */
    const undeclared = Object.entries(EVENT_CONSUMERS)
      .filter(
        ([eventType, topics]) =>
          topics.length === 0 && EVENT_WITHOUT_CONSUMER[eventType] === undefined,
      )
      .map(([eventType]) => eventType);
    expect(undeclared).toEqual([]);
  });

  it("근거만 선언하고 소비자를 남겨 두는 모순은 없다", () => {
    const contradictory = Object.keys(EVENT_WITHOUT_CONSUMER).filter(
      (eventType) => (EVENT_CONSUMERS[eventType]?.length ?? 0) > 0,
    );
    expect(contradictory).toEqual([]);
  });
});

describe("resolveConsumers — 「없다고 정한 것」과 「빠뜨린 것」의 구분", () => {
  it("소비자가 있는 이벤트는 토픽을 돌려준다", () => {
    expect(resolveConsumers("GradeFinalized")).toEqual({
      kind: "consumers",
      topics: ["mastery.update"],
    });
  });

  it("무소비를 선언한 이벤트는 근거와 함께 declared_none이다", () => {
    const resolved = resolveConsumers("RenderArtifactValidated");
    expect(resolved.kind).toBe("declared_none");
    expect(resolved.kind === "declared_none" && resolved.reason).toBeTruthy();
  });

  it("라우팅표에 없는 이벤트는 routing_gap이다 — 무음 폐기되지 않는다", () => {
    /* 디스패처는 이것을 delivered로 넘기지 않고 격리한다. 예전에는 소비자
     * 0건이면 그냥 delivered였고, 그래서 라우팅표에서 빠진 이벤트가
     * 「작업 0건 + 배달 완료」로 보이며 영구 유실됐다. */
    expect(resolveConsumers("NeverHeardOfThisEvent").kind).toBe("routing_gap");
  });
});
