import { describe, expect, it } from "vitest";
import {
  PENDING_NODE_ID,
  applyIntent,
  buildRouteConflict,
  decodeRouteSnapshot,
  diffRouteNodes,
  encodeRouteSnapshot,
  type RouteNodeSnapshot,
} from "../../src/routes/conflict";

/* ─────────────────────────────────────────────────────────────
 * 동시 수정 충돌 diff (인수 20).
 *
 * 이 테스트가 붙잡는 주장은 하나다: 충돌 화면이 "충돌했습니다"의 다른 표현이
 * 아니라 **무엇이 어떻게 달라졌는지**를 항목 단위로 집어낸다는 것.
 * 그래서 diff가 잡아야 할 변화(추가·삭제·제목·종류·시수·순서)를 하나씩,
 * 잡으면 안 되는 것(추가·삭제로 밀린 번호)도 함께 겨눈다.
 * ───────────────────────────────────────────────────────────── */

const node = (
  id: string,
  sortOrder: number,
  overrides?: Partial<RouteNodeSnapshot>,
): RouteNodeSnapshot => ({
  id,
  kind: "concept_lesson",
  title: `노드 ${id}`,
  sortOrder,
  expectedMinutes: 60,
  ...overrides,
});

/** 기준 상태 — 개념 수업 2 + 확인테스트 */
const base = (): RouteNodeSnapshot[] => [
  node("a", 1, { title: "일차함수의 뜻" }),
  node("b", 2, { title: "일차함수의 그래프" }),
  node("c", 3, { title: "확인테스트", kind: "confirmation_test" }),
];

const codes = (changes: ReturnType<typeof diffRouteNodes>) =>
  changes.map((c) => `${c.code}:${c.nodeId}`);

describe("루트 노드 diff", () => {
  it("변화가 없으면 아무것도 보고하지 않는다", () => {
    expect(diffRouteNodes(base(), base())).toEqual([]);
  });

  it("추가된 노드를 잡는다", () => {
    const after = [...base(), node("d", 4, { title: "새 노드" })];
    const changes = diffRouteNodes(base(), after);
    expect(codes(changes)).toEqual(["ADDED:d"]);
    expect(changes[0]!.title).toBe("새 노드");
  });

  it("삭제된 노드를 잡는다 — 사라진 제목을 남긴다", () => {
    const after = base().filter((n) => n.id !== "b");
    const changes = diffRouteNodes(base(), after);
    expect(codes(changes)).toEqual(["REMOVED:b"]);
    expect(changes[0]!.before).toBe("일차함수의 그래프");
    expect(changes[0]!.after).toBeNull();
  });

  it("제목 변경을 잡는다 — 바뀐 값 양쪽을 남긴다", () => {
    const after = base().map((n) =>
      n.id === "a" ? { ...n, title: "일차함수의 정의" } : n,
    );
    const changes = diffRouteNodes(base(), after);
    expect(codes(changes)).toEqual(["TITLE:a"]);
    expect(changes[0]!.before).toBe("일차함수의 뜻");
    expect(changes[0]!.after).toBe("일차함수의 정의");
  });

  it("종류 변경을 잡는다", () => {
    const after = base().map((n) =>
      n.id === "b" ? { ...n, kind: "problem_solving" } : n,
    );
    const changes = diffRouteNodes(base(), after);
    expect(codes(changes)).toEqual(["KIND:b"]);
    expect(changes[0]!.before).toBe("concept_lesson");
    expect(changes[0]!.after).toBe("problem_solving");
  });

  it("시수 변경을 잡는다", () => {
    const after = base().map((n) =>
      n.id === "c" ? { ...n, expectedMinutes: 90 } : n,
    );
    const changes = diffRouteNodes(base(), after);
    expect(codes(changes)).toEqual(["MINUTES:c"]);
    expect(changes[0]!.before).toBe("60");
    expect(changes[0]!.after).toBe("90");
  });

  it("자리를 바꾼 두 노드를 모두 이동으로 잡는다 (위치까지)", () => {
    // a(1)·b(2) 교환 — 액션 moveRouteNode가 실제로 하는 sort_order 교환
    const after = base().map((n) =>
      n.id === "a" ? { ...n, sortOrder: 2 } : n.id === "b" ? { ...n, sortOrder: 1 } : n,
    );
    const changes = diffRouteNodes(base(), after);
    expect(codes(changes).sort()).toEqual(["MOVED:a", "MOVED:b"]);
    const a = changes.find((c) => c.nodeId === "a")!;
    expect([a.before, a.after]).toEqual(["1", "2"]);
    const b = changes.find((c) => c.nodeId === "b")!;
    expect([b.before, b.after]).toEqual(["2", "1"]);
  });

  it("한 노드를 여러 항목에서 고치면 항목마다 따로 보고한다", () => {
    const after = base().map((n) =>
      n.id === "a"
        ? { ...n, title: "고친 제목", expectedMinutes: 45, kind: "homework" }
        : n,
    );
    expect(codes(diffRouteNodes(base(), after)).sort()).toEqual([
      "KIND:a",
      "MINUTES:a",
      "TITLE:a",
    ]);
  });

  it("맨 앞에 노드가 끼어들어 번호가 밀린 것은 이동이 아니다", () => {
    // 절대 sort_order로 보면 a·b·c가 전부 "이동"으로 보고돼 diff가 노이즈에
    // 덮인다. 남은 노드들의 상대 순서는 그대로이므로 추가 1건만 나와야 한다.
    const after = [
      node("z", 0, { title: "맨 앞 삽입" }),
      ...base().map((n) => ({ ...n, sortOrder: n.sortOrder + 1 })),
    ];
    expect(codes(diffRouteNodes(base(), after))).toEqual(["ADDED:z"]);
  });

  it("가운데 노드를 지워 번호가 당겨진 것도 이동이 아니다", () => {
    const after = [
      { ...node("a", 1, { title: "일차함수의 뜻" }) },
      { ...node("c", 2, { title: "확인테스트", kind: "confirmation_test" }) },
    ];
    expect(codes(diffRouteNodes(base(), after))).toEqual(["REMOVED:b"]);
  });
});

