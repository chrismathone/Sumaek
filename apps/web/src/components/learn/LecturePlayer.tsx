"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recordWatchProgressAction } from "@/app/learn/study/actions";
import { useLectureGate } from "@/components/learn/LectureGate";

/* ─────────────────────────────────────────────────────────────
 * 인강 플레이어 — **스킵 없이 끝까지** 보게 하는 재생기.
 *
 * 유튜브 기본 컨트롤을 끄고(controls=0·disablekb=1) 우리 컨트롤을 단다.
 * 기본 컨트롤을 그대로 두면 진행 바를 잡아끌어 끝으로 보내는 것을 막을 방법이
 * 없다 — 막고 싶은 동작이 바로 그것이다.
 *
 * 규칙은 하나다: **아직 안 본 곳으로는 못 간다.**
 *   - 뒤로 감기는 자유다. 어려운 데를 다시 보는 것은 막을 이유가 없다.
 *   - 앞으로 감기는 「여태 본 최대 지점」까지만이다. 그 너머로 넘어가면
 *     (진행 바를 끌든, 어떤 경로로 튀든) 최대 지점으로 되돌린다.
 *   - 배속은 준다. 빨리 보는 것과 건너뛰는 것은 다른 일이다.
 *
 * 진도는 「본 최대 지점 / 전체 길이」다. 앞으로 감기가 막혀 있으므로 이
 * 값이 곧 실제로 지나온 구간이고, 따로 구간 집합을 들 필요가 없다.
 *
 * **우회는 막지 않는다**(소유자 결정). 개발자도구를 아는 학생은 어차피
 * 뚫는다. 목적은 부정 방지가 아니라, 보통의 학생이 무심코 건너뛰지 않고
 * 끝까지 보게 하는 것이다. 그래서 서버는 보내온 %를 그대로 받되 뒤로만
 * 가지 않게 한다(recordVideoWatch).
 * ───────────────────────────────────────────────────────────── */

