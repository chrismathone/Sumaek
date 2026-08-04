import { describe, expect, it } from "vitest";
import {
  EVENT_CONSUMERS,
  EVENT_WITHOUT_CONSUMER,
  KILL_SWITCH_TOPICS,
} from "@su-maek/db";
import {
  createHandlerRegistry,
  TOPICS_WITHOUT_EVENT,
  TOPICS_WITHOUT_HANDLER,
} from "../../src/registry";

/* ─────────────────────────────────────────────────────────────
 * 배선의 짝 — DB 없이도 도는 회귀 검사.
 *
 * 이벤트가 학생에게 닿기까지 세 표가 맞물려야 한다:
 *   EVENT_CONSUMERS(queue.ts) → 핸들러 레지스트리(registry.ts) → kill switch 표
 * 한쪽만 있으면 조용히 아무 일도 일어나지 않는다. 화면은 "자동 처리됨"이라
 * 믿는데 실제로는 작업이 큐에 쌓이기만 하거나, 이벤트가 소비자 없이
 * delivered가 된다.
 *
 * 예전에는 이 검사를 main.ts 소스 문자열 검색으로 했다. 레지스트리를 모듈로
 * 떼어냈으니 실제 객체를 본다 — 주석에 register라고 써 있기만 해도 통과하던
 * 구멍이 사라진다.
 * ───────────────────────────────────────────────────────────── */

const handlers = createHandlerRegistry();
const routedTopics = [...new Set(Object.values(EVENT_CONSUMERS).flat())].sort();

describe("이벤트 소비자 배선", () => {
  it("라우팅표의 모든 토픽에 핸들러가 등록되어 있다", () => {
    /* 등록되지 않은 토픽의 작업은 클레임되지 않는다 — 유실은 아니지만
     * **아무도 하지 않는다**. 예전에는 assessment.exclude-question과
     * curriculum.impact-analysis 둘이 그 상태로 남아 있었다(둘 다 발행부 0건).
     * 지금은 라우팅표에서 뺐다 — 근거는 queue.ts 주석. */
    const unregistered = routedTopics.filter((topic) => !handlers.has(topic));
    expect(unregistered).toEqual([]);
  });

  it("등록된 핸들러에는 전부 자기를 부르는 이벤트나 생산자가 있다", () => {
    /* 반대 방향의 결손 — 아무 이벤트도 라우팅하지 않는 토픽은 죽은 코드거나
     * 라우팅을 빠뜨린 것이다. 어느 쪽인지 사람이 판단해야 한다.
     *
     * 예외는 **생산자가 직접 만드는** 토픽뿐이다(assessment.generate —
     * 생성 요청은 이벤트가 아니라 작업이다, ADR-0018 §4). 그 예외는
     * TOPICS_WITHOUT_EVENT에 이유와 함께 적히고, 여기서는 목록과 **정확히
     * 일치**하는지 본다 — 무조건 통과시키면 규칙 자체가 무의미해진다. */
    const orphanHandlers = [...handlers.keys()]
      .filter((topic) => !routedTopics.includes(topic))
      .sort();
    expect(orphanHandlers).toEqual(Object.keys(TOPICS_WITHOUT_EVENT).sort());
  });

  it("이벤트 없는 토픽에는 전부 그 이유가 적혀 있다", () => {
    for (const [topic, reason] of Object.entries(TOPICS_WITHOUT_EVENT)) {
      // 핸들러는 있어야 한다 — 없으면 그냥 죽은 이름이다
      expect(handlers.has(topic)).toBe(true);
      expect(EVENT_CONSUMERS[topic] ?? []).toEqual([]);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("학습자 오버라이드 변경은 학습자 실체화 토픽으로만 라우팅된다 (인수 4)", () => {
    expect(EVENT_CONSUMERS.LearnerRouteOverrideChanged).toEqual([
      "schedule.materialize-learner",
    ]);
    // 반 공통 실체화를 부르지 않는다 — 학생 오버라이드는 반을 바꾸지 않는다
    expect(EVENT_CONSUMERS.LearnerRouteOverrideChanged).not.toContain(
      "schedule.materialize",
    );
    expect(handlers.has("schedule.materialize-learner")).toBe(true);
  });

  it("소비자를 두지 않기로 선언한 이벤트는 라우팅 토픽이 0건이다", () => {
    for (const eventType of Object.keys(EVENT_WITHOUT_CONSUMER)) {
      expect(EVENT_CONSUMERS[eventType] ?? []).toEqual([]);
    }
  });
});

describe("kill switch 표와 핸들러", () => {
  it("스위치가 가리키는 토픽 중 핸들러가 없는 것은 알려진 목록과 정확히 일치한다", () => {
    /* KILL_SWITCH_TOPICS에 이름만 있고 핸들러가 없으면 "끄면 멈추는 무언가가
     * 돌고 있다"고 읽힌다. 실제로는 export.pdf·export.hwpx가 그 상태다 —
     * 렌더러(src/export/pdf-renderer.ts)는 있지만 어떤 토픽에도 배선돼 있지
     * 않고, 그 토픽의 작업을 만드는 곳도 없다. 지우는 대신 드러낸다.
     * 새 결손이 늘면 여기서 걸린다. */
    const switchTopics = [
      ...new Set(Object.values(KILL_SWITCH_TOPICS).flat()),
    ].sort();
    const missing = switchTopics.filter((topic) => !handlers.has(topic));
    expect(missing).toEqual(Object.keys(TOPICS_WITHOUT_HANDLER).sort());
  });

  it("핸들러 없는 토픽에는 전부 그 이유가 적혀 있다", () => {
    for (const [topic, reason] of Object.entries(TOPICS_WITHOUT_HANDLER)) {
      expect(handlers.has(topic)).toBe(false);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("자동 일정 재계산 스위치는 반·학습자 일정 토픽을 모두 덮는다 (인수 40)", () => {
    expect([...(KILL_SWITCH_TOPICS.auto_reschedule ?? [])].sort()).toEqual([
      "schedule.materialize",
      "schedule.materialize-learner",
      "schedule.recalculate",
    ]);
  });
});
