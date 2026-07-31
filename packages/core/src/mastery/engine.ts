import type { IsoDate } from "../shared/dates";

/* ─────────────────────────────────────────────────────────────
 * 숙련도 추정 엔진 (골프롬프트 20장·2M).
 *
 * - MasteryEvidence(불변 원본) + MasteryPolicy(버전) + cutoff → ConceptMastery.
 *   같은 입력은 같은 출력 — 재현 가능 (불변 조건 11).
 * - 임계값은 이 파일에 하드코딩하지 않는다. 전부 정책 객체의 필드다
 *   (math_test의 "30곳 하드코딩 + 설정 컬럼 사문화" 결함 회피).
 * - 한 번의 점수로 숙련을 확정하지 않는다: 최소 증거 수, 서로 다른 학습일,
 *   지연 확인, 표상·맥락 다양성, 최근성을 함께 본다 (원칙 14).
 * - is_mastered 영구 래치 금지: 상태는 언제나 재계산 가능한 파생이다.
 * ───────────────────────────────────────────────────────────── */

export type MasteryDimension =
  | "conceptual" // 개념 이해
  | "procedural" // 절차 유창성
  | "application" // 적용·문제 해결
  | "reasoning"; // 추론·설명

export interface EvidenceSignal {
  correct: boolean;
  /** 부분 점수 비율 (0~1). correct와 함께 오면 이 값을 우선 */
  scoreRatio?: number;
  /** 문항 난이도 0~1 (경험적·내용 수준의 종합 — 호출자가 산출) */
  difficulty: number;
  dimension: MasteryDimension;
  /** 표상 종류 (식·표·그래프·언어·도형 다양성 측정) */
  representation?: string;
  /** 전이 맥락 (낯선 상황) 여부 */
  isTransfer?: boolean;
  hintUsed?: boolean;
  /** 교사 수동 판정 증거 여부 */
  isTeacherJudgment?: boolean;
}

export interface MasteryEvidenceInput {
  evidenceId: string;
  evidenceDate: IsoDate;
  occurredAt: string; // ISO datetime
  signal: EvidenceSignal;
  /** 문항-개념 매핑 신뢰도 0~1 */
  mappingConfidence: number;
}

/** 숙련도 정책 — MasteryPolicyVersion.spec의 타입. DB에 시드·버전 관리된다. */
export interface MasteryPolicySpec {
  /** 상태 판정 최소 증거 수 */
  minEvidenceCount: number;
  /** 서로 다른 학습일 최소 수 (같은 날 반복은 1일) */
  minDistinctDays: number;
  /** 최근성 반감기 (일) — 오래된 증거의 가중 감쇠 */
  recencyHalfLifeDays: number;
  /** stable 판정 점 추정 하한 */
  stableThreshold: number;
  /** partial 판정 점 추정 하한 (미만이면 exploring 유지) */
  partialThreshold: number;
  /** stable 이후 이 일수 동안 증거가 없으면 재점검 필요 */
  recheckAfterDays: number;
  /** transfer_confirmed에 필요한 전이 맥락 정답 수 */
  transferEvidenceCount: number;
  /** 힌트 사용 증거의 가중 배율 (0~1) */
  hintPenalty: number;
  /** 필수 차원 — 이 차원들에 증거가 있어야 stable 가능 */
  requiredDimensions: MasteryDimension[];
  /** 간격 복습 간격 (일) — 연속 성공 단계별 */
  reviewIntervalsDays: number[];
}

/**
 * 기본 정책 v1 — 코드 상수가 아니라 "시드되는 정책 데이터"다.
 * DB의 MasteryPolicyVersion으로 저장되며 조직·학년군·개념별로 교체 가능.
 */
export const DEFAULT_MASTERY_POLICY: MasteryPolicySpec = {
  minEvidenceCount: 3,
  minDistinctDays: 2,
  recencyHalfLifeDays: 30,
  stableThreshold: 0.8,
  partialThreshold: 0.4,
  recheckAfterDays: 45,
  transferEvidenceCount: 1,
  hintPenalty: 0.6,
  requiredDimensions: ["conceptual", "procedural"],
  reviewIntervalsDays: [1, 3, 7, 14, 30],
};

export type MasteryState =
  | "no_evidence"
  | "exploring"
  | "partial"
  | "stable"
  | "transfer_confirmed"
  | "recheck_needed";

export interface MasteryEstimate {
  state: MasteryState;
  pointEstimate: number | null;
  uncertainty: number | null;
  evidenceCount: number;
  distinctDays: number;
  lastEvidenceAt: string | null;
  /** 차원별 (증거 수·정답률) */
  dimensions: Partial<
    Record<MasteryDimension, { count: number; ratio: number }>
  >;
  /** 다음 확인 조건 — 지연 확인 예정일 등 */
  nextCheck: { kind: "delayed_check" | "more_evidence" | "transfer_check"; dueOn?: IsoDate } | null;
  /** 판정에 사용된 근거 요약 (교사 열람용 — 원칙 6) */
  explanation: string[];
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(
    0,
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000,
  );
}

