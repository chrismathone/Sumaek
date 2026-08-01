/* ─────────────────────────────────────────────────────────────
 * 동시 수정 충돌 diff (인수 20).
 *
 * lock_version 불일치는 이미 명시 거부된다(마지막 저장이 조용히 이기지 않는다).
 * 여기서 만드는 것은 그 거부를 **비교할 수 있는 형태**로 바꾸는 계산이다:
 * 무엇이 어떻게 달라졌는가, 그리고 내 변경을 최신 상태에 그대로 다시
 * 적용할 수 있는가. "충돌했습니다"의 다른 표현이 되지 않으려면 항목 단위로
 * 답해야 한다 — 노드 추가·삭제·순서·제목·종류·시수.
 *
 * ── 왜 "폼에 실린 스냅샷"인가 (설계 판단) ─────────────────────
 * 비교하려면 "내가 읽었던 시점의 상태"가 있어야 하는데, DB에는 그것이 남지
 * 않는다: route_nodes는 제자리 수정이고(이동은 sort_order 교환, 삭제는 실제
 * DELETE) 노드 단위 이력 테이블도 감사 기록도 없다. 즉 **서버는 사후에 "그
 * 사용자가 무엇을 보고 있었는지"를 복원할 수 없다.** 선택지는 셋이었다:
 *
 *   (a) 노드 이력 테이블을 새로 만든다 — 임의 시점을 복원하려면 편집 1회마다
 *       전체 스냅샷을 남겨야 한다(부분 델타로는 특정 사용자가 본 시점을
 *       집어낼 수 없다). 충돌 화면 하나를 위해 모든 쓰기에 상시 비용과
 *       보존·정리 정책이 붙는다.
 *   (b) route_versions 이력을 조회한다 — 새 버전은 게시할 때만 생기므로
 *       편집 중인 초안 하나 안에서 벌어지는 이 충돌에는 정보가 0이다.
 *   (c) 읽은 시점의 스냅샷을 폼에 싣는다 — 채택.
 *
 * (c)를 고른 이유는 비용이 아니라 **정확성**이다. 비교의 기준은 "DB의 옛
 * 상태"가 아니라 "이 사용자가 실제로 보고 판단한 화면"이고, 그것을 아는 곳은
 * 그 화면뿐이다. 게다가 스냅샷은 lock_version 토큰과 같은 렌더에서 나와 같은
 * 폼으로 함께 오므로 둘이 같은 시점을 가리킨다는 것이 구조적으로 보장된다 —
 * 별도 조회로 짝을 맞추면 그 사이에 어긋날 수 있다.
 *
 * 대가는 폼 크기(노드당 약 60바이트)와 위조 가능성인데, 스냅샷은 **표시
 * 전용**이다. 쓰기 허용 여부는 여전히 서버의 lock_version 비교만으로 정해지므로
 * 스냅샷을 위조해도 권한·정합성에는 영향이 없고 자기 화면의 diff만 틀어진다.
 * ───────────────────────────────────────────────────────────── */

/** 비교에 쓰는 최소 노드 상태 — 화면이 보여 주는 항목과 같다 */
export interface RouteNodeSnapshot {
  id: string;
  kind: string;
  title: string;
  sortOrder: number;
  expectedMinutes: number;
}

/** 아직 저장되지 않은 "내가 추가하려던 노드"의 자리표시 id */
export const PENDING_NODE_ID = "__pending_new_node__";

export type RouteChangeCode =
  | "ADDED"
  | "REMOVED"
  | "TITLE"
  | "KIND"
  | "MINUTES"
  | "MOVED";

export interface RouteNodeChange {
  code: RouteChangeCode;
  nodeId: string;
  /** 사람이 알아볼 이름 — 삭제면 사라진 노드의 제목 */
  title: string;
  /** 바뀌기 전 값 (추가면 null) */
  before: string | null;
  /** 바뀐 뒤 값 (삭제면 null) */
  after: string | null;
}

