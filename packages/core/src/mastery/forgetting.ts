import type { IsoDate } from "../shared/dates";
import type { MasteryPolicySpec } from "./engine";

/* ─────────────────────────────────────────────────────────────
 * 에빙하우스 망각곡선 기반 복습 스케줄러 (20장).
 *
 * 이 파일이 생기기 전까지 간격 반복은 **작동한 적이 없다.** 겉보기에는
 * `reviewIntervalsDays [1,3,7,14,30]` 계단이었지만, 호출부가 언제나
 * `(stage=0, wasCorrect=false)`로만 불러 배열에서 `1`만 쓰였고, 단계를 저장할
 * 컬럼조차 없었다. 실제 동작은 "간격 1일 무한 반복"이었다.
 *
 * ── 모델 ──
 * 학습자×개념마다 **안정성 S(일)** 를 둔다 — "지금 복습하면 목표 유지율 θ까지
 * 버티는 일수". 망각곡선은
 *
 *     R(t) = exp( -t · ln(1/θ) / S )
 *
 * `t = S`일 때 `R = θ`가 **정확히** 성립하도록 정의했다. 덕분에 다음 복습일이
 * `마지막 복습일 + S`로 곧바로 나오고, 설명이 한 줄로 된다 — "S일 뒤에 90%만
 * 남는다". 고전적 stability(θ=1/e 기준)를 쓰면 매번 ln 변환이 끼어 사람이
 * 읽기 어려워진다. 여기서는 설명 가능성을 택했다.
 *
 * ── 규약 ──
 * 이 모듈은 **순수 함수**다. 내부에서 현재 시각을 읽지 않는다 (engine.ts와 같은
 * 규약 — 불변 조건 11의 재현성 근거). 날짜는 전부 파라미터로 들어온다.
 *
 * 임계값은 하나도 하드코딩하지 않는다 — 전부 정책(`MasteryPolicySpec`)에서
 * 온다 (ADR-0009 "코드 상수 금지"). 정책에 없으면 `FORGETTING_DEFAULTS`로
 * 메운다: DB에 이미 새 필드가 없는 정책 행이 있고, 그 행이 오늘 깨지면 안 된다.
 *
 * ── 경계 ──
 * 복습 성패는 **숙련도 증거가 아니다** (review.ts 머리말·불변 조건 10).
 * 그래서 안정성은 `concept_masteries`가 아니라 `review_items`에 산다.
 * 이 모듈은 숙련도를 계산하지도, 참조하지도 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface ForgettingParams {
  targetRetention: number;
  initialStabilityDays: number;
  successMultiplier: number;
  lapseMultiplier: number;
  minStabilityDays: number;
  maxIntervalDays: number;
  maxOverdueBonus: number;
}

/** 정책에 망각곡선 필드가 없을 때 메우는 값 */
export const FORGETTING_DEFAULTS: ForgettingParams = {
  targetRetention: 0.9,
  initialStabilityDays: 1,
  successMultiplier: 2.0,
  lapseMultiplier: 0.4,
  minStabilityDays: 1,
  maxIntervalDays: 30,
  maxOverdueBonus: 1.5,
};

/**
 * 정책에서 망각곡선 파라미터를 뽑는다. 없는 필드는 기본값으로 메우고,
 * **범위를 벗어난 값은 조용히 쓰지 않는다** — 잘못된 정책이 저장되어도
 * 스케줄러가 무한대나 음수 간격을 뱉지 않게 한다.
 */
export function forgettingParams(
  policy: Partial<MasteryPolicySpec> | undefined | null,
): ForgettingParams {
  const d = FORGETTING_DEFAULTS;
  const p = policy ?? {};
  const num = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;

  return {
    // θ는 0·1 양끝을 배제한다: 1이면 ln(1/θ)=0으로 나눗셈이 죽고, 0이면 발산한다
    targetRetention: num(p.targetRetention, d.targetRetention, 0.01, 0.99),
    initialStabilityDays: num(p.initialStabilityDays, d.initialStabilityDays, 0.1, 3650),
    successMultiplier: num(p.successMultiplier, d.successMultiplier, 1.01, 10),
    lapseMultiplier: num(p.lapseMultiplier, d.lapseMultiplier, 0.01, 0.99),
    minStabilityDays: num(p.minStabilityDays, d.minStabilityDays, 0.1, 3650),
    maxIntervalDays: num(p.maxIntervalDays, d.maxIntervalDays, 1, 3650),
    maxOverdueBonus: num(p.maxOverdueBonus, d.maxOverdueBonus, 1, 5),
  };
}

/**
 * 예측 기억률 R — 마지막 복습 이후 `daysSinceReview`일 지난 지금 얼마나 남았는가.
 *
 * 출제에서 "무엇부터 다시 낼까"의 정렬 기준이다. 기한이 지났는지(due_on)는
 * 예/아니오뿐이라 순서를 못 매기지만, R은 **얼마나 잊혔는지**로 줄을 세운다.
 */
export function predictedRetention(input: {
  stabilityDays: number;
  daysSinceReview: number;
  targetRetention?: number;
}): number {
  const theta = forgettingParams({
    targetRetention: input.targetRetention,
  } as Partial<MasteryPolicySpec>).targetRetention;
  const s = Math.max(0.1, input.stabilityDays);
  const t = Math.max(0, input.daysSinceReview);
  // t = s 일 때 정확히 theta가 되도록 정규화
  return Math.exp((-t * Math.log(1 / theta)) / s);
}

