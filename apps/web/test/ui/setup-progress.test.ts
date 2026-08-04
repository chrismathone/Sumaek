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

  it("자료는 루트 게시보다 먼저 온다 — 게시가 자료를 요구하기 때문이다", () => {
    /* 루트 게시는 준비도 게이트(T2.4)를 지난다. 개념 차시에 게시된 자료가
     * 없으면 게시가 **거부된다**(checkRouteReadiness의 material_missing).
     *
     * 그런데 이 순서표는 materials를 route 뒤에 두고 route를 선행으로
     * 요구하고 있었다. 그러면 새 학원은 「학습 루트 게시」를 할 차례로
     * 받아 들고 게시를 눌러 거부당하는데, 고치러 갈 자료 단계는 차단돼
     * 링크조차 없다 — 화면이 시킨 일을 하다가 막다른 길에 서는 것이다.
     * (T6.2 자율 E2E가 실제로 이 벽에 부딪혀 드러났다.)
     *
     * 순서를 뒤집는다: 자료가 있어야 게시가 된다. */
    const order = [...SETUP_STEP_ORDER];
    expect(order.indexOf("materials")).toBeLessThan(order.indexOf("route"));

    const beforeRoute = buildSetupProgress(
      facts({
        coursePeriods: 1,
        learningGroups: 1,
        learners: 2,
        learnersWithAccount: 2,
      }),
    );
    expect(beforeRoute.next?.id).toBe("materials");
    expect(
      beforeRoute.steps.find((s) => s.id === "materials")!.blockedBy,
    ).toBeNull();
  });

  it("준비도는 게시된 루트를 보는 단계다 — 루트 전에는 할 수 없다", () => {
    /* 이 단계의 갈 곳은 /app/routes다. 루트가 없으면 볼 것이 없다. */
    const noRoute = buildSetupProgress(
      facts({
        coursePeriods: 1,
        learningGroups: 1,
        learners: 2,
        learnersWithAccount: 2,
        materials: 3,
      }),
    );
    expect(noRoute.steps.find((s) => s.id === "readiness")!.blockedBy).toBe(
      "route",
    );
  });

  it("모든 단계에 갈 곳이 있다 — 「어딘가에서 하세요」가 되지 않게", () => {
    const p = buildSetupProgress(facts());
    for (const step of p.steps) {
      expect(step.href.startsWith("/app/")).toBe(true);
      expect(step.title.length).toBeGreaterThan(1);
    }
  });

  it("「하러 가기」는 그 일을 **할 수 있는** 화면으로 간다", () => {
    /* 갈 곳이 있는 것과 거기서 할 수 있는 것은 다르다.
     *
     * 과정 기간·반·학생을 만드는 폼은 셋 다 `/app/settings`에만 있다.
     * 그런데 이 단계들은 각각 /app/calendar·/app/classes·/app/students —
     * **목록 화면**을 가리키고 있었다. 거기엔 만들 폼도, 설정으로 가는
     * 링크도 없다(학생 목록의 유일한 링크는 NEIS 연동이다). 학생 계정
     * 단계는 발급 화면(/app/students/accounts)이 따로 있는데도 목록을
     * 가리켰고, 준비도 단계는 T5.4가 만든 /app/readiness 대신 루트 목록을
     * 가리켰다.
     *
     * 「빈 화면 열두 개」를 없애려고 만든 화면이 빈 화면으로 보내고 있었다.
     * (T6.2 자율 E2E가 설정 화면만 따라가다 첫 단계에서 멈춰 드러났다.) */
    const p = buildSetupProgress(facts());
    const href = (id: string) => p.steps.find((s) => s.id === id)!.href;

    expect(href("course_period")).toBe("/app/settings");
    expect(href("learning_group")).toBe("/app/settings");
    expect(href("learners")).toBe("/app/settings");
    expect(href("accounts")).toBe("/app/students/accounts");
    expect(href("materials")).toBe("/app/content/materials");
    expect(href("route")).toBe("/app/routes");
    expect(href("assessment_policy")).toBe("/app/settings");
    expect(href("readiness")).toBe("/app/readiness");
  });
});
