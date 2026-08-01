/* ─────────────────────────────────────────────────────────────
 * 역할 × 메뉴 권한 매트릭스 (골프롬프트 4장 · eywa 검증 패턴).
 *
 * - 접근 수준: full(전체) | scoped(담당 범위) | readonly(읽기) | none.
 * - canAccess(읽기 게이트)와 canWrite(쓰기 게이트)를 분리한다 —
 *   변경 액션에 canAccess를 쓰면 readonly 역할이 새어 들어간다 (eywa 실사고).
 * - scoped는 메뉴만 열어줄 뿐이다 — 데이터 범위는 membership_scopes 기반
 *   쿼리 필터가 별도로 책임진다 (권한과 스코프의 직교).
 * - 테넌트 오버라이드는 sparse하게 기본 매트릭스 위에 병합하되,
 *   가드레일(isPermissionLocked)에 걸리는 칸은 무시한다.
 * - DB의 RESTRICTIVE RLS 정책과 이중 방어 — 여기만 믿지 않는다.
 * ───────────────────────────────────────────────────────────── */

export const ROLES = [
  "owner",
  "program_director",
  "teacher",
  "grader",
  "content_manager",
  "content_reviewer",
  "student",
  /**
   * break-glass 운영자 (27장 · 인수 28). **멤버십으로 부여되지 않는다** —
   * DB의 member_role enum에는 이 값이 없고, 유효한 operator_access_grants
   * 승인이 살아 있는 동안에만 세션에서 만들어진다. 승인이 만료되면 다음
   * 요청에서 세션 자체가 성립하지 않는다 (auth/current-user.ts).
   */
  "operator",
] as const;
export type Role = (typeof ROLES)[number];

export const MENU_KEYS = [
  // 오늘 수업
  "today",
  "calendar",
  "grading",
  "inbox",
  // 수업 설계
  "routes",
  "curriculum_studio",
  "books",
  "materials",
  // 평가·문항
  "tests",
  "question_bank",
  "ingestion",
  "content_review",
  // 학습 분석
  "groups",
  "learners",
  "mastery",
  "reports",
  // 연동·설정
  "integrations",
  "settings",
  "audit",
  // 학생 앱
  "learn",
] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export type AccessLevel = "full" | "scoped" | "readonly" | "none";

type Matrix = Record<MenuKey, Record<Role, AccessLevel>>;

/**
 * 기본 매트릭스 — 워크스페이스 오버라이드의 기준값.
 *
 * operator 열은 **어떤 칸도 full·scoped가 아니다**. 그래서 canWrite는 메뉴를
 * 하나씩 손보지 않아도 전 메뉴에서 false를 돌려준다 — break-glass 접근이
 * 읽기 전용이라는 사실이 매트릭스 자체에 적혀 있고, 앞으로 추가될 쓰기
 * 액션도 canWrite 게이트만 지키면 자동으로 닫힌다.
 *
 * 학습자 개인 데이터 화면(today·grading·inbox·groups·learners·mastery·reports)은
 * 승인이 유효해도 operator에게 열리지 않는다 — 운영자 접근은 장애 진단용
 * 최소 권한이지 대리 운영 권한이 아니다 (콘텐츠 역할 가드레일과 같은 이유, 4장).
 */
