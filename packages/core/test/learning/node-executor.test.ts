import { describe, expect, it } from "vitest";
import {
  BLOCK_REASONS,
  NODE_EXECUTORS,
  ROUTE_NODE_KINDS,
  executeNode,
  executeNodes,
  type ExecutableNode,
  type NodeExecutionContext,
  type RouteNodeKind,
} from "../../src/learning/node-executors";

/* ─────────────────────────────────────────────────────────────
 * 루트 노드 실행기 (T2.2).
 *
 * 이 모듈이 없던 동안 book_range·homework·confirmation_test 노드는
 * 교사가 만들 수 있어도 학생 화면에 **아무것도 나타나지 않았다**. 조용히
 * 사라지는 것이 가장 나쁜 실패다 — 교사는 배정했다고 믿고, 학생은 그런
 * 것이 있는 줄도 모르고, 그 하루는 「할 일 없음」으로 완주 처리된다.
 *
 * 그래서 여기서 겨누는 것은 결과가 셋뿐이라는 것이다:
 * **펼친다 / 학생 행동이 없다 / 막혔다.** 넷째(조용히 사라짐)는 없다.
 * ───────────────────────────────────────────────────────────── */

const ctx = (over: Partial<NodeExecutionContext> = {}): NodeExecutionContext => ({
  materials: [],
  assessment: null,
  ordinalFrom: 0,
  ...over,
});

const node = (over: Partial<ExecutableNode> = {}): ExecutableNode => ({
  id: "n1",
  kind: "concept_lesson",
  title: "노드",
  ...over,
});

const material = (over: Partial<NodeExecutionContext["materials"][number]> = {}) => ({
  id: "m1",
  kind: "reading" as const,
  title: "읽기 자료",
  questionCount: 0,
  progress: "none" as const,
  ...over,
});

describe("모든 종류가 셋 중 하나로 명시된다", () => {
  it("DB enum의 12종 전부에 실행기가 있다", () => {
    for (const kind of ROUTE_NODE_KINDS) {
      expect(NODE_EXECUTORS[kind], `${kind} 실행기 없음`).toBeTypeOf("function");
    }
  });

  it("실행기 표에 enum 밖의 종류가 없다", () => {
    /* 표에만 있고 enum에 없는 종류는 영원히 안 불린다 — 지운 종류의 잔재다. */
    expect(Object.keys(NODE_EXECUTORS).sort()).toEqual([...ROUTE_NODE_KINDS].sort());
  });

  it("어떤 종류도 빈 결과를 조용히 내지 않는다", () => {
    /* 실행 불가능한 필수 노드가 사라지지 않는다는 것을 종류 전수로 확인한다.
     * 아무 맥락도 주지 않았으므로 대부분 막히거나 비필수여야 하고, 어느
     * 쪽이든 **결과가 있어야** 한다. */
    for (const kind of ROUTE_NODE_KINDS) {
      const r = executeNode(node({ kind }), ctx());
      expect(["items", "not_required", "blocked"]).toContain(r.outcome);
      if (r.outcome === "items") expect(r.items.length).toBeGreaterThan(0);
    }
  });

  it("알 수 없는 종류는 무시가 아니라 차단이다", () => {
    const r = executeNode(node({ kind: "우주정거장" }), ctx());
    expect(r.outcome).toBe("blocked");
    expect(r).toMatchObject({ reason: BLOCK_REASONS.unknownNodeKind });
  });
});

describe("개념을 배우는 차시", () => {
  it("붙은 자료가 항목이 된다", () => {
    const r = executeNode(
      node({ kind: "concept_lesson" }),
      ctx({
        materials: [
          material({ id: "a", kind: "reading" }),
          material({ id: "b", kind: "video", progress: "completed" }),
        ],
      }),
    );

    expect(r.outcome).toBe("items");
    if (r.outcome !== "items") return;
    expect(r.items.map((i) => i.key)).toEqual(["reading:a", "video:b"]);
    expect(r.items[0]!.status).toBe("pending");
    expect(r.items[1]!.status).toBe("completed");
    expect(r.items[0]!.routeNodeId).toBe("n1");
  });

  it("자료가 하나도 없으면 막혔다고 말한다 — 빈 배열로 삼키지 않는다", () => {
    const r = executeNode(node({ kind: "concept_lesson" }), ctx());
    expect(r).toMatchObject({
      outcome: "blocked",
      reason: BLOCK_REASONS.materialMissing,
    });
  });

  it("문항 0개 연습 자료는 차단 항목으로 나온다", () => {
    const r = executeNode(
      node(),
      ctx({ materials: [material({ kind: "practice", questionCount: 0 })] }),
    );
    if (r.outcome !== "items") throw new Error("items여야 한다");
    expect(r.items[0]!.status).toBe("blocked");
    expect(r.items[0]!.blockedReason).toBe(BLOCK_REASONS.noQuestions);
  });

  it("보충(remediation)도 같은 방식으로 편다", () => {
    const r = executeNode(
      node({ kind: "remediation" }),
      ctx({ materials: [material()] }),
    );
    expect(r.outcome).toBe("items");
  });
});

