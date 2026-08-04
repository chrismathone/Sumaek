import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { listMaterials, type MaterialRow } from "@/lib/domain/learning-material";
import { getTodayScope } from "@/lib/learn/today-context";
import { buildPracticeSets } from "@/lib/learn/practice-items";
import { PracticeForm } from "./PracticeForm";

export const metadata: Metadata = { title: "연습문제" };

/* ─────────────────────────────────────────────────────────────
 * 연습문제 — 개념 학습의 **다음 쪽**.
 *
 * 설명·인강을 마친 학생이 `/learn/study?p=N`에서 쪽을 넘겨 온다
 * (`?c=개념id`). 「배우기」와 「풀기」는 학생이 머리를 다르게 쓰는 일이라
 * 쪽을 나눈다 — 한 쪽에 다 실으면 연습이 본문 끝에 묻힌다.
 *
 * `?c`가 없으면 오늘 연습을 **전부** 낸다 — 몰아서 풀 때의 목적지로 남긴다.
 *
 * 개념 순서는 study와 같은 정렬(listMaterials)이라 「다음 개념」이 두 화면에서
 * 같은 것을 가리킨다. 쪽 **번호**가 아니라 개념 id로 오가는 이유도 같다:
 * 번호는 보내는 쪽이 굳힌 순번이라 그 사이 자료가 늘거나 줄면 어긋난다.
 *
 * 점수로 남지 않고 숙련도에도 반영되지 않는다. 그 사실을 화면에 적는다 —
 * 학생이 "이것도 성적에 들어가나" 걱정하면 연습이 연습이 아니게 된다.
 * ───────────────────────────────────────────────────────────── */

/** 오늘 개념의 순서 — study의 쪽 순서와 같아야 한다 */
function conceptOrder(materials: MaterialRow[]): string[] {
  const seen: string[] = [];
  for (const m of materials) {
    if (!seen.includes(m.conceptId)) seen.push(m.conceptId);
  }
  return seen;
}

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const learner = (await getCurrentLearner())!;
  const today = todayInKst();
  const scope = await getTodayScope(learner, today);
  const all = await listMaterials({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    conceptIds: scope.conceptIds,
  });

  const raw = await searchParams;
  const conceptParam = typeof raw.c === "string" ? raw.c : null;
  const order = conceptOrder(all);
  /* 넘어온 개념이 오늘 범위에 없으면(자료가 내려갔거나 링크가 낡았다)
   * 전체 보기로 물러선다 — 빈 화면을 내는 것보다 낫다. */
  const scoped = conceptParam && order.includes(conceptParam) ? conceptParam : null;
  const conceptName = scoped
    ? (all.find((m) => m.conceptId === scoped)?.conceptName ?? null)
    : null;

  const practiceMaterials = all.filter(
    (m) => m.kind === "practice" && (!scoped || m.conceptId === scoped),
  );
  const usable = await buildPracticeSets({
    organizationId: learner.user.organizationId,
    materials: practiceMaterials,
  });

  /* 다음 목적지 — 이 개념 다음의 개념 쪽으로. 마지막이면 오늘 학습으로. */
  const nextIndex = scoped ? order.indexOf(scoped) + 1 : -1;
  const nextConcept =
    nextIndex > 0 && nextIndex < order.length ? nextIndex + 1 : null;

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold break-keep">
        {conceptName ? `${conceptName} — 연습문제` : "연습문제"}
      </h1>
      <p className="mt-1 text-sm break-keep text-ink-soft">
        {conceptName
          ? "방금 배운 개념을 직접 풀어 봅니다. "
          : "오늘 배우는 개념을 직접 풀어 봅니다. "}
        <strong className="font-medium">점수로 남지 않고</strong> 성적에도
        반영되지 않습니다. 틀려도 괜찮습니다.
      </p>

      {scoped && (
        <Link
          href={`/learn/study?c=${scoped}`}
          className="mt-3 inline-block text-sm text-pen underline underline-offset-4"
        >
          ← 설명·인강 다시 보기
        </Link>
      )}

      {usable.length === 0 ? (
        <div className="mt-4 rounded-lg border border-rule bg-surface p-5">
          <p className="font-medium">
            {!scope.hasSession
              ? "오늘은 수업이 없어 연습할 개념이 없습니다."
              : practiceMaterials.length === 0
                ? "이 개념에 등록된 연습문제가 아직 없습니다."
                : "연습문제 묶음은 있지만 낼 수 있는 문항이 없습니다."}
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            {scope.hasSession &&
              practiceMaterials.length > 0 &&
              "문제은행에 이 개념의 검수 완료 문항이 없습니다. 선생님께 알려 주세요."}
            {scope.hasSession &&
              practiceMaterials.length === 0 &&
              "선생님이 연습문제를 올리면 여기에 표시됩니다."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-4">
          {usable.map(({ material, items }) => (
            <li key={material.id}>
              <PracticeForm
                materialId={material.id}
                title={material.title}
                conceptName={material.conceptName}
                items={items}
                showConcept={!scoped}
              />
            </li>
          ))}
        </ul>
      )}

      {/* 흐름을 잇는다 — 풀고 나면 다음 개념으로. 개념 범위로 들어온 학생만
          이 줄을 본다(전체 보기는 어느 개념의 다음인지 정할 수 없다). */}
      {scoped && (
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-rule-soft pt-4">
          {nextConcept ? (
            <Link
              href={`/learn/study?p=${nextConcept}`}
              className="rounded-[var(--radius-control)] border border-pen bg-pen px-4 py-2 text-sm font-medium text-white"
            >
              다음 개념 →
            </Link>
          ) : (
            <Link
              href="/learn/today"
              className="rounded-[var(--radius-control)] border border-pen px-4 py-2 text-sm font-medium text-pen"
            >
              오늘 학습으로 →
            </Link>
          )}
        </div>
      )}

      <Link
        href="/learn/today"
        className="mt-6 inline-block text-sm text-pen underline underline-offset-4"
      >
        오늘 학습으로 돌아가기
      </Link>
    </div>
  );
}