export const DEFAULT_MATRIX: Matrix = {
  today: { owner: "full", program_director: "full", teacher: "scoped", grader: "scoped", content_manager: "none", content_reviewer: "none", student: "none", operator: "none" },
  calendar: { owner: "full", program_director: "full", teacher: "scoped", grader: "readonly", content_manager: "none", content_reviewer: "none", student: "none", operator: "readonly" },
  grading: { owner: "full", program_director: "full", teacher: "scoped", grader: "scoped", content_manager: "none", content_reviewer: "none", student: "none", operator: "none" },
  inbox: { owner: "full", program_director: "full", teacher: "scoped", grader: "scoped", content_manager: "scoped", content_reviewer: "scoped", student: "none", operator: "none" },
  routes: { owner: "full", program_director: "full", teacher: "scoped", grader: "none", content_manager: "none", content_reviewer: "none", student: "none", operator: "readonly" },
  curriculum_studio: { owner: "full", program_director: "full", teacher: "readonly", grader: "none", content_manager: "full", content_reviewer: "readonly", student: "none", operator: "readonly" },
  books: { owner: "full", program_director: "full", teacher: "readonly", grader: "none", content_manager: "full", content_reviewer: "readonly", student: "none", operator: "readonly" },
  /* 학습 자료(개념 공부·인강·연습문제) — 교사가 **쓸 수 있는** 유일한 콘텐츠 메뉴다.
   * 다른 콘텐츠 메뉴(curriculum_studio·books·question_bank)는 teacher가 readonly인데,
   * 그것들이 다루는 것은 플랫폼 참조 데이터이거나 검수 사슬이 걸린 문항이기 때문이다.
   * 학습 자료는 담당 교사가 자기 학생을 위해 만드는 조직 소유 콘텐츠라 성격이 다르다 —
   * 여기까지 readonly로 두면 "보충 자료를 만드는 사람"이 제품 안에 아무도 없게 된다. */
  materials: { owner: "full", program_director: "full", teacher: "scoped", grader: "none", content_manager: "full", content_reviewer: "readonly", student: "none", operator: "readonly" },
  tests: { owner: "full", program_director: "full", teacher: "scoped", grader: "readonly", content_manager: "none", content_reviewer: "none", student: "none", operator: "readonly" },
  question_bank: { owner: "full", program_director: "full", teacher: "readonly", grader: "readonly", content_manager: "full", content_reviewer: "scoped", student: "none", operator: "readonly" },
  ingestion: { owner: "full", program_director: "readonly", teacher: "none", grader: "none", content_manager: "full", content_reviewer: "scoped", student: "none", operator: "readonly" },
  content_review: { owner: "full", program_director: "readonly", teacher: "none", grader: "none", content_manager: "full", content_reviewer: "scoped", student: "none", operator: "readonly" },
  groups: { owner: "full", program_director: "full", teacher: "scoped", grader: "readonly", content_manager: "none", content_reviewer: "none", student: "none", operator: "none" },
  learners: { owner: "full", program_director: "full", teacher: "scoped", grader: "scoped", content_manager: "none", content_reviewer: "none", student: "none", operator: "none" },
  mastery: { owner: "full", program_director: "full", teacher: "scoped", grader: "readonly", content_manager: "none", content_reviewer: "none", student: "none", operator: "none" },
  reports: { owner: "full", program_director: "full", teacher: "scoped", grader: "none", content_manager: "none", content_reviewer: "none", student: "none", operator: "none" },
  integrations: { owner: "full", program_director: "readonly", teacher: "none", grader: "none", content_manager: "none", content_reviewer: "none", student: "none", operator: "readonly" },
  settings: { owner: "full", program_director: "readonly", teacher: "none", grader: "none", content_manager: "none", content_reviewer: "none", student: "none", operator: "readonly" },
  audit: { owner: "readonly", program_director: "readonly", teacher: "none", grader: "none", content_manager: "none", content_reviewer: "none", student: "none", operator: "readonly" },
  learn: { owner: "none", program_director: "none", teacher: "none", grader: "none", content_manager: "none", content_reviewer: "none", student: "scoped", operator: "none" },
};

export interface MatrixOverride {
  menu: MenuKey;
  role: Role;
  access: AccessLevel;
}

