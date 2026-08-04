import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { listMaterials, type MaterialRow } from "@/lib/domain/learning-material";
import { getTodayScope } from "@/lib/learn/today-context";
import { buildPracticeSets } from "@/lib/learn/practice-items";
import { CompleteMaterialButton } from "@/components/learn/MaterialCard";
import { LectureVideoCard } from "@/components/learn/LectureVideoCard";
import { ReadingBody } from "@/components/materials/ReadingBody";
import { PracticeForm } from "@/app/learn/practice/PracticeForm";

export const metadata: Metadata = { title: "개념 학습" };

/* ─────────────────────────────────────────────────────────────
 * 개념 학습 — **한 쪽 = 한 개념**. 그 개념의 설명·인강·연습이 한 자리에 있다.
 *
 * 예전에는 개념 공부·개념 인강·연습문제가 각각 다른 단계이자 다른 화면이라,
 * 학생이 같은 개념을 배우면서 세 화면을 오갔다. 자료 단위로 쪽을 넘기던
 * 중간 형태도 마찬가지 문제를 남겼다 — 인강은 「읽기 자료가 있는 개념」에만
 * 딸려 나왔고, 영상만 있는 개념(일차방정식 복습·확인 개념)의 인강은 이
 * 화면 어디에도 없었다. 개념을 쪽의 단위로 삼으면 그 구멍이 닫힌다.
 *
 * 쪽 안의 배치는 **설명 좌측 · 인강 우측**이다. 세로로 쌓으면 영상을 보려고
 * 본문을 지나쳐 스크롤해야 하고, 그러면 「읽으면서 본다」가 아니라 「읽고 나서
 * 본다」가 된다 — 둘을 나란히 두어야 눈이 오갈 수 있다. 좁은 화면(lg 미만)
 * 에서는 나란히 둘 자리가 없으므로 설명 → 인강 순으로 쌓는다.
 *
 * **연습은 이 쪽에 없다.** 설명·인강을 마친 뒤 쪽을 넘겨 연습으로 간다
 * (/learn/practice?c=개념id). 한 쪽에 셋을 다 실으면 화면이 길어져 연습이
 * 본문 끝에 묻히고, 무엇보다 「배우기」와 「풀기」는 학생이 머리를 다르게
 * 쓰는 일이다 — 쪽을 넘기는 동작이 그 전환을 만든다.
 *
 * 한쪽이 비는 개념이 실제로 있다(실측: 읽기만 1, 영상만 2). 그래서 없는
 * 갈래는 **없다고 말한다** — 비워 두면 학생이 그 공백을 자기 탓으로 채운다.
 *
 * 쪽은 URL에 박고 시작한다(?p 없으면 redirect). 「다 봤어요」가 revalidate로
 * 같은 URL을 다시 그릴 때 기본 쪽이 재계산되면 화면이 통째로 다음 개념으로
 * 튀기 때문이다 — 방금 읽던 자리가 클릭 한 번에 사라진다.
 * ?c=개념id로도 들어올 수 있다(인강 화면의 역링크) — 순번이 아니라 개념을
 * 받아 지금 목록으로 풀어야 「이 개념의」라는 라벨이 항상 참이다.
 *
 * AI 고지(disclosure)는 읽기·인강 모두 **본문/영상 위에** 그대로 낸다.
 * 다 읽고 난 뒤에 알리는 것은 알린 것이 아니다. 교사 저작 화면이 이 칸을
 * 「학생에게 보이는 고지」라 부르므로, 화면 하나가 그 약속을 조용히 어기면
 * 교사가 쓴 고지가 거짓말이 된다.
 *
 * 셸은 넓게 쓴다(data-wide) — 좌우 2단 배치가 그 폭을 실제로 쓴다. 본문
 * 자체는 단을 나누지 않는다(layout="single"): 이미 반폭인 왼쪽 단을 다시
 * 둘로 쪼개면 한 줄이 열 몇 자로 줄어 읽기가 오히려 나빠진다.
 * ───────────────────────────────────────────────────────────── */

interface ConceptPage {
  conceptId: string;
  conceptName: string;
  readings: MaterialRow[];
  videos: MaterialRow[];
  practices: MaterialRow[];
  /** 이 개념의 자료를 다 봤나 — 쪽 차례의 ✓와 기본 쪽 결정에 쓴다 */
  done: boolean;
}

/** 자료를 개념 단위로 묶는다. 개념 순서는 listMaterials의 정렬(개념명)이다. */
function groupByConcept(materials: MaterialRow[]): ConceptPage[] {
  const byId = new Map<string, ConceptPage>();
  for (const m of materials) {
    let page = byId.get(m.conceptId);
    if (!page) {
      page = {
        conceptId: m.conceptId,
        conceptName: m.conceptName,
        readings: [],
        videos: [],
        practices: [],
        done: true,
      };
      byId.set(m.conceptId, page);
    }
    if (m.kind === "reading") page.readings.push(m);
    else if (m.kind === "video") page.videos.push(m);
    else page.practices.push(m);
    if (m.progress !== "completed") page.done = false;
  }
  return [...byId.values()];
}

