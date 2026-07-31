import { describe, expect, it } from "vitest";
import { fc, test as fcTest } from "@fast-check/vitest";
import { calculateSchedule, ENGINE_VERSION } from "../../src/scheduling/engine";
import type {
  RouteNodeInput,
  ScheduleEngineInput,
  ScheduledItem,
} from "../../src/scheduling/types";

function baseInput(
  partial?: Partial<ScheduleEngineInput>,
): ScheduleEngineInput {
  return {
    engineVersion: ENGINE_VERSION,
    seed: "seed-1",
    timezone: "Asia/Seoul",
    scope: { type: "learning_group", id: "group-1" },
    cutoffDate: "2026-08-03",
    horizon: { from: "2026-08-03", to: "2026-09-30" },
    routeVersionId: "rv-1",
    nodes: [
      node("n1", 1, 60),
      node("n2", 2, 60),
      node("n3", 3, 60),
      node("n4", 4, 60),
    ],
    overrides: [],
    // 월(1)·수(3)·금(5) 수업
    lessonSlots: [
      slot(1),
      slot(3),
      slot(5),
    ],
    holidays: [],
    busy: [],
    existingItems: [],
    completedNodeIds: [],
    maxMinutesPerDay: 120,
    inputVersions: { calendar: 1, policy: 1 },
    ...partial,
  };
}

function node(id: string, order: number, minutes: number): RouteNodeInput {
  return {
    nodeId: id,
    kind: "concept_lesson",
    title: `노드 ${id}`,
    sortOrder: order,
    expectedMinutes: minutes,
  };
}

function slot(weekday: number) {
  return {
    weekday,
    startTime: "16:00",
    endTime: "18:00",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  };
}

describe("결정론적 일정 엔진", () => {
  it("수업 가능일에만 순서대로 배치한다 (하루 용량 내 복수 노드 허용)", () => {
    const result = calculateSchedule(baseInput());
    expect(result.conflicts).toHaveLength(0);
    expect(result.items).toHaveLength(4);
    // 2026-08-03은 월요일. 하루 120분 상한 → 60분 노드 2개씩.
    expect(result.items.map((i) => i.date)).toEqual([
      "2026-08-03",
      "2026-08-03",
      "2026-08-05",
      "2026-08-05",
    ]);
    // 노드 순서 보존
    expect(result.items.map((i) => i.nodeId)).toEqual([
      "n1",
      "n2",
      "n3",
      "n4",
    ]);
  });

  it("같은 입력은 같은 출력 해시를 만든다 (불변 조건 12)", () => {
    const a = calculateSchedule(baseInput());
    const b = calculateSchedule(baseInput());
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
    expect(a.items).toEqual(b.items);
  });

  it("휴일을 피해 배치하고 이유 코드를 남긴다", () => {
    const existing: ScheduledItem[] = [
      {
        itemId: "it-1",
        nodeId: "n1",
        date: "2026-08-05",
        startTime: "16:00",
        endTime: "18:00",
        minutes: 60,
        locked: false,
        completed: false,
      },
    ];
    const result = calculateSchedule(
      baseInput({
        nodes: [node("n1", 1, 60)],
        existingItems: existing,
        holidays: [{ from: "2026-08-05", to: "2026-08-05" }],
      }),
    );
    expect(result.items[0]?.date).not.toBe("2026-08-05");
    expect(result.items[0]?.reason).toBe("MOVED_HOLIDAY");
    expect(result.diff.moved).toHaveLength(1);
  });

  it("완료·잠금·cutoff 이전 항목은 절대 변경하지 않는다 (불변 조건 5)", () => {
    const preserved: ScheduledItem[] = [
      {
        itemId: "done-1",
        nodeId: "n0",
        date: "2026-07-27", // cutoff 이전
        startTime: "16:00",
        endTime: "18:00",
        minutes: 60,
        locked: false,
        completed: true,
      },
      {
        itemId: "lock-1",
        nodeId: "n1",
        date: "2026-08-10",
        startTime: "16:00",
        endTime: "18:00",
        minutes: 60,
        locked: true,
        completed: false,
      },
    ];
    const result = calculateSchedule(
      baseInput({
        nodes: [node("n1", 1, 60), node("n2", 2, 60)],
        existingItems: preserved,
        // 잠금 날짜를 휴일로 지정해도 잠금은 이동하지 않는다
        holidays: [{ from: "2026-08-10", to: "2026-08-10" }],
      }),
    );
    const done = result.items.find((i) => i.itemId === "done-1");
    const locked = result.items.find((i) => i.itemId === "lock-1");
    expect(done).toMatchObject({ date: "2026-07-27", reason: "PAST_PRESERVED" });
    expect(locked).toMatchObject({ date: "2026-08-10", reason: "LOCK_PRESERVED" });
  });

  it("기존 유효 배치는 유지한다 (변경 최소화)", () => {
    const existing: ScheduledItem[] = [
      {
        itemId: "it-1",
        nodeId: "n1",
        date: "2026-08-03",
        startTime: "16:00",
        endTime: "18:00",
        minutes: 60,
        locked: false,
        completed: false,
      },
      {
        itemId: "it-2",
        nodeId: "n2",
        date: "2026-08-05",
        startTime: "16:00",
        endTime: "18:00",
        minutes: 60,
        locked: false,
        completed: false,
      },
    ];
    const result = calculateSchedule(
      baseInput({
        nodes: [node("n1", 1, 60), node("n2", 2, 60)],
        existingItems: existing,
      }),
    );
    expect(result.diff.moved).toHaveLength(0);
    expect(result.diff.unchanged.map((i) => i.itemId)).toEqual(
      expect.arrayContaining(["it-1", "it-2"]),
    );
  });

  it("배치 불가 노드는 부분 결과가 아니라 충돌로 보고한다", () => {
    const result = calculateSchedule(
      baseInput({
        horizon: { from: "2026-08-03", to: "2026-08-04" }, // 월요일 하루만
        nodes: [node("n1", 1, 60), node("n2", 2, 61), node("n3", 3, 60)],
        maxMinutesPerDay: 120,
      }),
    );
    // n1(60)+n2(61)=121 > 120 → n2는 8/3에 못 들어가고 이후 수업일 없음
    expect(result.conflicts.map((c) => c.nodeId)).toContain("n2");
    expect(result.conflicts.every((c) => c.code === "NO_AVAILABLE_SLOT")).toBe(
      true,
    );
  });

  it("오버라이드 삽입·건너뛰기가 반영되고 이유가 남는다", () => {
    const result = calculateSchedule(
      baseInput({
        nodes: [node("n1", 1, 60), node("n2", 2, 60), node("n3", 3, 60)],
        overrides: [
          {
            overrideId: "ov-1",
            kind: "remediation",
            skipNodeIds: ["n2"],
            insertBefore: {
              anchorNodeId: "n3",
              nodes: [node("remed-1", 0, 60)],
            },
          },
        ],
      }),
    );
    const ids = result.items.map((i) => i.nodeId);
    expect(ids).toEqual(["n1", "remed-1", "n3"]);
    expect(
      result.items.find((i) => i.nodeId === "remed-1")?.reason,
    ).toBe("INSERTED_OVERRIDE");
  });
});

