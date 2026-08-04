import { describe, expect, it } from "vitest";
import {
  buildDayPlan,
  canCompleteDay,
  decideDayStatus,
  type DayPlanItemInput,
} from "../../src/learning/day-plan";
import type { IsoDate } from "../../src/shared/dates";

/* ─────────────────────────────────────────────────────────────
 * 하루 계획 상태 머신 (ADR-0017).
 *
 * 이 판정기가 들어오기 전 「오늘 다 했다」는 화면에서만 계산됐고, 최근
 * 90일 배정을 전부 긁어 오고 있었다 — 두 달 전에 끝낸 테스트가 오늘
 * 목록에 「끝남」으로 앉아, 오늘 할 일이 하나도 없는 날에도 화면이
 * 완주한 것처럼 보였다. 그래서 여기서 겨누는 것은
 *   ① 오늘 것만 분모에 드는가
 *   ② 차단이 완료보다 먼저 걸리는가
 *   ③ 면제와 차단이 갈라져 있는가
 * 세 가지다. 셋 다 UI 문구가 아니라 판정 함수의 책임이다.
 *
 * 상태 어휘는 ADR-0017 §2·§3이 규격이다. 취향이 아니다.
 * ───────────────────────────────────────────────────────────── */

const TODAY = "2026-08-04" as IsoDate;

/** 필수·오늘·미완료 항목 하나 — 대부분의 사례에서 기준선으로 쓴다. */
function item(over: Partial<DayPlanItemInput> = {}): DayPlanItemInput {
  return {
    key: over.key ?? `k${Math.random()}`,
    kind: "reading",
    required: true,
    status: "pending",
    scheduledDate: TODAY,
    ...over,
  };
}

describe("날짜 경계 — 오늘 것만 분모에 든다", () => {
  it("과거에 끝낸 테스트만 있는 날은 완료가 아니라 빈 날이다", () => {
    /* G-01의 정확한 재현: 예전 판정은 이 날을 「완주」로 읽었다. */
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [
        item({ kind: "assessment", status: "completed", scheduledDate: "2026-06-01" as IsoDate }),
        item({ kind: "assessment", status: "completed", scheduledDate: "2026-07-20" as IsoDate }),
      ],
    });

    expect(plan.status).toBe("empty");
    expect(plan.status).not.toBe("completed");
    expect(plan.items).toHaveLength(0);
    expect(plan.required.total).toBe(0);
  });

  it("91일 전과 89일 전 완료가 똑같이 무관하다 — 90일은 경계가 아니다", () => {
    /* 예전 질의의 `scheduled_date >= today - 90`이 만든 경계.
     * 이 테스트가 그 숫자가 되살아나는 것을 막는다. */
    const before = buildDayPlan({
      planDate: TODAY,
      items: [item({ kind: "assessment", status: "completed", scheduledDate: "2026-05-05" as IsoDate })],
    });
    const after = buildDayPlan({
      planDate: TODAY,
      items: [item({ kind: "assessment", status: "completed", scheduledDate: "2026-05-07" as IsoDate })],
    });

    expect(before.status).toBe(after.status);
    expect(before.required.total).toBe(after.required.total);
    expect(before.items).toHaveLength(0);
    expect(after.items).toHaveLength(0);
  });

  it("미래 평가는 예정으로만 보이고 필수 분모에 들어가지 않는다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [
        item({ key: "today", kind: "reading" }),
        item({ key: "tomorrow", kind: "assessment", scheduledDate: "2026-08-05" as IsoDate }),
      ],
    });

    expect(plan.required.total).toBe(1);
    expect(plan.deferred.map((i) => i.key)).toEqual(["tomorrow"]);
    expect(plan.items.map((i) => i.key)).toEqual(["today"]);
  });

  it("미래 항목만 있는 날은 완료가 아니라 빈 날이다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ kind: "assessment", scheduledDate: "2026-08-05" as IsoDate })],
    });

    expect(plan.status).toBe("empty");
  });

  it("날짜가 없는 항목(자료·숙제)은 오늘 것으로 본다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ key: "m", kind: "reading", scheduledDate: null })],
    });

    expect(plan.items.map((i) => i.key)).toEqual(["m"]);
    expect(plan.required.total).toBe(1);
  });
});

