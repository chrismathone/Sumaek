"use client";

import { useActionState } from "react";
import Link from "next/link";
import { completeHomework, type HomeworkResult } from "./actions";

/**
 * 완료 표시 폼.
 *
 * 연습문제 숙제는 먼저 풀러 보내고, 교재 범위는 그 자리에서 확인만 받는다 —
 * 학생이 하는 일이 다르므로 버튼도 달라야 한다. 「완료」 하나로 묶으면
 * 연습문제를 풀지 않고 눌러 버리는 길이 열린다.
 */
export function HomeworkForm({
  itemKey,
  materialId,
}: {
  itemKey: string;
  materialId: string | null;
}) {
  const [state, action, pending] = useActionState<HomeworkResult | null, FormData>(
    completeHomework,
    null,
  );

  return (
    <div className="mt-3">
      {materialId && (
        <Link
          href="/learn/practice"
          className="mr-2 inline-block rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm hover:bg-paper"
        >
          연습문제 풀러 가기
        </Link>
      )}
      <form action={action} className="inline">
        <input type="hidden" name="itemKey" value={itemKey} />
        {materialId && <input type="hidden" name="materialId" value={materialId} />}
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "저장 중…" : materialId ? "다 풀었습니다" : "확인했습니다"}
        </button>
      </form>
      {state && (
        <p
          role="status"
          className="mt-2 text-sm break-keep text-ink-soft"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
