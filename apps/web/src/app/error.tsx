"use client";

import Link from "next/link";

/* 전역 오류 착지 지점 — 렌더 중 던져진 예외가 여기로 온다 (루트 레이아웃 자체의 오류는 제외).
 * 오류 메시지·스택은 사용자에게 보이지 않는다. 서버가 남긴 digest만 대조용으로 내보낸다.
 * 이 화면도 교사인지 학생인지 모른 채 렌더되므로 역할 전용 경로로 보내지 않는다. */

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <p className="font-mono text-xs text-grade">오류</p>
      <h1 className="mt-1 font-[MaruBuri] text-2xl font-semibold">
        화면을 여는 중 오류가 났습니다
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        요청을 끝내지 못했습니다. 방금 하던 작업은 반영되지 않았을 수 있으니 다시 열어
        확인하세요.
      </p>

      <div className="mt-6 rounded-[var(--radius-control)] border border-rule bg-surface p-4">
        <p className="text-sm font-medium">여기서 할 수 있는 것</p>
        <p className="mt-2 text-sm text-ink-soft">
          보던 화면으로는 브라우저 뒤로가기로 돌아갈 수 있습니다.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            다시 시도
          </button>
          <Link
            href="/"
            className="rounded-[var(--radius-control)] border border-rule bg-surface px-4 py-2 text-sm font-medium"
          >
            홈으로
          </Link>
        </div>
      </div>

      {error.digest && (
        <p className="mt-4 font-mono text-xs text-ink-soft">
          오류 번호 {error.digest} — 문의할 때 이 번호를 함께 알려 주세요.
        </p>
      )}
    </div>
  );
}
