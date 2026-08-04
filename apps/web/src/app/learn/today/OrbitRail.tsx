import type { ReactNode } from "react";
import type { OrbitState, StepState } from "@/lib/learn/today-steps";

/* ─────────────────────────────────────────────────────────────
 * 오늘의 궤도 — 여섯 단계를 하나의 세로 레일에 꿴다 (18장).
 *
 * 예전에는 여섯 단계가 각각 「번호 + 제목 + 배지 + 상자」를 갖고 같은
 * 크기로 늘어서 있었다. 어디를 봐도 무게가 같아서 「지금 할 것」이
 * 나머지 다섯에 묻혔고, 활성 표시는 테두리 색 하나(border-pen)뿐이라
 * 색만으로 상태를 구분하는 셈이었다 (globals.css의 원칙 위반).
 *
 * **크기 자체를 정보로 쓴다.** 할 차례 한 단계만 카드로 펼치고 나머지는
 * 한 줄로 접는다. 접어도 행동(링크)과 「없음」의 이유 문장은 남긴다 —
 * 조용하게 만드는 것과 없애는 것은 다르다.
 *
 * 선 어휘는 마케팅 OrbitBoard에서 그대로 가져왔다(지나온 길 ink 실선 /
 * 앞으로 갈 길 rule 점선). 다만 **선에는 정보를 싣지 않는다**: rule 위
 * surface는 2.10:1이라 비텍스트 대비 3:1에 못 미친다. 같은 사실을 노드
 * 문자(✓/번호/–)·StepBadge 라벨·히어로 캡션 바·aria-current·모노 좌표가
 * 다섯 번 반복한다. **이 중복은 의도다** — 「중복이니 줄이자」고 걷어내면
 * 그 순간 색만 남아 접근성이 되돌아간다.
 * ───────────────────────────────────────────────────────────── */

/* 상태 뱃지 — 예전에는 done과 none의 클래스가 **문자 그대로 같았다**.
 * 라벨(남은 N건 / 완료 / 예정 N건 / 없음)은 그대로 두고 모양 문자와 선
 * 모양을 더한다. 라벨을 아이콘으로 **대체**하면 그것이 새 회귀다.
 *
 * `upcoming`은 todo의 **속 빈 짝**이다 — 채운 삼각(▸)과 빈 삼각(▹), 실선과
 * 점선. 「곧 할 것이지만 아직 아니다」를 색이 아니라 채움으로 말한다.
 * 문자가 글꼴에 없어 깨지더라도 옆의 라벨이 같은 사실을 글자로 말한다 —
 * 그래서 모양 문자는 aria-hidden이어도 안전하다. */
export function StepBadge({ state, label }: { state: StepState; label: string }) {
  const style =
    state === "todo"
      ? "border-solid border-pen bg-pen text-white"
      : state === "done"
        ? "border-solid border-ink bg-surface text-ink"
        : state === "upcoming"
          ? "border-dashed border-pen bg-surface text-pen"
          : "border-dashed border-rule bg-paper text-ink-soft";
  const mark =
    state === "todo"
      ? "▸"
      : state === "done"
        ? "✓"
        : state === "upcoming"
          ? "▹"
          : "–";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-[11px] ${style}`}
    >
      <span aria-hidden>{mark}</span>
      {label}
    </span>
  );
}

/* 궤도 노드 — 채움·테두리 굵기·테두리 모양·문자 넷이 함께 바뀐다.
 * aria-hidden인 이유: 같은 사실을 바로 옆 StepBadge가 글자로 말한다. */
function OrbitNode({ state, no }: { state: OrbitState; no: number }) {
  const shape =
    state === "past"
      ? "border border-solid border-ink bg-ink text-white"
      : state === "here"
        ? "border-2 border-solid border-pen bg-surface font-bold text-pen"
        : state === "ahead"
          ? "border border-solid border-rule bg-surface text-ink-soft"
          : "border border-dashed border-rule bg-paper text-ink-soft";
  return (
    <span
      aria-hidden
      className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs ${shape}`}
    >
      {state === "past" ? "✓" : state === "empty" ? "–" : no}
    </span>
  );
}

/* 정거장 하나.
 *
 * 마커는 flex의 **정적 자식**이다 — absolute + first: 조합을 쓰면
 * :first-child 판정이 앞선 레일 span에 먹혀 첫 정거장이 어긋난다.
 * 레일 선만 absolute이고, 좌표는 rem으로 잠근다:
 *   left = 마커 폭 w-7(1.75rem)의 절반 0.875rem − 선 두께 2px의 절반 1px.
 * px 상수를 쓰면 사용자가 글꼴을 키웠을 때 마커와 선이 갈라진다. */
export function OrbitStop({
  no,
  orbit,
  solidBelow,
  last,
  children,
}: {
  no: number;
  orbit: OrbitState;
  /** 이 정거장 아래 구간을 실선으로 그릴지 — **위치 기준**이다.
   *  노드 상태(done)로 그리면, 뒤 단계를 먼저 마친 학생에게
   *  지나오지 않은 길이 실선으로 그려져 궤도가 거짓말한다. */
  solidBelow: boolean;
  last: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className="relative flex gap-3 pb-5 last:pb-0"
      aria-current={orbit === "here" ? "step" : undefined}
    >
      {!last && (
        <span
          aria-hidden
          className={`absolute top-7 bottom-0 left-[calc(0.875rem-1px)] w-0 border-l-2 ${
            solidBelow ? "border-solid border-ink" : "border-dashed border-rule"
          }`}
        />
      )}
      <OrbitNode state={orbit} no={no} />
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </li>
  );
}
