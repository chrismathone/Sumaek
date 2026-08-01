/**
 * 유튜브 URL → 영상 ID.
 *
 * 호스트를 유튜브로 좁히는 이유는 두 가지다. 하나는 학생 화면에서
 * `youtube-nocookie` 임베드로 재생하려면 ID가 필요하기 때문이고, 다른 하나는
 * 임의 URL을 받으면 그 페이지가 우리 화면 안에서 무엇이든 할 수 있기 때문이다.
 *
 * 저장은 항상 정규화된 `https://www.youtube.com/watch?v=<id>` 형태로 한다 —
 * 같은 영상이 단축·공유·임베드 주소로 여러 번 등록되는 것을 막는다.
 *
 * 이 파일이 서버 액션에서 분리되어 있는 이유: `"use server"` 모듈은 async
 * 함수만 export할 수 있어 순수 함수를 같이 둘 수 없다 (실측: 그대로 두면
 * 화면이 통째로 백지가 된다).
 */

const HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

export function parseYouTubeId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!HOSTS.has(host)) return null;

  const id =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : (url.searchParams.get("v") ??
        (url.pathname.startsWith("/embed/") ? url.pathname.slice(7) : null) ??
        (url.pathname.startsWith("/shorts/") ? url.pathname.slice(8) : null));
  if (!id) return null;
  // 유튜브 영상 ID는 11자 [A-Za-z0-9_-]
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** 저장용 정규 주소 */
export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** 학생 화면 임베드용 — 추적 쿠키를 줄이는 nocookie 도메인 */
export function youTubeEmbedUrl(watchUrl: string): string | null {
  const id = parseYouTubeId(watchUrl);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}