function byOrder(
  a: RouteNodeSnapshot,
  b: RouteNodeSnapshot,
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  // sort_order가 같은 과도 상태에서도 결과가 흔들리지 않게 id로 확정한다
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const sorted = (list: readonly RouteNodeSnapshot[]): RouteNodeSnapshot[] =>
  [...list].sort(byOrder);

/**
 * 두 노드 목록의 차이를 항목 단위로 낸다.
 *
 * 순서 변화는 **양쪽에 모두 있는 노드들만의 상대 순서**로 판정한다.
 * 절대 sort_order로 보면 노드 하나를 추가·삭제한 것만으로 그 뒤 노드가 전부
 * "이동"으로 보고돼 diff가 노이즈에 덮인다 — 실제로 사용자가 보고 싶은 것은
 * "무엇이 늘고 줄었나"와 "무엇이 서로 자리를 바꿨나"이지 번호 재부여가 아니다.
 */
export function diffRouteNodes(
  before: readonly RouteNodeSnapshot[],
  after: readonly RouteNodeSnapshot[],
): RouteNodeChange[] {
  const beforeById = new Map(before.map((n) => [n.id, n]));
  const afterById = new Map(after.map((n) => [n.id, n]));

  const rankOf = (
    list: readonly RouteNodeSnapshot[],
    keep: Map<string, RouteNodeSnapshot>,
  ): Map<string, number> => {
    const ids = sorted(list)
      .filter((n) => keep.has(n.id))
      .map((n) => n.id);
    return new Map(ids.map((id, i) => [id, i]));
  };
  const beforeRank = rankOf(before, afterById);
  const afterRank = rankOf(after, beforeById);

  const changes: RouteNodeChange[] = [];

  // 삭제를 먼저 — 원래 목록 순서로 읽힌다
  for (const n of sorted(before)) {
    if (afterById.has(n.id)) continue;
    changes.push({
      code: "REMOVED",
      nodeId: n.id,
      title: n.title,
      before: n.title,
      after: null,
    });
  }

  for (const n of sorted(after)) {
    const prev = beforeById.get(n.id);
    if (!prev) {
      changes.push({
        code: "ADDED",
        nodeId: n.id,
        title: n.title,
        before: null,
        after: n.title,
      });
      continue;
    }
    if (prev.title !== n.title) {
      changes.push({
        code: "TITLE",
        nodeId: n.id,
        title: n.title,
        before: prev.title,
        after: n.title,
      });
    }
    if (prev.kind !== n.kind) {
      changes.push({
        code: "KIND",
        nodeId: n.id,
        title: n.title,
        before: prev.kind,
        after: n.kind,
      });
    }
    if (prev.expectedMinutes !== n.expectedMinutes) {
      changes.push({
        code: "MINUTES",
        nodeId: n.id,
        title: n.title,
        before: String(prev.expectedMinutes),
        after: String(n.expectedMinutes),
      });
    }
    const from = beforeRank.get(n.id);
    const to = afterRank.get(n.id);
    if (from !== undefined && to !== undefined && from !== to) {
      changes.push({
        code: "MOVED",
        nodeId: n.id,
        title: n.title,
        before: String(from + 1),
        after: String(to + 1),
      });
    }
  }

  return changes;
}

/** 사용자가 하려던(아직 저장되지 않은) 편집 — 충돌 화면의 "내 변경" 쪽 */
export type RouteEditIntent =
  | {
      type: "add";
      kind: string;
      title: string;
      expectedMinutes: number;
      conceptIds: string[];
    }
  | { type: "delete"; nodeId: string }
  | { type: "move"; nodeId: string; direction: "up" | "down" }
  | { type: "publish" };

/**
 * 내 편집을 기준 상태에 얹은 결과 — 충돌 화면 왼쪽에 그릴 "내 목록".
 * 액션이 실제로 하는 일과 같은 규칙을 쓴다(추가는 맨 뒤, 이동은 이웃과
 * sort_order 교환). 저장은 하지 않는다.
 */
export function applyIntent(
  base: readonly RouteNodeSnapshot[],
  intent: RouteEditIntent,
): RouteNodeSnapshot[] {
  const list = sorted(base);
  switch (intent.type) {
    case "add": {
      const maxOrder = list.reduce((m, n) => Math.max(m, n.sortOrder), 0);
      return [
        ...list,
        {
          id: PENDING_NODE_ID,
          kind: intent.kind,
          title: intent.title,
          sortOrder: maxOrder + 1,
          expectedMinutes: intent.expectedMinutes,
        },
      ];
    }
    case "delete":
      return list.filter((n) => n.id !== intent.nodeId);
    case "move": {
      const i = list.findIndex((n) => n.id === intent.nodeId);
      if (i < 0) return list;
      const j = intent.direction === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return list;
      const a = list[i]!;
      const b = list[j]!;
      const next = [...list];
      next[i] = { ...b, sortOrder: a.sortOrder };
      next[j] = { ...a, sortOrder: b.sortOrder };
      return next.sort(byOrder);
    }
    case "publish":
      return list;
  }
}

/** 내 변경과 남의 변경이 같은 노드를 건드린 지점 */
export interface RouteConflictCollision {
  nodeId: string;
  title: string;
  mine: RouteNodeChange[];
  theirs: RouteNodeChange[];
}

export interface RouteConflict {
  /** 읽은 시점의 스냅샷이 있어 diff를 낼 수 있었는가 */
  comparable: boolean;
  /** 내가 제시한(읽은 시점의) 토큰 */
  baseLockVersion: number;
  /** 저장소의 현재 토큰 */
  currentLockVersion: number;
  intent: RouteEditIntent;
  /** 내가 하려던 변경 (아직 저장되지 않음) */
  myChanges: RouteNodeChange[];
  /** 내가 읽은 뒤 다른 사용자가 저장한 변경 */
  theirChanges: RouteNodeChange[];
  collisions: RouteConflictCollision[];
  /** 나란히 그릴 목록 — 왼쪽: 내 변경 반영본, 오른쪽: 저장된 최신 */
  mine: RouteNodeSnapshot[];
  theirs: RouteNodeSnapshot[];
  /** 내 변경을 최신 상태 위에 그대로 다시 적용할 수 있는가 */
  reapply: {
    possible: boolean;
    /** 불가능한 이유 (가능하면 null) */
    blockedReason: string | null;
    /** 가능하지만 알고 눌러야 하는 것 (없으면 null) */
    note: string | null;
  };
}

/**
 * 최신 상태 위에 내 편집을 그대로 다시 적용할 수 있는지 — 다시 적용 버튼이
 * 조용히 아무 일도 안 하거나 엉뚱한 노드를 건드리는 것을 막는다.
 */
function evaluateReapply(
  latest: readonly RouteNodeSnapshot[],
  intent: RouteEditIntent,
  theirChanges: readonly RouteNodeChange[],
): RouteConflict["reapply"] {
  const list = sorted(latest);
  switch (intent.type) {
    case "add":
      return { possible: true, blockedReason: null, note: null };
    case "delete": {
      const target = list.find((n) => n.id === intent.nodeId);
      if (!target) {
        return {
          possible: false,
          blockedReason:
            "삭제하려던 노드가 이미 없습니다 — 다른 사용자가 먼저 삭제했습니다. 지울 것이 남아 있지 않습니다.",
          note: null,
        };
      }
      return { possible: true, blockedReason: null, note: null };
    }
    case "move": {
      const i = list.findIndex((n) => n.id === intent.nodeId);
      if (i < 0) {
        return {
          possible: false,
          blockedReason:
            "옮기려던 노드가 이미 없습니다 — 다른 사용자가 먼저 삭제했습니다.",
          note: null,
        };
      }
      const j = intent.direction === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) {
        return {
          possible: false,
          blockedReason:
            "최신 상태에서는 그 방향에 이웃 노드가 없습니다 — 이미 끝자리입니다.",
          note: null,
        };
      }
      return {
        possible: true,
        blockedReason: null,
        note: `최신 상태 기준으로는 "${list[j]!.title}"와 자리를 바꿉니다.`,
      };
    }
    case "publish":
      return {
        possible: true,
        blockedReason: null,
        note:
          theirChanges.length > 0
            ? "게시 대상은 오른쪽 '저장된 최신 상태'입니다 — 다른 사용자의 변경이 함께 게시됩니다."
            : null,
      };
  }
}

