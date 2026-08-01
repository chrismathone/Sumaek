import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  DEFAULT_MATRIX,
  MENU_KEYS,
  canAccess,
  type MenuKey,
} from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import { NAV_GROUPS, visibleNavGroups, type NavItem } from "@/lib/nav";

export const metadata: Metadata = { title: "접근 권한 없음" };

/* 읽기 게이트 거부 안내 (requireAccess의 착지 지점).
 * 이 화면은 게이트를 걸지 않는다 — 걸면 거부된 사용자가 갈 곳이 없다.
 *
 * 다만 ?menu=는 근거가 아니라 **주장**이다 — 주소창에 직접 칠 수 있다.
 * 그 값을 그대로 믿고 문구를 쓰면 owner가 ?menu=learners로 들어왔을 때
 * 실제로는 full인 화면을 두고 "열려 있지 않습니다"라고 거짓을 말한다.
 * 그래서 안내를 쓰기 전에 매트릭스를 다시 본다 — requireAccess·lib/nav와
 * 같은 표(DEFAULT_MATRIX)를 같은 canAccess로. 이 화면은 거부를 판정하지
 * 않고 이미 내려진 판정을 확인만 하므로, 확인 결과가 파라미터와 어긋나면
 * 그건 문구 문제가 아니라 링크를 만든 쪽의 버그다. */

/** 메뉴 키 → 내비 항목. 라벨과 착지 경로가 같은 표에서 나온다 (lib/nav가 단일 소스) */
const NAV_BY_MENU = new Map<MenuKey, NavItem>(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.menu, i] as const)),
);

/** 모르는 ?menu= 값으로 화면 이름을 지어내지 않는다 — 유효한 키가 아니면 null */
function toMenuKey(value: string | undefined): MenuKey | null {
  return MENU_KEYS.find((key) => key === value) ?? null;
}

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ menu?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/today");

  const { menu } = await searchParams;
  const menuKey = toMenuKey(menu);
  /* 교사 앱 내비에 없는 메뉴(learn)는 여기서 안내할 화면이 아니다 — 그 메뉴가
   * 열리는 유일한 역할인 student는 셸(app/layout.tsx)에서 /learn으로 돌아간다. */
  const target = menuKey ? (NAV_BY_MENU.get(menuKey) ?? null) : null;

  /* 실은 열려 있었다 — 사과문을 보여줄 이유가 없으니 원래 가려던 곳으로 보낸다.
   * 그 페이지도 같은 매트릭스로 게이트하므로(read-gate 회귀 검사가 메뉴 키
   * 일치를 강제한다) 여기로 되돌아오는 루프는 생기지 않는다. */
  if (target && canAccess(DEFAULT_MATRIX, user.role, target.menu)) {
    redirect(target.href);
  }

  const label = target?.label ?? null;
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
