import { describe, expect, it } from "vitest";
import {
  classifyScheduleChange,
  deriveProgress,
  type SessionProgressFact,
} from "../../src/scheduling/adaptive";
import type {
  ProposedItem,
  ScheduleConflict,
  ScheduledItem,
  ScheduleDiff,
} from "../../src/scheduling/types";
import type { IsoDate } from "../../src/shared/dates";

/* ─────────────────────────────────────────────────────────────
 * 실제 진도 기반 재계획 (T4.3) — 순수 엔진.
 *
 * 여기서 고치는 것은 **일정 엔진이 무엇을 「끝난 것」으로 아는가**이다.
 *
 * 지금까지 `completedNodeIds`는 수업 단위로 파생됐다: `sessions.status`가
 * completed면 그 수업의 planned 노드를 **전부** 완료로 셌다. T4.2 이전에는
 * 마감 경로 자체가 없어 이 값이 늘 비어 있었으므로 드러나지 않았다.
 *
 * 이제 교사가 노드별로 「다 나감 / 일부만 / 못 나감」을 적는다. 그런데 그
 * 파생을 그대로 두면 **교사가 「못 나감」이라고 말한 노드가 완료로 기록되고
 * 다시는 배치되지 않는다** — 마감을 정직하게 적을수록 진도가 사라진다.
 *
 * 두 가지만 한다. 엔진을 대체하지 않고 **입력을 넓힌다**:
 *   deriveProgress          진도 사실 → 완료 집합과 이월 집합
 *   classifyScheduleChange  변경안 → 자동 적용인가 교사 승인인가
 * ───────────────────────────────────────────────────────────── */

const D = (s: string) => s as IsoDate;

function fact(
  nodeId: string,
  outcome: SessionProgressFact["outcome"],
  date = "2026-08-03",
  sessionId = "s1",
): SessionProgressFact {
  return { sessionId, date: D(date), nodeId, outcome };
}

describe("진도 사실 → 엔진 입력 (deriveProgress)", () => {
  it("다 나간 노드만 완료로 센다", () => {
    const r = deriveProgress([
      fact("a", "completed"),
      fact("b", "partial"),
      fact("c", "skipped"),
    ]);

    expect(r.completedNodeIds).toEqual(["a"]);
    /* 「못 나감」을 완료로 세면 교사가 정직하게 적을수록 진도가 사라진다.
     * 이 한 줄이 T4.3의 존재 이유다. */
    expect(r.completedNodeIds).not.toContain("c");
  });

  it("일부만 나간 노드는 이월한다 — 남은 부분을 다시 배치해야 한다", () => {
    const r = deriveProgress([fact("a", "completed"), fact("b", "partial")]);
    expect(r.carryOverNodeIds).toEqual(["b"]);
  });

  it("못 나간 노드도 이월한다", () => {
    const r = deriveProgress([fact("c", "skipped")]);
    expect(r.carryOverNodeIds).toEqual(["c"]);
  });

  it("한 번이라도 다 나갔으면 완료다 — 뒤에 다시 다뤄도 되돌아가지 않는다", () => {
    /* 보충 차시에서 같은 노드를 한 번 더 짚는 일이 있다. 그때 「일부만」이
     * 붙었다고 이미 끝낸 진도를 미완료로 되돌리면, 반은 같은 곳을 무한히
     * 맴돈다. */
    const r = deriveProgress([
      fact("a", "completed", "2026-08-03", "s1"),
      fact("a", "partial", "2026-08-05", "s2"),
    ]);

    expect(r.completedNodeIds).toEqual(["a"]);
    expect(r.carryOverNodeIds).toEqual([]);
  });

  it("이월 순서는 루트 순서를 따른다 — 나간 순서가 아니라", () => {
    /* 배운 순서가 곧 배울 순서다. 사실이 들어온 순서로 이월하면 조회 결과
     * 정렬 하나에 학습 순서가 바뀐다. */
    const r = deriveProgress(
      [
        fact("c", "skipped", "2026-08-05"),
        fact("a", "skipped", "2026-08-03"),
        fact("b", "partial", "2026-08-04"),
      ],
      { nodeOrder: ["a", "b", "c"] },
    );
    expect(r.carryOverNodeIds).toEqual(["a", "b", "c"]);
  });

  it("루트 순서를 모르면 날짜·id로 안정 정렬한다", () => {
    const r = deriveProgress([
      fact("z", "skipped", "2026-08-05"),
      fact("y", "skipped", "2026-08-03"),
    ]);
    expect(r.carryOverNodeIds).toEqual(["y", "z"]);
  });

  it("사실이 없으면 아무것도 완료가 아니다", () => {
    const r = deriveProgress([]);
    expect(r.completedNodeIds).toEqual([]);
    expect(r.carryOverNodeIds).toEqual([]);
  });

  it("같은 입력이면 항상 같은 결과다", () => {
    const facts = [
      fact("b", "partial", "2026-08-04"),
      fact("a", "completed", "2026-08-03"),
      fact("c", "skipped", "2026-08-05"),
    ];
    expect(deriveProgress(facts)).toEqual(deriveProgress([...facts].reverse()));
  });
});