export function buildRouteConflict(input: {
  /** 읽은 시점의 스냅샷 (폼에서 옴, 없거나 깨졌으면 null) */
  baseline: readonly RouteNodeSnapshot[] | null;
  /** 지금 저장소에 있는 상태 */
  latest: readonly RouteNodeSnapshot[];
  intent: RouteEditIntent;
  baseLockVersion: number;
  currentLockVersion: number;
}): RouteConflict {
  const { baseline, latest, intent } = input;
  const comparable = baseline !== null;
  const base = baseline ?? [];

  const theirChanges = comparable ? diffRouteNodes(base, latest) : [];
  const mine = comparable ? applyIntent(base, intent) : [];
  const myChanges = comparable ? diffRouteNodes(base, mine) : [];

  const byNode = new Map<string, RouteConflictCollision>();
  for (const m of myChanges) {
    for (const t of theirChanges) {
      if (t.nodeId !== m.nodeId) continue;
      const entry = byNode.get(m.nodeId) ?? {
        nodeId: m.nodeId,
        title: m.title,
        mine: [],
        theirs: [],
      };
      if (!entry.mine.includes(m)) entry.mine.push(m);
      if (!entry.theirs.includes(t)) entry.theirs.push(t);
      byNode.set(m.nodeId, entry);
    }
  }

  return {
    comparable,
    baseLockVersion: input.baseLockVersion,
    currentLockVersion: input.currentLockVersion,
    intent,
    myChanges,
    theirChanges,
    collisions: [...byNode.values()],
    mine,
    theirs: sorted(latest),
    reapply: evaluateReapply(latest, intent, theirChanges),
  };
}

