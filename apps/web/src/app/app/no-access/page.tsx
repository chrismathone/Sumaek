import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { MenuKey } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import { NAV_GROUPS, visibleNavGroups } from "@/lib/nav";

export const metadata: Metadata = { title: "접근 권한 없음" };

/* 읽기 게이트 거부 안내 (requireAccess의 착지 지점).
 * 이 화면은 게이트를 걸지 않는다 — 걸면 거부된 사용자가 갈 곳이 없다. */

const MENU_LABEL = new Map<MenuKey, string>(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.menu, i.label] as const)),
);

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ menu?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/today");

  const { menu } = await searchParams;
  const label = MENU_LABEL.get(menu as MenuKey);
  const groups = visibleNavGroups(user.role);

  return (
    <div className="mx-auto max-w-lg py-8">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">접근 권한이 없습니다</h1>
      <p className="mt-2 text-sm text-ink-soft">
        {label ? `‘${label}’ 화면은 ` : "이 화면은 "}
        현재 역할(<span className="font-mono">{user.role}</span>)에 열려 있지 않습니다.
        권한이 필요하면 워크스페이스 소유자에게 요청하세요.
      </p>

      {groups.length > 0 ? (
        <div className="mt-6 rounded-[var(--radius-control)] border border-rule bg-surface p-4">
          <p className="text-sm font-medium">열 수 있는 화면</p>
          <ul className="mt-2 space-y-1">
            {groups.flatMap((group) =>
              group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-pen underline underline-offset-4"
                  >
                    {item.label}
                  </Link>
                </li>
              )),
            )}
          </ul>
        </div>
      ) : (
        <p className="mt-6 text-sm text-ink-soft">
          현재 역할로 열 수 있는 화면이 없습니다. 소유자에게 역할 확인을 요청하세요.
        </p>
      )}
    </div>
  );
}