/**
 * 가드레일 — 오버라이드로도 바꿀 수 없는 칸.
 * - owner의 settings/audit 접근 축소 금지 (복구 불능 락아웃 방지 — eywa 실사고 3).
 * - student는 learn 외 어떤 메뉴도 열 수 없고, learn을 닫을 수도 없다.
 * - operator(break-glass)는 어떤 칸도 오버라이드할 수 없다. 테넌트 설정으로
 *   운영자에게 쓰기를 열어줄 수 있으면 "읽기 전용 승인 접근"이라는 약속이
 *   워크스페이스마다 달라진다 — 승인은 기간을 정할 뿐 권한을 넓히지 않는다.
 * - 콘텐츠 역할(content_manager/reviewer)에게 학습자 개인 데이터 메뉴를
 *   열어줄 수 없다 (4장 — 콘텐츠 담당자는 학생 개인정보에 접근하지 않는다).
 */
export function isPermissionLocked(menu: MenuKey, role: Role): boolean {
  if (role === "owner" && (menu === "settings" || menu === "audit")) return true;
  if (role === "student") return true;
  if (role === "operator") return true;
  if (
    (role === "content_manager" || role === "content_reviewer") &&
    (menu === "learners" || menu === "mastery" || menu === "groups" ||
      menu === "today" || menu === "grading" || menu === "reports")
  ) {
    return true;
  }
  return false;
}

/** 기본 매트릭스 + 워크스페이스 오버라이드 병합 (잠긴 칸 무시) */
export function resolveMatrix(overrides: readonly MatrixOverride[]): Matrix {
  const matrix: Matrix = structuredClone(DEFAULT_MATRIX);
  for (const o of overrides) {
    if (!MENU_KEYS.includes(o.menu) || !ROLES.includes(o.role)) continue;
    if (isPermissionLocked(o.menu, o.role)) continue;
    matrix[o.menu][o.role] = o.access;
  }
  return matrix;
}

/** 읽기 게이트 — none만 차단 (readonly 통과) */
export function canAccess(matrix: Matrix, role: Role, menu: MenuKey): boolean {
  return matrix[menu][role] !== "none";
}

/** 쓰기 게이트 — full|scoped만 통과. 변경 액션은 반드시 이 함수를 쓴다. */
export function canWrite(matrix: Matrix, role: Role, menu: MenuKey): boolean {
  const level = matrix[menu][role];
  return level === "full" || level === "scoped";
}

/** scoped 여부 — 데이터 스코프 필터 적용이 필요한지 */
export function isScoped(matrix: Matrix, role: Role, menu: MenuKey): boolean {
  return matrix[menu][role] === "scoped";
}

/* ── 역할 위계 (eywa canAssignRole 알고리즘) ── */

const HIERARCHY: Record<Role, number> = {
  owner: 0,
  program_director: 1,
  teacher: 2,
  grader: 3,
  content_manager: 2,
  content_reviewer: 3,
  student: 9,
  operator: 9,
};

/**
 * 역할 부여 가능 판정 — actor가 새 역할보다 강하고, 대상보다도 강해야 한다
 * (자기보다 강한 사람의 권한 변경 금지).
 */
export function canAssignRole(
  actorRole: Role,
  targetCurrentRole: Role,
  newRole: Role,
): boolean {
  /* operator는 멤버십 역할이 아니다 — 부여도 회수도 이 경로가 아니라
   * break-glass 승인(operator_access_grants)에서만 일어난다. 여기서 막지
   * 않으면 위계상 약한 역할이라는 이유로 누구나 붙일 수 있게 된다. */
  if (newRole === "operator" || targetCurrentRole === "operator") return false;
  if (actorRole === "operator") return false;
  const actor = HIERARCHY[actorRole];
  // owner만 owner를 만들 수 있다
  if (newRole === "owner") return actorRole === "owner";
  return actor < HIERARCHY[newRole] && actor < HIERARCHY[targetCurrentRole];
}

/** 위험 작업 — 별도 재확인·재인증 요구 대상 (4장) */
export const REAUTH_REQUIRED_OPERATIONS = [
  "route.publish",
  "grading.bulk-regrade",
  "question.invalidate",
  "privacy.export",
  "schedule.bulk-change",
  "member.role-change",
  "data.delete",
] as const;
