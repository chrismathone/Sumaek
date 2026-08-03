import { describe, expect, it } from "vitest";
import {
  ACTION_ORDER,
  orbitOf,
  readDay,
  solidBelow,
  type DayInput,
  type StepState,
} from "@/lib/learn/today-steps";

/* ─────────────────────────────────────────────────────────────
 * 학생 「오늘 학습」 단계 판정 회귀 검사.
 *
 * 이 판정이 틀리면 화면에 오류가 아니라 **격려**로 나타난다 — 아무것도
 * 배정되지 않은 날 「오늘 할 일을 모두 마쳤습니다」가 뜨는 식이라, 눈으로
 * 봐서는 정상으로 보인다. 실제로 예전 화면이 그랬다(activeStep === null
 * 하나로 완주와 빈 날을 묶었다). 그래서 여기서 못 박는다.
 * ───────────────────────────────────────────────────────────── */

const day = (over: Partial<DayInput> = {}): DayInput => ({
  hasSession: true,
  reading: "none",
  video: "none",
  practice: "none",
  test: "none",
  review: "none",
  ...over,
});

describe("오늘의 판정 (readDay)", () => {
  it("할 차례는 언제나 하나 — 배우는 순서에서 앞선 것이 이긴다", () => {
    const r = readDay(
      day({ reading: "todo", video: "todo", practice: "todo", review: "todo" }),
    );
    expect(r.active).toBe("reading");
    expect(r.verdict).toBe("active");
  });

  it("앞 단계를 마치면 다음 단계가 할 차례가 된다", () => {
    expect(readDay(day({ reading: "done", video: "todo" })).active).toBe("video");
    expect(
      readDay(day({ reading: "done", video: "done", test: "todo" })).active,
    ).toBe("test");
    expect(
      readDay(day({ reading: "done", practice: "none", review: "todo" })).active,
    ).toBe("review");
  });

  it("할 일이 있었고 전부 마친 날에만 완주를 선언한다", () => {
    const r = readDay(day({ reading: "done", test: "done" }));
    expect(r.active).toBeNull();
    expect(r.verdict).toBe("finished");
  });

  /* 이 스펙이 이 파일의 존재 이유다. */
  it("아무것도 배정되지 않은 날을 완주로 축하하지 않는다", () => {
    expect(readDay(day({ hasSession: false })).verdict).toBe("empty");
    expect(readDay(day({ hasSession: false })).active).toBeNull();
  });

  it("수업만 있고 자료·테스트가 없는 날은 빈 날과도 구분한다", () => {
    // 「배정된 학습이 없습니다」로 묶으면 1단계에 뜬 오늘 수업과 어긋난다
    expect(readDay(day({ hasSession: true })).verdict).toBe("sessionOnly");
  });

  it("1단계(오늘 배울 것)는 할 일로 세지 않는다 — 수업이 있어도 완주가 아니다", () => {
    expect(readDay(day({ hasSession: true })).verdict).not.toBe("finished");
  });

  it("모든 단계가 활성 후보로 한 번씩 뽑힐 수 있다", () => {
    for (const key of ACTION_ORDER) {
      expect(readDay(day({ [key]: "todo" } as Partial<DayInput>)).active).toBe(key);
    }
  });
});

describe("궤도 노드 (orbitOf)", () => {
  const here = 2;

  it("아무것도 없는 단계는 마쳤다고 하지 않는다", () => {
    expect(orbitOf("none", 0, here)).toBe("empty");
    // 지금 서 있는 자리라도 비어 있으면 empty가 우선한다
    expect(orbitOf("none", here, here)).toBe("empty");
  });

  it("지금 서 있는 자리만 here다", () => {
    expect(orbitOf("todo", here, here)).toBe("here");
    expect(orbitOf("todo", here + 1, here)).toBe("ahead");
  });

  it("마친 단계는 뒤에 있어도 ✓다 — 노드는 사실을 말한다", () => {
    expect(orbitOf("done", 0, here)).toBe("past");
    expect(orbitOf("done", here + 2, here)).toBe("past");
  });
});

describe("궤도 선 (solidBelow)", () => {
  it("선은 위치를 말한다 — 지나온 구간만 실선이다", () => {
    expect(solidBelow(0, 2, false)).toBe(true);
    expect(solidBelow(1, 2, false)).toBe(true);
    expect(solidBelow(2, 2, false)).toBe(false);
    expect(solidBelow(3, 2, false)).toBe(false);
  });

  it("뒤 단계를 먼저 마쳐도 그 앞 구간까지 실선이 되지는 않는다", () => {
    // 노드 4는 done(past)이지만 학생은 아직 2번에 서 있다
    const state: StepState = "done";
    expect(orbitOf(state, 4, 2)).toBe("past");
    expect(solidBelow(4, 2, false)).toBe(false);
  });

  it("완주한 날은 전 구간이 실선이다", () => {
    expect(solidBelow(0, -1, true)).toBe(true);
    expect(solidBelow(5, -1, true)).toBe(true);
  });

  it("활성 단계가 없고 완주도 아니면 어디도 실선이 아니다", () => {
    expect(solidBelow(0, -1, false)).toBe(false);
    expect(solidBelow(4, -1, false)).toBe(false);
  });
});