describe("내 편집 얹기 (applyIntent)", () => {
  it("추가는 맨 뒤에, 자리표시 id로 붙는다", () => {
    const mine = applyIntent(base(), {
      type: "add",
      kind: "homework",
      title: "숙제",
      expectedMinutes: 30,
      conceptIds: [],
    });
    expect(mine).toHaveLength(4);
    expect(mine[3]!.id).toBe(PENDING_NODE_ID);
    expect(mine[3]!.sortOrder).toBe(4);
    expect(diffRouteNodes(base(), mine).map((c) => c.code)).toEqual(["ADDED"]);
  });

  it("삭제는 그 노드만 뺀다", () => {
    const mine = applyIntent(base(), { type: "delete", nodeId: "b" });
    expect(mine.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("이동은 이웃과 sort_order를 맞바꾼다", () => {
    const mine = applyIntent(base(), {
      type: "move",
      nodeId: "b",
      direction: "up",
    });
    expect(mine.map((n) => n.id)).toEqual(["b", "a", "c"]);
    expect(mine.map((n) => n.sortOrder)).toEqual([1, 2, 3]);
  });

  it("끝자리를 더 밀면 아무 일도 일어나지 않는다", () => {
    const mine = applyIntent(base(), {
      type: "move",
      nodeId: "a",
      direction: "up",
    });
    expect(diffRouteNodes(base(), mine)).toEqual([]);
  });

  it("게시는 노드를 바꾸지 않는다", () => {
    expect(diffRouteNodes(base(), applyIntent(base(), { type: "publish" }))).toEqual(
      [],
    );
  });
});

describe("충돌 화면 조립 (buildRouteConflict)", () => {
  const build = (
    latest: RouteNodeSnapshot[],
    intent: Parameters<typeof buildRouteConflict>[0]["intent"],
    baseline: RouteNodeSnapshot[] | null = base(),
  ) =>
    buildRouteConflict({
      baseline,
      latest,
      intent,
      baseLockVersion: 4,
      currentLockVersion: 5,
    });

  it("남의 변경과 내 변경을 따로 세운다", () => {
    // 남: 노드 하나 추가. 나: 다른 노드를 추가하려던 중.
    const latest = [...base(), node("x", 4, { title: "다른 사용자 노드" })];
    const conflict = build(latest, {
      type: "add",
      kind: "concept_lesson",
      title: "내 노드",
      expectedMinutes: 60,
      conceptIds: [],
    });

    expect(conflict.comparable).toBe(true);
    expect(conflict.theirChanges.map((c) => [c.code, c.title])).toEqual([
      ["ADDED", "다른 사용자 노드"],
    ]);
    expect(conflict.myChanges.map((c) => [c.code, c.title])).toEqual([
      ["ADDED", "내 노드"],
    ]);
    // 나란히 그릴 두 목록이 실제로 다르다
    expect(conflict.mine.map((n) => n.title)).toContain("내 노드");
    expect(conflict.mine.map((n) => n.title)).not.toContain("다른 사용자 노드");
    expect(conflict.theirs.map((n) => n.title)).toContain("다른 사용자 노드");
    expect(conflict.collisions).toEqual([]);
    expect(conflict.reapply.possible).toBe(true);
  });

  it("같은 노드를 양쪽이 건드리면 충돌 지점으로 집어낸다", () => {
    const latest = base().map((n) =>
      n.id === "b" ? { ...n, title: "남이 고친 제목" } : n,
    );
    const conflict = build(latest, { type: "delete", nodeId: "b" });

    expect(conflict.collisions).toHaveLength(1);
    expect(conflict.collisions[0]!.nodeId).toBe("b");
    expect(conflict.collisions[0]!.mine.map((c) => c.code)).toEqual(["REMOVED"]);
    expect(conflict.collisions[0]!.theirs.map((c) => c.code)).toEqual(["TITLE"]);
  });

  it("이미 삭제된 노드를 지우려던 것은 다시 적용할 수 없다 — 이유를 말한다", () => {
    const latest = base().filter((n) => n.id !== "b");
    const conflict = build(latest, { type: "delete", nodeId: "b" });
    expect(conflict.reapply.possible).toBe(false);
    expect(conflict.reapply.blockedReason).toContain("이미 없습니다");
  });

  it("최신 상태에서 끝자리가 된 노드는 그 방향으로 더 옮길 수 없다", () => {
    // 남이 a를 지워서 b가 맨 앞이 됐다 — b를 위로 올릴 자리가 없다
    const latest = base().filter((n) => n.id !== "a");
    const conflict = build(latest, {
      type: "move",
      nodeId: "b",
      direction: "up",
    });
    expect(conflict.reapply.possible).toBe(false);
    expect(conflict.reapply.blockedReason).toContain("이웃 노드가 없습니다");
  });

  it("옮길 수 있으면 최신 기준의 상대가 누구인지 알려 준다", () => {
    const latest = base();
    const conflict = build(latest, {
      type: "move",
      nodeId: "b",
      direction: "down",
    });
    expect(conflict.reapply.possible).toBe(true);
    expect(conflict.reapply.note).toContain("확인테스트");
  });

  it("게시를 다시 누르면 남의 변경까지 함께 게시된다고 미리 말한다", () => {
    const latest = [...base(), node("x", 4, { title: "남이 넣은 노드" })];
    const conflict = build(latest, { type: "publish" });
    expect(conflict.reapply.possible).toBe(true);
    expect(conflict.reapply.note).toContain("함께 게시");
  });

  it("스냅샷이 없으면 비교했다고 꾸미지 않는다", () => {
    const conflict = build([...base()], { type: "publish" }, null);
    expect(conflict.comparable).toBe(false);
    expect(conflict.myChanges).toEqual([]);
    expect(conflict.theirChanges).toEqual([]);
    // 최신 상태는 그래도 보여 줄 수 있다
    expect(conflict.theirs).toHaveLength(3);
  });
});

describe("폼 왕복 직렬화", () => {
  it("왕복해도 같은 목록이다", () => {
    expect(decodeRouteSnapshot(encodeRouteSnapshot(base()))).toEqual(base());
  });

  it("빈 목록도 왕복한다", () => {
    expect(decodeRouteSnapshot(encodeRouteSnapshot([]))).toEqual([]);
  });

  it("따옴표·줄바꿈이 든 제목도 살아 돌아온다", () => {
    const tricky = [node("a", 1, { title: '따옴표 " 와 \n 줄바꿈' })];
    expect(decodeRouteSnapshot(encodeRouteSnapshot(tricky))).toEqual(tricky);
  });

  it("깨진 입력은 부분 복원하지 않고 null이다", () => {
    expect(decodeRouteSnapshot("{ 이건 JSON이 아니다")).toBeNull();
    expect(decodeRouteSnapshot("{}")).toBeNull();
    expect(decodeRouteSnapshot('[["a","concept_lesson","제목",1]]')).toBeNull();
    expect(
      decodeRouteSnapshot('[["a","concept_lesson","제목","1",60]]'),
    ).toBeNull();
    expect(decodeRouteSnapshot("")).toBeNull();
    expect(decodeRouteSnapshot(null)).toBeNull();
  });
});
