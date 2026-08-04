import { describe, expect, it } from "vitest";
import {
  buildSetupProgress,
  SETUP_STEP_ORDER,
  type SetupFacts,
} from "@/lib/domain/setup-progress";

/* ─────────────────────────────────────────────────────────────
 * 단계형 온보딩 (T5.1) — 순수 판정.
 *
 * 새 학원이 로그인하면 빈 화면 열두 개를 만난다. 무엇부터 해야 하는지는
 * 어디에도 없고, 순서를 틀리면 「반을 먼저 만드세요」 같은 오류가 화면
 * 깊숙한 곳에서 나온다(G-07).
 *
 * 이 파일이 정하는 것은 **지금 무엇을 할 차례인가**이고, 그 판정은 전부
 * 서버 상태에서 나온다. 진행률을 세션이나 로컬 저장소에 두면 새로고침·
 * 로그아웃으로 사라지고, 사라진 진행률은 「처음부터 다시」로 보인다.
 *
 * 겨누는 것:
 *   1) 다음 할 일이 언제나 하나로 정해진다
 *   2) 앞 단계가 안 끝났으면 뒤 단계는 「할 수 없음」으로 보인다 — 눌러서
 *      실패하는 것이 아니라
 *   3) 뒤 단계가 먼저 끝나 있어도 앞이 비면 완료가 아니다
 * ───────────────────────────────────────────────────────────── */

function facts(over: Partial<SetupFacts> = {}): SetupFacts {
  return {
    coursePeriods: 0,
    learningGroups: 0,
    learners: 0,
    learnersWithAccount: 0,
    publishedRoutes: 0,
    materials: 0,
    assessmentPolicies: 0,
    readinessBlocking: 0,
    ...over,
  };
}

/** 앞 단계를 전부 채운 상태 — 뒤 단계만 검사할 때 쓴다 */
const allButLast = facts({
  coursePeriods: 1,
  learningGroups: 1,
  learners: 3,
  learnersWithAccount: 3,
  publishedRoutes: 1,
  materials: 5,
  assessmentPolicies: 2,
});

describe("설정 진행 판정 (buildSetupProgress)", () => {
  it("아무것도 없으면 첫 단계가 다음 할 일이다", () => {
    const p = buildSetupProgress(facts());
    expect(p.next?.id).toBe("course_period");
    expect(p.doneCount).toBe(0);
    expect(p.complete).toBe(false);
  });

  it("단계 순서는 고정이다 — 화면이 다시 정하지 않는다", () => {
    const p = buildSetupProgress(facts());
    expect(p.steps.map((s) => s.id)).toEqual([...SETUP_STEP_ORDER]);
  });

  it("앞을 끝내면 다음이 하나로 정해진다", () => {
    const p = buildSetupProgress(facts({ coursePeriods: 1 }));
    expect(p.next?.id).toBe("learning_group");
    expect(p.steps.find((s) => s.id === "course_period")!.done).toBe(true);
  });

  it("앞 단계가 비면 뒤 단계는 할 수 없음으로 표시된다", () => {
    /* 눌러서 「반을 먼저 만드세요」를 만나는 것과, 애초에 못 누르는 것은
     * 다르다. 전자는 사용자가 자기가 틀렸다고 느낀다. */
    const p = buildSetupProgress(facts());
    const learners = p.steps.find((s) => s.id === "learners")!;
    expect(learners.blockedBy).toBe("learning_group");
  });

  it("앞이 채워지면 차단이 풀린다", () => {
    const p = buildSetupProgress(facts({ coursePeriods: 1, learningGroups: 1 }));
    expect(p.steps.find((s) => s.id === "learners")!.blockedBy).toBeNull();
  });

  it("뒤가 먼저 끝나 있어도 앞이 비면 완료가 아니다", () => {
    /* 시드 데이터나 손으로 만든 자료 때문에 뒤 단계가 먼저 충족될 수 있다.
     * 그것으로 완료를 선언하면 반도 학생도 없는 학원이 「설정 끝」을 본다. */
    const p = buildSetupProgress(
      facts({ materials: 10, publishedRoutes: 1, assessmentPolicies: 2 }),
    );
    expect(p.complete).toBe(false);
    expect(p.next?.id).toBe("course_period");
  });

  it("계정 단계는 학생 수와 대조한다 — 한 명이라도 남으면 안 끝났다", () => {
    /* 「계정 발급함」이 아니라 「전부 발급됨」이어야 한다. 한 명이 로그인
     * 못 하는 것은 그 학생에게 100%다. */
    const partial = buildSetupProgress(
      facts({
        coursePeriods: 1,
        learningGroups: 1,
        learners: 3,
        learnersWithAccount: 2,
      }),
    );
    expect(partial.steps.find((s) => s.id === "accounts")!.done).toBe(false);
    expect(partial.next?.id).toBe("accounts");
  });

  it("준비도는 차단이 0건일 때만 끝난다", () => {
    const blocked = buildSetupProgress({ ...allButLast, readinessBlocking: 2 });
    expect(blocked.steps.find((s) => s.id === "readiness")!.done).toBe(false);
    expect(blocked.complete).toBe(false);

    const clear = buildSetupProgress({ ...allButLast, readinessBlocking: 0 });
    expect(clear.steps.find((s) => s.id === "readiness")!.done).toBe(true);
    expect(clear.complete).toBe(true);
    expect(clear.next).toBeNull();
  });

  it("남은 이유를 수치로 말한다 — 「미완료」로 끝내지 않는다", () => {
    const p = buildSetupProgress(
      facts({
        coursePeriods: 1,
        learningGroups: 1,
        learners: 5,
        learnersWithAccount: 2,
      }),
    );
    expect(p.steps.find((s) => s.id === "accounts")!.detail).toContain("3");
  });

  it("모든 단계에 갈 곳이 있다 — 「어딘가에서 하세요」가 되지 않게", () => {
    const p = buildSetupProgress(facts());
    for (const step of p.steps) {
      expect(step.href.startsWith("/app/")).toBe(true);
      expect(step.title.length).toBeGreaterThan(1);
    }
  });
});
