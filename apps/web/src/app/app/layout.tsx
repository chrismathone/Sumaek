import Link from "next/link";
import { redirect } from "next/navigation";
import {
  DEFAULT_MATRIX,
  canAccess,
  type MenuKey,
} from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import { signOut } from "@/app/(auth)/login/actions";

/* 교사 앱 셸 (골프롬프트 8장) — 좌측 내비 5그룹 + 상단 바.
 * 진짜 인증 검증은 여기서 한다 (프록시는 쿠키 존재만 확인). */

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{ href: string; label: string; menu: MenuKey }>;
}> = [
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

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/today");
  if (user.role === "student") redirect("/learn/today");

  const matrix = DEFAULT_MATRIX;

  return (
    <div className="flex min-h-dvh bg-paper">
      {/* 좌측 내비 */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-rule-soft bg-ink text-white/85 lg:flex">
        <div className="px-4 py-4">
          <Link href="/app/today" className="text-lg font-bold text-white">
            수맥
          </Link>
          <p className="mt-0.5 truncate font-mono text-[11px] text-white/60">
            {user.organizationName}
          </p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4" aria-label="주요 메뉴">
          {NAV_GROUPS.map((group) => {
            const visible = group.items.filter((item) =>
              canAccess(matrix, user.role, item.menu),
            );
            if (visible.length === 0) return null;
            return (
              <div key={group.title}>
                <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-white/50">
                  {group.title}
                </p>
                <ul>
                  {visible.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="block rounded-[var(--radius-control)] px-2 py-1.5 text-sm hover:bg-white/10 hover:text-white"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-3">
          <p className="truncate text-sm text-white">{user.displayName}</p>
          <form action={signOut}>
            <button type="submit" className="mt-1 text-xs text-white/60 hover:text-white">
              로그아웃
            </button>
          </form>
        </div>
      </aside>

      {/* 본문 */}
      <div className="min-w-0 flex-1">
        <header className="flex h-12 items-center justify-between border-b border-rule-soft bg-surface px-4 lg:px-6">
          <p className="font-mono text-xs text-ink-soft">
            2026학년도 2학기 · {user.organizationName}
          </p>
          <p className="text-sm lg:hidden">{user.displayName}</p>
        </header>
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
