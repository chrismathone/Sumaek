"use client";

import { useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────────
 * 행 안 액션의 결과 알림.
 *
 * 표 안에서 결과 문구를 그 자리에 그리면 행 높이가 늘어나 표가 출렁인다.
 * position:fixed로 띄우면 레이아웃 흐름에서 빠져 **행 높이가 그대로**다.
 * DOM 트리에서는 여전히 그 행의 자손이라 E2E의 행 스코프 조회
 * (row.getByRole("status"))도 그대로 동작한다.
 *
 * 자동으로 사라지되, 읽는 중에 닫히지 않도록 마우스를 올리면 멈춘다.
 * ───────────────────────────────────────────────────────────── */

const AUTO_DISMISS_MS = 6000;

export function ActionToast({
  ok,
  children,
  /** 같은 값이 유지되면 같은 알림으로 본다 — 새 결과가 오면 타이머가 다시 시작된다 */
  resultKey,
}: {
  ok: boolean;
  children: React.ReactNode;
  resultKey: unknown;
}) {
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);

  /* 새 결과가 오면 다시 띄운다 — effect가 아니라 **렌더 중 상태 조정**이다.
   * effect에서 setState하면 한 번 그린 뒤 다시 그리는 연쇄 렌더가 된다
   * (react-hooks/set-state-in-effect). */
  const [lastKey, setLastKey] = useState(resultKey);
  if (resultKey !== lastKey) {
    setLastKey(resultKey);
    setVisible(true);
  }

  useEffect(() => {
    if (!visible || paused) return;
    const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible, paused, resultKey]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
        ok
          ? "border-pen bg-surface text-ink"
          : "border-grade bg-grade-soft text-grade"
      }`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="알림 닫기"
        className="shrink-0 text-ink-soft hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}
