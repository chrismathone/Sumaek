import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  capabilityScope,
  hasCapability,
} from "../../src/authz/capabilities";
import type { Role } from "../../src/authz/matrix";

/* ─────────────────────────────────────────────────────────────
 * 작업 단위 권한 (T5.2).
 *
 * 지금까지 권한은 **메뉴** 단위였다(matrix.ts). 그래서 학생 계정 발급이
 * `settings` 쓰기에 묶여 있었고, 기본 매트릭스에서 그것은 owner뿐이다 —
 * 담당 교사가 자기 반 학생에게 로그인을 만들어 줄 수 없다(G-07).
 *
 * 메뉴 권한을 넓히는 것으로 풀 수 없다. `settings` 쓰기를 교사에게 주면
 * 조직 설정·킬 스위치·정책까지 함께 열린다. 계정 발급은 메뉴보다 **좁은**
 * 단위라서, 그 단위를 새로 만든다.
 *
 * 겨누는 것:
 *   1) 교사가 settings 없이 계정을 다룰 수 있다 — 단 **담당 범위 안에서만**
 *   2) 채점자·콘텐츠 담당처럼 학생을 맡지 않는 역할은 못 한다
 *   3) 범위(scope)가 권한 여부와 함께 나온다 — 두 번 묻지 않게
 * ───────────────────────────────────────────────────────────── */

const ROLES: Role[] = [
  "owner",
  "program_director",
  "teacher",
  "grader",
  "content_manager",
  "content_reviewer",
  "student",
  "operator",
];

describe("학생 계정 관리 권한 (student_account.manage)", () => {
  it("owner와 프로그램 디렉터는 조직 전체를 다룬다", () => {
    for (const role of ["owner", "program_director"] as Role[]) {
      expect(hasCapability(role, "student_account.manage")).toBe(true);
      expect(capabilityScope(role, "student_account.manage")).toBe("organization");
    }
  });

  it("교사는 할 수 있되 담당 범위 안에서만이다", () => {
    /* 이 한 줄이 T5.2의 전부다. 넓히면 settings가 함께 열리고, 막으면
     * 교사가 학생에게 로그인을 만들어 줄 수 없다. */
    expect(hasCapability("teacher", "student_account.manage")).toBe(true);
    expect(capabilityScope("teacher", "student_account.manage")).toBe("assigned");
  });

  it("학생을 맡지 않는 역할은 계정을 다루지 못한다", () => {
    for (const role of [
      "grader",
      "content_manager",
      "content_reviewer",
      "student",
    ] as Role[]) {
      expect(hasCapability(role, "student_account.manage")).toBe(false);
      expect(capabilityScope(role, "student_account.manage")).toBe("none");
    }
  });

  it("운영자는 계정을 만들지 못한다 — 조회 권한과 발급 권한은 다르다", () => {
    /* 운영자는 장애 대응으로 여러 메뉴를 읽는다. 읽는 것과 남의 학생에게
     * 로그인 수단을 주는 것은 무게가 다르다 (4장 break-glass와 같은 원칙). */
    expect(hasCapability("operator", "student_account.manage")).toBe(false);
  });

  it("모르는 능력은 아무도 갖지 못한다 — 기본값이 허용이 되지 않게", () => {
    for (const role of ROLES) {
      expect(
        hasCapability(role, "never.heard.of.this" as never),
      ).toBe(false);
    }
  });

  it("정의된 능력에는 전부 모든 역할의 답이 있다", () => {
    /* 역할이 늘 때 표에서 빠지면 그 역할은 조용히 「없음」이 된다. 그 편이
     * 안전하지만, 빠뜨린 것과 정한 것을 구분할 수 없게 되므로 검사한다. */
    for (const cap of CAPABILITIES) {
      for (const role of ROLES) {
        expect(typeof hasCapability(role, cap)).toBe("boolean");
      }
    }
  });
});