describe("일정 엔진 속성 테스트", () => {
  const nodeArb = fc
    .record({
      idx: fc.integer({ min: 1, max: 30 }),
      minutes: fc.integer({ min: 10, max: 90 }),
    })
    .map(({ idx, minutes }) => node(`n${idx}`, idx, minutes));

  const nodesArb = fc
    .uniqueArray(nodeArb, {
      minLength: 1,
      maxLength: 12,
      selector: (n) => n.nodeId,
    })
    .map((ns) => [...ns].sort((a, b) => a.sortOrder - b.sortOrder));

  const holidayArb = fc
    .integer({ min: 0, max: 50 })
    .map((offset) => {
      const d = new Date(Date.UTC(2026, 7, 3 + offset));
      const iso = d.toISOString().slice(0, 10);
      return { from: iso, to: iso };
    });

  fcTest.prop([nodesArb, fc.array(holidayArb, { maxLength: 10 })])(
    "하드 제약: 휴일 배치 0건, 하루 상한 위반 0건, 순서 보존",
    (nodes, holidays) => {
      const input = baseInput({ nodes, holidays });
      const result = calculateSchedule(input);

      const holidayDates = new Set(holidays.map((h) => h.from));
      const byDate = new Map<string, number>();
      for (const item of result.items) {
        expect(holidayDates.has(item.date)).toBe(false);
        byDate.set(item.date, (byDate.get(item.date) ?? 0) + item.minutes);
      }
      for (const total of byDate.values()) {
        expect(total).toBeLessThanOrEqual(input.maxMinutesPerDay);
      }
      // 노드 순서 보존 (배치된 것들 사이에서)
      const orderIndex = new Map(nodes.map((n, i) => [n.nodeId, i]));
      const placedOrders = result.items
        .map((i) => orderIndex.get(i.nodeId))
        .filter((v): v is number => v !== undefined);
      expect([...placedOrders].sort((a, b) => a - b)).toEqual(placedOrders);
      // 배치 + 충돌 = 전체 노드 (누락 없음)
      expect(result.items.length + result.conflicts.length).toBe(nodes.length);
    },
  );

  fcTest.prop([nodesArb])(
    "결정론: 같은 입력 두 번 실행 = 같은 해시",
    (nodes) => {
      const input = baseInput({ nodes });
      const a = calculateSchedule(input);
      const b = calculateSchedule(input);
      expect(a.outputHash).toBe(b.outputHash);
    },
  );
});