describe("밀린 것 — 복습만 예외다 (ADR-0017 §5)", () => {
  it("기한 지난 복습은 오늘 필수에 든다", () => {
    /* 복습은 성질상 「밀린 것」이 곧 「지금 할 것」이다.
     * 여기서 빼면 그 개념은 영영 돌아오지 않는다. */
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ key: "r", kind: "review", scheduledDate: "2026-08-01" as IsoDate })],
    });

    expect(plan.items.map((i) => i.key)).toEqual(["r"]);
    expect(plan.required.total).toBe(1);
    expect(plan.overdue).toHaveLength(0);
  });

  it("응시하지 않은 과거 테스트는 밀린 것일 뿐 오늘 필수가 아니다", () => {
    /* 넣으면 하루 결석한 학생이 영원히 하루를 끝낼 수 없다.
     * 완주가 구조적으로 불가능해지면 학생은 완료 표시를 믿지 않게 된다. */
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [
        item({ key: "old", kind: "assessment", status: "pending", scheduledDate: "2026-08-01" as IsoDate }),
        item({ key: "now", kind: "reading" }),
      ],
    });

    expect(plan.required.total).toBe(1);
    expect(plan.overdue.map((i) => i.key)).toEqual(["old"]);
    expect(plan.items.map((i) => i.key)).toEqual(["now"]);
  });

  it("밀린 테스트만 있는 날도 완주할 수 있다 — 필수가 0이면 빈 날", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ kind: "assessment", status: "pending", scheduledDate: "2026-07-30" as IsoDate })],
    });

    expect(plan.status).toBe("empty");
    expect(plan.overdue).toHaveLength(1);
  });
});

describe("완료 판정 — 필수가 전부 끝난 경우에만", () => {
  it("필수가 모두 completed면 완료", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ status: "completed" }), item({ status: "completed" })],
    });

    expect(plan.status).toBe("completed");
    expect(plan.required.remaining).toBe(0);
  });

  it("필수 하나가 남으면 완료가 아니다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ status: "completed" }), item({ status: "pending" })],
    });

    expect(plan.status).toBe("in_progress");
    expect(plan.required.remaining).toBe(1);
  });

  it("선택 항목이 남아도 완료를 막지 않는다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [
        item({ status: "completed" }),
        item({ required: false, status: "pending" }),
      ],
    });

    expect(plan.status).toBe("completed");
  });

  it("면제는 분모에서 빠져 완료를 만든다 — 다만 「했다」로 세지 않는다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ status: "completed" }), item({ status: "exempted" })],
    });

    expect(plan.status).toBe("completed");
    expect(plan.required.satisfied).toBe(2);
    expect(plan.required.completed).toBe(1);
    expect(plan.required.exempted).toBe(1);
  });

  it("아무것도 손대지 않았으면 미시작", () => {
    const plan = buildDayPlan({ planDate: TODAY, items: [item(), item()] });
    expect(plan.status).toBe("not_started");
  });

  it("하나라도 진행 중이면 진행", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ status: "in_progress" }), item()],
    });
    expect(plan.status).toBe("in_progress");
  });
});

describe("차단 — 완료보다 먼저 걸리고 사유가 보존된다", () => {
  it("필수가 차단이면 나머지를 다 해도 완료가 아니다", () => {
    /* 판정 순서가 곧 우선순위다 (ADR-0017 §3). */
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [
        item({ status: "completed" }),
        item({ status: "completed" }),
        item({ status: "blocked", blockedReason: "no_questions" }),
      ],
    });

    expect(plan.status).toBe("blocked");
    expect(plan.status).not.toBe("completed");
  });

  it("차단 사유가 중복 없이 보존된다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [
        item({ status: "blocked", blockedReason: "material_missing" }),
        item({ status: "blocked", blockedReason: "no_questions" }),
        item({ status: "blocked", blockedReason: "no_questions" }),
      ],
    });

    expect(plan.blockedReasons).toEqual(["material_missing", "no_questions"]);
  });

  it("선택 항목의 차단은 완주를 막지 않는다", () => {
    /* 학생에게 알리되 하루는 끝낼 수 있다 (ADR-0017 §3). */
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [
        item({ status: "completed" }),
        item({ required: false, status: "blocked", blockedReason: "rights_expired" }),
      ],
    });

    expect(plan.status).toBe("completed");
    expect(plan.blockedReasons).toContain("rights_expired");
  });

  it("차단과 면제를 같은 것으로 취급하지 않는다", () => {
    /* 합치면 자료를 안 올린 사고가 「면제 처리됨」으로 위장된다. */
    const blocked = buildDayPlan({
      planDate: TODAY,
      items: [item({ status: "blocked", blockedReason: "material_missing" })],
    });
    const exempted = buildDayPlan({
      planDate: TODAY,
      items: [item({ status: "exempted" })],
    });

    expect(blocked.status).toBe("blocked");
    expect(exempted.status).toBe("completed");
  });

  it("차단 항목에 사유가 없으면 알 수 없음으로 남기되 삼키지 않는다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ status: "blocked", blockedReason: null })],
    });

    expect(plan.status).toBe("blocked");
    expect(plan.blockedReasons).toEqual(["unknown"]);
  });
});

