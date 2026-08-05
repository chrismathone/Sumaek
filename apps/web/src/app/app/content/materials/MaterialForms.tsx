"use client";

import { useActionState, useEffect, useState } from "react";
import { ActionToast } from "@/components/ActionToast";
import { DisclosureField, MetaPasteField, VideoFields } from "./MetaPasteField";
import type { ConceptOption } from "./shared";
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
  concepts: ConceptOption[];
  conceptQuery: string;
}) {
  const [state, action, pending] = useActionState<MaterialResult | null, FormData>(
    createMaterialAction,
    null,
  );
  const [kind, setKind] = useState<"reading" | "video" | "practice">("reading");
  /* 고른 개념을 붙들고 있는 이유는 하나다: 연습문제인데 그 개념에 낼 문항이
   * 0개면 **만들기 전에** 말해 주기 위해서다. 지금까지 교사는 만들고 게시한
   * 뒤 학생이 「낼 수 있는 문항이 없습니다」를 보고 알려 줘야 알았다. */
  const [conceptId, setConceptId] = useState("");

  /* ── 수화(hydration) 전에 고른 값을 잃지 않는다 ────────────────
   *
   * 이 두 칸은 controlled다. 그래서 자바스크립트가 붙기 전에 교사가 개념을
   * 고르면, 수화 직후 React가 상태값("")을 DOM에 다시 써서 **선택이 조용히
   * 풀린다.** 그 뒤 「초안으로 만들기」를 누르면 required 셀렉트가 비어 있어
   * 브라우저가 제출을 막고, 화면에는 개념이 골라진 것처럼 보이는데 아무 일도
   * 일어나지 않는다 — 실측으로 E2E가 여기서 죽었다(제목·유튜브 칸은
   * uncontrolled라 값이 남아 있어 더 헷갈렸다).
   *
   * 그래서 **커밋 전에** DOM의 실제 값을 훔쳐 두었다가 마운트 직후 상태로
   * 받아들인다. 렌더 단계에서 읽는 이유가 이것이다 — 커밋(=React가 덮어쓰는
   * 시점) 뒤에 읽으면 이미 지워져 있다. 첫 렌더가 내는 화면은 서버와 같으므로
   * 수화 불일치는 생기지 않는다. */
  const [preHydration] = useState(() => {
    if (typeof document === "undefined") return null;
    const read = (id: string) =>
      (document.getElementById(id) as HTMLSelectElement | null)?.value ?? "";
    return { kind: read("createKind"), conceptId: read("conceptId") };
  });
  useEffect(() => {
    if (!preHydration) return;
    const { kind: preKind, conceptId: preConcept } = preHydration;
    if (preKind === "video" || preKind === "practice") setKind(preKind);
    if (preConcept) setConceptId(preConcept);
    // 한 번만 — 이후의 값은 onChange가 맡는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const usableQuestions =
    concepts.find((c) => c.id === conceptId)?.usable_questions ?? null;

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
          <div>
            <label htmlFor="conceptId" className="block text-sm">
              개념
            </label>
            <select
              id="conceptId"
              name="conceptId"
              required
              value={conceptId}
              onChange={(e) => setConceptId(e.target.value)}
              className="mt-1 w-64 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm"
            >
              <option value="">개념 선택</option>
              {concepts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            {/* id가 `kind`가 아니다 — 아래 목록 필터의 종류 셀렉트가 같은 id를
                쓰고 있었다. 한 문서에 같은 id가 둘이면 라벨이 **둘 다 첫
                번째 것**에 붙어(실측: 이 셀렉트의 접근성 이름이 「종류 종류」),
                필터 셀렉트는 이름 없는 콤보박스가 된다. 이름은 name=kind
                그대로라 서버가 받는 값은 바뀌지 않는다. */}
            <label htmlFor="createKind" className="block text-sm">
              종류
            </label>
            <select
              id="createKind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="mt-1 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm"
            >
              <option value="reading">개념 공부 (읽기)</option>
              <option value="video">개념 인강 (영상)</option>
              <option value="practice">연습문제</option>
            </select>
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
              defaultValue={0}
              className="mt-1 w-20 rounded-[var(--radius-control)] border border-rule px-3 py-2 font-mono text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="title" className="block text-sm">
            제목
          </label>
          <input
            id="title"
            name="title"
            required
            maxLength={200}
            placeholder="일차방정식 복습 — 핵심 정리"
            className="mt-1 block w-full max-w-xl rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
          />
        </div>

        {kind === "reading" && (
          <div>
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
              rows={6}
              className="mt-1 block w-full max-w-2xl rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
            />
          </div>
        )}

        {/* 메타 붙여넣기·영상 칸은 고치기 폼과 **같은 컴포넌트**를 쓴다.
            갈라 두면 「만들 땐 있던 칸이 고칠 땐 없다」가 생기고, 실제로
            그랬다 — 만들기 폼에만 있던 붙여넣기 로직이 따로 살아 있었다. */}
        {kind === "video" && (
          <div className="space-y-3">
            <MetaPasteField />
            <VideoFields />
          </div>
        )}

        {kind === "practice" &&
          (usableQuestions === 0 ? (
            /* 만들기 전에 막지는 않는다 — 문항을 나중에 붙일 수도 있다.
               다만 이대로 게시하면 학생이 빈 화면을 본다는 것은 말한다. */
            <p
              role="status"
              className="max-w-2xl rounded-[var(--radius-control)] border border-grade bg-grade-soft px-3 py-2 text-sm text-grade"
            >
              이 개념에 낼 수 있는 문항이 0개입니다. 지금 만들어 게시하면 학생
              화면에 「낼 수 있는 문항이 없습니다」가 뜹니다. 문제은행에서 이
              개념의 문항을 검수·게시한 뒤 만드세요.
            </p>
          ) : (
            <p className="max-w-2xl rounded-[var(--radius-control)] bg-paper px-3 py-2 text-sm text-ink-soft">
              만들 때는 문항을 지정하지 않습니다. 만든 뒤 목록에서 열면 낼 문항을
              골라 순서까지 정할 수 있고, 고르지 않으면 이 개념에 연결된{" "}
              <strong className="font-medium">검수 완료·사용 권한 유효</strong>{" "}
              문항에서 자동으로 선정됩니다.
              {usableQuestions !== null &&
                ` 지금 이 개념에는 낼 수 있는 문항이 ${usableQuestions}개 있습니다.`}
            </p>
          ))}

        {/* AI 고지는 종류를 가리지 않는다 — 읽기 자료도 AI가 쓸 수 있고,
            그때도 학생은 알아야 한다. 만들 때부터 적을 수 있어야 「나중에
            상세에서 넣지」가 곧 「아무도 안 넣는다」가 되지 않는다. */}
        <DisclosureField />

        {/* 잡 ID는 사람이 옮겨 적을 값이 아니다 — 메타 붙여넣기가 채운다.
            상세 화면에서는 눈으로 보고 고칠 수 있다. */}
        <input type="hidden" name="sourceJobId" defaultValue="" />

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
