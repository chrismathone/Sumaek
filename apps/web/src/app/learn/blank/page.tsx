import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { getTodayScope } from "@/lib/learn/today-context";
import {
  getBlankStage,
  listStagesForConcept,
  type BlankStage,
} from "@/lib/domain/concept-blank";
import { ReadingBody } from "@/components/materials/ReadingBody";
import { BlankForm } from "./BlankForm";

export const metadata: Metadata = { title: "개념 확인" };

/* ─────────────────────────────────────────────────────────────
 * 개념 확인 (빈칸) — 인강을 보고 넘어가는 것이 아니라 인출하게.
 *
 * 화면은 **개념 섹션과 똑같다.** 같은 자료, 같은 카드(정의·예·핵심·순서),
 * 같은 배치에서 낱말만 입력칸으로 바뀌어 있다. 따로 만든 문장을 보여 주면
 * 방금 읽은 것과 다른 글을 보게 되고, 그러면 「배운 것을 떠올린다」가 아니라
 * 「새 문제를 푼다」가 된다.
 *
 * 단계는 발판을 걷어내는 순서다: one(핵심어 한둘) → two(뼈대까지) →
 * full(본문 없이 통째로 다시 쓰기).
 * ───────────────────────────────────────────────────────────── */

const STAGE_LABEL: Record<BlankStage, string> = {
  one: "1단계",
  two: "2단계",
  full: "3단계",
};

export default async function BlankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const learner = (await getCurrentLearner())!;
  const today = todayInKst();
  const scope = await getTodayScope(learner, today);

  const raw = await searchParams;
  const conceptId = typeof raw.c === "string" ? raw.c : null;
  const stageParam = typeof raw.s === "string" ? raw.s : "one";
  const stage: BlankStage =
    stageParam === "two" || stageParam === "full" ? stageParam : "one";

  /* 오늘 배우는 개념이 아니면 보내지 않는다 — 남의 개념 빈칸을 주소로 열 수
   * 있으면 오늘의 범위라는 것이 뜻을 잃는다. */
  if (!conceptId || !scope.conceptIds.includes(conceptId)) {
    redirect("/learn/study");
  }

  const [view, stages] = await Promise.all([
    getBlankStage({
      organizationId: learner.user.organizationId,
      learnerId: learner.learnerId,
      conceptId,
      stage,
    }),
    listStagesForConcept({
      organizationId: learner.user.organizationId,
      conceptId,
    }),
  ]);
  if (!view) redirect(`/learn/study?c=${conceptId}`);

  /* 다음 목적지 — 남은 단계가 있으면 그 단계, 없으면 연습으로. */
  const idx = stages.indexOf(stage);
  const nextStage = idx >= 0 ? stages[idx + 1] : undefined;
  const nextHref = nextStage
    ? `/learn/blank?c=${conceptId}&s=${nextStage}`
    : `/learn/practice?c=${conceptId}`;
  const nextLabel = nextStage
    ? `${STAGE_LABEL[nextStage]}로 →`
    : "연습문제 풀러 가기 →";

  return (
    <div data-wide>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-[MaruBuri] text-2xl font-semibold break-keep">
            {view.conceptName} — 개념 확인
          </h1>
          <p className="mt-1 text-sm break-keep text-ink-soft">
            {stage === "full"
              ? "본문 없이 배운 개념을 다시 써 봅니다."
              : "방금 읽은 그 자리에서 빠진 말을 채워 보세요."}
          </p>
        </div>
        {/* 단계 차례 — 어디쯤인지 숨기지 않는다 */}
        <nav aria-label="단계" className="flex gap-1.5">
          {stages.map((s) => (
            <Link
              key={s}
              href={`/learn/blank?c=${conceptId}&s=${s}`}
              aria-current={s === stage ? "page" : undefined}
              className={`rounded-[var(--radius-control)] border px-3 py-1.5 font-mono text-xs ${
                s === stage
                  ? "border-pen bg-pen font-bold text-white"
                  : "border-rule bg-surface text-ink-soft"
              }`}
            >
              {STAGE_LABEL[s]}
            </Link>
          ))}
        </nav>
      </div>

      <section className="mt-3 rounded-lg border border-rule bg-surface p-5">
        <p className="font-mono text-xs text-ink-soft">
          {STAGE_LABEL[stage]} · 빈칸 {view.total}개
        </p>

        <div className="mt-3">
          <BlankForm
            setId={view.setId}
            stage={stage}
            total={view.total}
            nextHref={nextHref}
            nextLabel={nextLabel}
          >
            {/* 개념 섹션과 같은 렌더러·같은 블록 — 낱말만 입력칸이다 */}
            <div className="space-y-6">
              {view.bodies.map((b) => (
                <article key={b.id}>
                  <h2 className="font-medium break-keep">{b.title}</h2>
                  <div className="mt-2">
                    <ReadingBody body={b.body} mode="publish" layout="single" />
                  </div>
                </article>
              ))}
            </div>
          </BlankForm>
        </div>

        {/* 본문에서 자리를 못 찾은 빈칸이 있으면 조용히 넘어가지 않는다 —
            채점되는 칸이 화면의 칸보다 많으면 학생은 다 맞힐 수 없다. */}
        {view.orphans.length > 0 && (
          <p className="mt-3 rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-3 py-2 text-xs break-keep">
            본문에서 찾지 못한 빈칸 {view.orphans.length}개가 있습니다. 선생님께
            알려 주세요.
          </p>
        )}
      </section>

      <div className="sticky bottom-0 z-30 mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-t-lg border border-b-0 border-rule bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/learn/study?c=${conceptId}`}
            className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-sm"
          >
            ← 설명·인강 다시 보기
          </Link>
          <Link
            href="/learn/today"
            className="text-sm text-pen underline underline-offset-4"
          >
            오늘 학습으로
          </Link>
        </div>
      </div>
    </div>
  );
}
