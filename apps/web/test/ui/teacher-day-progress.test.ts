import { describe, expect, it } from "vitest";
import {
  blockCategory,
  summarizeDayProgress,
  type LearnerDayRow,
} from "@/lib/domain/day-progress";

/* ─────────────────────────────────────────────────────────────
 * 교사가 보는 오늘 (T4.4) — 순수 판정.
 *
 * T4.1이 학생의 하루 완료를 **기록**으로 만들었지만, 그 기록을 반 단위로
 * 볼 곳이 없었다. 학습자 상세에 세로 기록만 있었고 가로로 자르는 화면은
 * 없다. 교사는 서른 명을 한 명씩 눌러 봐야 했다.
 *
 * 이 파일이 정하는 것은 **무엇을 먼저 보여 줄까**이다. 서른 줄을 그냥
 * 늘어놓으면 완주한 스물여덟 명이 막힌 두 명을 덮는다.
 *
 * 겨누는 것:
 *   1) 「기록 없음」과 「미시작」은 다른 사실이다
 *   2) 막힘 사유가 자료·문항·계정 등으로 갈린다
 *   3) 먼저 볼 학생이 위로 온다 — 막힘 > 기록 없음 > 미시작
 * ───────────────────────────────────────────────────────────── */

function row(over: Partial<LearnerDayRow> = {}): LearnerDayRow {
  return {
    learnerId: over.learnerId ?? "l1",
    displayName: over.displayName ?? "학생",
    status: over.status ?? "completed",
    completedAt: over.completedAt ?? null,
    requiredTotal: over.requiredTotal ?? 3,
    requiredSatisfied: over.requiredSatisfied ?? 3,
    requiredBlocked: over.requiredBlocked ?? 0,
    blockedReasons: over.blockedReasons ?? [],
    lastActivityAt: over.lastActivityAt ?? null,
  };
}

describe("막힘 사유의 갈래 (blockCategory)", () => {
  it("자료·문항·계정·권한을 서로 다른 갈래로 가른다", () => {
    /* 「막힘 2명」만으로는 교사가 아무것도 못 한다. 자료를 올려야 하는 것과
     * 계정을 연결해야 하는 것은 가는 화면이 다르다. */
    expect(blockCategory("material_missing")).toBe("material");
    expect(blockCategory("no_questions")).toBe("question");
    expect(blockCategory("account_unlinked")).toBe("account");
    expect(blockCategory("rights_expired")).toBe("rights");
  });

  it("자동 생성이 못 따라온 것은 자료 결손과 다른 갈래다", () => {
    /* 자료가 없는 것은 사람이 안 올린 것이고, 시험이 없는 것은 워커가 못
     * 만든 것이다. 교사가 할 일이 다르다 — 후자는 T3.4의 복구 화면이다. */
    expect(blockCategory("assessment_not_generated")).toBe("assessment");
  });

  it("모르는 코드는 조용히 자료로 뭉개지 않는다", () => {
    expect(blockCategory("something_new")).toBe("unknown");
  });
});

describe("반 하루 요약 (summarizeDayProgress)", () => {
  it("상태별로 센다", () => {
    const s = summarizeDayProgress([
      row({ learnerId: "a", status: "completed" }),
      row({ learnerId: "b", status: "in_progress" }),
      row({ learnerId: "c", status: "blocked" }),
      row({ learnerId: "d", status: "not_started" }),
      row({ learnerId: "e", status: "no_record" }),
    ]);

    expect(s.total).toBe(5);
    expect(s.counts.completed).toBe(1);
    expect(s.counts.blocked).toBe(1);
    expect(s.counts.no_record).toBe(1);
  });

  it("「기록 없음」을 「미시작」에 합치지 않는다", () => {
    /* 미시작은 계획이 있는데 아직 안 한 것이고, 기록 없음은 학생이 오늘
     * 화면을 **한 번도 열지 않은** 것이다. 후자는 대개 로그인 문제라
     * 교사가 할 일이 다르다. 합치면 계정이 안 열린 학생이 「게으른 학생」이
     * 된다. */
    const s = summarizeDayProgress([
      row({ learnerId: "d", status: "not_started" }),
      row({ learnerId: "e", status: "no_record" }),
    ]);
    expect(s.counts.not_started).toBe(1);
    expect(s.counts.no_record).toBe(1);
  });

  it("막힘 사유를 학생 수로 묶는다 — 많은 것부터", () => {
    const s = summarizeDayProgress([
      row({ learnerId: "a", status: "blocked", blockedReasons: ["no_questions"] }),
      row({ learnerId: "b", status: "blocked", blockedReasons: ["no_questions"] }),
      row({ learnerId: "c", status: "blocked", blockedReasons: ["material_missing"] }),
    ]);

    expect(s.blocked).toEqual([
      { code: "no_questions", category: "question", learners: 2 },
      { code: "material_missing", category: "material", learners: 1 },
    ]);
  });

  it("한 학생의 사유 둘은 각각 한 번씩만 센다", () => {
    /* 같은 학생이 같은 사유로 두 항목 막혀 있다고 두 명이 되지 않는다 —
     * 「몇 명이 막혔나」가 학생 수보다 커지면 교사가 수를 믿지 않는다. */
    const s = summarizeDayProgress([
      row({
        learnerId: "a",
        status: "blocked",
        blockedReasons: ["material_missing", "material_missing", "no_questions"],
      }),
    ]);
    expect(s.blocked).toEqual([
      { code: "material_missing", category: "material", learners: 1 },
      { code: "no_questions", category: "question", learners: 1 },
    ]);
  });

  it("먼저 볼 학생이 위로 온다 — 막힘 > 기록 없음 > 미시작", () => {
    /* 서른 줄을 그냥 늘어놓으면 완주한 스물여덟 명이 막힌 두 명을 덮는다.
     * 완주·진행 중은 여기 오지 않는다 — 교사가 할 일이 없다. */
    const s = summarizeDayProgress([
      row({ learnerId: "done", status: "completed" }),
      row({ learnerId: "notstarted", status: "not_started" }),
      row({ learnerId: "norecord", status: "no_record" }),
      row({ learnerId: "blocked", status: "blocked", blockedReasons: ["material_missing"] }),
      row({ learnerId: "doing", status: "in_progress" }),
    ]);

    expect(s.attention.map((r) => r.learnerId)).toEqual([
      "blocked",
      "norecord",
      "notstarted",
    ]);
  });

  it("같은 상태끼리는 이름순 — 볼 때마다 순서가 바뀌지 않게", () => {
    const s = summarizeDayProgress([
      row({ learnerId: "b", displayName: "나학생", status: "not_started" }),
      row({ learnerId: "a", displayName: "가학생", status: "not_started" }),
    ]);
    expect(s.attention.map((r) => r.displayName)).toEqual(["가학생", "나학생"]);
  });

  it("아무도 없으면 전부 0이다", () => {
    const s = summarizeDayProgress([]);
    expect(s.total).toBe(0);
    expect(s.blocked).toEqual([]);
    expect(s.attention).toEqual([]);
    expect(s.counts.completed).toBe(0);
  });
});
