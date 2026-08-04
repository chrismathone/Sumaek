import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { listMaterials } from "@/lib/domain/learning-material";
import { getTodayScope } from "@/lib/learn/today-context";
import { CompleteMaterialButton } from "@/components/learn/MaterialCard";
import { LectureVideoCard } from "@/components/learn/LectureVideoCard";
import { ReadingBody } from "@/components/materials/ReadingBody";

export const metadata: Metadata = { title: "개념 공부" };

/* 개념 공부 — 오늘 차시의 개념에 붙은 읽기 자료. **같은 개념의 인강도
 * 이 화면에 함께 싣는다** — 설명을 읽다가 영상이 필요할 때 화면을 옮겨
 * 다니지 않게. 영상 한 건의 모습은 LectureVideoCard 한 곳에만 있다.
 *
 * **한 번에 한 자료만** 보여 준다 (?p=번호). 여덟 자료를 한 줄로 이어 붙이면
 * 스크롤이 수백 줄이 되고, 학생은 자기가 어디까지 읽었는지 잃어버린다.
 * 기본 페이지는 첫 미완료 자료 — 다시 들어와도 읽던 곳에서 이어진다.
 * 차례(번호)는 읽기 자료 기준 그대로다: 인강은 지금 읽는 개념에 **붙어
 * 나오는 것**이지 별도의 쪽이 아니다.
 *
 * 읽기 자료는 없고 인강만 있는 날은 인강을 그대로 여기에 낸다 — 「자료가
 * 없습니다」라고 말하면서 영상은 다른 화면에 숨겨 두면 화면이 거짓말을 한다.
 *
 * 넓은 화면에서는 남는 좌우를 쓴다 — data-wide로 셸을 넓히고 본문을
 * 2단으로 흘려, 한 자료가 스크롤 없이 한 화면에 최대한 들어가게 한다.
 * 단, 읽기 자료가 없어 2단 본문 자체가 없는 날은 넓히지 않는다 — 인강
 * 카드는 좁은 셸(인강 화면과 같은 폭)용으로 그려져 있다.
 *
 * AI 고지(disclosure)는 읽기·인강 모두 **본문/영상 위에** 그대로 낸다.
 * 다 읽고 난 뒤에 알리는 것은 알린 것이 아니다. 교사 저작 화면은 이 칸을
 * 「학생에게 보이는 고지」라 부르고(content/materials 상세), 도메인 계약
 * (learning-material.ts)도 「있으면 학생 화면에 반드시 그대로」라 말한다 —
 * 화면 하나가 그 약속을 조용히 어기면 교사가 쓴 고지가 거짓말이 된다.
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
    kinds: ["reading", "video"],
  });
  const readings = materials.filter((m) => m.kind === "reading");
  const videos = materials.filter((m) => m.kind === "video");

  const raw = await searchParams;
  const requested = Number(typeof raw.p === "string" ? raw.p : NaN);
  const conceptParam = typeof raw.c === "string" ? raw.c : null;
  const firstUnread = readings.findIndex((m) => m.progress !== "completed");
  const fallback = firstUnread === -1 ? 1 : firstUnread + 1;
  const validP =
    Number.isInteger(requested) && requested >= 1 && requested <= readings.length;

  /* 쪽이 정해지면 **URL에 박고 시작한다** (?p 없으면 redirect).
   *
   * ?p 없는 화면에서 「다 봤어요」를 누르면 revalidate가 같은 URL을 다시
   * 그리는데, 그 사이 firstUnread가 방금 완료한 자료를 지나쳐 버려 화면이
   * 다음 미완료 쪽으로 통째로 튄다 — 방금 읽던 설명과 그 개념의 인강이
   * 클릭 한 번에 사라진다(마지막 자료면 1쪽으로 되감긴다). URL에 쪽이
   * 박혀 있으면 완료해도 그 자리에 머문다.
   *
   * ?c=개념id는 인강 화면의 「이 개념의 설명 읽기」가 실어 보낸다 — 쪽
   * **번호**를 실으면 보내는 쪽이 굳힌 순번이 클릭 시점의 목록과 어긋날
   * 수 있다(그 사이 교사가 게시·게시 취소하면 다른 개념이 열린다). 개념을
   * 싣고 여기서 지금 목록으로 풀어야 「이 개념의」라는 라벨이 항상 참이다. */
  if (readings.length > 0 && !validP) {
    const byConcept = conceptParam
      ? readings.findIndex((m) => m.conceptId === conceptParam)
      : -1;
    redirect(`/learn/study?p=${byConcept >= 0 ? byConcept + 1 : fallback}`);
  }
  const page = validP ? requested : fallback;
  const current = readings[page - 1];
  const doneCount = readings.filter((m) => m.progress === "completed").length;
  // 지금 읽는 개념의 인강 — 설명과 같은 화면에 나온다
  const conceptVideos = current
    ? videos.filter((v) => v.conceptId === current.conceptId)
    : [];

  return (
    /* 2단 흘림이 실제로 있는 날만 셸을 넓힌다 — 인강만 있는 날 셸만 넓히면
     * 좁은 화면용 카드가 1080px로 늘어져 버튼·고지가 흩어진다 */
    <div data-wide={readings.length > 0 ? "" : undefined}>
      {/* 제목·진행과 번호 차례를 한 줄에 — 세로 공간은 본문에 양보한다 */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-[MaruBuri] text-2xl font-semibold">개념 공부</h1>
          {/* 부제는 화면이 실제로 내는 것만 말한다 — 설명 0건인 날
           * 「설명과 강의 영상」이라 적으면 첫 문장부터 거짓이다 */}
          <p className="mt-1 text-sm text-ink-soft">
            {readings.length > 0
              ? `읽기 자료 ${readings.length}건 중 ${doneCount}건을 읽었습니다. 다 읽었으면 「다 봤어요」를 눌러 주세요.`
              : videos.length > 0
                ? "오늘 배우는 개념의 강의 영상입니다. 다 봤으면 「다 봤어요」를 눌러 주세요."
                : "오늘 배우는 개념의 설명입니다."}
          </p>
        </div>
        {readings.length > 1 && current && (
          <nav aria-label="자료 차례" className="flex flex-wrap gap-1.5">
            {readings.map((m, i) => {
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

      {readings.length === 0 || !current ? (
        videos.length > 0 ? (
          /* 읽기 자료 없이 인강만 있는 날 — 영상을 여기 그대로 낸다.
           * 개념이 여럿일 수 있으므로 개념명 캡션은 켜 둔다. */
          <ul className="mt-4 space-y-3">
            {videos.map((v) => (
              <li key={v.id} className="rounded-lg border border-rule bg-surface p-5">
                <LectureVideoCard video={v} />
              </li>
            ))}
          </ul>
        ) : (
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
        )
      ) : (
        <>
          <section className="mt-3 rounded-lg border border-rule bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-ink-soft">
                  {current.conceptName} · {page}/{readings.length}
                </p>
                <h2 className="mt-0.5 font-medium">{current.title}</h2>
              </div>
              <CompleteMaterialButton
                materialId={current.id}
                done={current.progress === "completed"}
              />
            </div>
            {/* AI 고지 — 본문 **위에** 둔다. 다 읽고 난 뒤에 알리는 것은
                알린 것이 아니다. 인강(LectureVideoCard)과 같은 정책·같은
                모습이다. */}
            {current.disclosure && (
              <p className="mt-3 rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-3 py-2 text-sm">
                {current.disclosure}
              </p>
            )}
            <div className="mt-3">
              <ReadingBody body={current.body} mode="publish" layout="columns" />
            </div>

            {/* 이 개념의 인강 — 설명 아래, 다음 이동 위. 오늘 학습의 단계
             * 순서(공부 2 → 인강 3)와 같은 순서다: 읽고, 그 자리에서 본다.
             * 완료는 영상마다 따로 찍는다 — 진도의 뜻(자료 한 건을 봤다)은
             * 어느 화면에서 보든 같아야 한다.
             *
             * 경계 라벨은 실제 제목(h3)이다 — 본문 소제목도 h3/h4로 나오므로
             * (ReadingBody), 시각 장식만으로 가르면 스크린리더 제목 탐색에서
             * 인강 제목이 본문 소제목과 구별되지 않는다. 카드 폭은 2xl로
             * 잡는다 — 넓은 셸은 2단 본문용이지 카드용이 아니다. */}
            {conceptVideos.length > 0 && (
              <div className="mt-6 border-t border-rule-soft pt-4">
                <h3 className="font-mono text-xs text-ink-soft">이 개념의 인강</h3>
                <ul className="mt-2 max-w-2xl space-y-3">
                  {conceptVideos.map((v) => (
                    <li key={v.id}>
                      <LectureVideoCard video={v} titleAs="h4" showConcept={false} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
              {page < readings.length ? (
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
