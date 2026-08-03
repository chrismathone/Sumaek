/* ─────────────────────────────────────────────────────────────
 * 학생 「오늘 학습」의 단계 판정 — 화면에서 떼어 낸 순수 함수.
 *
 * 화면 안에 두면 확인할 방법이 실제 데이터를 만드는 것밖에 없다. 그런데
 * 여기서 틀리면 조용히 틀린다 — 특히 「배정이 아무것도 없는 날」과
 * 「할 일이 있었고 다 마친 날」의 혼동은 화면에 오류가 아니라 **격려**로
 * 나타나서, 눈으로 봐서는 잘 돌아가는 것처럼 보인다. 예전 판정이 정확히
 * 그랬다: activeStep === null 하나로 둘을 묶어, 자료도 테스트도 복습도
 * 없는 날 아무것도 하지 않은 학생에게 「오늘 할 일을 모두 마쳤습니다」를
 * 띄웠다. 그래서 판정만 따로 꺼내 테스트로 못 박는다.
 * ───────────────────────────────────────────────────────────── */

/** 그 단계에 무엇이 있는가 */
export type StepState = "todo" | "done" | "none";
/** 궤도에서 어디인가 — StepState와 축이 다르다 */
export type OrbitState = "past" | "here" | "ahead" | "empty";

/** 활성 단계가 될 수 있는 단계 — 1단계(오늘 배울 것)는 학생이 할 일이 아니다 */
export type ActionKey = "reading" | "video" | "practice" | "test" | "review";

/** 배우는 순서 그대로 — 앞 단계가 남아 있으면 그것이 먼저다 */
export const ACTION_ORDER: readonly ActionKey[] = [
  "reading",
  "video",
  "practice",
  "test",
  "review",
];

export type DayVerdict =
  /** 지금 할 차례가 있다 */
  | "active"
  /** 할 일이 있었고 전부 마쳤다 */
  | "finished"
  /** 수업은 있는데 배정된 자료·테스트·복습이 없다 */
  | "sessionOnly"
  /** 오늘 배정된 것이 아무것도 없다 */
  | "empty";

export interface DayInput extends Record<ActionKey, StepState> {
  hasSession: boolean;
}

export interface DayReading {
  active: ActionKey | null;
  verdict: DayVerdict;
}

/**
 * 오늘이 어떤 날인지 한 번에 정한다.
 *
 * 「할 차례」는 언제나 **하나**다. 그리고 활성 단계가 없다는 사실 하나만으로
 * 완주를 선언하지 않는다 — 할 일이 하나라도 있었는지(`none`이 아닌 단계가
 * 있었는지)를 함께 본다.
 */
export function readDay(day: DayInput): DayReading {
  const active = ACTION_ORDER.find((k) => day[k] === "todo") ?? null;
  if (active) return { active, verdict: "active" };
  const hadWork = ACTION_ORDER.some((k) => day[k] !== "none");
  if (hadWork) return { active: null, verdict: "finished" };
  return { active: null, verdict: day.hasSession ? "sessionOnly" : "empty" };
}

/**
 * 궤도 노드의 모양.
 *
 * 노드는 **사실**(그 단계를 마쳤나)을 말한다. 지금 서 있는 자리만 예외로
 * `here`가 되고, 아무것도 없는 단계는 마쳤다고 하지 않는다.
 */
export function orbitOf(
  state: StepState,
  index: number,
  hereIndex: number,
): OrbitState {
  if (state === "none") return "empty";
  if (index === hereIndex) return "here";
  return state === "done" ? "past" : "ahead";
}

/**
 * 이 정거장 아래 구간을 실선으로 그릴지.
 *
 * 선은 **위치**(어디까지 왔나)를 말한다 — 노드 상태로 그리면 뒤 단계를
 * 먼저 마친 학생에게 지나오지 않은 길이 실선으로 그려져 궤도가 거짓말한다.
 */
export function solidBelow(
  index: number,
  hereIndex: number,
  finished: boolean,
): boolean {
  if (finished) return true;
  if (hereIndex === -1) return false;
  return index < hereIndex;
}
