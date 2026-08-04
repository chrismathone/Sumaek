import Link from "next/link";

/* ─────────────────────────────────────────────────────────────
 * 학생의 목적지 전환 — 두 곳뿐이다.
 *
 * 셸(learn/layout.tsx)이 아니라 **화면이 렌더한다.** 그래야 응시 화면
 * (/learn/tests/[id])은 이것을 부르지 않는 것만으로 내비가 없다 — 서버가
 * 마감을 검사하지 않는 상태에서 상시 내비를 띄우는 것은 시험 도중 이탈을
 * 권하는 셈이다. 라우트 그룹도 data 스위치도 필요 없어진다.
 *
 * **규칙: 내비를 렌더하지 않는 화면은 반드시 본문에 돌아가는 길을 둔다.**
 * (개념 공부·인강·연습·복습은 「오늘 학습으로 돌아가기」를 이미 갖고 있다.
 * 응시 화면만 아직 없는데, 그 문구를 고르는 일은 마감 검사와 함께 판단할
 * 문제라 여기서 손대지 않고 남겨 둔다.)
 *
 * lib/nav.ts의 NAV_GROUPS를 늘리지 않는다 — 그것은 교사 메뉴 × 역할
 * 매트릭스이고 student 역할은 그 공간에 없다. role="tablist"도 쓰지 않는다:
 * 랜딩의 FlowTabs가 그것으로 aria-required-children 계열을 세 개 터뜨린
 * 전례가 있다. 링크 두 개는 링크 두 개로 둔다.
 * ───────────────────────────────────────────────────────────── */

const TABS = [
  { key: "today", href: "/learn/today", label: "오늘 학습" },
  { key: "homework", href: "/learn/homework", label: "숙제" },
  { key: "records", href: "/learn/records", label: "지난 기록" },
] as const;

export type LearnTabKey = (typeof TABS)[number]["key"];

export function LearnTabs({ current }: { current: LearnTabKey }) {
  return (
    <nav aria-label="학습 화면" className="mb-4 flex gap-1.5">
      {TABS.map((t) => {
        const on = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-sm ${
              on
                ? "border-pen bg-pen font-medium text-white"
                : "border-rule bg-surface text-ink-soft"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
