import type { ReactNode } from "react";

/* ─────────────────────────────────────────────────────────────
 * 가로로 넘치는 내용을 감싸는 상자 (표·도해).
 *
 * 좁은 화면에서 `overflow-x-auto`만 걸면 마우스 휠·터치 드래그로만 밀 수 있다.
 * 키보드만 쓰는 사용자에게는 잘린 열이 아예 없는 것과 같다 (WCAG 2.1.1 키보드).
 * 상자 자체를 탭 정지로 만들고 이름을 붙여, 탭으로 들어와 화살표로 밀 수 있게 한다.
 * axe 규칙 scrollable-region-focusable이 이 누락을 잡는다.
 *
 * 포커스 링을 반드시 남긴다 — 탭 정지를 늘려놓고 어디에 있는지 안 보이면
 * 규칙만 통과하고 사용성은 더 나빠진다 (WCAG 2.4.7).
 * ───────────────────────────────────────────────────────────── */
export function ScrollableRegion({
  label,
  className = "",
  children,
}: {
  /** 탭으로 들어왔을 때 읽히는 이름 — 무엇을 밀고 있는지 알려준다 */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-pen ${className}`}
    >
      {children}
    </div>
  );
}
