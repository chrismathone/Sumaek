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

  /* 경로별로 ID가 어디 있는지가 다르다 — **경로를 먼저 보고** 그 자리에서만
   * 읽는다. 예전에는 `v` 쿼리를 경로와 무관하게 먼저 읽어서
   * `youtube.com/@아무채널?v=<11자>` 같은 주소가 통과했고, 그것이 정규
   * watch 주소로 저장돼 학생 화면에는 엉뚱한 영상이 임베드됐다. */
  const path = url.pathname.replace(/\/$/, "");
  const id =
    host === "youtu.be"
      ? path.slice(1)
      : path === "/watch"
        ? url.searchParams.get("v")
        : path.startsWith("/embed/")
          ? path.slice(7)
          : path.startsWith("/shorts/")
            ? path.slice(8)
            : null;
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
