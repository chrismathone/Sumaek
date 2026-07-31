import { describe, expect, it } from "vitest";
import {
  KILL_SWITCH_TOPICS,
  deferSignal,
  filterTopicsBySwitches,
  isDeferSignal,
} from "../src/kill-switch";

/* Kill switch 집행의 순수 부분 (인수 40) — 토픽 게이트와 연기 신호.
 * DB 왕복 부분(isFeatureEnabled)은 워커 스모크·E2E가 덮는다. */

const ALL_TOPICS = [
  "schedule.recalculate",
  "schedule.materialize",
  "grading.auto",
  "notification.dispatch",
  "mastery.update",
];

describe("filterTopicsBySwitches", () => {
  it("중지된 스위치가 없으면 토픽을 그대로 반환한다", () => {
    expect(filterTopicsBySwitches(ALL_TOPICS, new Set())).toEqual(ALL_TOPICS);
  });

  it("auto_reschedule 중지는 일정 토픽만 제외한다 — 알림·숙련도는 계속", () => {
    const result = filterTopicsBySwitches(
      ALL_TOPICS,
      new Set(["auto_reschedule"]),
    );
    expect(result).toEqual([
      "grading.auto",
      "notification.dispatch",
      "mastery.update",
    ]);
  });

  it("스위치 여러 개가 각자 독립적으로 토픽을 제외한다 (28장 — 독립 차단)", () => {
    const result = filterTopicsBySwitches(
      ALL_TOPICS,
      new Set(["auto_reschedule", "auto_grading"]),
    );
    expect(result).toEqual(["notification.dispatch", "mastery.update"]);
  });

  it("매핑에 없는 스위치 키는 아무 토픽도 막지 않는다", () => {
    expect(
      filterTopicsBySwitches(ALL_TOPICS, new Set(["formula_autofix"])),
    ).toEqual(ALL_TOPICS);
  });

  it("앱 내 알림은 어떤 스위치에도 매이지 않는다 — 업무함은 항상 동작 (22장)", () => {
    const allKeys = new Set(Object.keys(KILL_SWITCH_TOPICS));
    const result = filterTopicsBySwitches(ALL_TOPICS, allKeys);
    expect(result).toContain("notification.dispatch");
  });
});

describe("deferSignal", () => {
  it("연기 신호를 만들고 판별한다", () => {
    const signal = deferSignal("kill switch: auto_reschedule 중지");
    expect(isDeferSignal(signal)).toBe(true);
    expect(signal.reason).toContain("auto_reschedule");
  });

  it("일반 핸들러 결과는 연기 신호가 아니다", () => {
    expect(isDeferSignal({ ok: true })).toBe(false);
    expect(isDeferSignal(null)).toBe(false);
    expect(isDeferSignal("done")).toBe(false);
    expect(isDeferSignal({ __defer: false, reason: "x" })).toBe(false);
  });
});
