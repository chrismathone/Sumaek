import type { IsoDate } from "../shared/dates";

/* ─────────────────────────────────────────────────────────────
 * 결정론적 일정 엔진 타입 (골프롬프트 2H)
 * 입력은 불변 스냅샷 — 엔진은 현재 시각·비정렬 조회·비고정 난수를 쓰지 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface RouteNodeInput {
  nodeId: string;
  kind: string; // route_node_kind
  title: string;
  sortOrder: number;
  /** 예상 소요 분 — 학습량 상한 계산의 단위 */
  expectedMinutes: number;
  /** 체크포인트 게이트 (확인테스트) 여부 */
  isCheckpoint?: boolean;
}

/** 학생 오버라이드가 적용된 차이 (학습자 스코프 계산에서만 사용) */
export interface OverrideDeltaInput {
  overrideId: string;
  kind: string;
  /** 건너뛸 노드 */
  skipNodeIds?: string[];
  /** 삽입할 보충 노드 (기준 노드 앞에) */
  insertBefore?: { anchorNodeId: string | null; nodes: RouteNodeInput[] };
  /** 재합류 지점 — 이 노드부터 반 공통 경로 복귀 */
  rejoinNodeId?: string;
}

export interface LessonSlotRule {
  /** 0=일 … 6=토 */
  weekday: number;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
}

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface BusyInterval {
  date: IsoDate;
  startTime: string;
  endTime: string;
  /** 충돌 리포트용 라벨 */
  label: string;
}

/** 기존 활성 일정의 항목 — 변경 최소화(소프트 제약)의 기준 */
export interface ScheduledItem {
  itemId: string;
  nodeId: string;
  date: IsoDate;
  startTime: string;
  endTime: string;
  minutes: number;
  locked: boolean;
  completed: boolean;
}

export interface ScheduleEngineInput {
  engineVersion: string;
  seed: string;
  timezone: string;
  scope: { type: "learning_group" | "learner"; id: string };
  /** 완료 진도 기준 시각 — 이 날짜 이전 일정은 절대 변경하지 않는다 */
  cutoffDate: IsoDate;
  horizon: DateRange;
  routeVersionId: string;
  nodes: RouteNodeInput[];
  overrides: OverrideDeltaInput[];
  lessonSlots: LessonSlotRule[];
  holidays: DateRange[];
  /** 교사·학습 그룹·학생의 다른 일정 (하드 충돌) */
  busy: BusyInterval[];
  existingItems: ScheduledItem[];
  completedNodeIds: string[];
  /** 하루 학습량 상한 (분) */
  maxMinutesPerDay: number;
  /** 정책·달력 버전 기록 (해시 입력) */
  inputVersions: Record<string, string | number>;
}

export type ScheduleReasonCode =
  | "UNCHANGED" // 기존 배치 유지
  | "NEW_NODE" // 새 노드 배치
  | "MOVED_HOLIDAY" // 휴일 회피 이동
  | "MOVED_CONFLICT" // 시간 충돌 회피
  | "MOVED_CAPACITY" // 하루 학습량 초과 회피
  | "MOVED_CASCADE" // 앞 노드 이동의 연쇄
  | "SKIPPED_OVERRIDE" // 오버라이드로 건너뜀
  | "INSERTED_OVERRIDE" // 오버라이드 보충 삽입
  | "PAST_PRESERVED" // cutoff 이전 보존
  | "LOCK_PRESERVED"; // 잠금 보존

export interface ProposedItem extends ScheduledItem {
  reason: ScheduleReasonCode;
  /**
   * 같은 날짜·슬롯 안에서의 루트 진행 순번.
   * 한 수업일이 여러 노드를 담을 수 있으므로(용량 내) 순서 보존의 기준이 된다.
   */
  seq: number;
}

export interface ScheduleConflict {
  nodeId: string;
  code:
    | "NO_AVAILABLE_SLOT" // 지평선 안에 배치 불가
    | "HARD_OVERLAP" // 해소 불가능한 시간 충돌
    | "CAPACITY_EXCEEDED"; // 상한 내 배치 불가
  detail: string;
}

export interface ScheduleDiff {
  added: ProposedItem[];
  moved: Array<{ before: ScheduledItem; after: ProposedItem }>;
  removed: ScheduledItem[];
  unchanged: ProposedItem[];
}

export interface ScheduleProposalResult {
  engineVersion: string;
  inputHash: string;
  outputHash: string;
  items: ProposedItem[];
  diff: ScheduleDiff;
  conflicts: ScheduleConflict[];
  reasonCodes: ScheduleReasonCode[];
  /** 계산에 사용된 요약 (승인 화면 표시용) */
  summary: {
    plannedDays: number;
    totalMinutes: number;
    lastDate: IsoDate | null;
  };
}
