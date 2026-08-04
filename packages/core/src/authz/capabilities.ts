import type { Role } from "./matrix";

/* ─────────────────────────────────────────────────────────────
 * 작업 단위 권한 (T5.2 · G-07).
 *
 * 지금까지 권한은 **메뉴** 단위였다(matrix.ts). 학생 계정 발급이 `settings`
 * 쓰기에 묶여 있었고 기본 매트릭스에서 그것은 owner뿐이라, 담당 교사가 자기
 * 반 학생에게 로그인을 만들어 줄 수 없었다.
 *
 * 메뉴 권한을 넓혀서는 풀 수 없다. `settings` 쓰기를 교사에게 주면 조직
 * 설정·킬 스위치·정책까지 함께 열린다. 계정 발급은 메뉴보다 **좁은** 단위라
 * 그 단위를 새로 만든다.
 *
 * 메뉴 매트릭스를 대체하지 않는다. 화면 노출과 읽기 게이트는 그대로 메뉴가
 * 정하고, 여기서 정하는 것은 「그 화면 안에서 이 작업을 해도 되는가」다.
 * ───────────────────────────────────────────────────────────── */

export const CAPABILITIES = ["student_account.manage"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * 능력의 범위.
 *
 * `assigned`가 이 모듈의 핵심이다 — 「할 수 있다」와 「누구에게 할 수
 * 있다」를 한 번에 답해야, 화면이 권한을 확인하고 대상을 또 확인하는
 * 두 걸음에서 한쪽을 빠뜨리지 않는다. 실제로 학생 흐름에는 그런 결손이
 * 있었다(스코프 없는 저장 경로).
 */
export type CapabilityScope =
  /** 조직 전체 */
  | "organization"
  /** 자기가 맡은 반의 학생만 */
  | "assigned"
  | "none";

const SCOPES: Readonly<Record<Capability, Readonly<Record<Role, CapabilityScope>>>> = {
  "student_account.manage": {
    owner: "organization",
    program_director: "organization",
    /* 담당 반의 학생만. 넓히면 settings가 함께 열리고, 막으면 교사가
     * 학생에게 로그인을 만들어 줄 수 없다 — 그 사이가 이 값이다. */
    teacher: "assigned",
    grader: "none",
    content_manager: "none",
    content_reviewer: "none",
    student: "none",
    /* 운영자는 장애 대응으로 여러 메뉴를 읽는다. 읽는 것과 남의 학생에게
     * 로그인 수단을 주는 것은 무게가 다르다 (4장 break-glass와 같은 원칙). */
    operator: "none",
  },
};

/** 정의되지 않은 능력·역할은 언제나 `none`이다 — 기본값이 허용이 되지 않게. */
export function capabilityScope(
  role: Role,
  capability: Capability,
): CapabilityScope {
  return SCOPES[capability]?.[role] ?? "none";
}

export function hasCapability(role: Role, capability: Capability): boolean {
  return capabilityScope(role, capability) !== "none";
}