function addDaysIso(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 증거 목록 → 숙련도 추정. 결정론적 — asOf(기준 시각)를 입력으로 받는다.
 * 엔진 내부에서 현재 시각을 읽지 않는다.
 */
export function estimateMastery(
  evidences: readonly MasteryEvidenceInput[],
  policy: MasteryPolicySpec,
  asOf: string,
): MasteryEstimate {
  const explanation: string[] = [];
  const valid = [...evidences]
    .filter((e) => e.occurredAt <= asOf)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  if (valid.length === 0) {
    return {
      state: "no_evidence",
      pointEstimate: null,
      uncertainty: null,
      evidenceCount: 0,
      distinctDays: 0,
      lastEvidenceAt: null,
      dimensions: {},
      nextCheck: { kind: "more_evidence" },
      explanation: ["증거 없음"],
    };
  }

  // 가중 정답률: 난이도·매핑 신뢰도·최근성·힌트 반영
  let weightSum = 0;
  let correctWeight = 0;
  const dims: Partial<Record<MasteryDimension, { count: number; correct: number }>> = {};
  let transferCorrect = 0;
  const dayset = new Set<string>();

  for (const e of valid) {
    dayset.add(e.evidenceDate);
    const age = daysBetween(e.occurredAt, asOf);
    const recency = Math.pow(0.5, age / policy.recencyHalfLifeDays);
    const difficultyWeight = 0.5 + e.signal.difficulty; // 어려운 문항 증거 가중
    const hintFactor = e.signal.hintUsed ? policy.hintPenalty : 1;
    const w = recency * difficultyWeight * e.mappingConfidence * hintFactor;
    const ratio =
      e.signal.scoreRatio !== undefined
        ? e.signal.scoreRatio
        : e.signal.correct
          ? 1
          : 0;
    weightSum += w;
    correctWeight += w * ratio;

    const d = (dims[e.signal.dimension] ??= { count: 0, correct: 0 });
    d.count += 1;
    d.correct += ratio;
    if (e.signal.isTransfer && ratio >= 1) transferCorrect += 1;
  }

  const pointEstimate = weightSum > 0 ? correctWeight / weightSum : 0;
  // 불확실성 — 유효 표본 크기 기반 (단순·설명 가능)
  const uncertainty = Math.min(1, 1 / Math.sqrt(valid.length));
  const distinctDays = dayset.size;
  const last = valid[valid.length - 1];
  const lastEvidenceAt = last ? last.occurredAt : null;

  const dimensions: MasteryEstimate["dimensions"] = {};
  for (const [k, v] of Object.entries(dims)) {
    dimensions[k as MasteryDimension] = {
      count: v.count,
      ratio: v.count ? v.correct / v.count : 0,
    };
  }

  explanation.push(
    `증거 ${valid.length}건, 학습일 ${distinctDays}일, 가중 정답률 ${(pointEstimate * 100).toFixed(0)}%`,
  );

  // ── 상태 판정 (순서 중요 — 전부 정책 필드 기준) ──
  const enoughEvidence =
    valid.length >= policy.minEvidenceCount &&
    distinctDays >= policy.minDistinctDays;

  const missingDims = policy.requiredDimensions.filter(
    (d) => !dimensions[d] || (dimensions[d]?.count ?? 0) === 0,
  );

  const daysSinceLast = lastEvidenceAt ? daysBetween(lastEvidenceAt, asOf) : 0;

  let state: MasteryState;
  let nextCheck: MasteryEstimate["nextCheck"] = null;

  if (!enoughEvidence) {
    state = "exploring";
    explanation.push(
      `증거 부족 (최소 ${policy.minEvidenceCount}건·${policy.minDistinctDays}일 필요) — 한 번의 결과로 확정하지 않는다`,
    );
    nextCheck = { kind: "more_evidence" };
  } else if (pointEstimate < policy.partialThreshold) {
    state = "exploring";
    explanation.push(`추정 ${(pointEstimate * 100).toFixed(0)}% < 부분 이해 기준`);
    nextCheck = { kind: "more_evidence" };
  } else if (pointEstimate < policy.stableThreshold) {
    state = "partial";
    nextCheck = { kind: "more_evidence" };
  } else if (missingDims.length > 0) {
    state = "partial";
    explanation.push(`필수 차원 증거 누락: ${missingDims.join(", ")}`);
    nextCheck = { kind: "more_evidence" };
  } else if (daysSinceLast > policy.recheckAfterDays) {
    state = "recheck_needed";
    explanation.push(
      `마지막 증거 후 ${Math.floor(daysSinceLast)}일 경과 (기준 ${policy.recheckAfterDays}일) — 유지 확인 필요`,
    );
    nextCheck = {
      kind: "delayed_check",
      dueOn: asOf.slice(0, 10) as IsoDate,
    };
  } else if (transferCorrect >= policy.transferEvidenceCount) {
    state = "transfer_confirmed";
    explanation.push(`전이 맥락 정답 ${transferCorrect}건 — 전이 확인`);
  } else {
    state = "stable";
    explanation.push("안정적 수행 — 전이 확인 대기");
    nextCheck = { kind: "transfer_check" };
  }

  return {
    state,
    pointEstimate,
    uncertainty,
    evidenceCount: valid.length,
    distinctDays,
    lastEvidenceAt,
    dimensions,
    nextCheck,
    explanation,
  };
}

/**
 * 간격 복습 다음 예정일 (정책 주입 — 코드 상수 아님).
 * 오답이면 1단계로 리셋, 정답이면 다음 단계. 마지막 단계 정답이면 졸업(null).
 */
export function nextReviewDate(
  policy: MasteryPolicySpec,
  currentStage: number,
  wasCorrect: boolean,
  baseDate: IsoDate,
): { stage: number; dueOn: IsoDate } | null {
  const intervals = policy.reviewIntervalsDays;
  if (intervals.length === 0) return null;
  if (!wasCorrect) {
    return { stage: 1, dueOn: addDaysIso(baseDate, intervals[0] ?? 1) };
  }
  const nextStage = currentStage + 1;
  if (nextStage > intervals.length) return null; // 졸업
  const days = intervals[nextStage - 1] ?? 1;
  return { stage: nextStage, dueOn: addDaysIso(baseDate, days) };
}
