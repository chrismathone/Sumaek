"use client";

import { useActionState, useState } from "react";
import { ActionToast } from "@/components/ActionToast";
import {
  DisclosureField,
  MetaPasteField,
  VideoFields,
} from "../MetaPasteField";
import { KIND_LABEL, type ConceptOption } from "../shared";
import { updateMaterialAction, type MaterialResult } from "../actions";

/* ─────────────────────────────────────────────────────────────
 * 자료 고치기.
 *
 * **종류(kind)는 바꿀 수 없다** — 화면에도 그렇게 보인다(고정 배지, 입력 없음).
 * 이유는 두 개다. DB CHECK가 kind에 걸려 있어 종류를 바꾸면 payload가 통째로
 * 갈아엎여야 하고, 더 중요하게는 **학생 진도의 뜻이 바뀐다**: 「다 읽었어요」로
 * 찍힌 완료가 종류만 바꾸면 「다 봤어요」로 둔갑한다. 종류가 다르면 다른
 * 자료다. 종류를 바꾸고 싶으면 새로 만들어야 한다.
 *
 * 게시 중인 자료를 고칠 때 진도가 어떻게 되는지도 화면에서 말한다 —
 * 진도는 material_id에 매달려 있으므로 제자리 수정에서는 그대로 남는다.
 * (반대로 「보관 후 재생성」은 진도를 통째로 잃는다. 그것이 이 화면이 생긴
 * 이유다.)
 * ───────────────────────────────────────────────────────────── */

export interface QuestionOption {
  id: string;
  /** 미리보기용 본문 HTML — 서버에서 렌더해 내려온다 */
  previewHtml: string;
  kind: string;
  /** 이 개념에 연결돼 있는가 — 자동 선정 대상과 같은 기준 */
  aligned: boolean;
}

