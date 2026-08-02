"use client";

import { useState } from "react";
import { parseLectureMeta } from "@/lib/lecture-meta";

/* ─────────────────────────────────────────────────────────────
 * 메타 붙여넣기 — 자동 판서 강의 파이프라인의 `out/meta.json`.
 *
 * 두 가지를 고쳤다.
 *
 * 1. **이름을 맞췄다.** 파이프라인의 handoff.md는 이 칸을 「메타 붙여넣기」라
 *    부르는데 화면은 「자동 생성 강의라면 — meta.json 붙여넣기」였다. 안내
 *    문서에 적힌 이름이 화면에 없으면 사람은 그 칸을 못 찾는다.
 * 2. **접힘을 폈다.** <details> 안에 있어서 처음 쓰는 사람은 그 칸의 존재를
 *    모른 채 제목·길이를 손으로 옮겨 적었다 — 이 폼이 없애려던 바로 그
 *    실수다. 영상 자료를 만들 때는 항상 펴 둔다.
 *
 * 붙여넣으면 제목·길이·AI 고지·잡 ID를 채운다. 유튜브 주소는 meta.json에
 * 없다 — 파이프라인이 업로드하지 않아 주소를 모른다. 그것만 사람이 넣는다.
 * ───────────────────────────────────────────────────────────── */

export function MetaPasteField() {
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2">
      <label htmlFor="metaPaste" className="block text-sm font-medium">
        메타 붙여넣기
      </label>
      <p className="mt-1 text-xs text-ink-soft">
        자동 생성 강의라면 파이프라인 산출물 <code>out/meta.json</code> 내용을
        그대로 붙이세요. 제목·길이·AI 고지·잡 ID가 채워집니다. 유튜브 주소는
        영상을 올린 뒤 직접 넣어야 합니다 (meta.json에 없습니다).
      </p>
      <textarea
        id="metaPaste"
        rows={3}
        placeholder='{ "lessonTitle": "...", "fps": 30, "totalFrames": 3877, "disclosure": "...", "jobId": "..." }'
        onChange={(e) => {
          const v = e.target.value;
          if (!v.trim()) {
            setNote(null);
            return;
          }
          const result = parseLectureMeta(v);
          if (!result.ok) {
            setNote(result.message);
            return;
          }
          const form = e.target.closest("form");
          if (!form) return;
          const set = (name: string, value: string) => {
            const el = form.elements.namedItem(name);
            if (
              el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement
            ) {
              el.value = value;
            }
          };
          const minutes = Math.floor(result.meta.seconds / 60);
          const seconds = result.meta.seconds % 60;
          set("title", result.meta.title);
          set("videoMinutes", String(minutes));
          set("videoSeconds", String(seconds));
          /* 고지·잡 ID는 있을 때만 덮어쓴다 — 없는 meta.json을 붙였다고
           * 사람이 손으로 적어 둔 고지를 지워 버리면 안 된다. */
          if (result.meta.disclosure) set("disclosure", result.meta.disclosure);
          if (result.meta.jobId) set("sourceJobId", result.meta.jobId);
          setNote(
            `«${result.meta.title}» · ${minutes}분 ${seconds}초를 채웠습니다.` +
              (result.meta.disclosure ? " AI 고지도 함께 채웠습니다." : " 이 meta.json에는 AI 고지가 없습니다.") +
              " 유튜브 주소를 넣으세요.",
          );
        }}
        className="mt-2 block w-full rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-xs"
      />
      {note && (
        <p role="status" className="mt-2 text-xs">
          {note}
        </p>
      )}
    </div>
  );
}

/* 영상 자료의 공통 입력 — 만들기 폼과 고치기 폼이 같은 칸을 써야
 * "만들 땐 있던 칸이 고칠 땐 없다"가 생기지 않는다. */
export function VideoFields({
  defaults,
}: {
  defaults?: {
    videoUrl: string;
    minutes: number;
    seconds: number;
  };
}) {
  return (
    <>
      <label htmlFor="videoUrl" className="block text-sm">
        유튜브 주소
      </label>
      <span className="block text-xs text-ink-soft">
        비공개(일부 공개)로 올린 영상의 주소. 유튜브만 등록됩니다 — 영상을 이
        제품이 보관하지 않기 때문입니다.
      </span>
      <input
        id="videoUrl"
        name="videoUrl"
        type="url"
        defaultValue={defaults?.videoUrl ?? ""}
        placeholder="https://www.youtube.com/watch?v=..."
        className="mt-1 block w-full max-w-xl rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
      />
      <div className="flex items-end gap-2 text-sm">
        <label htmlFor="videoMinutes">
          <span className="block text-xs text-ink-soft">길이 (분)</span>
          <input
            id="videoMinutes"
            name="videoMinutes"
            type="number"
            min={0}
            max={600}
            defaultValue={defaults?.minutes ?? 0}
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
            defaultValue={defaults?.seconds ?? 0}
            className="mt-1 w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm"
          />
        </label>
        <span className="pb-2 text-xs text-ink-soft">
          비워 두면 학생에게 길이를 알리지 않습니다
        </span>
      </div>
    </>
  );
}

/* AI 고지 — 종류를 가리지 않는다. 읽기 자료도 AI가 쓸 수 있고, 그때도
 * 학생은 그 사실을 알아야 한다. 적으면 학생 화면에 그대로 나간다. */
export function DisclosureField({ defaultValue }: { defaultValue?: string }) {
  /* 라벨·설명·입력은 형제로 둔다(감싸는 <label>이 아니라 htmlFor로 잇는다).
   * 형제를 그대로 return하면 부모가 없어 컴파일되지 않으므로 조각으로 묶는다. */
  return (
    <div>
      <label htmlFor="disclosure" className="block text-sm">
        AI 고지
      </label>
      <span className="block text-xs text-ink-soft">
        AI가 만든 자료라면 학생에게 알릴 문구를 적으세요. 적으면 학생 화면에
        그대로 표시됩니다. 사람이 처음부터 만든 자료라면 비워 두세요.
      </span>
      <input
        id="disclosure"
        name="disclosure"
        maxLength={300}
        defaultValue={defaultValue ?? ""}
        placeholder="선생님이 검수한 AI 보충 강의입니다."
        className="mt-1 block w-full max-w-xl rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
      />
    </div>
  );
}
