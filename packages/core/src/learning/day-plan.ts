import type { IsoDate } from "../shared/dates";

/* ─────────────────────────────────────────────────────────────
 * 하루 계획 상태 머신 — ADR-0017의 §2·§3을 그대로 옮긴 것.
 *
 * 이 모듈은 **문구를 만들지 않는다.** 상태와 수치만 낸다. 화면 문구를
 * 여기 섞으면 교사 미리보기(T5.4)와 학생 화면이 같은 판정을 쓰면서도
 * 서로 다른 말을 하게 된다 — 그래서 판정과 표현을 갈라 둔다.
 *
 * 세 가지가 이 파일의 존재 이유다.
 *   ① 오늘 것만 분모에 든다. 예전 판정은 최근 90일 배정을 전부 긁어
 *      와서, 두 달 전에 끝낸 테스트로 오늘을 완주로 읽었다.
 *   ② 차단이 완료보다 먼저 걸린다. 필수 하나가 막혀 있으면 나머지를
 *      다 해도 완료가 아니다.
 *   ③ 차단과 면제는 다른 것이다. 차단은 고쳐야 할 사고고 면제는 교사의
 *      판단이다. 합치면 자료를 안 올린 사고가 「면제됨」으로 위장된다.
 * ───────────────────────────────────────────────────────────── */

/** 항목 종류 — 노드 실행기(T2.2)가 노드를 이 종류로 펼친다. */
export type DayPlanItemKind =
  | "reading"
  | "video"
  | "practice"
  | "assessment"
  | "review"
  | "book_range"
  | "homework";

/**
 * 항목 상태 (ADR-0017 §2).
 *
 * `blocked`와 `exempted`를 한 값으로 합치지 않는다 — 위 ③.
 */
export type DayPlanItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "exempted";

/**
 * 하루 상태 (ADR-0017 §3).
 *
 * 교사 현황판(T4.4)의 「완료 / 진행 / 막힘 / 미시작」과 그대로 대응하고,
 * `empty`는 수업이 없는 날이다.
 */
export type DayPlanStatus =
  | "empty"
  | "not_started"
  | "in_progress"
  | "blocked"
  | "completed";

export interface DayPlanItemInput {
  /** 항목 식별자. 투영기에서는 `kind:refId` 꼴을 쓴다 (재투영 멱등 키와 같은 모양). */
  key: string;
  kind: DayPlanItemKind;
  required: boolean;
  status: DayPlanItemStatus;
  /**
   * 배정 날짜. 자료·숙제처럼 날짜가 붙지 않는 항목은 `null`이며 오늘 것으로 본다.
   * 평가·복습은 날짜를 가진다.
   */
  scheduledDate?: IsoDate | null;
  /** `status === "blocked"`일 때의 사유 코드. 준비도 게이트와 같은 레지스트리(T2.4). */
  blockedReason?: string | null;
  /** 화면 표시 순서. 없으면 `key` 사전순으로 안정 정렬한다. */
  ordinal?: number | null;
}

export interface DayPlanItem extends DayPlanItemInput {
  scheduledDate: IsoDate | null;
  blockedReason: string | null;
  ordinal: number | null;
}

export interface RequiredTally {
  /** 오늘의 필수 항목 수 */
  total: number;
  completed: number;
  exempted: number;
  blocked: number;
  /** `completed + exempted` — 완료 판정이 보는 값 */
  satisfied: number;
  /** `total - satisfied` */
  remaining: number;
}

export interface DayPlan {
  planDate: IsoDate;
  status: DayPlanStatus;
  /** 오늘 해야 하는 항목 */
  items: DayPlanItem[];
  /** 미래 배정 — 「예정」으로만 보이고 분모에 들지 않는다 */
  deferred: DayPlanItem[];
  /** 기한이 지난 미완료 — 「밀린 것」. 복습은 여기 오지 않는다 (ADR-0017 §5) */
  overdue: DayPlanItem[];
  required: RequiredTally;
  /** 오늘 항목의 차단 사유. 중복 없이 사전순 */
  blockedReasons: string[];
}

/** 차단이면서 사유가 비어 있을 때 쓰는 값 — 사유 없음을 조용히 삼키지 않는다. */
const UNKNOWN_BLOCK_REASON = "unknown";

function normalize(input: DayPlanItemInput): DayPlanItem {
  return {
    ...input,
    scheduledDate: input.scheduledDate ?? null,
    blockedReason: input.blockedReason ?? null,
    ordinal: input.ordinal ?? null,
  };
}

