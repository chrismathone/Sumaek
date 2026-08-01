import { hashObject } from "../shared/deterministic";
import { eachDate, weekdayOf, type IsoDate } from "../shared/dates";
import type {
  BusyInterval,
  OverrideDeltaInput,
  ProposedItem,
  RouteNodeInput,
  ScheduleConflict,
  ScheduleDiff,
  ScheduleEngineInput,
  ScheduleProposalResult,
  ScheduledItem,
  ScheduleReasonCode,
} from "./types";

/**
 * 결정론적 일정 엔진 (골프롬프트 2H).
 *
 * 보장:
 * 1. cutoff 이전·완료·잠금 항목은 어떤 입력에서도 변경되지 않는다 (불변 조건 5).
 * 2. 하드 제약(휴일, 시간 충돌, 하루 학습량)을 위반한 결과를 만들지 않는다 (불변 조건 6).
 * 3. 같은 입력 스냅샷·엔진 버전·시드는 같은 출력 해시를 만든다 (불변 조건 12).
 * 4. 기존 미래 일정 변경 최소화 — 유효한 기존 배치는 유지한다 (소프트 제약).
 */
export const ENGINE_VERSION = "schedule-engine/1.0.0";

export function calculateSchedule(
  input: ScheduleEngineInput,
): ScheduleProposalResult {
  const inputHash = hashObject(input);

  // ── 1. 보존 대상 분리: cutoff 이전, 완료, 잠금 ──
  let seqCounter = 0;
  const preserved: ProposedItem[] = [];
  const mutableExisting: ScheduledItem[] = [];
  for (const item of sortItems(input.existingItems)) {
    if (item.completed || item.date < input.cutoffDate) {
      preserved.push({ ...item, reason: "PAST_PRESERVED", seq: seqCounter++ });
    } else if (item.locked) {
      preserved.push({ ...item, reason: "LOCK_PRESERVED", seq: seqCounter++ });
    } else {
      mutableExisting.push(item);
    }
  }

  // ── 2. 오버라이드 적용 후 배치 대상 노드 계산 ──
  const { orderedNodes, overrideReasons } = applyOverrides(
    input.nodes,
    input.overrides,
  );
  const completedSet = new Set(input.completedNodeIds);
  const preservedNodeIds = new Set(preserved.map((p) => p.nodeId));
  const targetNodes = orderedNodes.filter(
    (n) => !completedSet.has(n.nodeId) && !preservedNodeIds.has(n.nodeId),
  );

  // ── 3. 가용 슬롯 계산 (cutoff 이후, 지평선 안, 휴일·충돌 제외) ──
  const slots = computeAvailableSlots(input, preserved);

  // ── 4. 배치: 기존 유지 우선 → 순서대로 그리디 ──
  const existingByNode = new Map<string, ScheduledItem>();
  for (const item of mutableExisting) existingByNode.set(item.nodeId, item);

  const placed: ProposedItem[] = [];
  const conflicts: ScheduleConflict[] = [];
  const usedMinutes = new Map<IsoDate, number>();
  for (const p of preserved) {
    usedMinutes.set(p.date, (usedMinutes.get(p.date) ?? 0) + p.minutes);
  }

  /** 노드가 배치 가능한 가장 이른 날짜 — 순서 보존을 위해 앞 노드 이후만 */
  let earliestDate = input.cutoffDate;

  for (const node of targetNodes) {
    const minutes = Math.max(1, node.expectedMinutes);
    const existing = existingByNode.get(node.nodeId);

    // 4a. 기존 배치가 여전히 유효하면 유지 (변경 최소화)
    if (
      existing &&
      existing.date >= earliestDate &&
      isSlotAvailable(slots, existing.date, existing.startTime) &&
      (usedMinutes.get(existing.date) ?? 0) + minutes <=
        input.maxMinutesPerDay
    ) {
      const kept: ProposedItem = {
        ...existing,
        minutes,
        reason: "UNCHANGED",
        seq: seqCounter++,
      };
      placed.push(kept);
      usedMinutes.set(
        existing.date,
        (usedMinutes.get(existing.date) ?? 0) + minutes,
      );
      earliestDate = existing.date;
      continue;
    }

    // 4b. 새 슬롯 탐색 — 날짜·시작시간 순 결정론적 순회
    const found = findSlot(
      slots,
      earliestDate,
      minutes,
      usedMinutes,
      input.maxMinutesPerDay,
    );

    if (!found) {
      conflicts.push({
        nodeId: node.nodeId,
        code: "NO_AVAILABLE_SLOT",
        detail: `${node.title}: ${input.horizon.to}까지 배치 가능한 수업일이 없습니다.`,
      });
      continue;
    }

    const reason: ScheduleReasonCode = overrideReasons.get(node.nodeId)
      ? "INSERTED_OVERRIDE"
      : existing
        ? classifyMove(existing, found, input)
        : "NEW_NODE";

    const item: ProposedItem = {
      itemId: existing?.itemId ?? `prop-${node.nodeId}`,
      nodeId: node.nodeId,
      date: found.date,
      startTime: found.startTime,
      endTime: found.endTime,
      minutes,
      locked: false,
      completed: false,
      reason,
      seq: seqCounter++,
    };
    placed.push(item);
    usedMinutes.set(found.date, (usedMinutes.get(found.date) ?? 0) + minutes);
    earliestDate = found.date;
  }

  // ── 5. diff 계산 ──
  // 같은 날짜·슬롯 안에서는 배치 순번(seq)이 루트 진행 순서를 보존한다.
  const allItems = [...preserved, ...placed].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.seq - b.seq,
  );
  const diff = computeDiff(mutableExisting, placed, preserved);

  const summary = {
    plannedDays: new Set(allItems.map((i) => i.date)).size,
    totalMinutes: allItems.reduce((s, i) => s + i.minutes, 0),
    lastDate: allItems.length
      ? (allItems[allItems.length - 1]?.date ?? null)
      : null,
  };

  return {
    engineVersion: input.engineVersion,
    inputHash,
    outputHash: hashObject(allItems),
    items: allItems,
    diff,
    conflicts,
    reasonCodes: [...new Set(allItems.map((i) => i.reason))],
    summary,
  };
}

