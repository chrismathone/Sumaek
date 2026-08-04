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
import { listMaterials } from "@/lib/domain/learning-material";
import { ReadingBody } from "@/components/materials/ReadingBody";
import { LectureVideoCard } from "@/components/learn/LectureVideoCard";
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
 *
 * **인강은 오른쪽에 그대로 둔다.** 개념 학습 화면과 같은 배치라 화면이 바뀐
 * 것이 아니라 왼쪽 설명이 빈칸으로 바뀐 것처럼 이어진다. 무엇보다 기억이
 * 안 날 때 강의를 다시 볼 자리가 있어야 한다 — 없으면 학생은 뒤로 가서
 * 찾아야 하고, 그러면 쓰던 답이 사라진다.
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

  /* 이 개념의 인강 — 개념 학습 화면과 같은 카드로 오른쪽에 둔다.
   * 폼 **밖**이다: 임베드가 아닌 영상은 카드 안에 자기 폼(다 봤어요)을
   * 갖는데, 폼 안에 폼을 넣으면 브라우저가 바깥 폼을 깨뜨린다. */
  const videos = (
    await listMaterials({
      organizationId: learner.user.organizationId,
      learnerId: learner.learnerId,
      conceptIds: [conceptId],
      kinds: ["video"],
    })
  ).filter((v) => v.conceptId === conceptId);

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

        {/* 개념 학습과 같은 배치 — 왼쪽 설명이 빈칸으로 바뀌었을 뿐이고,
            오른쪽 인강은 그 자리에 그대로 있다. */}
        <div className="mt-3 grid gap-x-10 lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
          <div className="pb-5">
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

          <div className="pb-5 lg:border-l lg:border-rule-soft lg:pl-10">
            <div className="lg:sticky lg:top-20">
              <h3 className="font-mono text-xs text-ink-soft">인강</h3>
              {videos.length === 0 ? (
                <p className="mt-2 text-sm break-keep text-ink-soft">
                  이 개념에는 등록된 강의 영상이 없습니다.
                </p>
              ) : (
                <ul className="mt-2 space-y-5">
                  {videos.map((v) => (
                    <li
                      key={v.id}
                      className="rounded-lg border border-rule bg-paper/60 p-4"
                    >
                      <LectureVideoCard video={v} titleAs="h4" showConcept={false} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs break-keep text-ink-soft">
                기억이 안 나면 다시 봐도 됩니다.
              </p>
            </div>
          </div>
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
