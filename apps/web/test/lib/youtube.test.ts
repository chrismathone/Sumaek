import { describe, expect, it } from "vitest";
import {
  parseYouTubeId,
  youTubeEmbedUrl,
  youTubeWatchUrl,
} from "@/lib/youtube";

/* ─────────────────────────────────────────────────────────────
 * 유튜브 주소 판정.
 *
 * 이 함수가 느슨하면 학생 화면의 iframe에 임의 페이지가 실린다 — 그 페이지가
 * 우리 화면 안에서 무엇이든 할 수 있다. 그래서 "받아들이는 것"보다
 * **"거절하는 것"** 을 더 촘촘히 겨눈다.
 * ───────────────────────────────────────────────────────────── */

const ID = "aQkPcPqTq4M";

describe("유튜브 주소 판정", () => {
  it("watch·단축·임베드·shorts 주소를 모두 같은 ID로 읽는다", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
    ]) {
      expect(parseYouTubeId(url), url).toBe(ID);
    }
  });

  it("재생목록·시간 같은 부가 파라미터가 있어도 읽는다", () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}&t=42s&list=PLxyz`)).toBe(ID);
  });

  it("앞뒤 공백을 허용한다 (붙여넣기 현실)", () => {
    expect(parseYouTubeId(`  https://youtu.be/${ID}  `)).toBe(ID);
  });

  /* ── 거절해야 하는 것들 ── */

  it("유튜브가 아닌 호스트는 거절한다", () => {
    for (const url of [
      "https://vimeo.com/12345678901",
      "https://example.com/watch?v=aQkPcPqTq4M",
      // 호스트 접미사만 같은 위장 도메인
      "https://notyoutube.com/watch?v=aQkPcPqTq4M",
      "https://youtube.com.evil.test/watch?v=aQkPcPqTq4M",
    ]) {
      expect(parseYouTubeId(url), url).toBeNull();
    }
  });

  it("http(s)가 아닌 스킴을 거절한다", () => {
    expect(parseYouTubeId(`javascript:alert(1)//youtube.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeId(`data:text/html,<script>1</script>`)).toBeNull();
  });

  it("watch가 아닌 경로에 붙은 v 쿼리를 읽지 않는다", () => {
    /* 실측 결함: `v` 쿼리를 경로와 무관하게 읽어서 채널·검색·재생목록 주소가
     * 통과했고, 그것이 정규 watch 주소로 저장돼 학생 화면에는 전혀 다른
     * 영상이 실렸다. 유튜브가 실제로 ID를 v에 싣는 경로는 /watch 뿐이다. */
    for (const url of [
      `https://www.youtube.com/@someone?v=${ID}`,
      `https://www.youtube.com/results?search_query=x&v=${ID}`,
      `https://www.youtube.com/playlist?list=PLxyz&v=${ID}`,
      `https://www.youtube.com/?v=${ID}`,
      `https://www.youtube.com/watch/extra?v=${ID}`,
    ]) {
      expect(parseYouTubeId(url), url).toBeNull();
    }
  });

  it("경로 끝 슬래시는 붙어 있어도 같게 읽는다 (붙여넣기 현실)", () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch/?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://youtu.be/${ID}/`)).toBe(ID);
  });

  it("영상 ID 형식이 아니면 거절한다", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/watch?v=" + "x".repeat(12))).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/watch?v=has spaces")).toBeNull();
  });

  it("주소가 아니거나 비어 있으면 거절한다", () => {
    for (const bad of ["", "   ", "그냥 글자", "youtube.com/watch?v=" + ID]) {
      expect(parseYouTubeId(bad), bad).toBeNull();
    }
  });

  /* ── 정규화 ── */

  it("어떤 형태로 들어와도 같은 정규 주소로 저장된다", () => {
    const urls = [
      `https://youtu.be/${ID}?t=10`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/embed/${ID}`,
    ];
    const normalized = urls.map((u) => youTubeWatchUrl(parseYouTubeId(u)!));
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it("임베드는 nocookie 도메인을 쓴다 (추적 쿠키 축소)", () => {
    expect(youTubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}`,
    );
  });

  it("알아볼 수 없는 주소는 임베드하지 않는다 (새 탭으로 물러설 수 있게 null)", () => {
    expect(youTubeEmbedUrl("https://vimeo.com/12345")).toBeNull();
  });
});
