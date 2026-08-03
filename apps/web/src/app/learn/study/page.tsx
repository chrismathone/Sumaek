import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { listMaterials } from "@/lib/domain/learning-material";
import { getTodayScope } from "@/lib/learn/today-context";
import { CompleteMaterialButton } from "@/components/learn/MaterialCard";
import { ReadingBody } from "@/components/materials/ReadingBody";

export const metadata: Metadata = { title: "개념 공부" };

/* 개념 공부 — 오늘 차시의 개념에 붙은 읽기 자료.
 *
 * **한 번에 한 자료만** 보여 준다 (?p=번호). 여덟 자료를 한 줄로 이어 붙이면
 * 스크롤이 수백 줄이 되고, 학생은 자기가 어디까지 읽었는지 잃어버린다.
 * 기본 페이지는 첫 미완료 자료 — 다시 들어와도 읽던 곳에서 이어진다.
 *
 * 넓은 화면에서는 남는 좌우를 쓴다 — data-wide로 셸을 넓히고 본문을
 * 2단으로 흘려, 한 자료가 스크롤 없이 한 화면에 최대한 들어가게 한다.
 *
 * AI 고지(disclosure)는 학생 화면에 싣지 않는다 — 출처·생성 경위는 교사
 * 검수 화면의 정보다. 데이터는 그대로 있으므로 정책이 바뀌면 다시 켠다.
 *
 * 자료가 없으면 "없다"고 말한다. 학생이 뭘 잘못한 게 아니라는 것까지 적는다. */

export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const learner = (await getCurrentLearner())!;
  const today = todayInKst();
  const scope = await getTodayScope(learner, today);
  const materials = await listMaterials({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    conceptIds: scope.conceptIds,
    kinds: ["reading"],
  });

  const raw = await searchParams;
  const requested = Number(typeof raw.p === "string" ? raw.p : NaN);
  const firstUnread = materials.findIndex((m) => m.progress !== "completed");
  const fallback = firstUnread === -1 ? 1 : firstUnread + 1;
  const page =
    Number.isInteger(requested) && requested >= 1 && requested <= materials.length
      ? requested
      : fallback;
  const current = materials[page - 1];
  const doneCount = materials.filter((m) => m.progress === "completed").length;

  return (
    <div data-wide>
      {/* 제목·진행과 번호 차례를 한 줄에 — 세로 공간은 본문에 양보한다 */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-[MaruBuri] text-2xl font-semibold">개념 공부</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {materials.length > 0
              ? `오늘 자료 ${materials.length}건 중 ${doneCount}건을 읽었습니다. 다 읽었으면 「다 봤어요」를 눌러 주세요.`
              : "오늘 배우는 개념의 설명입니다."}
          </p>
        </div>
        {materials.length > 1 && current && (
          <nav aria-label="자료 차례" className="flex flex-wrap gap-1.5">
            {materials.map((m, i) => {
              const isCurrent = i + 1 === page;
              const isDone = m.progress === "completed";
              return (
                <Link
                  key={m.id}
                  href={`/learn/study?p=${i + 1}`}
                  aria-current={isCurrent ? "page" : undefined}
                  title={`${m.conceptName} — ${m.title}`}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border font-mono text-sm ${
                    isCurrent
                      ? "border-pen bg-pen font-bold text-white"
                      : isDone
                        ? "border-rule bg-paper text-ink-soft"
                        : "border-pen/50 bg-surface text-pen"
                  }`}
                >
                  {isDone && !isCurrent ? "✓" : i + 1}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {materials.length === 0 || !current ? (
        <div className="mt-4 rounded-lg border border-rule bg-surface p-5">
          <p className="font-medium">
            {!scope.hasSession
              ? "오늘은 수업이 없어 공부할 개념이 없습니다."
              : "오늘 개념에 등록된 설명 자료가 아직 없습니다."}
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            {scope.hasSession &&
              "선생님이 자료를 올리면 여기에 표시됩니다. 그동안 연습문제와 테스트는 그대로 할 수 있습니다."}
          </p>
        </div>
      ) : (
        <>
          <section className="mt-3 rounded-lg border border-rule bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-ink-soft">
                  {current.conceptName} · {page}/{materials.length}
                </p>
                <h2 className="mt-0.5 font-medium">{current.title}</h2>
              </div>
              <CompleteMaterialButton
                materialId={current.id}
                done={current.progress === "completed"}
              />
            </div>
            <div className="mt-3">
              <ReadingBody body={current.body} mode="publish" layout="columns" />
            </div>

            {/* 아래 이동 — 긴 본문을 다 읽은 자리에서 바로 다음으로 */}
            <div className="mt-6 flex items-center justify-between border-t border-rule-soft pt-4">
              {page > 1 ? (
                <Link
                  href={`/learn/study?p=${page - 1}`}
                  className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-sm"
                >
                  ← 이전 개념
                </Link>
              ) : (
                <span />
              )}
              {page < materials.length ? (
                <Link
                  href={`/learn/study?p=${page + 1}`}
                  className="rounded-[var(--radius-control)] border border-pen bg-pen px-3 py-1.5 text-sm font-medium text-white"
                >
                  다음 개념 →
                </Link>
              ) : (
                <Link
                  href="/learn/today"
                  className="rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-sm font-medium text-pen"
                >
                  오늘 학습으로 →
                </Link>
              )}
            </div>
          </section>
        </>
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
