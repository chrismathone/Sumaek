"use client";

import { useActionState } from "react";
import { uploadSourceFile, type UploadState } from "./actions";

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState | null, FormData>(
    uploadSourceFile,
    null,
  );

  return (
    <div className="rounded-lg border border-rule bg-surface p-5">
      <h2 className="font-semibold">원본 PDF 업로드</h2>
      <p className="mt-1 text-sm text-ink-soft">
        업로드 즉시 문항을 추출합니다 (현재 mock 추출기 — 실제 AI 공급자 연결
        시 비동기 작업으로 전환). 추출된 문항은 전부 검수 대기 상태로 들어가며
        검수·권한 확인 전에는 출제되지 않습니다.
      </p>
      <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="up-file" className="block text-sm font-medium">
            PDF 파일 (최대 20MB)
          </label>
          <input
            id="up-file"
            name="file"
            type="file"
            accept="application/pdf"
            required
            className="mt-1 block text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-rule file:bg-paper file:px-3 file:py-1.5 file:text-sm"
          />
        </div>
        <div>
          <label htmlFor="up-rights" className="block text-sm font-medium">
            권리자·출처 (필수)
          </label>
          <input
            id="up-rights"
            name="rightsHolder"
            type="text"
            required
            placeholder="예: 자체 제작 / OO출판사 계약분"
            className="mt-1 w-56 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "추출 중…" : "업로드·추출"}
        </button>
      </form>
      {state && (
        <p
          role="status"
          className={`mt-3 rounded-[var(--radius-control)] px-3 py-2 text-sm ${
            state.ok ? "bg-pen-soft/60" : "bg-grade-soft text-grade"
          }`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
