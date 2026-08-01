"use client";

import { useActionState, useState } from "react";
import { ActionToast } from "@/components/ActionToast";
import { parseLectureMeta } from "@/lib/lecture-meta";
import {
  createMaterialAction,
  setMaterialStatusAction,
  type MaterialResult,
} from "./actions";

/* 학습 자료 생성 폼.
 *
 * 종류를 고르면 그 종류의 입력만 보인다 — 읽기 자료를 만들면서 유튜브 주소
 * 칸을 보는 것은 혼란만 준다. DB CHECK가 종류별 필수값을 강제하므로 화면도
 * 같은 모양이어야 한다. */

export function CreateMaterialForm({
  concepts,
  conceptQuery,
}: {
  concepts: Array<{ id: string; name: string }>;
  conceptQuery: string;
}) {
  const [state, action, pending] = useActionState<MaterialResult | null, FormData>(
    createMaterialAction,
    null,
  );
  const [kind, setKind] = useState<"reading" | "video" | "practice">("reading");
  const [metaNote, setMetaNote] = useState<string | null>(null);

  return (
    <div className="mt-4 rounded-lg border border-rule bg-surface p-5">
      <h2 className="font-semibold">학습 자료 만들기</h2>
      <p className="mt-1 text-sm text-ink-soft">
        개념에 붙습니다. 그 개념을 배우는 날 학생의 「오늘 학습」에 나타납니다.
        만들면 <strong className="font-medium">초안</strong>이고, 게시해야 학생에게
        보입니다.
      </p>

      {/* 개념 찾기 — 별도 GET 폼. 개념이 수천 개가 되어도 견디도록 목록을
          통째로 싣지 않고 검색으로 좁힌다. */}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <label htmlFor="cq" className="text-sm">
          <span className="block text-xs text-ink-soft">개념 찾기</span>
          <input
            id="cq"
            name="cq"
            type="search"
            defaultValue={conceptQuery}
            placeholder="개념 이름 또는 slug"
            className="mt-1 w-64 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
        >
          찾기
        </button>
        <span className="text-xs text-ink-soft">
          {conceptQuery
            ? `«${conceptQuery}» 결과 ${concepts.length}개`
            : `최근 개념 ${concepts.length}개 — 검색해 좁히세요`}
        </span>
      </form>

      <form action={action} className="mt-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor="conceptId" className="text-sm">
            <span className="block">개념</span>
            <select
              id="conceptId"
              name="conceptId"
              required
              className="mt-1 w-64 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm"
            >
              <option value="">개념 선택</option>
              {concepts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="kind" className="text-sm">
            <span className="block">종류</span>
            <select
              id="kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="mt-1 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm"
            >
              <option value="reading">개념 공부 (읽기)</option>
              <option value="video">개념 인강 (영상)</option>
              <option value="practice">연습문제</option>
            </select>
          </label>

          <label htmlFor="sortOrder" className="text-sm">
            <span className="block">순서</span>
            <input
              id="sortOrder"
              name="sortOrder"
              type="number"
              min={0}
              max={999}
              defaultValue={0}
              className="mt-1 w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm"
            />
          </label>
        </div>

        <label htmlFor="title" className="block text-sm">
          <span className="block">제목</span>
          <input
            id="title"
            name="title"
            required
            maxLength={200}
            placeholder="일차방정식 복습 — 핵심 정리"
            className="mt-1 block w-full max-w-xl rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
          />
        </label>

        {kind === "reading" && (
          <label htmlFor="body" className="block text-sm">
            <span className="block">본문</span>
            <span className="block text-xs text-ink-soft">
              수식은 $3x - 4 = 5$ 처럼 달러 기호 사이에 씁니다. 빈 줄로 문단을
              나눕니다.
            </span>
            <textarea
              id="body"
              name="body"
              rows={6}
              className="mt-1 block w-full max-w-2xl rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
            />
          </label>
        )}

        {kind === "video" && (
          <div className="space-y-3">
            {/* 파이프라인이 만든 meta.json을 붙이면 제목·길이가 채워진다.
                옮겨 적다 틀리는 것이 실제 실수의 대부분이라 그 자리를 없앤다.
                유튜브 주소는 meta.json에 없다 — 파이프라인이 업로드하지 않기
                때문이다. 그래서 주소만 사람이 넣는다. */}
            <details className="rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2">
              <summary className="cursor-pointer text-sm">
                자동 생성 강의라면 — meta.json 붙여넣기
              </summary>
              <p className="mt-2 text-xs text-ink-soft">
                파이프라인 산출물 <code>out/meta.json</code> 내용을 그대로
                붙이세요. 제목과 길이가 채워집니다. 유튜브 주소는 올린 뒤 직접
                넣어야 합니다.
              </p>
              <textarea
                rows={3}
                placeholder='{ "lessonTitle": "...", "fps": 30, "totalFrames": 3877, ... }'
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v.trim()) {
                    setMetaNote(null);
                    return;
                  }
                  const result = parseLectureMeta(v);
                  if (!result.ok) {
                    setMetaNote(result.message);
                    return;
                  }
                  const form = e.target.closest("form");
                  if (!form) return;
                  const set = (name: string, value: string) => {
                    const el = form.elements.namedItem(name);
                    if (el instanceof HTMLInputElement) el.value = value;
                  };
                  set("title", result.meta.title);
                  set("videoMinutes", String(Math.floor(result.meta.seconds / 60)));
                  set("videoSeconds", String(result.meta.seconds % 60));
                  setMetaNote(
                    `«${result.meta.title}» · ${Math.floor(result.meta.seconds / 60)}분 ${result.meta.seconds % 60}초를 채웠습니다. 유튜브 주소를 넣으세요.`,
                  );
                }}
                className="mt-2 block w-full rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-xs"
              />
              {metaNote && (
                <p role="status" className="mt-2 text-xs">
                  {metaNote}
                </p>
              )}
            </details>
            <label htmlFor="videoUrl" className="block text-sm">
              <span className="block">유튜브 주소</span>
              <span className="block text-xs text-ink-soft">
                비공개(일부 공개)로 올린 영상의 주소. 유튜브만 등록됩니다 —
                영상을 이 제품이 보관하지 않기 때문입니다.
              </span>
              <input
                id="videoUrl"
                name="videoUrl"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                className="mt-1 block w-full max-w-xl rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
              />
            </label>
            <div className="flex items-end gap-2 text-sm">
              <label htmlFor="videoMinutes">
                <span className="block text-xs text-ink-soft">길이 (분)</span>
                <input
                  id="videoMinutes"
                  name="videoMinutes"
                  type="number"
                  min={0}
                  max={600}
                  defaultValue={0}
                  className="mt-1 w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm"
                />
              </label>
              <label htmlFor="videoSeconds">
                <span className="block text-xs text-ink-soft">초</span>
                <input
                  id="videoSeconds"
                  name="videoSeconds"
                  type="number"
                  min={0}
                  max={59}
                  defaultValue={0}
                  className="mt-1 w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm"
                />
              </label>
              <span className="pb-2 text-xs text-ink-soft">
                비워 두면 학생에게 길이를 알리지 않습니다
              </span>
            </div>
          </div>
        )}

        {kind === "practice" && (
          <p className="max-w-2xl rounded-[var(--radius-control)] bg-paper px-3 py-2 text-sm text-ink-soft">
            문항을 따로 지정하지 않습니다. 이 개념에 연결된{" "}
            <strong className="font-medium">검수 완료·사용 권한 유효</strong> 문항에서
            자동으로 선정됩니다. 낼 문항이 없으면 학생 화면이 그렇다고 알립니다.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "만드는 중…" : "초안으로 만들기"}
        </button>
      </form>

      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </div>
  );
}

/* 상태 전환 — 표 행 안에서 쓰이므로 결과는 반드시 ActionToast로.
 * 행 안에 문구를 그리면 표가 출렁인다 (ADR-0016). */
export function MaterialStatusButton({
  materialId,
  status,
  label,
  primary,
}: {
  materialId: string;
  status: "draft" | "published" | "archived";
  label: string;
  primary?: boolean;
}) {
  const [state, action, pending] = useActionState<MaterialResult | null, FormData>(
    setMaterialStatusAction,
    null,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="materialId" value={materialId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-[var(--radius-control)] px-2 py-1 text-xs disabled:opacity-60 ${
          primary
            ? "bg-pen font-medium text-white"
            : "border border-rule hover:bg-paper"
        }`}
      >
        {pending ? "처리 중…" : label}
      </button>
      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </form>
  );
}
