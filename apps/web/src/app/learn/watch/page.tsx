import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { youTubeEmbedUrl } from "@/lib/youtube";
import { todayInTimeZone } from "@/lib/format";
import { listMaterials } from "@/lib/domain/learning-material";
import { getTodayScope } from "@/lib/learn/today-context";
import { CompleteMaterialButton } from "@/components/learn/MaterialCard";

export const metadata: Metadata = { title: "개념 인강" };

/* 개념 인강 — 오늘 차시 개념의 강의 영상.
 *
 * 영상은 **외부 호스팅만** 받는다 (learning_materials.video_url). 이 제품은
 * 영상을 보관하지도, 트랜스코딩하지도 않는다 — 그 순간 저장·전송 비용과
 * 저작권 관리가 제품 안으로 들어온다. 생성기가 어디에 있든 결과 URL만
 * 넣으면 붙는 구조다.
 *
 * **임베드는 유튜브로 호스트가 확정된 뒤에 열었다.** 예전에는 임의 URL이라
 * 새 탭으로만 열었다 — 임의 페이지를 iframe으로 열면 그 페이지가 우리 화면
 * 안에서 무엇이든 할 수 있기 때문이다. 지금은 저작 화면(`content/materials`)이
 * 유튜브 주소만 받아 정규화해 저장하므로 그 위험이 사라졌다.
 * `youtube-nocookie.com`을 쓰는 이유는 추적 쿠키를 줄이기 위한 것이고,
 * 정규 주소를 못 알아보는 예전 데이터는 종전대로 새 탭 링크로 물러선다. */

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}분${s > 0 ? ` ${s}초` : ""}`;
}

export default async function WatchPage() {
  const learner = (await getCurrentLearner())!;
  const today = todayInTimeZone(learner.user.timezone);
  const scope = await getTodayScope(learner, today);
  const materials = await listMaterials({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    conceptIds: scope.conceptIds,
    kinds: ["video"],
  });

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold">개념 인강</h1>
      <p className="mt-1 text-sm text-ink-soft">
        오늘 배우는 개념의 강의 영상입니다. 다 봤으면 「다 봤어요」를 눌러 주세요.
      </p>

      {materials.length === 0 ? (
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
          {materials.map((m) => {
            const duration = formatDuration(m.videoSeconds);
            // 유튜브로 알아본 것만 임베드한다 — 못 알아보면 새 탭으로 물러선다
            const embed = m.videoUrl ? youTubeEmbedUrl(m.videoUrl) : null;
            return (
              <li key={m.id} className="rounded-lg border border-rule bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-ink-soft">{m.conceptName}</p>
                    <h2 className="mt-0.5 font-medium">{m.title}</h2>
                    {duration && (
                      <p className="mt-0.5 font-mono text-xs text-ink-soft">
                        {duration}
                      </p>
                    )}
                  </div>
                  <CompleteMaterialButton
                    materialId={m.id}
                    done={m.progress === "completed"}
                  />
                </div>
                {/* AI 고지 — 영상 **위에** 둔다. 다 보고 난 뒤에 알리는 것은
                    알린 것이 아니다. 파이프라인은 이 문구를 유튜브 설명란에
                    넣으라고 안내하지만, 임베드로 보는 학생에게 설명란은
                    보이지 않는다. 그래서 자료에 저장해 여기서 말한다. */}
                {m.disclosure && (
                  <p className="mt-3 rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-3 py-2 text-sm">
                    {m.disclosure}
                  </p>
                )}
                {m.videoUrl &&
                  (embed ? (
                    <div className="mt-3 aspect-video w-full max-w-2xl overflow-hidden rounded-[var(--radius-control)] border border-rule">
                      <iframe
                        src={embed}
                        title={m.title}
                        className="h-full w-full"
                        allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    </div>
                  ) : (
                    <a
                      href={m.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
                    >
                      영상 보기 (새 창)
                    </a>
                  ))}
              </li>
            );
          })}
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