describe("교재 범위", () => {
  it("교재와 쪽이 있으면 학생이 볼 문구로 편다", () => {
    const r = executeNode(
      node({
        kind: "book_range",
        bookEditionId: "b1",
        pageRange: { startPage: 12, endPage: 40 },
      }),
      ctx({ bookTitle: "RPM 중2-2" }),
    );

    if (r.outcome !== "items") throw new Error("items여야 한다");
    expect(r.items[0]!.titleSnapshot).toBe("RPM 중2-2 12~40쪽");
    expect(r.items[0]!.kind).toBe("book_range");
    expect(r.items[0]!.required).toBe(true);
  });

  it("교재나 쪽이 없으면 막힌다", () => {
    expect(executeNode(node({ kind: "book_range" }), ctx())).toMatchObject({
      outcome: "blocked",
      reason: BLOCK_REASONS.bookRangeIncomplete,
    });
    expect(
      executeNode(node({ kind: "book_range", bookEditionId: "b1" }), ctx()),
    ).toMatchObject({ reason: BLOCK_REASONS.bookRangeIncomplete });
  });
});

describe("숙제", () => {
  it("방식이 없으면 막힌다", () => {
    expect(executeNode(node({ kind: "homework" }), ctx())).toMatchObject({
      outcome: "blocked",
      reason: BLOCK_REASONS.homeworkModeMissing,
    });
  });

  it("교재 쪽 숙제는 교재명과 범위를 보여 준다", () => {
    const r = executeNode(
      node({
        kind: "homework",
        homework: { mode: "book_pages" },
        bookEditionId: "b1",
        pageRange: { startPage: 3, endPage: 5 },
      }),
      ctx({ bookTitle: "쎈 중2" }),
    );
    if (r.outcome !== "items") throw new Error("items여야 한다");
    expect(r.items[0]!.titleSnapshot).toBe("숙제 — 쎈 중2 3~5쪽");
  });

  it("시스템 연습 숙제는 자료를 가리킨다", () => {
    const r = executeNode(
      node({
        kind: "homework",
        homework: { mode: "practice_set", practiceMaterialId: "m9" },
      }),
      ctx({
        materials: [material({ id: "m9", kind: "practice", questionCount: 12, title: "연습 12제" })],
      }),
    );
    if (r.outcome !== "items") throw new Error("items여야 한다");
    expect(r.items[0]!.refId).toBe("m9");
    expect(r.items[0]!.titleSnapshot).toContain("연습 12제");
  });

  it("연습 숙제의 자료에 문항이 없으면 막힌다", () => {
    const r = executeNode(
      node({
        kind: "homework",
        homework: { mode: "practice_set", practiceMaterialId: "m9" },
      }),
      ctx({ materials: [material({ id: "m9", kind: "practice", questionCount: 0 })] }),
    );
    expect(r).toMatchObject({ outcome: "blocked", reason: BLOCK_REASONS.noQuestions });
  });

  it("끝낸 숙제는 완료로 나온다", () => {
    const r = executeNode(
      node({
        kind: "homework",
        homework: { mode: "book_pages" },
        bookEditionId: "b1",
        pageRange: { startPage: 1, endPage: 2 },
      }),
      ctx({ homeworkDone: true }),
    );
    if (r.outcome !== "items") throw new Error("items여야 한다");
    expect(r.items[0]!.status).toBe("completed");
  });
});