/* ── 변경안의 위험도 ─────────────────────────────────────── */

const item = (over: Partial<ProposedItem> = {}): ProposedItem => ({
  itemId: over.itemId ?? "i1",
  nodeId: over.nodeId ?? "n1",
  date: over.date ?? D("2026-08-10"),
  startTime: "16:00",
  endTime: "18:00",
  minutes: 120,
  locked: false,
  completed: false,
  reason: over.reason ?? "MOVED_CASCADE",
  seq: over.seq ?? 0,
  ...over,
});

const before = (over: Partial<ScheduledItem> = {}): ScheduledItem => ({
  itemId: "i1",
  nodeId: "n1",
  date: D("2026-08-08"),
  startTime: "16:00",
  endTime: "18:00",
  minutes: 120,
  locked: false,
  completed: false,
  ...over,
});

const emptyDiff = (): ScheduleDiff => ({
  added: [],
  moved: [],
  removed: [],
  unchanged: [],
});

describe("자동 적용과 승인 필요를 가른다 (classifyScheduleChange)", () => {
  it("바뀐 것이 없으면 자동이다", () => {
    const v = classifyScheduleChange({ diff: emptyDiff(), conflicts: [] });
    expect(v.risk).toBe("auto");
    expect(v.reasons).toEqual([]);
  });

  it("작은 이동은 자동으로 적용한다", () => {
    const v = classifyScheduleChange({
      diff: { ...emptyDiff(), moved: [{ before: before(), after: item() }] },
      conflicts: [],
    });
    expect(v.risk).toBe("auto");
  });

  it("배치하지 못한 노드가 있으면 승인을 받는다", () => {
    /* 자리를 못 찾은 것을 조용히 적용하면 그 노드는 화면 어디에도 없이
     * 사라진다. 사람이 봐야 한다. */
    const conflicts: ScheduleConflict[] = [
      { nodeId: "n9", code: "NO_AVAILABLE_SLOT", detail: "지평선 초과" },
    ];
    const v = classifyScheduleChange({ diff: emptyDiff(), conflicts });
    expect(v.risk).toBe("needs_approval");
    expect(v.reasons).toContain("unplaced_node");
  });

  it("확인테스트가 움직이면 승인을 받는다", () => {
    /* 확인테스트는 진급 게이트다. 날짜가 밀리면 그 뒤 단원 전체가 밀리고,
     * 학부모에게 이미 공지된 날짜인 경우가 많다. */
    const v = classifyScheduleChange({
      diff: {
        ...emptyDiff(),
        moved: [
          { before: before({ nodeId: "chk" }), after: item({ nodeId: "chk" }) },
        ],
      },
      conflicts: [],
      checkpointNodeIds: ["chk"],
    });
    expect(v.risk).toBe("needs_approval");
    expect(v.reasons).toContain("checkpoint_moved");
  });

  it("일정에서 빠지는 항목이 있으면 승인을 받는다", () => {
    const v = classifyScheduleChange({
      diff: { ...emptyDiff(), removed: [before()] },
      conflicts: [],
    });
    expect(v.risk).toBe("needs_approval");
    expect(v.reasons).toContain("item_removed");
  });

  it("이동이 한도를 넘으면 승인을 받는다 — 한 번에 뒤집지 않는다", () => {
    const moved = Array.from({ length: 4 }, (_, i) => ({
      before: before({ itemId: `i${i}`, nodeId: `n${i}` }),
      after: item({ itemId: `i${i}`, nodeId: `n${i}` }),
    }));
    const v = classifyScheduleChange({
      diff: { ...emptyDiff(), moved },
      conflicts: [],
      maxAutoMoves: 3,
    });
    expect(v.risk).toBe("needs_approval");
    expect(v.reasons).toContain("too_many_moves");
  });

  it("사유는 중복 없이 사전순이다 — 화면이 순서를 다시 정하지 않게", () => {
    const v = classifyScheduleChange({
      diff: {
        ...emptyDiff(),
        removed: [before()],
        moved: [
          { before: before({ nodeId: "chk" }), after: item({ nodeId: "chk" }) },
        ],
      },
      conflicts: [
        { nodeId: "n9", code: "NO_AVAILABLE_SLOT", detail: "" },
        { nodeId: "n8", code: "NO_AVAILABLE_SLOT", detail: "" },
      ],
      checkpointNodeIds: ["chk"],
    });
    expect(v.reasons).toEqual([
      "checkpoint_moved",
      "item_removed",
      "unplaced_node",
    ]);
  });

  it("추가만 있는 변경은 자동이다 — 새 노드가 붙는 것은 되돌릴 일이 아니다", () => {
    const v = classifyScheduleChange({
      diff: { ...emptyDiff(), added: [item({ reason: "NEW_NODE" })] },
      conflicts: [],
    });
    expect(v.risk).toBe("auto");
  });
});
