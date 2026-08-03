import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { getCurrentUser } from "@/lib/auth/current-user";
import { firstAccessibleHref } from "@/lib/nav";
import { signOut } from "@/app/(auth)/login/actions";
import { SumaekLogo } from "@/components/brand/SumaekLogo";

/* 학생 학습·응시 셸 (18장) — 한 화면에 한 가지 주요 행동.
 * 교사용 정보 밀도를 가져오지 않는다.
 *
 * 거부 사유를 구분한다 — 전부 /login으로 보내면 이미 로그인한 교직원이
 * 로그인→next=/learn/today→다시 거부로 무한 루프에 빠진다 (proxy.ts의
 * 실사고 주석과 같은 형태). 미인증만 로그인으로 보낸다. */

export default async function LearnLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/learn/today");
  // 교직원 — 학생 영역이 아니므로 자기 영역으로 되돌린다
  if (user.role !== "student") {
    redirect(firstAccessibleHref(user.role) ?? "/app/no-access");
  }

  const learner = await getCurrentLearner();
  // 학생인데 학습자 연결이 없다 — 갈 수 있는 다른 화면이 없으므로 안내로 끝낸다
  if (!learner) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="font-[MaruBuri] text-xl font-semibold">
          학습자 정보가 연결되지 않았습니다
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          계정은 있지만 학습자 명단과 연결되어 있지 않습니다. 선생님께 계정 연결을
          요청하세요.
        </p>
        <form action={signOut} className="mt-6">
          <button type="submit" className="text-sm text-pen underline underline-offset-4">
            로그아웃
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="group min-h-dvh bg-paper">
      {/* 학생 셸에도 스킵 링크를 둔다 — 화면 상단에 반복 내비(LearnTabs)가
       * 생겼으므로 키보드 사용자가 매번 두 링크를 지나게 된다. 교사 셸과
       * 같은 마크업이다. */}
      <a
        href="#main-content"
        className="sr-only z-50 focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded-[var(--radius-control)] focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        본문으로 건너뛰기
      </a>
      <header className="sticky top-0 z-40 border-b border-rule-soft bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4 group-has-[[data-wide]]:max-w-6xl">
          <Link href="/learn/today" aria-label="수맥 오늘의 학습" className="shrink-0">
            <SumaekLogo
              variant="header"
              className="h-9 w-auto"
              sizes="80px"
            />
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span>{learner.displayName}</span>
            <form action={signOut}>
              <button type="submit" className="text-xs text-ink-soft hover:text-ink">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>
      {/* 기본은 좁은 한 줄(한 화면에 한 행동). 읽기 위주 화면만 data-wide로
       * 넓힌다 — 개념 공부가 넓은 화면에서 2단으로 흐르기 위한 스위치. */}
      <main
        id="main-content"
        className="mx-auto max-w-2xl px-4 py-6 has-[[data-wide]]:max-w-6xl"
      >
        {children}
      </main>
    </div>
  );
}