/** `ordinal` 우선, 없으면 `key` 사전순. 정렬 없는 조회 결과가 들어와도 결과가 같다. */
function byDisplayOrder(a: DayPlanItem, b: DayPlanItem): number {
  const ao = a.ordinal ?? Number.POSITIVE_INFINITY;
  const bo = b.ordinal ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function isSettled(status: DayPlanItemStatus): boolean {
  return status === "completed" || status === "exempted";
}

/**
 * 항목을 오늘·예정·밀림으로 가른다.
 *
 * 과거의 **끝난** 항목은 셋 중 어디에도 넣지 않는다 — 오늘과 무관하고,
 * 지난 기록은 `/learn/records`가 따로 낸다. 이 한 줄이 G-01의 수정이다.
 */
function scope(
  item: DayPlanItem,
  planDate: IsoDate,
): "today" | "deferred" | "overdue" | "drop" {
  const on = item.scheduledDate;
  if (on === null) return "today";
  if (on > planDate) return "deferred";
  if (on === planDate) return "today";

  /* 여기부터 과거. 복습만 예외로 오늘에 든다 — 복습은 성질상 「밀린 것」이
   * 곧 「지금 할 것」이고, 여기서 빼면 그 개념은 영영 돌아오지 않는다. */
  if (item.kind === "review") return "today";
  return isSettled(item.status) ? "drop" : "overdue";
}

/**
 * 하루 상태 판정. **판정 순서가 곧 우선순위다** (ADR-0017 §3).
 *
 * 필수가 하나도 없는 날(선택 항목만 있는 날)은 `completed`로 넘어가지
 * 않는다 — 아무것도 안 해도 완주로 읽히면 완료 표시의 뜻이 사라진다.
 */
export function decideDayStatus(
  items: readonly Pick<DayPlanItem, "required" | "status">[],
): DayPlanStatus {
  if (items.length === 0) return "empty";

  const required = items.filter((i) => i.required);
  if (required.some((i) => i.status === "blocked")) return "blocked";
  if (required.length > 0 && required.every((i) => isSettled(i.status))) {
    return "completed";
  }
  if (items.some((i) => i.status === "completed" || i.status === "in_progress")) {
    return "in_progress";
  }
  return "not_started";
}

/** 오늘 필수 항목의 집계 — 완료 판정과 E-16 payload가 같은 값을 쓴다. */
export function tallyRequired(items: readonly DayPlanItem[]): RequiredTally {
  const required = items.filter((i) => i.required);
  const completed = required.filter((i) => i.status === "completed").length;
  const exempted = required.filter((i) => i.status === "exempted").length;
  const blocked = required.filter((i) => i.status === "blocked").length;
  const satisfied = completed + exempted;

  return {
    total: required.length,
    completed,
    exempted,
    blocked,
    satisfied,
    remaining: required.length - satisfied,
  };
}

/**
 * 항목 목록을 하루 계획으로 만든다.
 *
 * 입력 배열을 변형하지 않고, 같은 입력이면 항상 같은 결과를 낸다
 * (`packages/core`의 순수성 규약 — I-12 계열).
 */
export function buildDayPlan(input: {
  planDate: IsoDate;
  items: readonly DayPlanItemInput[];
}): DayPlan {
  const today: DayPlanItem[] = [];
  const deferred: DayPlanItem[] = [];
  const overdue: DayPlanItem[] = [];

  for (const raw of input.items) {
    const item = normalize(raw);
    switch (scope(item, input.planDate)) {
      case "today":
        today.push(item);
        break;
      case "deferred":
        deferred.push(item);
        break;
      case "overdue":
        overdue.push(item);
        break;
      case "drop":
        break;
    }
  }

  today.sort(byDisplayOrder);
  deferred.sort(byDisplayOrder);
  overdue.sort(byDisplayOrder);

  /* 차단 사유는 오늘 항목에서만 모은다. 선택 항목의 차단도 완주를 막지는
   * 않지만 학생·교사에게는 보여야 하므로 여기 들어온다. */
  const reasons = new Set<string>();
  for (const item of today) {
    if (item.status === "blocked") {
      reasons.add(item.blockedReason ?? UNKNOWN_BLOCK_REASON);
    }
  }

  return {
    planDate: input.planDate,
    status: decideDayStatus(today),
    items: today,
    deferred,
    overdue,
    required: tallyRequired(today),
    blockedReasons: [...reasons].sort(),
  };
}

/**
 * 하루를 완료로 전이해도 되는가.
 *
 * DB의 CAS 전이(T4.1)가 이 함수를 먼저 통과시킨다. 완료 판정과 전이 허용을
 * 같은 규칙으로 묶어 두면 화면·서버·워커가 갈라지지 않는다.
 */
export function canCompleteDay(plan: DayPlan): boolean {
  return plan.status === "completed";
}