/* ── 내부 ──────────────────────────────────────────────────── */

interface Slot {
  date: IsoDate;
  startTime: string;
  endTime: string;
}

function sortItems<T extends ScheduledItem>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.nodeId.localeCompare(b.nodeId),
  );
}

function applyOverrides(
  nodes: readonly RouteNodeInput[],
  overrides: readonly OverrideDeltaInput[],
): {
  orderedNodes: RouteNodeInput[];
  overrideReasons: Map<string, string>;
} {
  const skip = new Set<string>();
  const overrideReasons = new Map<string, string>();
  let ordered = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder);

  // 결정론: overrideId 순으로 적용
  const sortedOverrides = [...overrides].sort((a, b) =>
    a.overrideId.localeCompare(b.overrideId),
  );

  for (const ov of sortedOverrides) {
    for (const id of ov.skipNodeIds ?? []) skip.add(id);
    if (ov.insertBefore) {
      const { anchorNodeId, nodes: inserted } = ov.insertBefore;
      for (const n of inserted) overrideReasons.set(n.nodeId, ov.overrideId);
      if (anchorNodeId === null) {
        ordered = [...inserted, ...ordered];
      } else {
        const idx = ordered.findIndex((n) => n.nodeId === anchorNodeId);
        const at = idx === -1 ? ordered.length : idx;
        ordered = [...ordered.slice(0, at), ...inserted, ...ordered.slice(at)];
      }
    }
  }

  return {
    orderedNodes: ordered.filter((n) => !skip.has(n.nodeId)),
    overrideReasons,
  };
}

