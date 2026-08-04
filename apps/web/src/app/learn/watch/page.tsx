import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { listMaterials } from "@/lib/domain/learning-material";
import { getTodayScope } from "@/lib/learn/today-context";
import { LectureVideoCard } from "@/components/learn/LectureVideoCard";

export const metadata: Metadata = { title: "개념 인강" };

/* 개념 인강 — 오늘 차시 개념의 강의 영상 목록.
 *
 * 영상 한 건을 그리는 규칙(외부 호스팅만·유튜브 확정 후 임베드·고지는 영상
 * 위)은 LectureVideoCard에 있다 — 개념 공부(/learn/study)가 같은 개념의
 * 인강을 함께 싣게 되면서 그리는 곳이 두 곳이 됐고, 규칙은 한 곳에만 둔다.
 *
 * 각 영상에는 같은 개념의 설명(/learn/study?c=개념id)으로 가는 길을 단다 —
 * 영상만 보고 끝나지 않고 설명과 오가며 공부하는 흐름을 화면이 잇는다. */

export default async function WatchPage() {
  const learner = (await getCurrentLearner())!;
  const today = todayInKst();
  const scope = await getTodayScope(learner, today);
  const materials = await listMaterials({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    conceptIds: scope.conceptIds,
    kinds: ["reading", "video"],
  });
  const videos = materials.filter((m) => m.kind === "video");
  /* 설명이 있는 개념 — 링크에는 쪽 **번호**가 아니라 **개념**을 싣는다.
   * 번호는 이 화면이 렌더 시점에 굳힌 순번이라, 탭을 켜 둔 사이 교사가
   * 게시·게시 취소하면 클릭 시점의 목록과 어긋나 다른 개념이 열린다.
   * 개념을 실으면 받는 쪽(study)이 지금 목록으로 풀므로 「이 개념의」라는
   * 라벨이 항상 참이다. */
  const conceptsWithReading = new Set(
    materials.filter((m) => m.kind === "reading").map((m) => m.conceptId),
  );

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold">개념 인강</h1>
      <p className="mt-1 text-sm text-ink-soft">
        오늘 배우는 개념의 강의 영상입니다. 다 봤으면 「다 봤어요」를 눌러 주세요.
      </p>

      {videos.length === 0 ? (
        <div className="mt-4 rounded-lg border border-rule bg-surface p-5">
          <p className="font-medium">
            {!scope.hasSession
              ? "오늘은 수업이 없어 볼 강의가 없습니다."
              : "오늘 개념에 등록된 강의 영상이 아직 없습니다."}
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            {scope.hasSession &&
              "선생님이 영상을 올리면 여기에 표시됩니다. 그동안 개념 공부와 연습문제는 그대로 할 수 있습니다."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {videos.map((m) => (
            <li key={m.id} className="rounded-lg border border-rule bg-surface p-5">
              <LectureVideoCard
                video={m}
                readingHref={
                  conceptsWithReading.has(m.conceptId)
                    ? `/learn/study?c=${m.conceptId}`
                    : null
                }
              />
            </li>
          ))}
        </ul>
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