/** 없는 갈래를 말하는 한 줄 — 비워 두지 않는다 */
function Missing({ what }: { what: string }) {
  return (
    <p className="mt-2 text-sm break-keep text-ink-soft">
      이 개념에는 등록된 {what}이(가) 아직 없습니다.
    </p>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="font-mono text-xs text-ink-soft">{children}</h3>;
}

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
  });
  const pages = groupByConcept(materials);

  const raw = await searchParams;
  const requested = Number(typeof raw.p === "string" ? raw.p : NaN);
  const conceptParam = typeof raw.c === "string" ? raw.c : null;
  const firstUndone = pages.findIndex((c) => !c.done);
  const fallback = firstUndone === -1 ? 1 : firstUndone + 1;
  const validP =
    Number.isInteger(requested) && requested >= 1 && requested <= pages.length;

  if (pages.length > 0 && !validP) {
    const byConcept = conceptParam
      ? pages.findIndex((c) => c.conceptId === conceptParam)
      : -1;
    redirect(`/learn/study?p=${byConcept >= 0 ? byConcept + 1 : fallback}`);
  }
  const page = validP ? requested : fallback;
  const current = pages[page - 1];
  const doneCount = pages.filter((c) => c.done).length;

  /* 연습으로 보내는 버튼을 낼지 — 자료 행이 있어도 낼 문항이 0이면 보내지
   * 않는다. 문항을 실제로 조립해야 알 수 있으므로 여기서 한 번 조립한다
   * (현재 쪽의 것만 — 오늘 개념 전부를 조립하면 쪽마다 쓰지도 않을 질의가
   * 개념 수만큼 돈다). */
  const practiceSets = current
    ? await buildPracticeSets({
        organizationId: learner.user.organizationId,
        materials: current.practices,
      })
    : [];
  const hasPractice = practiceSets.length > 0;

  return (
    <div data-wide>
      {/* 제목·진행과 개념 차례를 한 줄에 — 세로 공간은 본문에 양보한다 */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-[MaruBuri] text-2xl font-semibold">개념 학습</h1>
          <p className="mt-1 text-sm break-keep text-ink-soft">
            {pages.length > 0
              ? `오늘 개념 ${pages.length}개 중 ${doneCount}개를 마쳤습니다. 설명을 읽고 인강을 본 뒤 연습까지 이어서 하면 됩니다.`
              : "오늘 배우는 개념의 설명·인강·연습입니다."}
          </p>
        </div>
        {pages.length > 1 && current && (
          <nav aria-label="개념 차례" className="flex flex-wrap gap-1.5">
            {pages.map((c, i) => {
              const isCurrent = i + 1 === page;
              return (
                <Link
                  key={c.conceptId}
                  href={`/learn/study?p=${i + 1}`}
                  aria-current={isCurrent ? "page" : undefined}
                  title={c.conceptName}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border font-mono text-sm ${
                    isCurrent
                      ? "border-pen bg-pen font-bold text-white"
                      : c.done
                        ? "border-rule bg-paper text-ink-soft"
                        : "border-pen/50 bg-surface text-pen"
                  }`}
                >
                  {c.done && !isCurrent ? "✓" : i + 1}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {!current ? (
        <div className="mt-4 rounded-lg border border-rule bg-surface p-5">
          <p className="font-medium">
            {!scope.hasSession
              ? "오늘은 수업이 없어 공부할 개념이 없습니다."
              : "오늘 개념에 등록된 자료가 아직 없습니다."}
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            {scope.hasSession &&
              "선생님이 자료를 올리면 여기에 표시됩니다. 그동안 테스트와 복습은 그대로 할 수 있습니다."}
          </p>
        </div>
      ) : (
        <section className="mt-3 rounded-lg border border-rule bg-surface p-5">
          <p className="font-mono text-xs text-ink-soft">
            개념 {page}/{pages.length}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold break-keep">
            {current.conceptName}
          </h2>

          {/* ── 설명 좌 · 인강 우 ──
              lg 미만에서는 나란히 둘 자리가 없으므로 설명 → 인강 순으로 쌓는다.
              items-start를 두는 이유: 기본값(stretch)이면 짧은 쪽 칸이 긴 쪽
              높이만큼 늘어나 구분선이 허공까지 내려온다. */}
          {/* items-start를 쓰지 않는다 — 칸이 내용 높이만큼만 서면 가운데
              구분선이 짧은 쪽에서 끊긴다. 늘어난 칸(stretch) 안에서 내용만
              sticky로 띄우면 선은 **긴 쪽 기준**으로 끝까지 내려온다. */}
          {/* 설명 칸은 **넓히지 않는다**(40rem 상한). 글은 한 줄이 길어질수록
              읽기 나빠진다 — 창이 커질 때 남는 폭은 전부 영상이 가져간다.
              그래서 좌측은 고정 상한, 우측은 1fr(나머지 전부)다. */}
          <div className="mt-4 grid gap-6 border-t border-rule-soft pt-4 lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] lg:gap-10">
            <div>
              <SectionTitle>설명</SectionTitle>
              {current.readings.length === 0 ? (
                <Missing what="설명 자료" />
              ) : (
                /* 한 개념에 설명이 여러 건인 경우가 실제로 있다(소인수분해·
                 * 최대공약수는 2건). 그냥 세로로 이어 붙이면 앞 자료의 마지막
                 * 블록과 다음 자료의 첫 블록이 붙어 **한 편의 글처럼 읽힌다**
                 * — 학생이 「거듭제곱」을 읽다가 자기도 모르게 「소인수분해」로
                 * 넘어간다(실측 지적). 그래서 자료마다 테두리로 경계를 긋고,
                 * 여러 건이면 「1/2」로 몇 번째인지 못 박는다. */
                <div className="mt-2 space-y-5">
                  {current.readings.map((m, i) => (
                    <article
                      key={m.id}
                      className="rounded-lg border border-rule bg-paper/60 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          {current.readings.length > 1 && (
                            <p className="font-mono text-[11px] text-ink-soft">
                              설명 {i + 1}/{current.readings.length}
                            </p>
                          )}
                          <h4 className="font-medium break-keep">{m.title}</h4>
                        </div>
                        <CompleteMaterialButton
                          materialId={m.id}
                          done={m.progress === "completed"}
                        />
                      </div>
                      {/* AI 고지는 학생 화면에 싣지 않는다(소유자 결정
                          2026-08-04). 출처·생성 경위는 교사 검수 화면의
                          정보다 — 자료마다 같은 문구가 반복되면 학생에게는
                          읽을 것이 늘 뿐이다. 데이터(disclosure)는 그대로
                          남아 있으므로 정책이 바뀌면 여기서 다시 켠다. */}
                      <div className="mt-3">
                        {/* single — 이미 반폭인 칸을 다시 둘로 쪼개면 한 줄이
                            열 몇 자로 줄어 읽기가 오히려 나빠진다 */}
                        <ReadingBody body={m.body} mode="publish" layout="single" />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {/* 영상 칸은 **스크롤을 따라온다**(sticky).
                설명은 길고 영상은 짧아, 가만두면 오른쪽이 통째로 빈 채로
                남고 학생은 영상을 지나쳐 내려가 버린다. 붙여 두면 어디까지
                읽든 영상이 늘 눈에 있어, 「읽고 나서 본다」가 아니라
                「읽으면서 본다」가 된다. 칸 너비도 설명보다 조금 넓게 잡는다
                (1.15fr) — 글은 좁아야 읽히고 영상은 넓어야 보인다.
                self-start가 없으면 grid 칸이 늘어나 sticky가 걸리지 않는다.
                top-20은 상단 고정 헤더(h-14) 아래 자리다.

                완료는 자료마다 따로 찍는다 — 진도의 뜻(자료 한 건을 봤다)은
                어느 화면에서 보든 같아야 한다. */}
            <div className="lg:border-l lg:border-rule-soft lg:pl-10">
              <div className="lg:sticky lg:top-20">
                <SectionTitle>인강</SectionTitle>
                {current.videos.length === 0 ? (
                  <Missing what="강의 영상" />
                ) : (
                  /* 설명과 같은 규칙으로 경계를 긋는다 — 한 개념에 인강이
                   * 여럿인 경우가 실제로 있고(소인수분해·최대공약수 2건),
                   * 이어 붙이면 앞 영상 끝과 다음 영상 머리가 붙어 어디까지가
                   * 한 강의인지 흐려진다. */
                  <ul className="mt-2 space-y-5">
                    {current.videos.map((v, i) => (
                      <li
                        key={v.id}
                        className="rounded-lg border border-rule bg-paper/60 p-4"
                      >
                        {current.videos.length > 1 && (
                          <p className="font-mono text-[11px] text-ink-soft">
                            인강 {i + 1}/{current.videos.length}
                          </p>
                        )}
                        <LectureVideoCard
                          video={v}
                          titleAs="h4"
                          showConcept={false}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* 아래 이동 — 설명·인강을 마쳤으면 **쪽을 넘겨** 연습으로 간다.
              연습 자료가 없는 개념은 곧장 다음 개념으로 — 없는 곳으로 보내
              「연습문제가 없습니다」를 읽히는 것은 한 번 더 걷게 하는 일이다. */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-rule-soft pt-4">
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
            {hasPractice ? (
              <Link
                href={`/learn/practice?c=${current.conceptId}`}
                className="rounded-[var(--radius-control)] border border-pen bg-pen px-4 py-2 text-sm font-medium text-white"
              >
                연습문제 풀러 가기 →
              </Link>
            ) : page < pages.length ? (
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
