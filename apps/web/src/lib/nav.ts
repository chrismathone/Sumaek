import { DEFAULT_MATRIX, canAccess, type MenuKey, type Role } from "@su-maek/core/authz";

/* ─────────────────────────────────────────────────────────────
 * 교사 앱 내비 정의 — 라우트와 메뉴 키의 **단일 소스**.
 *
 * 셸(app/layout.tsx)의 링크 노출과 페이지의 읽기 게이트(requireAccess)가
 * 같은 표를 본다. 메뉴를 추가하면서 게이트를 빠뜨리는 드리프트를 막는다.
 * ───────────────────────────────────────────────────────────── */

export interface NavItem {
  href: string;
  label: string;
  menu: MenuKey;
}

export const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "오늘 수업",
    items: [
      { href: "/app/today", label: "오늘 수업", menu: "today" },
      { href: "/app/calendar", label: "캘린더", menu: "calendar" },
      { href: "/app/grading", label: "채점·예외", menu: "grading" },
      { href: "/app/inbox", label: "알림·업무함", menu: "inbox" },
    ],
  },
  {
    title: "수업 설계",
    items: [
      { href: "/app/routes", label: "학습 루트", menu: "routes" },
      { href: "/app/content/curriculum", label: "커리큘럼 스튜디오", menu: "curriculum_studio" },
      { href: "/app/content/books", label: "교재", menu: "books" },
    ],
  },
  {
    title: "평가·문항",
    items: [
      { href: "/app/tests", label: "일일·확인테스트", menu: "tests" },
      { href: "/app/content/questions", label: "문제은행", menu: "question_bank" },
      { href: "/app/content/ingestion", label: "문제집 변환", menu: "ingestion" },
      { href: "/app/content/review", label: "콘텐츠 검수", menu: "content_review" },
    ],
  },
  {
    title: "학습 분석",
    items: [
      { href: "/app/classes", label: "반·학습 그룹", menu: "groups" },
      { href: "/app/students", label: "학습자", menu: "learners" },
      { href: "/app/analytics", label: "개념 숙련도", menu: "mastery" },
      { href: "/app/reports", label: "리포트", menu: "reports" },
    ],
  },
  {
    title: "연동·설정",
    items: [
      { href: "/app/settings/integrations", label: "외부 명단 연동", menu: "integrations" },
      { href: "/app/settings", label: "설정", menu: "settings" },
      { href: "/app/audit", label: "감사 로그", menu: "audit" },
    ],
  },
];

/** 역할이 열 수 있는 메뉴만 남긴 내비 */
export function visibleNavGroups(role: Role) {
  return NAV_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => canAccess(DEFAULT_MATRIX, role, item.menu)),
  })).filter((group) => group.items.length > 0);
}

/**
 * 역할이 열 수 있는 첫 화면. 접근 거부 시 리다이렉트 대상으로 쓴다 —
 * 고정 경로(/app/today)로 보내면 그 메뉴가 none인 역할(content_manager 등)이
 * 무한 루프에 빠진다. 열 수 있는 메뉴가 하나도 없으면 null.
 */
export function firstAccessibleHref(role: Role): string | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (canAccess(DEFAULT_MATRIX, role, item.menu)) return item.href;
    }
  }
  return null;
}
