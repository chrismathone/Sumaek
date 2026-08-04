import Link from "next/link";
import { youTubeEmbedUrl } from "@/lib/youtube";
import { CompleteMaterialButton } from "@/components/learn/MaterialCard";

/* ─────────────────────────────────────────────────────────────
 * 인강 한 건 — 개념 인강(/learn/watch)과 개념 공부(/learn/study) 공용.
 *
 * 개념 공부 화면이 같은 개념의 인강을 함께 싣게 되면서 영상을 그리는 곳이
 * 두 곳이 됐다. 각자 그리면 임베드 규칙·고지 위치가 한쪽에서만 지켜지는
 * 상태가 된다 — 그래서 영상 한 건의 모습은 여기 한 곳에만 있다.
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
 * 정규 주소를 못 알아보는 예전 데이터는 종전대로 새 탭 링크로 물러선다.
 * ───────────────────────────────────────────────────────────── */

export interface LectureVideo {
  id: string;
  conceptName: string;
  title: string;
  videoUrl: string | null;
  videoSeconds: number | null;
  disclosure: string | null;
  progress: "none" | "in_progress" | "completed";
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}분${s > 0 ? ` ${s}초` : ""}`;
}

export function LectureVideoCard({
  video,
  titleAs: Title = "h2",
  showConcept = true,
  readingHref,
}: {
  video: LectureVideo;
  /** 문서 위계에 맞는 제목 태그 — 인강 화면은 h2, 개념 공부 안에서는
   *  「이 개념의 인강」(h3) 아래의 h4 */
  titleAs?: "h2" | "h3" | "h4";
  /** 개념명 캡션 — 화면 전체가 이미 그 개념일 때는 끈다 */
  showConcept?: boolean;
  /** 같은 개념의 설명으로 가는 길(/learn/study?c=개념id) — 쪽 번호가 아니라
   *  개념을 싣는다. 번호는 이 화면이 굳힌 순번이라 클릭 시점의 목록과
   *  어긋날 수 있다 — 받는 쪽(study)이 지금 목록으로 푼다. */
  readingHref?: string | null;
}) {
  const duration = formatDuration(video.videoSeconds);
  // 유튜브로 알아본 것만 임베드한다 — 못 알아보면 새 탭으로 물러선다
  const embed = video.videoUrl ? youTubeEmbedUrl(video.videoUrl) : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {showConcept && (
            <p className="font-mono text-xs text-ink-soft">{video.conceptName}</p>
          )}
          <Title className="mt-0.5 font-medium">{video.title}</Title>
          {duration && (
            <p className="mt-0.5 font-mono text-xs text-ink-soft">{duration}</p>
          )}
        </div>
        <CompleteMaterialButton
          materialId={video.id}
          done={video.progress === "completed"}
        />
      </div>
      {/* AI 고지(video.disclosure)는 학생 화면에 싣지 않는다(소유자 결정
          2026-08-04) — 출처·생성 경위는 교사 검수 화면의 정보다. 데이터는
          그대로 남아 있으므로 정책이 바뀌면 여기서 다시 켠다. */}
      {video.videoUrl &&
        (embed ? (
          /* 폭은 **담는 칸이 정한다** — 카드가 max-w를 박아 두면 넓은 칸에
             놓였을 때도 영상만 작게 남는다. 좁은 화면에서는 칸 자체가 좁다. */
          <div className="mt-3 aspect-video w-full overflow-hidden rounded-[var(--radius-control)] border border-rule">
            <iframe
              src={embed}
              title={video.title}
              className="h-full w-full"
              allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          <a
            href={video.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            영상 보기 (새 창)
          </a>
        ))}
      {readingHref && (
        <p className="mt-3">
          <Link
            href={readingHref}
            className="text-sm text-pen underline underline-offset-4"
          >
            이 개념의 설명 읽기 →
          </Link>
        </p>
      )}
    </>
  );
}