describe("빈 날과 수업만 있는 날", () => {
  it("항목이 하나도 없으면 빈 날", () => {
    expect(buildDayPlan({ planDate: TODAY, items: [] }).status).toBe("empty");
  });

  it("선택 항목만 있는 날도 빈 날이 아니라 완주 가능한 날이다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ required: false, status: "pending" })],
    });

    expect(plan.status).not.toBe("empty");
    expect(plan.status).toBe("not_started");
    expect(plan.required.total).toBe(0);
  });
});

describe("decideDayStatus — 판정 순서 자체", () => {
  it("blocked > completed > in_progress > not_started 순으로 걸린다", () => {
    const done = { required: true, status: "completed" as const };
    const block = { required: true, status: "blocked" as const };
    const going = { required: true, status: "in_progress" as const };
    const todo = { required: true, status: "pending" as const };

    expect(decideDayStatus([done, block])).toBe("blocked");
    expect(decideDayStatus([done, done])).toBe("completed");
    expect(decideDayStatus([done, going])).toBe("in_progress");
    expect(decideDayStatus([done, todo])).toBe("in_progress");
    expect(decideDayStatus([todo, todo])).toBe("not_started");
    expect(decideDayStatus([])).toBe("empty");
  });
});

describe("완료 전이 허용 — DB CAS(T4.1)가 이 함수를 먼저 통과시킨다", () => {
  it("완료 상태일 때만 전이를 허용한다", () => {
    const of = (items: DayPlanItemInput[]) =>
      canCompleteDay(buildDayPlan({ planDate: TODAY, items }));

    expect(of([item({ status: "completed" })])).toBe(true);
    expect(of([item({ status: "completed" }), item({ status: "exempted" })])).toBe(true);

    expect(of([])).toBe(false);
    expect(of([item({ status: "pending" })])).toBe(false);
    expect(of([item({ status: "in_progress" })])).toBe(false);
    expect(of([item({ status: "completed" }), item({ status: "blocked" })])).toBe(false);
  });

  it("선택 항목만 남은 날은 전이를 허용하지 않는다 — 필수가 0이면 완주가 아니다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [item({ required: false, status: "completed" })],
    });

    expect(plan.status).toBe("in_progress");
    expect(canCompleteDay(plan)).toBe(false);
  });
});

describe("결정론", () => {
  it("같은 입력을 여러 번 넣어도 같은 결과다", () => {
    const items = [
      item({ key: "a", status: "completed" }),
      item({ key: "b", kind: "review", scheduledDate: "2026-08-02" as IsoDate }),
      item({ key: "c", kind: "assessment", scheduledDate: "2026-08-09" as IsoDate }),
      item({ key: "d", required: false, status: "blocked", blockedReason: "x" }),
    ];

    const runs = [1, 2, 3].map(() => buildDayPlan({ planDate: TODAY, items }));
    expect(JSON.stringify(runs[1])).toBe(JSON.stringify(runs[0]));
    expect(JSON.stringify(runs[2])).toBe(JSON.stringify(runs[0]));
  });

  it("ordinal이 있으면 그 순서를, 없으면 key 사전순을 쓴다", () => {
    /* 학생 화면의 정거장 순서가 여기서 정해진다 (T1.4). ordinal이 섞여
     * 들어와도 순서가 흔들리면 새로고침마다 화면이 뒤바뀐다. */
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [
        item({ key: "z", ordinal: 1 }),
        item({ key: "a", ordinal: 3 }),
        item({ key: "m", ordinal: 2 }),
      ],
    });

    expect(plan.items.map((i) => i.key)).toEqual(["z", "m", "a"]);
  });

  it("ordinal이 없는 항목은 있는 항목 뒤로 간다", () => {
    const plan = buildDayPlan({
      planDate: TODAY,
      items: [
        item({ key: "b", ordinal: null }),
        item({ key: "a", ordinal: null }),
        item({ key: "z", ordinal: 5 }),
      ],
    });

    expect(plan.items.map((i) => i.key)).toEqual(["z", "a", "b"]);
  });

  it("입력 순서가 달라도 같은 결과다 — 정렬 없는 조회를 견딘다", () => {
    const a = item({ key: "a", status: "completed" });
    const b = item({ key: "b", status: "pending" });

    const forward = buildDayPlan({ planDate: TODAY, items: [a, b] });
    const reverse = buildDayPlan({ planDate: TODAY, items: [b, a] });

    expect(reverse.status).toBe(forward.status);
    expect(reverse.items.map((i) => i.key)).toEqual(forward.items.map((i) => i.key));
  });

  it("입력 배열을 변형하지 않는다", () => {
    const items = [item({ key: "a" }), item({ key: "b" })];
    const snapshot = JSON.stringify(items);

    buildDayPlan({ planDate: TODAY, items });

    expect(JSON.stringify(items)).toBe(snapshot);
  });
});