export interface ReviewSchedule {
  /** 갱신된 안정성 (일) */
  stabilityDays: number;
  /** 몇 번째 복습인가 (1부터) */
  repetitionNo: number;
  /** 누적 실패 횟수 */
  lapseCount: number;
  /** 다음 복습 기한 */
  dueOn: IsoDate;
  /** 이번에 적용된 간격 (일) — 화면 표시·감사용 */
  intervalDays: number;
  /** 왜 이 날짜가 나왔는지 — 사람이 읽는 설명 (engine.ts 문체) */
  explanation: string[];
}

function addDaysIso(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) as IsoDate;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * 다음 복습 일정.
 *
 * @param stabilityDays 현재 안정성. `null`이면 첫 배치 — 정책의 초기값을 쓴다.
 * @param dueOn         원래 예정일. 늦게 본 정도를 재는 기준이며, 없으면 보너스 없음.
 * @param reviewedOn    실제로 복습한 날 (조직 시간대 기준 날짜).
 */
export function scheduleNextReview(input: {
  policy: Partial<MasteryPolicySpec> | undefined | null;
  stabilityDays: number | null;
  repetitionNo: number;
  lapseCount: number;
  wasCorrect: boolean;
  dueOn: IsoDate | null;
  reviewedOn: IsoDate;
}): ReviewSchedule {
  const p = forgettingParams(input.policy);
  const explanation: string[] = [];

  const prior =
    input.stabilityDays !== null && Number.isFinite(input.stabilityDays)
      ? Math.max(p.minStabilityDays, input.stabilityDays)
      : p.initialStabilityDays;

  let next: number;
  let lapseCount = input.lapseCount;

  if (input.wasCorrect) {
    /* 예정보다 늦게 봤는데도 맞혔다 = 기억이 우리 추정보다 강했다.
     * 그만큼 더 늘려 준다. 다만 상한을 둔다 — 한 달 방치 후 정답 하나로
     * 간격이 폭주하면 그 다음 복습이 영영 안 온다. */
    const overdueDays = input.dueOn ? Math.max(0, daysBetween(input.dueOn, input.reviewedOn)) : 0;
    const bonus =
      overdueDays > 0
        ? Math.min(p.maxOverdueBonus, 1 + overdueDays / Math.max(1, prior))
        : 1;
    next = prior * p.successMultiplier * bonus;
    explanation.push(
      `맞혔으므로 안정성을 ${prior.toFixed(1)}일 → ${Math.min(next, p.maxIntervalDays).toFixed(1)}일로 늘렸습니다 (배율 ${p.successMultiplier}).`,
    );
    if (bonus > 1) {
      explanation.push(
        `예정보다 ${overdueDays}일 늦게 봤는데도 맞혀 ${bonus.toFixed(2)}배를 더 얹었습니다.`,
      );
    }
  } else {
    next = prior * p.lapseMultiplier;
    lapseCount += 1;
    explanation.push(
      `틀렸으므로 안정성을 ${prior.toFixed(1)}일 → ${Math.max(next, p.minStabilityDays).toFixed(1)}일로 줄였습니다 (배율 ${p.lapseMultiplier}).`,
    );
    explanation.push(`이 개념을 놓친 횟수: ${lapseCount}회.`);
  }

  /* 하한·상한. 상한은 사용자가 정한 "최대 1달"이고, 어떤 경로로도 뚫리면 안 된다 —
   * 연속 정답으로 배율이 곱해져도, 늦게 봐 보너스가 붙어도 여기서 잘린다. */
  const stability = Math.min(
    p.maxIntervalDays,
    Math.max(p.minStabilityDays, next),
  );
  if (next > p.maxIntervalDays) {
    explanation.push(`간격 상한 ${p.maxIntervalDays}일에서 잘랐습니다.`);
  }

  /* 간격은 정수 일로 내린다 — 날짜 계산이 정수이고, 올리면 상한을 넘길 수 있다.
   * 최소 1일은 보장한다 (같은 날 다시 내지 않는다). */
  const intervalDays = Math.max(1, Math.floor(stability));

  return {
    stabilityDays: stability,
    repetitionNo: input.repetitionNo + 1,
    lapseCount,
    dueOn: addDaysIso(input.reviewedOn, intervalDays),
    intervalDays,
    explanation,
  };
}

/** 오답으로 복습 항목을 **처음 만들 때**의 초기 일정 */
export function initialReviewSchedule(input: {
  policy: Partial<MasteryPolicySpec> | undefined | null;
  occurredOn: IsoDate;
}): ReviewSchedule {
  const p = forgettingParams(input.policy);
  const intervalDays = Math.max(
    1,
    Math.floor(Math.min(p.maxIntervalDays, p.initialStabilityDays)),
  );
  return {
    stabilityDays: Math.min(p.maxIntervalDays, p.initialStabilityDays),
    repetitionNo: 0,
    lapseCount: 0,
    dueOn: addDaysIso(input.occurredOn, intervalDays),
    intervalDays,
    explanation: [`틀린 개념이라 ${intervalDays}일 뒤에 다시 확인합니다.`],
  };
}
