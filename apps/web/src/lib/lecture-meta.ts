/* ─────────────────────────────────────────────────────────────
 * 자동 판서 강의 파이프라인의 `out/meta.json` 해석.
 *
 * 파이프라인은 별도 도구이고 라이브러리 진입점도 없어서(CLI만 있다), 연결은
 * **사람이 파일 내용을 붙여넣는** 형태로 둔다. 그 대신 붙여넣은 것에서 제목과
 * 길이를 뽑아 폼을 채워 준다 — 옮겨 적다 틀리는 것이 실제 실수의 대부분이다.
 *
 * 여기서 `video_url`을 읽지 않는 이유: meta.json에 그런 필드가 **없다**.
 * 파이프라인은 mp4를 로컬에 두고 업로드하지 않으므로 주소를 모른다.
 * 유튜브 주소는 사람이 올린 뒤 직접 넣는다.
 *
 * `pageId`도 쓰지 않는다 — 그것은 "어느 페이지에서 만들었나"이지 "어느 개념인가"가
 * 아니다. 개념 선택은 이 화면에서 사람이 한다.
 * ───────────────────────────────────────────────────────────── */

export interface LectureMeta {
  title: string;
  /** 총 길이(초). fps·프레임 수에서 유도한다 — meta.json에 초 단위 필드가 없다 */
  seconds: number;
  /**
   * AI 고지 — 파이프라인이 「선생님이 검수한 AI 보충 강의입니다.」를 넣는다.
   * 지금까지는 이 값이 meta.json에만 있고 수맥 안에는 저장할 자리도 표시할
   * 자리도 없어서, 학생은 AI가 만든 강의를 사람이 만든 것과 구별할 수 없었다.
   */
  disclosure: string | null;
  jobId: string | null;
  pageId: string | null;
}

export type ParseResult =
  | { ok: true; meta: LectureMeta }
  | { ok: false; message: string };

/**
 * 붙여넣은 meta.json 문자열을 해석한다.
 * 실패는 "왜 못 읽었는지"를 말한다 — 조용히 빈 폼을 남기면 사람이 뭘 잘못했는지
 * 모른 채 다시 붙여넣는다.
 */
export function parseLectureMeta(raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { ok: false, message: "붙여넣은 내용이 없습니다." };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: "JSON으로 읽을 수 없습니다. meta.json 파일 내용을 통째로 붙여넣으세요.",
    };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, message: "meta.json 형식이 아닙니다." };
  }
  const m = data as Record<string, unknown>;

  const title = typeof m.lessonTitle === "string" ? m.lessonTitle.trim() : "";
  if (!title) {
    return {
      ok: false,
      message: "lessonTitle이 없습니다. 강의 meta.json이 맞는지 확인하세요.",
    };
  }

  const fps = typeof m.fps === "number" ? m.fps : 0;
  const frames = typeof m.totalFrames === "number" ? m.totalFrames : 0;
  if (fps <= 0 || frames <= 0) {
    return {
      ok: false,
      message: "fps·totalFrames가 없어 길이를 계산할 수 없습니다.",
    };
  }

  return {
    ok: true,
    meta: {
      title,
      seconds: Math.round(frames / fps),
      disclosure:
        typeof m.disclosure === "string" && m.disclosure.trim()
          ? m.disclosure.trim()
          : null,
      jobId: typeof m.jobId === "string" ? m.jobId : null,
      pageId: typeof m.pageId === "string" ? m.pageId : null,
    },
  };
}
