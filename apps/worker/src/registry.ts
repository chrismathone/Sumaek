import type { ClaimedJob } from "@su-maek/db";
import {
  handleLearnerScheduleMaterialize,
  handleNotificationDispatch,
  handleScheduleRecalculate,
  makeInboxNoop,
} from "./handlers/schedule";
import { handleRightsImpact } from "./handlers/content";

/* ─────────────────────────────────────────────────────────────
 * 토픽 → 핸들러 레지스트리.
 *
 * main.ts에서 떼어냈다. 프로세스 진입점 안에 있으면 테스트가 배선을 확인할
 * 방법이 소스 문자열 검색뿐이었고(실제로 그렇게 하고 있었다), 루프를 한
 * 프로세스에서 돌려 보는 것도 불가능했다.
 *
 * 등록되지 않은 토픽의 작업은 클레임되지 않는다 — 유실은 아니지만 **아무도
 * 하지 않는다**. 그래서 EVENT_CONSUMERS(queue.ts)와 이 표는 반드시 짝이어야
 * 하고, test/wiring/event-wiring.test.ts가 그 짝을 정적으로 검사한다.
 * ───────────────────────────────────────────────────────────── */

export type JobHandler = (job: ClaimedJob) => Promise<unknown>;

export function createHandlerRegistry(): Map<string, JobHandler> {
  const handlers = new Map<string, JobHandler>();

  handlers.set("schedule.recalculate", handleScheduleRecalculate);
  handlers.set("schedule.materialize", handleScheduleRecalculate);
  /* EVENT_CONSUMERS.LearnerRouteOverrideChanged의 짝 (queue.ts).
   * 이 등록을 지우면 디스패처가 작업 0건을 만들고도 outbox를 delivered로
   * 표시해 이벤트가 영구 유실된다 — 소비자 등록과 반드시 함께 움직인다. */
  handlers.set("schedule.materialize-learner", handleLearnerScheduleMaterialize);
  handlers.set("notification.dispatch", handleNotificationDispatch);
  handlers.set("content.rights-impact", handleRightsImpact);
  // 인라인으로 파생이 이미 갱신된 이벤트 — 소비 확인만
  handlers.set("mastery.update", makeInboxNoop("mastery.update"));
  handlers.set("review.plan", makeInboxNoop("review.plan"));
  handlers.set("grading.auto", makeInboxNoop("grading.auto"));
  handlers.set("readmodel.refresh", makeInboxNoop("readmodel.refresh"));

  return handlers;
}

/**
 * kill switch 표(KILL_SWITCH_TOPICS)에는 이름이 있는데 **핸들러가 없는** 토픽.
 *
 * 이름만 있으면 "끄면 멈추는 무언가가 돌고 있다"고 읽힌다. 실제로는 그 토픽의
 * 작업을 만드는 곳도, 처리하는 곳도 없다. 지우는 대신 여기 적어 두는 이유는
 * 스위치·런북·화면이 이미 그 키를 쓰고 있고, 구현이 붙을 자리가 어디인지
 * 드러내는 편이 낫기 때문이다. 구현되면 여기서 지우고 위에 등록한다.
 */
export const TOPICS_WITHOUT_HANDLER: Readonly<Record<string, string>> = {
  "export.pdf":
    "렌더러(src/export/pdf-renderer.ts)는 있으나 작업 발행·소비 배선이 없다 — document_export 스위치는 지금 아무것도 멈추지 않는다",
  "export.hwpx": "HWPX 출력 미구현 — 렌더러 자체가 없다",
};