/* ── 폼 왕복용 직렬화 ──────────────────────────────────────────
 * 튜플 배열로 담는다 — 키 이름을 빼면 노드당 수십 바이트라 노드가 수십 개인
 * 초안도 폼 하나에 들어간다. 깨진 입력은 조용히 부분 복원하지 않고 null로
 * 돌려 "비교할 수 없다"고 정직하게 말하게 한다. ── */

type SnapshotTuple = [string, string, string, number, number];

export function encodeRouteSnapshot(
  nodes: readonly RouteNodeSnapshot[],
): string {
  const rows: SnapshotTuple[] = nodes.map((n) => [
    n.id,
    n.kind,
    n.title,
    n.sortOrder,
    n.expectedMinutes,
  ]);
  return JSON.stringify(rows);
}

export function decodeRouteSnapshot(
  raw: string | null | undefined,
): RouteNodeSnapshot[] | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const nodes: RouteNodeSnapshot[] = [];
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== 5) return null;
    const [id, kind, title, sortOrder, minutes] = row as unknown[];
    if (
      typeof id !== "string" ||
      typeof kind !== "string" ||
      typeof title !== "string" ||
      typeof sortOrder !== "number" ||
      !Number.isFinite(sortOrder) ||
      typeof minutes !== "number" ||
      !Number.isFinite(minutes)
    ) {
      return null;
    }
    nodes.push({ id, kind, title, sortOrder, expectedMinutes: minutes });
  }
  return nodes;
}
