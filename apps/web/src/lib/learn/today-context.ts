import "server-only";
import {
  getTodayScope as resolveTodayScope,
  type TodayScope,
} from "@/lib/domain/day-plan";
import type { IsoDate } from "@su-maek/core/shared";
import type { CurrentLearner } from "@/lib/auth/current-learner";

/* 오늘의 학습 범위 — 여러 학생 화면이 같은 방식으로 "오늘 배우는 개념"을
 * 찾아야 해서 한 곳에 둔다. 각 화면이 따로 구하면 화면마다 범위가 갈린다.
 *
 * 개별 일정(learner_schedule_items)을 먼저 보고 없을 때만 반 공통(sessions)으로
 * 물러선다 — 보충·재합류로 반과 달라진 학생에게 반 공통 개념을 보여 주면
 * 오늘 배우지도 않는 자료가 나온다.
 *
 * 실제 구현은 lib/domain/day-plan.ts 하나뿐이다. 여기는 화면이 이미 들고
 * 있는 CurrentLearner를 그대로 넘길 수 있게 하는 얇은 어댑터다 — 예전에는
 * 이 파일이 같은 질의를 한 벌 더 갖고 있었고, 그 사본이 오늘 화면의 것과
 * 갈라질 자리였다. 지금은 오늘 화면·공부·인강·연습이 같은 함수를 부른다. */
export type { TodayScope };

export async function getTodayScope(
  learner: CurrentLearner,
  today: string,
): Promise<TodayScope> {
  return resolveTodayScope(
    {
      organizationId: learner.user.organizationId,
      learnerId: learner.learnerId,
    },
    today as IsoDate,
  );
}