describe("평가 노드", () => {
  it("생성된 평가가 있으면 항목이 된다", () => {
    const r = executeNode(
      node({ kind: "daily_test", blueprintId: "bp1" }),
      ctx({
        assessment: {
          id: "a1",
          title: "8월 4일 일일테스트",
          scheduledDate: null,
          questionCount: 10,
          status: "pending",
        },
      }),
    );
    if (r.outcome !== "items") throw new Error("items여야 한다");
    expect(r.items[0]!.kind).toBe("assessment");
    expect(r.items[0]!.refId).toBe("a1");
  });

  it("평가가 아직 없으면 막힌다 — 학생이 빈 칸을 영원히 기다리지 않게", () => {
    expect(
      executeNode(node({ kind: "confirmation_test", blueprintId: "bp1" }), ctx()),
    ).toMatchObject({
      outcome: "blocked",
      reason: BLOCK_REASONS.assessmentNotGenerated,
    });
  });

  it("문항 0개 평가는 차단 항목이다", () => {
    const r = executeNode(
      node({ kind: "daily_test" }),
      ctx({
        assessment: {
          id: "a1",
          title: "빈 테스트",
          scheduledDate: null,
          questionCount: 0,
          status: "pending",
        },
      }),
    );
    if (r.outcome !== "items") throw new Error("items여야 한다");
    expect(r.items[0]!.status).toBe("blocked");
    expect(r.items[0]!.blockedReason).toBe(BLOCK_REASONS.noQuestions);
  });
});

describe("복습 노드", () => {
  it("기한이 온 복습이 있으면 한 덩어리로 낸다", () => {
    const r = executeNode(
      node({ kind: "wrong_answer_review" }),
      ctx({ dueReviewCount: 5 }),
    );
    if (r.outcome !== "items") throw new Error("items여야 한다");
    expect(r.items[0]!.titleSnapshot).toBe("복습 5건");
  });

  it("복습할 것이 없는 날은 결손이 아니다", () => {
    const r = executeNode(node({ kind: "cumulative_review" }), ctx());
    expect(r.outcome).toBe("not_required");
  });
});

describe("학생 행동이 없는 노드", () => {
  it("버퍼와 휴강은 비필수다 — 막힌 것이 아니다", () => {
    for (const kind of ["buffer", "break"] as RouteNodeKind[]) {
      const r = executeNode(node({ kind }), ctx());
      expect(r.outcome).toBe("not_required");
      if (r.outcome === "not_required") expect(r.note.length).toBeGreaterThan(0);
    }
  });

  it("custom은 비필수가 아니라 차단이다 — 무엇을 할지 아무도 모른다", () => {
    expect(executeNode(node({ kind: "custom" }), ctx())).toMatchObject({
      outcome: "blocked",
      reason: BLOCK_REASONS.unknownNodeKind,
    });
  });
});

describe("여러 노드 펼치기", () => {
  it("막힌 노드를 버리지 않고 함께 돌려준다", () => {
    const r = executeNodes(
      [
        node({ id: "n1", kind: "concept_lesson", title: "개념" }),
        node({ id: "n2", kind: "book_range", title: "교재 범위" }),
        node({ id: "n3", kind: "buffer", title: "버퍼" }),
      ],
      (n) =>
        ctx({
          materials: n.id === "n1" ? [material()] : [],
          ordinalFrom: 0,
        }),
    );

    expect(r.items).toHaveLength(1);
    expect(r.blocked).toEqual([
      {
        nodeId: "n2",
        kind: "book_range",
        title: "교재 범위",
        reason: BLOCK_REASONS.bookRangeIncomplete,
      },
    ]);
    expect(r.notRequired.map((n) => n.nodeId)).toEqual(["n3"]);
  });

  it("항목 순번이 노드 순서를 잇는다", () => {
    const r = executeNodes(
      [
        node({ id: "n1", kind: "concept_lesson" }),
        node({ id: "n2", kind: "concept_lesson" }),
      ],
      (n, from) =>
        ctx({
          materials: [material({ id: `${n.id}-m` })],
          ordinalFrom: from,
        }),
    );

    expect(r.items.map((i) => i.ordinal)).toEqual([0, 1]);
  });

  it("노드가 없으면 아무것도 없다 — 빈 날은 결손이 아니다", () => {
    const r = executeNodes([], () => ctx());
    expect(r).toEqual({ items: [], blocked: [], notRequired: [] });
  });
});