const COMPLETE_PERCENT = 95;
/** 이 초를 넘게 튀면 「감았다」로 본다 — 재생 중 자연 진행과 구분한다 */
const JUMP_TOLERANCE = 1.5;
/** 서버에 진도를 보내는 간격(초 단위 진도 증가분) */
const REPORT_EVERY_SECONDS = 10;
const RATES = [1, 1.25, 1.5, 2] as const;

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  /** 자막 모듈 내리기 — 플레이어 종류에 따라 "captions" 또는 "cc" */
  unloadModule?(module: string): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: Record<string, unknown>,
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace & { loaded?: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/* API 스크립트는 페이지에 **한 번만** 싣는다. 한 개념에 인강이 여럿이라
 * 플레이어도 여럿인데, 각자 부르면 스크립트가 중복으로 실린다. */
let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT as YTNamespace);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LecturePlayer({
  materialId,
  videoId,
  title,
  initialPercent,
  initialSeconds,
  fallbackDuration,
}: {
  materialId: string;
  videoId: string;
  title: string;
  initialPercent: number;
  initialSeconds: number;
  /** 자료에 적힌 길이 — 플레이어가 준비되기 전 눈금을 그리는 데 쓴다 */
  fallbackDuration: number | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  /* 최대 지점은 ref로도 든다 — 250ms 틱 안에서 최신 값을 봐야 하는데
   * state만 쓰면 클로저가 낡은 값을 잡는다. */
  const maxRef = useRef(initialSeconds);
  const reportedRef = useRef(initialSeconds);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(initialSeconds);
  const [maxWatched, setMaxWatched] = useState(initialSeconds);
  const [duration, setDuration] = useState(fallbackDuration ?? 0);
  const [rate, setRate] = useState<number>(1);
  const [blocked, setBlocked] = useState(false);

  const gate = useLectureGate();
  const [percent, setPercent] = useState(initialPercent);
  const doneRef = useRef(initialPercent >= COMPLETE_PERCENT);

  const report = useCallback(
    (seconds: number, total: number) => {
      const pct = total > 0 ? Math.min(100, (seconds / total) * 100) : 0;
      setPercent(pct);
      void recordWatchProgressAction({
        materialId,
        seconds,
        percent: pct,
      }).then((r) => {
        if (r.completed && !doneRef.current) {
          doneRef.current = true;
          gate?.markDone(materialId);
        }
      });
    },
    [materialId, gate],
  );

  /* 플레이어 생성 — 한 번만. videoId가 바뀌는 경우는 없다(자료 한 건 = 영상
   * 한 개). host를 nocookie로 두어 지금까지의 임베드 정책을 유지한다. */
  useEffect(() => {
    let disposed = false;
    void loadYouTubeApi().then((YT) => {
      if (disposed || !hostRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
          /* 유튜브 자막을 끈다 — 강의 영상에는 우리가 만든 자막이 이미
           * 화면에 박혀 있다. 유튜브 자막이 켜지면 두 벌이 겹쳐 읽히고,
           * 상호작용을 막아 두었으므로 학생이 끌 방법도 없다.
           * iv_load_policy 3 = 주석(annotation)도 끈다. */
          cc_load_policy: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: () => {
            if (disposed) return;
            setReady(true);
            const p = playerRef.current;
            /* cc_load_policy만으로는 부족하다 — 학생의 유튜브 계정이
             * 「자막 항상 켜기」면 그 설정이 이긴다. 자막 모듈 자체를
             * 내려 버린다(플레이어 종류에 따라 이름이 둘이라 둘 다). */
            p?.unloadModule?.("captions");
            p?.unloadModule?.("cc");
            const d = p?.getDuration?.() ?? 0;
            if (d > 0) setDuration(d);
            /* 이어 보기 — 지난번 지점으로. 단 **끝까지 본 영상은 그냥 둔다**:
             * 끝 지점으로 옮겨 놓으면 재생을 눌러도 곧바로 끝나 다시 볼
             * 길이 없다(실측). 처음부터 다시 보는 것은 막을 이유가 없다 —
             * 이미 다 본 사람이다. */
            const resumable = d > 0 ? maxRef.current < d - 5 : true;
            if (maxRef.current > 1 && resumable) {
              p?.seekTo(maxRef.current, true);
            } else if (!resumable) {
              setCurrent(0);
            }
          },
          onStateChange: (e: { data: number }) => {
            // 1=재생, 2=일시정지, 0=끝
            setPlaying(e.data === 1);
            if (e.data === 0) {
              const d = playerRef.current?.getDuration?.() ?? duration;
              maxRef.current = d;
              setMaxWatched(d);
              setCurrent(d);
              report(d, d);
            }
          },
        },
      });
    });
    return () => {
      disposed = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  /* 감시 틱 — 앞으로 튄 것을 되돌리고 최대 지점을 올린다 */
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      const t = p.getCurrentTime();
      const d = p.getDuration?.() ?? 0;
      if (d > 0) setDuration(d);

      if (t > maxRef.current + JUMP_TOLERANCE) {
        // 안 본 곳 — 되돌린다
        p.seekTo(maxRef.current, true);
        setCurrent(maxRef.current);
        setBlocked(true);
        window.setTimeout(() => setBlocked(false), 1800);
        return;
      }
      setCurrent(t);
      if (t > maxRef.current) {
        maxRef.current = t;
        setMaxWatched(t);
        if (t - reportedRef.current >= REPORT_EVERY_SECONDS) {
          reportedRef.current = t;
          report(t, d);
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [report]);

  /* 화면을 떠날 때 마지막 지점을 보낸다 — 10초 간격 사이에 나가면 그만큼이
   * 사라진다. 탭을 닫는 경우까지 잡으려고 visibilitychange도 함께 본다. */
  useEffect(() => {
    const flush = () => {
      if (maxRef.current > reportedRef.current) {
        reportedRef.current = maxRef.current;
        report(maxRef.current, playerRef.current?.getDuration?.() ?? duration);
      }
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [report, duration]);

  const seekTo = (seconds: number) => {
    const target = Math.max(0, Math.min(seconds, maxRef.current));
    playerRef.current?.seekTo(target, true);
    setCurrent(target);
  };

  const total = duration || fallbackDuration || 0;
  const watchedPct = total > 0 ? Math.min(100, (maxWatched / total) * 100) : 0;
  const headPct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const done = percent >= COMPLETE_PERCENT || watchedPct >= COMPLETE_PERCENT;
  /* 렌더는 **상태**를 읽는다. maxRef.current를 여기서 읽으면 ref가 바뀌어도
   * 다시 그려지지 않아 앞으로 감기 단추가 낡은 값에 묶인다 — 게다가 바로
   * 위 watchedPct는 maxWatched(상태)를 쓰므로, 두 줄이 같은 순간에 서로 다른
   * 진도를 말한다. maxRef.current를 쓰는 모든 자리는 setMaxWatched를 함께
   * 부르므로 두 값은 같다(ref는 콜백·이펙트가 즉시 읽으려고 두는 것이다). */
  const canForward = current + 10 <= maxWatched;

  return (
    <div className="mt-3">
      {/* 유튜브 자체 UI(가운데 재생 단추·우하단 로고·마우스 올렸을 때 뜨는
          것들)는 **iframe 안**이라 CSS로 지울 수 없다 — 다른 출처다. 대신
          위에 우리 층을 덮는다:
            · 이 층이 클릭·마우스오버를 전부 먹으므로 유튜브에는 아무 입력도
              닿지 않는다 → 올려도 유튜브 UI가 뜨지 않는다.
            · 멈춰 있을 때는 불투명하게 덮어 가운데 재생 단추와 로고를 가리고
              우리 재생 단추만 남긴다.
          화면을 누르면 재생·정지가 되는 것은 그대로 두되, 그 판단도 우리
          플레이어가 한다. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-control)] border border-rule bg-ink">
        {/* YT.Player가 이 div를 iframe으로 갈아치운다 */}
        <div ref={hostRef} className="h-full w-full" />
        <button
          type="button"
          aria-label={playing ? `${title} 일시정지` : `${title} 재생`}
          onClick={() =>
            playing
              ? playerRef.current?.pauseVideo()
              : playerRef.current?.playVideo()
          }
          /* 멈춤 상태는 **완전 불투명**이다 — 반투명이면 유튜브 로고와 종료
             화면이 비쳐 보인다. 재생 중에는 투명하되 입력은 계속 먹는다. */
          className={`absolute inset-0 flex items-center justify-center transition-colors ${
            playing ? "bg-transparent" : "bg-ink"
          }`}
        >
          {!playing && (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95">
              <svg viewBox="0 0 24 24" className="h-7 w-7 translate-x-0.5">
                <path d="M7 4.5 L19 12 L7 19.5 Z" fill="currentColor" />
              </svg>
            </span>
          )}
        </button>
      </div>

      {/* 진행 — 본 구간(굵게)과 지금 위치(눈금)를 한 막대에 겹쳐 그린다.
          막대는 **본 데까지만** 누를 수 있다. */}
      <div
        role="group"
        aria-label={`${title} 재생 조작`}
        className="mt-2 rounded-[var(--radius-control)] border border-rule bg-surface p-2"
      >
        <div
          className="relative h-2 w-full cursor-pointer rounded-full bg-rule-soft"
          onClick={(e) => {
            if (total <= 0) return;
            const box = e.currentTarget.getBoundingClientRect();
            seekTo(((e.clientX - box.left) / box.width) * total);
          }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-pen/30"
            style={{ width: `${watchedPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-pen"
            style={{ width: `${headPct}%` }}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={!ready}
            onClick={() =>
              playing
                ? playerRef.current?.pauseVideo()
                : playerRef.current?.playVideo()
            }
            /* 폭을 고정한다 — 「재생」(두 자)과 「일시정지」(네 자)의 폭이
               다르면 누를 때마다 뒤 버튼들이 좌우로 밀린다. 방금 누른 자리에
               다른 버튼이 와 있는 것은 그 자체로 오작동처럼 느껴진다. */
            className="w-20 shrink-0 rounded-[var(--radius-control)] border border-pen bg-pen px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {playing ? "일시정지" : "재생"}
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => seekTo(current - 10)}
            className="rounded-[var(--radius-control)] border border-rule px-2.5 py-1.5 font-mono text-xs disabled:opacity-50"
          >
            ← 10초
          </button>
          {/* 처음부터 — 뒤로 가는 것이므로 언제나 열려 있다. 되감아도
              시청률은 깎이지 않는다(최고 기록만 남긴다) — 다 본 영상을
              다시 보다가 「완료」가 풀리면 다음 단계가 도로 잠긴다. */}
          {maxWatched > 5 && (
            <button
              type="button"
              disabled={!ready}
              onClick={() => {
                seekTo(0);
                playerRef.current?.playVideo();
              }}
              className="rounded-[var(--radius-control)] border border-rule px-2.5 py-1.5 font-mono text-xs disabled:opacity-50"
            >
              처음부터
            </button>
          )}
          {/* 앞으로 감기는 본 데까지만 — 안 본 곳으로는 아예 누를 수 없다 */}
          <button
            type="button"
            disabled={!ready || !canForward}
            title={canForward ? undefined : "아직 보지 않은 부분입니다"}
            onClick={() => seekTo(current + 10)}
            className="rounded-[var(--radius-control)] border border-rule px-2.5 py-1.5 font-mono text-xs disabled:opacity-40"
          >
            10초 →
          </button>

          <label className="ml-1 flex items-center gap-1 font-mono text-xs text-ink-soft">
            배속
            <select
              value={rate}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRate(r);
                playerRef.current?.setPlaybackRate(r);
              }}
              className="rounded-[var(--radius-control)] border border-rule bg-surface px-1.5 py-1 font-mono text-xs"
            >
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
          </label>

          <span className="ml-auto font-mono text-xs text-ink-soft">
            {clock(current)} / {clock(total)}
          </span>
          <span
            className={`rounded-[var(--radius-control)] px-2 py-0.5 font-mono text-xs ${
              done ? "bg-pen text-white" : "border border-rule text-ink-soft"
            }`}
          >
            {done ? "시청 완료" : `${Math.floor(watchedPct)}%`}
          </span>
        </div>

        {/* 왜 안 넘어가는지 말해 준다 — 말없이 되돌리면 고장으로 보인다 */}
        {blocked && (
          <p className="mt-2 rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-2.5 py-1.5 text-xs">
            아직 보지 않은 부분으로는 건너뛸 수 없습니다. 본 곳까지 되돌렸습니다.
          </p>
        )}
      </div>
    </div>
  );
}
