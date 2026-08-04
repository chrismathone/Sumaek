import { describe, expect, it } from "vitest";
import {
  buildPreviewRow,
  summarizePreview,
  type PreviewInput,
} from "@/lib/domain/readiness-preview";

/* ─────────────────────────────────────────────────────────────
 * 날짜별 준비도 미리보기 (T5.4 · G-08) — 순수 판정.
 *
 * 준비도 게이트(T2.4)는 **게시 시점**에 돈다. 그런데 결손은 그 뒤에도
 * 생긴다 — 자료를 내리거나, 평가 생성이 실패하거나, 학생 계정을 아직 안
 * 만들었거나. 교사가 그것을 아는 시점은 지금까지 학생이 「빈 화면」을
 * 보고 말해 줄 때였다.
 *
 * 이 화면은 **학생이 로그인하기 전에** 그날을 미리 본다.
 *
 * 겨누는 것:
 *   1) 계정이 없으면 나머지 판정이 의미 없다 — 그 학생은 아무것도 못 본다
 *   2) 차단 사유가 자료·문항·평가 생성으로 갈린다 (T4.4와 **같은** 갈래)
 *   3) 미리보기는 아무것도 만들지 않는다 (persist: false)
 * ───────────────────────────────────────────────────────────── */

function input(over: Partial<PreviewInput> = {}): PreviewInput {
  return {
    learnerId: over.learnerId ?? "l1",
    displayName: over.displayName ?? "학생",
    hasAccount: over.hasAccount ?? true,
    plan: over.plan ?? {
      status: "in_progress",
      requiredTotal: 3,
      requiredSatisfied: 1,
      blockedReasons: [],
      itemCount: 3,
    },
  };
}

describe("학생 한 명의 미리보기 (buildPreviewRow)", () => {
  it("계정이 없으면 그 사실이 먼저다", () => {
    /* 자료가 다 있어도 로그인할 수 없으면 그 학생은 아무것도 못 본다.
     * 계획 상태를 앞세우면 「진행 중」으로 보이고, 교사는 준비가 끝난 줄
     * 안다. */
    const r = buildPreviewRow(input({ hasAccount: false }));
    expect(r.status).toBe("no_account");
    expect(r.blockers.map((b) => b.code)).toContain("account_unlinked");
  });

  it("계정이 있으면 계획 판정을 그대로 쓴다 — 새로 정하지 않는다", () => {
    const r = buildPreviewRow(
      input({ plan: { status: "blocked", requiredTotal: 2, requiredSatisfied: 1, blockedReasons: ["no_questions"], itemCount: 2 } }),
    );
    expect(r.status).toBe("blocked");
  });

  it("차단 사유를 갈래와 함께 낸다 — 갈 화면이 다르다", () => {
    const r = buildPreviewRow(
      input({
        plan: {
          status: "blocked",
          requiredTotal: 3,
          requiredSatisfied: 0,
          blockedReasons: ["material_missing", "assessment_not_generated"],
          itemCount: 3,
        },
      }),
    );
    expect(r.blockers).toEqual([
      { code: "assessment_not_generated", category: "assessment" },
      { code: "material_missing", category: "material" },
    ]);
  });

  it("같은 사유가 항목마다 반복돼도 한 번만 낸다", () => {
    const r = buildPreviewRow(
      input({
        plan: {
          status: "blocked",
          requiredTotal: 3,
          requiredSatisfied: 0,
          blockedReasons: ["no_questions", "no_questions"],
          itemCount: 3,
        },
      }),
    );
    expect(r.blockers).toHaveLength(1);
  });

  it("배정이 아예 없는 날은 「빈 날」로 구분한다", () => {
    /* 준비가 끝난 것과 그날 배울 것이 없는 것은 다르다. 합치면 루트를
     * 안 만든 반이 「준비 완료」로 보인다. */
    const r = buildPreviewRow(
      input({ plan: { status: "empty", requiredTotal: 0, requiredSatisfied: 0, blockedReasons: [], itemCount: 0 } }),
    );
    expect(r.status).toBe("empty");
    expect(r.ready).toBe(false);
  });

  it("필수가 전부 준비돼야 ready다", () => {
    expect(
      buildPreviewRow(
        input({ plan: { status: "not_started", requiredTotal: 3, requiredSatisfied: 0, blockedReasons: [], itemCount: 3 } }),
      ).ready,
    ).toBe(true);
    /* 학생이 아직 안 했다는 것과 할 수 없다는 것은 다르다 — 미리보기가
     * 보는 것은 후자뿐이다. */
    expect(
      buildPreviewRow(
        input({ plan: { status: "blocked", requiredTotal: 3, requiredSatisfied: 0, blockedReasons: ["material_missing"], itemCount: 3 } }),
      ).ready,
    ).toBe(false);
  });
});

describe("반 요약 (summarizePreview)", () => {
  const rows = [
    buildPreviewRow(input({ learnerId: "a", displayName: "가", hasAccount: false })),
    buildPreviewRow(
      input({
        learnerId: "b",
        displayName: "나",
        plan: { status: "blocked", requiredTotal: 2, requiredSatisfied: 0, blockedReasons: ["no_questions"], itemCount: 2 },
      }),
    ),
    buildPreviewRow(
      input({
        learnerId: "c",
        displayName: "다",
        plan: { status: "not_started", requiredTotal: 2, requiredSatisfied: 0, blockedReasons: [], itemCount: 2 },
      }),
    ),
  ];

  it("준비된 학생 수와 막힌 학생 수를 가른다", () => {
    const s = summarizePreview(rows);
    expect(s.total).toBe(3);
    expect(s.ready).toBe(1);
    expect(s.blocked).toBe(2);
  });

  it("사유를 학생 수로 묶는다 — 많은 것부터", () => {
    const s = summarizePreview(rows);
    expect(s.blockers).toEqual([
      { code: "account_unlinked", category: "account", learners: 1 },
      { code: "no_questions", category: "question", learners: 1 },
    ]);
  });

  it("먼저 볼 학생만 편다 — 준비된 학생은 오지 않는다", () => {
    const s = summarizePreview(rows);
    expect(s.attention.map((r) => r.learnerId)).toEqual(["a", "b"]);
  });

  it("아무도 없으면 전부 0이다", () => {
    const s = summarizePreview([]);
    expect(s.total).toBe(0);
    expect(s.blockers).toEqual([]);
    expect(s.attention).toEqual([]);
  });
});
