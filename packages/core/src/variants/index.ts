/**
 * 문항 변형 — 원본의 숫자를 바꿔 연습 문항을 늘린다.
 *
 * **정답의 권한은 코드에 있다.** AI는 "이 문항이 어느 템플릿인가"를 고르고
 * 만들어진 문항의 문장이 자연스러운지 보는 일만 한다. 답은 solve()가 낸다.
 *
 * 풀이기를 믿는 근거: 원본 숫자를 넣었을 때 **교재에 인쇄된 답이 그대로
 * 나오는가**(원본 재현 검사). 정답 별책이 있으므로 전수로 확인할 수 있다.
 */
export * from "./arithmetic";
export * from "./types";
export * from "./templates";
export * from "./templates-drill";

import { RPM_M1_CH1_TEMPLATES } from "./templates";
import { RPM_M1_CH1_DRILL_TEMPLATES } from "./templates-drill";
import type { VariantTemplate } from "./types";

/**
 * RPM 중1-1 1단원 템플릿 전체.
 *
 * **순서가 규칙이다** — 앞엣것이 먼저 문항을 문다. 좁은 템플릿을 앞에 둔다.
 * 「소인수분해 하고 소인수를 모두 구하시오」는 「소인수분해하시오」이기도
 * 하므로, 뒤에 두면 넓은 쪽이 먼저 물어 답이 모자라게 나온다.
 */
/* 템플릿마다 파라미터 타입이 다르고, 목록을 훑는 쪽은 그것을 **열어 보지
 * 않는다** — parse가 낸 것을 그대로 solve에 넘길 뿐이다. 그래서 목록에서는
 * 파라미터를 불투명하게 둔다. */
export const RPM_M1_CH1_ALL_TEMPLATES = [
  ...RPM_M1_CH1_DRILL_TEMPLATES,
  ...RPM_M1_CH1_TEMPLATES,
] as unknown as readonly VariantTemplate<unknown>[];
