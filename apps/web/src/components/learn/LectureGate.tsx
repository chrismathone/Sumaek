"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import Link from "next/link";

/* ─────────────────────────────────────────────────────────────
 * 인강을 다 봐야 다음으로 — 개념 쪽의 잠금.
 *
 * 서버 컴포넌트(개념 쪽)는 시청이 끝나는 순간을 알 수 없다. 플레이어가
 * 클라이언트에서 완료를 알리고, 다음 버튼이 그것을 읽는다. 서버를
 * revalidate로 다시 그리지 않는 이유는 재생 중 화면이 새로 그려지면 보던
 * 영상이 끊기기 때문이다 — 잠금 해제는 화면 상태로만 처리하고, 진도 자체는
 * 서버에 이미 저장돼 있어 새로고침해도 유지된다.
 *
 * 영상이 0건인 개념에서는 잠그지 않는다(total 0). 볼 것이 없는데 막으면
 * 학생이 갈 곳을 잃는다.
 * ───────────────────────────────────────────────────────────── */

interface GateValue {
  markDone: (materialId: string) => void;
}

const Ctx = createContext<GateValue | null>(null);
const RemainCtx = createContext<number>(0);

export function useLectureGate(): GateValue | null {
  return useContext(Ctx);
}

export function LectureGate({
  videoIds,
  initialDoneIds,
  children,
}: {
  videoIds: string[];
  initialDoneIds: string[];
  children: React.ReactNode;
}) {
  const [done, setDone] = useState<string[]>(initialDoneIds);
  const markDone = useCallback((materialId: string) => {
    setDone((prev) => (prev.includes(materialId) ? prev : [...prev, materialId]));
  }, []);
  const remain = videoIds.filter((id) => !done.includes(id)).length;
  const value = useMemo(() => ({ markDone }), [markDone]);
  return (
    <Ctx.Provider value={value}>
      <RemainCtx.Provider value={remain}>{children}</RemainCtx.Provider>
    </Ctx.Provider>
  );
}

/** 다음으로 가는 버튼 — 남은 인강이 있으면 잠긴다 */
export function GatedNextLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const remain = useContext(RemainCtx);
  if (remain > 0) {
    return (
      <div className="text-right">
        <span
          aria-disabled
          className="inline-block cursor-not-allowed rounded-[var(--radius-control)] border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink-soft"
        >
          {label}
        </span>
        {/* 왜 잠겼는지 말한다 — 잠긴 버튼만 두면 고장으로 보인다 */}
        <p className="mt-1.5 text-xs break-keep text-ink-soft">
          인강 {remain}건을 끝까지 보면 열립니다.
        </p>
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-[var(--radius-control)] border border-pen bg-pen px-4 py-2 text-sm font-medium text-white"
    >
      {label}
    </Link>
  );
}
