import { describe, expect, it } from "vitest";
import {
  ACTION_ORDER,
  badgeLabel,
  conceptSpan,
  orbitOf,
  planToDayInput,
  readDay,
  solidBelow,
  type DayInput,
  type StepState,
} from "@/lib/learn/today-steps";
import { buildDayPlan, type DayPlanItemInput } from "@su-maek/core/learning";
import type { IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 학생 「오늘 학습」 단계 판정 회귀 검사.
 *
 * 이 판정이 틀리면 화면에 오류가 아니라 **격려**로 나타난다 — 아무것도
 * 배정되지 않은 날 「오늘 할 일을 모두 마쳤습니다」가 뜨는 식이라, 눈으로
 * 봐서는 정상으로 보인다. 실제로 예전 화면이 그랬다(activeStep === null
 * 하나로 완주와 빈 날을 묶었다). 그래서 여기서 못 박는다.
 * ───────────────────────────────────────────────────────────── */

const day = (over: Partial<DayInput> = {}): DayInput => ({
  blocked: false,
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

  /* ── 예정(upcoming) — 있지만 오늘 것이 아니다 ──
   *
   * 이 상태가 없던 시절 예정 테스트는 `none`으로 접혔고, 화면은 「배정된
   * 테스트가 없습니다」라고 말한 바로 아래에 그 테스트를 목록으로 냈다.
   * 상태를 만들면서 반대쪽 함정이 생긴다 — `hadWork`를 `!== "none"`으로
   * 두면 예정 하나가 오늘 몫으로 딸려 들어가 거짓 축하가 되돌아온다. */
  it("예정은 할 차례가 되지 않는다 — 아직 학생이 할 수 있는 일이 아니다", () => {
    expect(readDay(day({ test: "upcoming" })).active).toBeNull();
    // 앞 단계가 예정이어도 실제로 할 수 있는 뒤 단계가 할 차례다
    expect(readDay(day({ test: "upcoming", review: "todo" })).active).toBe(
      "review",
    );
  });

  it("예정만 있는 날을 완주로 축하하지 않는다", () => {
    expect(readDay(day({ test: "upcoming" })).verdict).toBe("sessionOnly");
    expect(readDay(day({ hasSession: false, test: "upcoming" })).verdict).toBe(
      "empty",
    );
  });

  it("오늘 할 일을 마쳤으면 예정이 남아 있어도 완주다", () => {
    // 내일 볼 테스트가 오늘의 완주를 막지 않는다
    expect(readDay(day({ reading: "done", test: "upcoming" })).verdict).toBe(
      "finished",
    );
  });
});

describe("차단된 날 (readDay)", () => {
  it("필수가 막혀 있으면 완주를 선언하지 않는다", () => {
    /* 이 화면이 하는 거짓말 중 가장 나쁜 것이다. 자료를 안 올렸거나 문항이
     * 0개라 학생이 할 수 없는 항목이 남아 있는데 「다 마쳤습니다」가 뜨면,
     * 학생은 자기 몫을 끝냈다고 믿고 화면을 닫는다. */
    const r = readDay(day({ reading: "done", blocked: true }));
    expect(r.verdict).toBe("blocked");
    expect(r.verdict).not.toBe("finished");
    expect(r.active).toBeNull();
  });

  it("할 차례가 남아 있으면 차단이 있어도 그것부터 한다", () => {
    /* 차단은 완주를 막을 뿐 나머지 일을 막지 않는다 (ADR-0017 §3). */
    const r = readDay(day({ reading: "todo", test: "done", blocked: true }));
    expect(r.verdict).toBe("active");
    expect(r.active).toBe("reading");
  });

  it("차단이 없으면 종전대로 완주다", () => {
    expect(readDay(day({ reading: "done", blocked: false })).verdict).toBe(
      "finished",
    );
  });
});

describe("계획 → 단계 상태 (planToDayInput)", () => {
  const TODAY = "2026-08-04" as IsoDate;
  const item = (over: Partial<DayPlanItemInput>): DayPlanItemInput => ({
    key: over.key ?? `k${Math.random()}`,
    kind: "reading",
    required: true,
    status: "pending",
    ...over,
  });
  const from = (items: DayPlanItemInput[]) =>
    planToDayInput(buildDayPlan({ planDate: TODAY, items }));

  it("자료 종류가 그대로 단계가 된다", () => {
    const d = from([
      item({ kind: "reading", status: "completed" }),
      item({ kind: "video", status: "pending" }),
      item({ kind: "practice", status: "in_progress" }),
    ]);
    expect(d.reading).toBe("done");
    expect(d.video).toBe("todo");
    expect(d.practice).toBe("todo");
    expect(d.test).toBe("none");
  });

  it("평가와 복습이 각자 단계로 간다", () => {
    const d = from([
      item({ kind: "assessment", status: "pending" }),
      item({ kind: "review", status: "completed" }),
    ]);
    expect(d.test).toBe("todo");
    expect(d.review).toBe("done");
  });

  it("미래 평가만 있으면 예정이지 할 차례가 아니다", () => {
    const d = from([
      item({ kind: "assessment", scheduledDate: "2026-08-09" as IsoDate }),
    ]);
    expect(d.test).toBe("upcoming");
    expect(readDay(d).verdict).not.toBe("active");
  });

  it("차단 항목은 할 차례가 되지 않는다 — 학생이 할 수 없는 일이다", () => {
    /* todo로 두면 히어로가 「지금 할 차례」라고 말하고 학생을 눌러도 아무것도
     * 없는 화면으로 보낸다. */
    const d = from([
      item({ kind: "reading", status: "completed" }),
      item({ kind: "practice", status: "blocked", blockedReason: "no_questions" }),
    ]);
    expect(d.practice).not.toBe("todo");
    expect(d.blocked).toBe(true);
    expect(readDay(d).verdict).toBe("blocked");
  });

  it("선택 항목의 차단은 완주를 막지 않는다", () => {
    const d = from([
      item({ kind: "reading", status: "completed" }),
      item({
        kind: "video",
        required: false,
        status: "blocked",
        blockedReason: "rights_expired",
      }),
    ]);
    expect(d.blocked).toBe(false);
    expect(readDay(d).verdict).toBe("finished");
  });

  it("면제는 완주를 막지 않는다", () => {
    const d = from([
      item({ kind: "reading", status: "completed" }),
      item({ kind: "practice", status: "exempted" }),
    ]);
    expect(readDay(d).verdict).toBe("finished");
  });

  it("정거장 없는 필수 항목은 차단으로 센다 — 조용히 빠지지 않는다", () => {
    /* 숙제·교재 범위는 T2.3이 정거장을 만들기 전까지 학생이 도달할 방법이
     * 없다. 접는 과정에서 그냥 빠지면 「필수가 남았는데 완주」가 된다 —
     * 이 파일이 막으려는 거짓 축하가 새 노드 종류를 타고 되돌아온다. */
    const d = from([
      item({ kind: "reading", status: "completed" }),
      item({ kind: "homework", status: "pending" }),
    ]);
    expect(d.blocked).toBe(true);
    expect(readDay(d).verdict).toBe("blocked");
  });

  it("정거장 없는 항목도 끝났거나 면제면 완주를 막지 않는다", () => {
    const d = from([
      item({ kind: "reading", status: "completed" }),
      item({ kind: "book_range", status: "exempted" }),
    ]);
    expect(d.blocked).toBe(false);
    expect(readDay(d).verdict).toBe("finished");
  });

  it("항목이 없는 날은 전부 none이다", () => {
    const d = from([]);
    for (const k of ACTION_ORDER) expect(d[k]).toBe("none");
    expect(d.blocked).toBe(false);
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

  it("예정은 앞으로 갈 길이다 — 마친 것도 빈 것도 아니다", () => {
    expect(orbitOf("upcoming", here + 2, here)).toBe("ahead");
    // 활성 단계가 없는 날에도 ✓(past)로 새지 않는다
    expect(orbitOf("upcoming", 4, -1)).toBe("ahead");
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

describe("배지 라벨 (badgeLabel)", () => {
  /* 이 스펙이 이 함수를 화면에서 떼어 낸 이유다.
   *
   * 배지는 활성이 **아닌** 단계에만 렌더된다. 그러므로 배지가 「할 차례」라고
   * 말하면 화면에 뜨는 모든 「할 차례」가 할 차례 아닌 단계의 것이 된다 —
   * 실제로 그랬고, 좌표 줄·히어로와 함께 세 자리가 서로 다른 단계를 가리켰다. */
  it("배지는 「할 차례」라고 말하지 않는다 — 그 말은 히어로가 독점한다", () => {
    for (const state of ["todo", "done", "upcoming", "none"] as const) {
      expect(badgeLabel(state, 3)).not.toContain("할 차례");
    }
  });

  it("남은 양은 숨기지 않는다 — 조용하게 만드는 것과 지우는 것은 다르다", () => {
    expect(badgeLabel("todo", 6)).toBe("남은 6건");
    expect(badgeLabel("upcoming", 2)).toBe("예정 2건");
  });

  it("예정과 없음은 다른 말이다", () => {
    // 「없음」으로 뭉개면 화면이 예정 테스트를 목록으로 내면서
    // 「배정된 테스트가 없습니다」라고 말하게 된다
    expect(badgeLabel("upcoming", 1)).not.toBe(badgeLabel("none", 1));
  });

  it("완료·없음은 세지 않는다", () => {
    expect(badgeLabel("done", 99)).toBe("완료");
    expect(badgeLabel("none", 99)).toBe("없음");
  });
});

describe("개념 머리글 (conceptSpan)", () => {
  it("한 개념이면 그 이름을 그대로 부른다", () => {
    expect(conceptSpan(["소인수분해"])).toBe("소인수분해");
    // 같은 개념의 자료가 여럿이어도 한 번만 센다
    expect(conceptSpan(["소인수분해", "소인수분해"])).toBe("소인수분해");
  });

  /* 예전에는 첫 자료의 개념명만 달아, 다섯 개념에 걸친 카드가 「소수와
   * 합성수」 하나로 이름 붙어 있었다. 머리글이 카드를 잘못 부르는 셈이다. */
  it("여러 개념에 걸치면 첫 개념만 부르고 나머지가 있다는 사실을 남긴다", () => {
    expect(conceptSpan(["소수와 합성수", "거듭제곱", "소인수분해"])).toBe(
      "소수와 합성수 외 개념 2개",
    );
  });

  it("중복은 세지 않는다 — 자료 수가 아니라 개념 수다", () => {
    expect(
      conceptSpan(["소수와 합성수", "소수와 합성수", "거듭제곱"]),
    ).toBe("소수와 합성수 외 개념 1개");
  });

  it("자료가 없으면 머리글도 없다 — 빈 칸을 지어내지 않는다", () => {
    expect(conceptSpan([])).toBeNull();
  });
});