function computeAvailableSlots(
  input: ScheduleEngineInput,
  preserved: readonly ScheduledItem[],
): Map<IsoDate, Slot[]> {
  const holidaySet = new Set<IsoDate>();
  for (const h of input.holidays) {
    for (const d of eachDate(h.from, h.to)) holidaySet.add(d);
  }

  const busyByDate = new Map<IsoDate, BusyInterval[]>();
  for (const b of input.busy) {
    const arr = busyByDate.get(b.date) ?? [];
    arr.push(b);
    busyByDate.set(b.date, arr);
  }
  // 보존(잠금·완료) 항목이 점유한 시간도 충돌 대상
  for (const p of preserved) {
    const arr = busyByDate.get(p.date) ?? [];
    arr.push({
      date: p.date,
      startTime: p.startTime,
      endTime: p.endTime,
      label: `보존 일정 ${p.nodeId}`,
    });
    busyByDate.set(p.date, arr);
  }

  const from =
    input.horizon.from > input.cutoffDate ? input.horizon.from : input.cutoffDate;
  const slots = new Map<IsoDate, Slot[]>();

  for (const date of eachDate(from, input.horizon.to)) {
    if (holidaySet.has(date)) continue;
    const wd = weekdayOf(date);
    const daySlots: Slot[] = [];
    for (const rule of input.lessonSlots) {
      if (rule.weekday !== wd) continue;
      if (date < rule.effectiveFrom) continue;
      if (rule.effectiveTo && date > rule.effectiveTo) continue;
      const busy = busyByDate.get(date) ?? [];
      const overlaps = busy.some(
        (b) => b.startTime < rule.endTime && rule.startTime < b.endTime,
      );
      if (overlaps) continue;
      daySlots.push({
        date,
        startTime: rule.startTime,
        endTime: rule.endTime,
      });
    }
    if (daySlots.length) {
      daySlots.sort((a, b) => a.startTime.localeCompare(b.startTime));
      slots.set(date, daySlots);
    }
  }
  return slots;
}

function isSlotAvailable(
  slots: Map<IsoDate, Slot[]>,
  date: IsoDate,
  startTime: string,
): boolean {
  return (slots.get(date) ?? []).some((s) => s.startTime === startTime);
}

function findSlot(
  slots: Map<IsoDate, Slot[]>,
  earliestDate: IsoDate,
  minutes: number,
  usedMinutes: Map<IsoDate, number>,
  maxMinutesPerDay: number,
): Slot | null {
  // Map 삽입 순서는 eachDate 순서 — 결정론적
  for (const [date, daySlots] of slots) {
    if (date < earliestDate) continue;
    if ((usedMinutes.get(date) ?? 0) + minutes > maxMinutesPerDay) continue;
    const slot = daySlots[0];
    if (slot) return slot;
  }
  return null;
}

function classifyMove(
  before: ScheduledItem,
  after: Slot,
  input: ScheduleEngineInput,
): ScheduleReasonCode {
  const holiday = input.holidays.some(
    (h) => before.date >= h.from && before.date <= h.to,
  );
  if (holiday) return "MOVED_HOLIDAY";
  const conflict = input.busy.some(
    (b) =>
      b.date === before.date &&
      b.startTime < before.endTime &&
      before.startTime < b.endTime,
  );
  if (conflict) return "MOVED_CONFLICT";
  if (before.date === after.date) return "MOVED_CAPACITY";
  return "MOVED_CASCADE";
}

function computeDiff(
  mutableExisting: readonly ScheduledItem[],
  placed: readonly ProposedItem[],
  preserved: readonly ProposedItem[],
): ScheduleDiff {
  const placedByItem = new Map(placed.map((p) => [p.itemId, p]));
  const moved: ScheduleDiff["moved"] = [];
  const removed: ScheduledItem[] = [];
  const unchanged: ProposedItem[] = [
    ...preserved.filter(
      (p) => p.reason === "PAST_PRESERVED" || p.reason === "LOCK_PRESERVED",
    ),
  ];

  for (const before of mutableExisting) {
    const after = placedByItem.get(before.itemId);
    if (!after) {
      removed.push(before);
    } else if (
      after.date !== before.date ||
      after.startTime !== before.startTime
    ) {
      moved.push({ before, after });
    } else {
      unchanged.push(after);
    }
  }

  const existingIds = new Set(mutableExisting.map((i) => i.itemId));
  const added = placed.filter((p) => !existingIds.has(p.itemId));

  return { added, moved, removed, unchanged };
}
