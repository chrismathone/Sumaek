import type { IsoDate } from "../shared/dates";
import type { ScheduleConflict, ScheduleDiff } from "./types";

/* ─────────────────────────────────────────────────────────────
 * 실제 진도 기반 재계획의 입력 (T4.3).
 *
 * 일정 엔진(engine.ts)을 **대체하지 않는다.** 그 엔진의 결정론은 그대로 두고
 * 무엇을 먹일지만 정한다. 이 파일이 하는 일은 둘뿐이다:
 *
 *   ① 진도 사실 → 「끝난 것」과 「다시 배치할 것」
 *   ② 나온 변경안 → 자동 적용인가, 교사 승인인가
 *
 * ①이 필요한 이유: 지금까지 완료 집합은 **수업 단위**로 파생됐다. 수업
 * 상태가 completed면 그 수업의 planned 노드를 전부 완료로 셌다. T4.2 이전에는
 * 마감 경로 자체가 없어 그 값이 늘 비어 있었으므로 드러나지 않았지만, 이제
 * 교사가 노드별로 적는다 — 그대로 두면 **교사가 「못 나감」이라고 말한 노드가
 * 완료로 기록되고 다시는 배치되지 않는다.** 정직하게 적을수록 진도가 사라진다.
 *
 * ②가 필요한 이유: 전부 자동으로 적용하면 학부모에게 공지된 확인테스트
 * 날짜가 아무도 모르게 밀린다. 전부 승인으로 돌리면 승인함이 쌓여 아무도
 * 보지 않게 되고, 그 순간 자동화가 없는 것과 같아진다.
 *
 * 순수 함수다 — 현재 시각·난수·비정렬 조회를 쓰지 않는다 (2H 규약).
 * ───────────────────────────────────────────────────────────── */

/** 교사가 마감에서 적는 노드별 결과 (T4.2의 progress_events와 같은 어휘) */
export type NodeOutcome = "completed" | "partial" | "skipped";

export interface SessionProgressFact {
  sessionId: string;
  date: IsoDate;
  nodeId: string;
  outcome: NodeOutcome;
}

export interface AdaptiveProgress {
  /** 다시 배치하지 않는다 */
  completedNodeIds: string[];
  /**
   * 미진행 — 다음 가용 슬롯으로 이월한다.
   *
   * 「일부만」도 여기 든다. 남은 부분이 있는데 완료로 넣으면 그 자리는 영영
   * 돌아오지 않고, 교사는 다음 차시를 손으로 만들어야 한다.
   */
  carryOverNodeIds: string[];
}

/**
 * 진도 사실을 엔진 입력으로 옮긴다.
 *
 * 한 번이라도 「다 나감」이면 완료다. 보충 차시에서 같은 노드를 다시 짚고
 * 「일부만」이 붙었다고 이미 끝낸 진도를 되돌리면 반은 같은 곳을 맴돈다.
 */
export function deriveProgress(
  facts: readonly SessionProgressFact[],
  options?: {
    /** 루트 순서. 주면 이월 순서가 이것을 따른다 — 배운 순서가 곧 배울 순서다. */
    nodeOrder?: readonly string[];
  },
): AdaptiveProgress {
  const completed = new Set<string>();
  /** 이월 후보 → 처음 관측된 (날짜, 노드) — 순서 결정에만 쓴다 */
  const pending = new Map<string, { date: IsoDate; nodeId: string }>();

  for (const f of facts) {
    if (f.outcome === "completed") {
      completed.add(f.nodeId);
      continue;
    }
    const prior = pending.get(f.nodeId);
    if (!prior || f.date < prior.date) {
      pending.set(f.nodeId, { date: f.date, nodeId: f.nodeId });
    }
  }

  /* 완료가 이월을 이긴다 — 순서와 무관하게. 사실이 들어온 순서에 따라
   * 결과가 달라지면 같은 입력에 다른 일정이 나온다. */
  for (const nodeId of completed) pending.delete(nodeId);

  const order = options?.nodeOrder;
  const carryOver = [...pending.values()].sort((a, b) => {
    if (order) {
      const ai = order.indexOf(a.nodeId);
      const bi = order.indexOf(b.nodeId);
      /* 루트에 없는 노드(지난 판본의 잔재)는 뒤로 — 있는 것부터 제자리에 */
      const an = ai === -1 ? Number.POSITIVE_INFINITY : ai;
      const bn = bi === -1 ? Number.POSITIVE_INFINITY : bi;
      if (an !== bn) return an - bn;
    }
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.nodeId < b.nodeId ? -1 : 1;
  });

  return {
    completedNodeIds: [...completed].sort(),
    carryOverNodeIds: carryOver.map((c) => c.nodeId),
  };
}

/* ── 변경안의 위험도 ─────────────────────────────────────── */

export type ChangeRisk = "auto" | "needs_approval";

/** 승인이 필요한 이유 — 화면·알림이 같은 코드를 쓴다 */
export type RiskReason =
  /** 확인테스트가 움직였다 — 진급 게이트이자 이미 공지된 날짜다 */
  | "checkpoint_moved"
  /** 일정에서 빠지는 항목이 있다 */
  | "item_removed"
  /** 한 번에 옮기는 양이 한도를 넘었다 */
  | "too_many_moves"
  /** 자리를 못 찾은 노드가 있다 */
  | "unplaced_node";

export interface RiskVerdict {
  risk: ChangeRisk;
  /** 중복 없이 사전순 — 화면이 순서를 다시 정하지 않게 */
  reasons: RiskReason[];
}

/** 승인 없이 옮길 수 있는 항목 수의 기본 한도. */
export const DEFAULT_MAX_AUTO_MOVES = 3;

/**
 * 변경안을 자동 적용과 승인 필요로 가른다.
 *
 * 기준은 「되돌리기 쉬운가」가 아니라 **「사람이 이미 그 날짜를 알고 있는가」**다.
 * 새 노드가 뒤에 붙는 것은 아무도 모르던 일이고, 확인테스트가 사흘 밀리는
 * 것은 학부모가 아는 일이다.
 */
export function classifyScheduleChange(input: {
  diff: ScheduleDiff;
  conflicts: readonly ScheduleConflict[];
  /** 확인테스트 등 게이트 노드 */
  checkpointNodeIds?: readonly string[];
  maxAutoMoves?: number;
}): RiskVerdict {
  const reasons = new Set<RiskReason>();
  const checkpoints = new Set(input.checkpointNodeIds ?? []);
  const limit = input.maxAutoMoves ?? DEFAULT_MAX_AUTO_MOVES;

  if (input.conflicts.length > 0) reasons.add("unplaced_node");
  if (input.diff.removed.length > 0) reasons.add("item_removed");
  if (input.diff.moved.length > limit) reasons.add("too_many_moves");
  for (const m of input.diff.moved) {
    if (checkpoints.has(m.after.nodeId)) {
      reasons.add("checkpoint_moved");
      break;
    }
  }

  return {
    risk: reasons.size > 0 ? "needs_approval" : "auto",
    reasons: [...reasons].sort(),
  };
}
