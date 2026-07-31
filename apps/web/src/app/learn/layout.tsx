import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { signOut } from "@/app/(auth)/login/actions";

/* 학생 학습·응시 셸 (18장) — 한 화면에 한 가지 주요 행동.
 * 교사용 정보 밀도를 가져오지 않는다. */

export default async function LearnLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const learner = await getCurrentLearner();
  if (!learner) redirect("/login?next=/learn/today");

  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-40 border-b border-rule-soft bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Link href="/learn/today" className="font-bold">
            수맥
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
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}
