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

/**
 * 그 단계에 무엇이 있는가.
 *
 * `upcoming`은 **있지만 오늘 것이 아니다** — 아직 열리지 않은 예정 테스트가
 * 여기 산다. 예전에는 이 상태가 없어서 예정 테스트가 `none`으로 접혔고,
 * 화면이 「배정된 테스트가 없습니다」라고 말한 바로 아래에 그 테스트를
 * 목록으로 냈다. 한 화면이 두 줄 사이에서 자기와 모순됐다.
 *
 * `todo`와는 반드시 갈라야 한다: 예정 테스트는 학생이 지금 할 수 있는 일이
 * 아니므로 「할 차례」가 될 수 없고(readDay), 오늘의 완주 판정에도 들어가면
 * 안 된다 — 들어가면 아무것도 배정되지 않은 날 예정 하나로 완주 축하가 뜬다.
 */
export type StepState = "todo" | "done" | "upcoming" | "none";
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
  /* 「할 일이 있었나」는 **오늘 할 수 있었던 것**만 센다. `!== "none"`으로
   * 쓰면 예정 테스트 하나가 오늘 몫으로 딸려 들어가, 아무것도 배정되지 않은
   * 날 아무것도 하지 않은 학생에게 「오늘 할 일을 모두 마쳤습니다」가 뜬다 —
   * 이 파일이 생긴 이유였던 그 거짓 축하가 새 상태를 타고 되돌아온다. */
  const hadWork = ACTION_ORDER.some(
    (k) => day[k] === "todo" || day[k] === "done",
  );
  if (hadWork) return { active: null, verdict: "finished" };
  return { active: null, verdict: day.hasSession ? "sessionOnly" : "empty" };
}

/**
 * 궤도 노드의 모양.
 *
 * 노드는 **사실**(그 단계를 마쳤나)을 말한다. 지금 서 있는 자리만 예외로
 * `here`가 되고, 아무것도 없는 단계는 마쳤다고 하지 않는다.
 *
 * `upcoming`은 `ahead`로 떨어진다 — 마치지 않았으니 `past`가 아니고, 비어
 * 있지도 않으니 `empty`도 아니다. 「앞으로 올 길」이 정확히 그 뜻이다.
 * (`here`가 될 일은 없다: readDay가 `todo`만 활성으로 고르므로 `hereIndex`가
 * 예정 단계를 가리키지 못한다.)
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
 * 접힌 줄의 배지 라벨.
 *
 * **「할 차례」를 여기 쓰지 않는다.** 배지는 구조상 활성이 **아닌** 단계에만
 * 렌더되므로(page.tsx의 `!active` 분기), 배지가 「할 차례」라고 말하면 화면에
 * 뜨는 모든 「할 차례」가 할 차례 아닌 단계의 것이 된다. 실제로 그랬다:
 * 좌표 줄이 「현재 위치 2 / 6」, 히어로가 「지금 할 차례 · 2단계」라고 말하는
 * 옆에서 3단계와 6단계가 나란히 「할 차례 N건」을 달고 있었다 — 「한 번에 한
 * 단계만 할 차례다」가 가장 잘 보이는 자리에서 깨져 있던 셈이다.
 *
 * 「할 차례」는 히어로 캡션 바가 독점한다. 배지는 **남은 양**만 말한다.
 * 건수는 그대로 둔다 — 성량을 낮추는 것과 사실을 지우는 것은 다르다.
 *
 * `count`는 그 상태에 해당하는 수다(`todo`면 남은 수, `upcoming`이면 예정 수).
 * `done`·`none`은 세지 않는다.
 */
export function badgeLabel(state: StepState, count: number): string {
  if (state === "todo") return `남은 ${count}건`;
  if (state === "done") return "완료";
  if (state === "upcoming") return `예정 ${count}건`;
  return "없음";
}

/**
 * 자료가 걸친 개념 — 히어로 카드의 머리글.
 *
 * 예전에는 첫 자료의 개념명 하나였다. 오늘 자료가 「소수와 합성수」·
 * 「거듭제곱」·「소인수분해」 셋에 걸쳐 있어도 머리글은 첫 개념만 달았으니,
 * 카드 전체를 그 개념 하나로 잘못 이름 붙인 셈이다.
 *
 * 첫 개념은 그대로 이름으로 부르고(학생이 실제로 먼저 읽을 것이다) 나머지가
 * 있다는 사실만 숨기지 않는다 — 이름을 전부 늘어놓으면 머리글이 목록이 된다.
 * 같은 개념이 여러 자료에 걸쳐도 한 번만 센다.
 */
export function conceptSpan(names: readonly string[]): string | null {
  const unique = [...new Set(names)];
  const first = unique[0];
  if (first === undefined) return null;
  return unique.length === 1 ? first : `${first} 외 개념 ${unique.length - 1}개`;
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
