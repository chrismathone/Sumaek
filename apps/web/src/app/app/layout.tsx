import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { visibleNavGroups } from "@/lib/nav";
import { signOut } from "@/app/(auth)/login/actions";

/* 교사 앱 셸 (골프롬프트 8장) — 좌측 내비 5그룹 + 상단 바.
 * 진짜 인증 검증은 여기서 한다 (프록시는 쿠키 존재만 확인).
 * 내비 정의는 lib/nav.ts가 단일 소스 — 페이지의 읽기 게이트와 같은 표를 본다.
 * 링크 숨김은 접근 제한이 아니므로 각 페이지가 requireAccess로 따로 막는다. */

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/today");
  if (user.role === "student") redirect("/learn/today");

  const visibleGroups = visibleNavGroups(user.role);

  return (
    <div className="flex min-h-dvh bg-paper">
      {/* 키보드 사용자용 스킵 링크 (인수 15) */}
      <a
        href="#main-content"
        className="sr-only z-50 focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded-[var(--radius-control)] focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        본문으로 건너뛰기
      </a>
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
          {visibleGroups.map((group) => (
            <div key={group.title}>
              <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-white/50">
                {group.title}
              </p>
              <ul>
                {group.items.map((item) => (
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
          ))}
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
          {/* 모바일 내비 (인수 15) — details 기반: JS 없이 키보드 접근 가능 */}
          <details className="relative lg:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
              메뉴
              <span aria-hidden="true" className="text-xs">☰</span>
            </summary>
            <nav
              aria-label="모바일 메뉴"
              className="absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-[80dvh] w-64 overflow-y-auto rounded-lg border border-rule bg-ink p-3 text-white/85 shadow-lg"
            >
              {visibleGroups.map((group) => (
                <div key={group.title} className="mb-3 last:mb-0">
                  <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-white/50">
                    {group.title}
                  </p>
                  <ul>
                    {group.items.map((item) => (
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
              ))}
              <div className="mt-2 border-t border-white/10 px-2 pt-2">
                <p className="truncate text-sm text-white">{user.displayName}</p>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="mt-1 text-xs text-white/60 hover:text-white"
                  >
                    로그아웃
                  </button>
                </form>
              </div>
            </nav>
          </details>
        </header>
        <main id="main-content" className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