export function MaterialEditForm({
  material,
  concepts,
  conceptQuery,
  candidates,
  progressCount,
  bodyLocked = false,
}: {
  material: {
    id: string;
    conceptId: string;
    conceptName: string;
    kind: string;
    title: string;
    status: string;
    sortOrder: number;
    bodyText: string;
    videoUrl: string;
    videoMinutes: number;
    videoSeconds: number;
    disclosure: string;
    sourceJobId: string;
    questionIds: string[];
    /** 읽은 시점의 updated_at 원문 — 서버가 DB 현재 값과 대조한다 */
    updatedAtToken: string;
  };
  concepts: ConceptOption[];
  conceptQuery: string;
  candidates: QuestionOption[];
  progressCount: number;
  /** 구조화 본문(정제본) — 평문 편집이 구조를 부수므로 본문만 잠근다.
   *  최종 판정은 서버가 DB 본문을 보고 다시 한다 (actions.ts). */
  bodyLocked?: boolean;
}) {
  const [state, action, pending] = useActionState<MaterialResult | null, FormData>(
    updateMaterialAction,
    null,
  );
  /* 지정 문항은 **순서가 있는 목록**이다. 체크박스 묶음으로 두면 순서가
   * 사라지고, 그러면 "쉬운 것부터"라는 교사의 의도가 DB 생성순에 먹힌다. */
  const [picked, setPicked] = useState<string[]>(material.questionIds);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const move = (index: number, delta: number) => {
    const next = [...picked];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setPicked(next);
  };

  return (
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="materialId" value={material.id} />
      <input type="hidden" name="questionIds" value={picked.join(",")} />
      {/* 낡은 폼이 조용히 이기는 것을 막는 토큰 — 그 사이 다른 사람이
          저장했으면 서버가 이 값 불일치로 거부한다. 저장이 성공하면
          revalidate로 새 토큰이 내려와 연속 저장도 막히지 않는다. */}
      <input type="hidden" name="updatedAt" value={material.updatedAtToken} />

      {/* 개념 찾기는 별도 GET 폼이라 이 폼 밖에 있다 (page.tsx) */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="conceptId" className="block text-sm">
            개념
          </label>
          <select
            id="conceptId"
            name="conceptId"
            required
            defaultValue={material.conceptId}
            className="mt-1 w-64 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm"
          >
            {/* 지금 붙어 있는 개념이 검색 결과에 없을 수 있다 — 그러면
                선택지가 통째로 비어 저장할 때 엉뚱한 개념으로 옮겨간다.
                현재 개념은 언제나 첫 줄에 둔다. */}
            <option value={material.conceptId}>{material.conceptName} (현재)</option>
            {concepts
              .filter((c) => c.id !== material.conceptId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <span className="mt-1 block text-xs text-ink-soft">
          {conceptQuery
            ? `«${conceptQuery}» 결과 ${concepts.length}개`
            : "다른 개념으로 옮기려면 위에서 검색하세요"}
        </span>

        <div className="text-sm">
          <span className="block">종류</span>
          <span className="mt-1 inline-block rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2 font-mono text-sm text-ink-soft">
            {KIND_LABEL[material.kind] ?? material.kind}
          </span>
        </div>

        <div>
          <label htmlFor="sortOrder" className="block text-sm">
            순서
          </label>
          <input
            id="sortOrder"
            name="sortOrder"
            type="number"
            min={0}
            max={999}
            defaultValue={material.sortOrder}
            className="mt-1 w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm"
          />
        </div>
      </div>

      <p className="max-w-2xl text-xs text-ink-soft">
        종류는 바꿀 수 없습니다. 학생 진도(「다 봤어요」)가 이 자료에 매달려
        있어서, 종류를 바꾸면 이미 찍힌 완료가 다른 뜻이 되어 버립니다. 종류를
        바꾸려면 새 자료를 만드세요.
      </p>

      <div>
        <label htmlFor="title" className="block text-sm">
          제목
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={200}
          defaultValue={material.title}
          className="mt-1 block w-full max-w-xl rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
        />
      </div>

      {material.kind === "reading" && bodyLocked && (
        <div className="max-w-2xl">
          <span className="block text-sm">본문</span>
          <p className="mt-1 rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-3 py-2 text-sm">
            파이프라인이 만든 본문(추출본·정제본)입니다. 평문 편집으로 저장하면
            블록 구조 — 추출본이라면 지면 근거 — 가 복구 불가로 사라져서
            본문을 잠갔습니다. 문구를 고치려면 이 자료만 다시 정제하세요:{" "}
            <code className="font-mono text-xs">
              refine-concepts --material={material.id} --force
            </code>
            . 재정제는 <strong className="font-medium">새 자료</strong>를
            만들므로 게시 상태와 학생 진도는 새로 시작됩니다. 제목·개념·순서·
            고지는 여기서 그대로 고칠 수 있습니다.
          </p>
        </div>
      )}

      {material.kind === "reading" && !bodyLocked && (
        <>
          <label htmlFor="body" className="block text-sm">
            본문
          </label>
          <span className="block text-xs text-ink-soft">
            수식은 $3x - 4 = 5$ 처럼 달러 기호 사이에 씁니다. 빈 줄로 문단을
            나눕니다.
          </span>
          <textarea
            id="body"
            name="body"
            rows={10}
            defaultValue={material.bodyText}
            className="mt-1 block w-full max-w-2xl rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
          />
          {/* 정직하게: 여기 보이는 것은 저장된 블록을 평문으로 편 것이다.
              저장하면 다시 텍스트 한 블록이 된다 — 반입 파이프라인이 만든
              구조화 블록(수식 블록·풀이 단계 등)이 있었다면 그 구조는
              평문으로 눌린다. 이 화면이 만든 자료는 원래 한 블록이라
              그대로다. */}
          <p className="max-w-2xl text-xs text-ink-soft">
            저장하면 본문은 텍스트 한 덩어리로 다시 저장됩니다. 이 화면에서
            만든 자료는 원래 그 모양이라 달라지는 것이 없지만, 밖에서 반입한
            구조화 본문이라면 블록 구조가 평문으로 눌립니다.
          </p>
        </>
      )}

      {material.kind === "video" && (
        <div className="space-y-3">
          <MetaPasteField />
          <VideoFields
            defaults={{
              videoUrl: material.videoUrl,
              minutes: material.videoMinutes,
              seconds: material.videoSeconds,
            }}
          />
        </div>
      )}

      {material.kind === "practice" && (
        <QuestionCurator
          candidates={candidates}
          picked={picked}
          byId={byId}
          onToggle={(id) =>
            setPicked((prev) =>
              prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
            )
          }
          onMove={move}
          onClear={() => setPicked([])}
        />
      )}

      <DisclosureField defaultValue={material.disclosure} />

      <label htmlFor="sourceJobId" className="block text-sm">
        파이프라인 잡 ID
      </label>
      <span className="block text-xs text-ink-soft">
        자동 생성 강의를 만든 잡. 메타를 붙여넣으면 자동으로 채워집니다 —
        이 값이 있어야 나중에 「이 영상 어떤 잡에서 나왔지」를 되짚을 수
        있습니다.
      </span>
      <input
        id="sourceJobId"
        name="sourceJobId"
        maxLength={120}
        defaultValue={material.sourceJobId}
        placeholder="20260722-0953-d093ce3f"
        className="mt-1 block w-full max-w-xs rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm"
      />

      {/* 게시 중인 자료를 고치면 학생이 보는 것이 즉시 바뀐다. 진도가 어떻게
          되는지까지 말해야 교사가 "고쳐도 되나"를 스스로 판단할 수 있다. */}
      <p
        className={`max-w-2xl rounded-[var(--radius-control)] border px-3 py-2 text-sm ${
          material.status === "published"
            ? "border-highlight bg-highlight-soft"
            : "border-rule bg-paper text-ink-soft"
        }`}
      >
        {material.status === "published" ? (
          <>
            지금 <strong className="font-medium">게시 중</strong>입니다. 저장하면
            이 개념을 배우는 학생 화면에 바로 반영됩니다.{" "}
            {progressCount > 0
              ? `이미 ${progressCount}명이 진도를 찍었고, 그 기록은 그대로 남습니다 — 고쳐도 「다 봤어요」가 풀리지 않습니다.`
              : "아직 진도를 찍은 학생은 없습니다."}{" "}
            내용을 크게 바꿀 때는 먼저 게시를 취소하는 편이 안전합니다.
          </>
        ) : (
          <>
            지금 {material.status === "draft" ? "초안" : "보관"}이라 학생에게는
            보이지 않습니다. 고쳐도 학생 화면은 바뀌지 않습니다.
            {progressCount > 0 &&
              ` 과거에 진도를 찍은 학생 ${progressCount}명의 기록은 그대로 남아 있습니다.`}
          </>
        )}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "저장 중…" : "저장"}
      </button>

      {state && (
        <ActionToast ok={state.ok} resultKey={state}>
          {state.message}
        </ActionToast>
      )}
    </form>
  );
}

/* 문항 고르기 — 고른 것은 순서 있는 목록, 나머지는 후보 목록.
 *
 * 지금까지 이 화면이 없어서 question_ids는 코드가 `'[]'::jsonb`로 박아 넣는
 * 값이었다. 스키마 주석은 「questionIds로 문제은행을 참조한다」를 설계
 * 결정으로 내세우는데 실제로 값을 넣는 지점이 하나도 없었다. 여기가 그 문이다. */
function QuestionCurator({
  candidates,
  picked,
  byId,
  onToggle,
  onMove,
  onClear,
}: {
  candidates: QuestionOption[];
  picked: string[];
  byId: Map<string, QuestionOption>;
  onToggle: (id: string) => void;
  onMove: (index: number, delta: number) => void;
  onClear: () => void;
}) {
  const rest = candidates.filter((c) => !picked.includes(c.id));

  return (
    <section className="max-w-3xl rounded-lg border border-rule bg-paper p-4">
      <h3 className="text-sm font-semibold">낼 문항</h3>
      <p className="mt-1 text-xs text-ink-soft">
        고르지 않으면 이 개념의 검수 완료·사용 권한 유효 문항에서 자동으로
        선정됩니다. 고르면 <strong className="font-medium">고른 순서 그대로</strong>{" "}
        학생에게 나갑니다.
      </p>

      {candidates.length === 0 ? (
        <p
          role="status"
          className="mt-3 rounded-[var(--radius-control)] border border-grade bg-grade-soft px-3 py-2 text-sm text-grade"
        >
          이 개념에 낼 수 있는 문항이 없습니다. 지금 게시하면 학생 화면에
          「낼 수 있는 문항이 없습니다」가 뜹니다. 문제은행에서 이 개념의 문항을
          검수·게시한 뒤 다시 오세요.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="font-mono text-xs text-ink-soft">
              {picked.length === 0
                ? `지정 없음 — 자동 선정 (후보 ${candidates.length}개)`
                : `지정 ${picked.length}개 / 후보 ${candidates.length}개`}
            </p>
            {picked.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="rounded-[var(--radius-control)] border border-rule px-2 py-1 text-xs"
              >
                지정 지우고 자동으로
              </button>
            )}
          </div>

          {picked.length > 0 && (
            <ol className="mt-2 space-y-1.5">
              {picked.map((id, i) => {
                const q = byId.get(id);
                return (
                  <li
                    key={id}
                    className="flex items-start gap-2 rounded-[var(--radius-control)] border border-pen bg-surface px-2 py-1.5"
                  >
                    <span className="mt-1 font-mono text-xs text-pen">{i + 1}</span>
                    <span className="min-w-0 flex-1 text-sm">
                      {q ? (
                        <span
                          dangerouslySetInnerHTML={{ __html: q.previewHtml }}
                        />
                      ) : (
                        /* 후보에서 사라진 지정 — 검수가 풀렸거나 권한이 막혔다.
                           숨기면 교사는 여전히 그 문항이 나간다고 믿는다. */
                        <span className="text-grade">
                          더 이상 낼 수 없는 문항입니다 (검수·권한 확인 필요) —{" "}
                          <span className="font-mono text-xs">{id.slice(-8)}</span>
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => onMove(i, -1)}
                        disabled={i === 0}
                        aria-label={`${i + 1}번 문항 위로`}
                        className="rounded-[var(--radius-control)] border border-rule px-1.5 py-0.5 text-xs disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(i, 1)}
                        disabled={i === picked.length - 1}
                        aria-label={`${i + 1}번 문항 아래로`}
                        className="rounded-[var(--radius-control)] border border-rule px-1.5 py-0.5 text-xs disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggle(id)}
                        className="rounded-[var(--radius-control)] border border-rule px-1.5 py-0.5 text-xs"
                      >
                        빼기
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {rest.length > 0 && (
            <>
              <h4 className="mt-4 text-xs font-semibold text-ink-soft">
                고를 수 있는 문항
              </h4>
              <ul className="mt-1.5 space-y-1.5">
                {rest.map((q) => (
                  <li
                    key={q.id}
                    className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rule-soft bg-surface px-2 py-1.5"
                  >
                    <span
                      className="min-w-0 flex-1 text-sm"
                      dangerouslySetInnerHTML={{ __html: q.previewHtml }}
                    />
                    {!q.aligned && (
                      <span className="shrink-0 font-mono text-[11px] text-ink-soft">
                        다른 개념
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onToggle(q.id)}
                      className="shrink-0 rounded-[var(--radius-control)] border border-pen px-2 py-0.5 text-xs text-pen"
                    >
                      담기
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
