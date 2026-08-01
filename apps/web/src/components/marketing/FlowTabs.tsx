"use client";

import { useState, type KeyboardEvent } from "react";

/** 운영 흐름 5단계 — 누르면 동일한 샘플 반의 해당 화면 설명이 인라인 패널에서 바뀐다. */
const STEPS = [
  {
    title: "루트 설계",
    panel: {
      heading: "중2 심화 A · 2학기 루트",
      lines: [
        "일차부등식 → 연립방정식 → 연립방정식 활용 → 일차함수",
        "수업일: 월·수·금 16:00–18:00 · 목표 종료일 11월 20일",
        "성취기준 커버리지 100% · 선수 개념 공백 0건",
      ],
    },
  },
  {
    title: "오늘 수업 생성",
    panel: {
      heading: "8월 3일 (월) 자동 생성",
      lines: [
        "반 공통: 연립방정식 활용 ① · 예제 12–18",
        "개별: 정하린 — 지난주 미완료 예제 8–11 보충 포함",
        "숙제: 유형서 44–46쪽 · 준비물 없음",
      ],
    },
  },
  {
    title: "테스트 자동 운영",
    panel: {
      heading: "일일테스트 8문항 · 제한 15분",
      lines: [
        "오늘 학습 5문항 · 누적 복습 2문항 · 취약 개념 1문항",
        "검수·사용 권한 통과 문항만 선정 · 문항별 선정 이유 기록",
        "객관식·단답형 즉시 채점 · 저신뢰 답만 검토함으로",
      ],
    },
  },
  {
    title: "숙련도 갱신",
    panel: {
      heading: "채점 완료 → 개념 증거 반영",
      lines: [
        "이도윤: 연립방정식 풀이 — 부분 이해 (증거 4건 · 학습일 3일)",
        "한 번의 점수로 확정하지 않고 시점·표상·난이도 증거를 누적",
        "5·7번 오답 → 오답 복습과 금요일 확인테스트 생성",
      ],
    },
  },
  {
    title: "미래 일정 재계산",
    panel: {
      heading: "변경안 — 승인 대기 1건",
      lines: [
        "정하린 8/3 불참 → 8/5 보강, 8/10 반 진도 재합류 제안",
        "완료된 과거·잠긴 일정은 변경하지 않음",
        "변경 이유·전후 비교와 되돌리기 제공",
      ],
    },
  },
] as const;

export function FlowTabs() {
  const [active, setActive] = useState(0);
  const step = STEPS[active] ?? STEPS[0];

  // 탭 목록은 한 번의 Tab으로 들어오고 좌우 화살표로 이동한다 (roving tabindex).
  // 탭마다 Tab을 누르게 하면 다섯 번을 지나야 패널에 닿는다.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target =
      delta !== 0
        ? (active + delta + STEPS.length) % STEPS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? STEPS.length - 1
            : null;
    if (target === null) return;
    event.preventDefault();
    setActive(target);
    const tabs =
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[target]?.focus();
  }

  return (
    <div>
      {/*
        tablist의 직계 자식은 tab만 허용된다 — 이전의 <ol><li><button role="tab">은
        aria-required-children·aria-required-parent·listitem 세 규칙을 동시에 깼다.
        단계 번호는 목록 마크업이 아니라 버튼 안 텍스트로 유지한다.
      */}
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="운영 흐름 단계"
        onKeyDown={onKeyDown}
      >
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            id={`flow-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`flow-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm font-medium transition-colors ${
              i === active
                ? "border-pen bg-pen text-white"
                : "border-rule bg-surface text-ink-soft hover:border-pen hover:text-ink"
            }`}
          >
            <span className="mr-1.5 font-mono text-xs">{i + 1}</span>
            {s.title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`flow-panel-${active}`}
        aria-labelledby={`flow-tab-${active}`}
        tabIndex={0}
        className="mt-4 rounded-lg border border-rule bg-surface p-5"
      >
        <p className="font-mono text-xs text-ink-soft">{step.panel.heading}</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {step.panel.lines.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="text-pen">·</span>
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
