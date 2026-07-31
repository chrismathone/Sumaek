import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATRIX,
  MENU_KEYS,
  ROLES,
  canAccess,
  canAssignRole,
  canWrite,
  isPermissionLocked,
  resolveMatrix,
} from "../../src/authz/matrix";

describe("권한 매트릭스", () => {
  it("기본 매트릭스는 모든 메뉴 × 역할 칸을 정의한다", () => {
    for (const menu of MENU_KEYS) {
      for (const role of ROLES) {
        expect(DEFAULT_MATRIX[menu][role]).toBeDefined();
      }
    }
  });

  it("읽기와 쓰기 게이트가 분리된다 — readonly는 접근 가능·쓰기 불가", () => {
    const m = resolveMatrix([]);
    // teacher는 curriculum_studio readonly
    expect(canAccess(m, "teacher", "curriculum_studio")).toBe(true);
    expect(canWrite(m, "teacher", "curriculum_studio")).toBe(false);
  });

  it("학생은 learn만 접근할 수 있다", () => {
    const m = resolveMatrix([]);
    for (const menu of MENU_KEYS) {
      if (menu === "learn") {
        expect(canAccess(m, "student", menu)).toBe(true);
      } else {
        expect(canAccess(m, "student", menu), menu).toBe(false);
      }
    }
  });

  it("콘텐츠 역할은 학습자 개인 데이터 메뉴에 접근할 수 없다 (4장)", () => {
    const m = resolveMatrix([]);
    for (const role of ["content_manager", "content_reviewer"] as const) {
      expect(canAccess(m, role, "learners")).toBe(false);
      expect(canAccess(m, role, "mastery")).toBe(false);
      expect(canAccess(m, role, "grading")).toBe(false);
    }
  });

  it("오버라이드는 병합되지만 잠긴 칸은 무시된다", () => {
    const m = resolveMatrix([
      // 유효: 채점자에게 리포트 읽기 허용
      { menu: "reports", role: "grader", access: "readonly" },
      // 잠김: owner의 settings 축소 시도 (락아웃 방지)
      { menu: "settings", role: "owner", access: "none" },
      // 잠김: 학생에게 문제은행 열기 시도
      { menu: "question_bank", role: "student", access: "full" },
      // 잠김: 콘텐츠 관리자에게 학습자 열기 시도
      { menu: "learners", role: "content_manager", access: "full" },
    ]);
    expect(canAccess(m, "grader", "reports")).toBe(true);
    expect(canAccess(m, "owner", "settings")).toBe(true);
    expect(canAccess(m, "student", "question_bank")).toBe(false);
    expect(canAccess(m, "content_manager", "learners")).toBe(false);
  });

  it("잠금 규칙 자체를 검증한다", () => {
    expect(isPermissionLocked("settings", "owner")).toBe(true);
    expect(isPermissionLocked("learn", "student")).toBe(true);
    expect(isPermissionLocked("reports", "grader")).toBe(false);
  });
});

describe("역할 위계", () => {
  it("actor는 새 역할과 대상 모두보다 강해야 한다", () => {
    // 프로그램 책임자는 선생님을 채점자로 바꿀 수 있다
    expect(canAssignRole("program_director", "teacher", "grader")).toBe(true);
    // 선생님은 다른 선생님의 역할을 바꿀 수 없다 (동급)
    expect(canAssignRole("teacher", "teacher", "grader")).toBe(false);
    // 선생님은 프로그램 책임자를 강등할 수 없다 (자기보다 강함)
    expect(canAssignRole("teacher", "program_director", "grader")).toBe(false);
    // owner만 owner를 만들 수 있다
    expect(canAssignRole("program_director", "teacher", "owner")).toBe(false);
    expect(canAssignRole("owner", "teacher", "owner")).toBe(true);
  });
});
