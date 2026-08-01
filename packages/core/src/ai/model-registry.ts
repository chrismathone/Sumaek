/* ─────────────────────────────────────────────────────────────
 * AI 모델 버전 레지스트리 · 승격 게이트 · 중단 판정 (인수 36).
 *
 * 세 가지를 한 파일에 둔다. 셋이 같은 사실(카나리 표본)을 읽고 서로
 * 반대되는 결론을 내면 안 되기 때문이다 — 승격을 막는 기준과 중단하는
 * 기준이 두 곳에 흩어지면 느슨한 쪽이 이긴다 (break-glass의 grantState와
 * 같은 이유).
 *
 * 여기에는 DB도 시계도 없다. 판정만 있다 — DB 왕복은
 * packages/db/src/domain/ai-canary.ts 가 맡는다.
 * ───────────────────────────────────────────────────────────── */

/**
 * 모델 버전의 상태.
 *
 * candidate → canary → active → retired 가 정상 경로이고,
 * canary·active 어느 쪽이든 악화되면 halted 로 빠진다.
 *
 * - candidate: 등록만 됐다. 실사용도 섀도도 받지 않는다.
 * - canary:    섀도 트래픽을 받는다. **결과는 어디에도 쓰이지 않는다.**
 * - active:    실사용 트래픽을 처리한다. 조직·작업당 하나뿐이다.
 * - halted:    사유와 함께 멈췄다. 다시 카나리로 올리려면 재등록해야 한다.
 * - retired:   다른 버전이 승격되어 물러났다.
 */
export type ModelRole =
  | "candidate"
  | "canary"
  | "active"
  | "halted"
  | "retired";

export const MODEL_ROLES: readonly ModelRole[] = [
  "candidate",
  "canary",
  "active",
  "halted",
  "retired",
];

export interface ModelVersion {
  id: string;
  /** 이 모델이 담당하는 작업 — 지금은 extract_questions 하나 */
  operation: string;
  provider: string;
  model: string;
  role: ModelRole;
}

export interface ModelSelection {
  /** 실사용 모델. null이면 호출자가 공급자 기본 모델을 쓴다 */
  active: ModelVersion | null;
  /** 섀도 평가 대상. null이면 섀도를 돌리지 않는다 */
  canary: ModelVersion | null;
  /** 후보가 제외된 이유 — 운영자가 "왜 카나리가 안 도나"를 물을 때의 답 */
  skipped: Array<{ model: string; reason: string }>;
}

/**
 * 레지스트리에서 이번 호출에 쓸 모델을 고른다.
 *
 * `deployedProvider` 는 배포 설정(AI_PROVIDER)이 정한 공급자다. 레지스트리
 * 행의 provider가 이것과 다르면 active로도 canary로도 쓰지 않는다.
 * 이유는 두 가지다:
 *
 *  1. 섀도는 **실사용 원문을 그대로** 카나리에 보낸다. DB 행 하나로 고객
 *     콘텐츠가 다른 벤더에게 넘어가게 두지 않는다 — 공급자 전환은 배포
 *     결정이지 데이터 변경이 아니다.
 *  2. 공급자가 다르면 회로 차단기·가격표·자격증명이 전부 다른 축이라
 *     "같은 조건에서 모델만 바꿨다"는 비교 전제가 깨진다.
 */
export function selectModels(
  rows: readonly ModelVersion[],
  options: { operation: string; deployedProvider: string },
): ModelSelection {
  const skipped: Array<{ model: string; reason: string }> = [];
  // id 정렬로 결정론 확보 — DB 부분 유니크 인덱스가 중복을 막지만,
  // 순서를 DB 반환 순서에 맡기지 않는다.
  const forOperation = [...rows]
    .filter((r) => r.operation === options.operation)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const pick = (role: ModelRole): ModelVersion | null => {
    for (const row of forOperation) {
      if (row.role !== role) continue;
      if (row.provider !== options.deployedProvider) {
        skipped.push({
          model: `${row.provider}:${row.model}`,
          reason: `배포 공급자(${options.deployedProvider})와 다른 공급자라 사용하지 않습니다.`,
        });
        continue;
      }
      return row;
    }
    return null;
  };

  const active = pick("active");
  let canary = pick("canary");

  // 실사용 모델과 같은 모델을 섀도로 또 부르는 것은 비용만 두 배다.
  if (canary && active && canary.model === active.model) {
    skipped.push({
      model: `${canary.provider}:${canary.model}`,
      reason: "실사용 모델과 같은 모델이라 섀도를 돌리지 않습니다.",
    });
    canary = null;
  }

  return { active, canary, skipped };
}

/* ── 승격 게이트 ────────────────────────────────────────────── */

/** 섀도 표본 집계 — DB가 채우고 게이트가 읽는다 */
export interface CanaryMetrics {
  /** 섀도 시도 총수 (실패 포함) */
  samples: number;
  /** 카나리 호출이 실패한 수 (장애·시간 초과·회로 열림) */
  errorCount: number;
  /** 성공 표본의 평균 일치도 0~1. 성공 표본이 없으면 null */
  meanAgreement: number | null;
  baselineLatencyP95Ms: number;
  canaryLatencyP95Ms: number;
  /** 표본 구간의 총 비용 (USD) */
  baselineCostUsd: number;
  canaryCostUsd: number;
  /**
   * 카나리 모델이 가격표에 있는가.
   * false면 비용이 0으로 집계된다 — 그 0을 "싸다"로 읽으면 안 된다.
   */
  costPriced: boolean;
}

export interface PromotionCriteria {
  /** 이 표본 수 미만이면 판단하지 않는다 */
  minSamples: number;
  /** 평균 일치도 하한 */
  minAgreement: number;
  /** 카나리 실패율 상한 */
  maxErrorRate: number;
  /** p95 지연 허용 배수 */
  maxLatencyP95Ratio: number;
  /**
   * 지연 비교의 절대 허용치 (ms).
   * 비율만 쓰면 기준선이 1ms일 때 2ms가 200%로 잡혀 의미 없는 차단이
   * 된다. 사용자가 체감하지 못하는 절대 증가는 통과시킨다.
   */
  latencyToleranceMs: number;
  /** 비용 허용 배수 */
  maxCostRatio: number;
}

export const DEFAULT_PROMOTION_CRITERIA: PromotionCriteria = {
  minSamples: 20,
  minAgreement: 0.95,
  maxErrorRate: 0.02,
  maxLatencyP95Ratio: 1.25,
  latencyToleranceMs: 50,
  maxCostRatio: 1.5,
};

export type GateCriterion =
  | "samples"
  | "agreement"
  | "error_rate"
  | "latency"
  | "cost";

export interface GateFailure {
  criterion: GateCriterion;
  observed: number | null;
  threshold: number | null;
  message: string;
}

export interface PromotionDecision {
  promotable: boolean;
  failures: GateFailure[];
  /** 사람이 읽는 한 줄 요약 */
  summary: string;
}

/**
 * 승격 가능 여부. **기준을 하나라도 못 넘으면 승격은 없다.**
 *
 * 전부 검사한 뒤 실패 목록을 통째로 돌려준다 — 첫 실패에서 멈추면
 * 운영자가 한 번에 하나씩만 고치게 되어 승격이 며칠씩 늦어진다.
 */
export function evaluatePromotionGate(
  metrics: CanaryMetrics,
  criteria: PromotionCriteria = DEFAULT_PROMOTION_CRITERIA,
): PromotionDecision {
  const failures: GateFailure[] = [];

  if (metrics.samples < criteria.minSamples) {
    failures.push({
      criterion: "samples",
      observed: metrics.samples,
      threshold: criteria.minSamples,
      message: `표본 ${metrics.samples}건 — 최소 ${criteria.minSamples}건이 필요합니다.`,
    });
  }

  const errorRate =
    metrics.samples === 0 ? 0 : metrics.errorCount / metrics.samples;
  if (errorRate > criteria.maxErrorRate) {
    failures.push({
      criterion: "error_rate",
      observed: errorRate,
      threshold: criteria.maxErrorRate,
      message: `카나리 실패율 ${(errorRate * 100).toFixed(1)}% — 상한 ${(criteria.maxErrorRate * 100).toFixed(1)}%를 넘었습니다.`,
    });
  }

  if (metrics.meanAgreement === null) {
    failures.push({
      criterion: "agreement",
      observed: null,
      threshold: criteria.minAgreement,
      message: "성공한 섀도 표본이 없어 일치도를 계산할 수 없습니다.",
    });
  } else if (metrics.meanAgreement < criteria.minAgreement) {
    failures.push({
      criterion: "agreement",
      observed: metrics.meanAgreement,
      threshold: criteria.minAgreement,
      message: `평균 일치도 ${metrics.meanAgreement.toFixed(3)} — 하한 ${criteria.minAgreement}에 못 미칩니다.`,
    });
  }

  const latencyBudget =
    metrics.baselineLatencyP95Ms * criteria.maxLatencyP95Ratio +
    criteria.latencyToleranceMs;
  if (metrics.canaryLatencyP95Ms > latencyBudget) {
    failures.push({
      criterion: "latency",
      observed: metrics.canaryLatencyP95Ms,
      threshold: latencyBudget,
      message: `카나리 p95 ${Math.round(metrics.canaryLatencyP95Ms)}ms — 허용 ${Math.round(latencyBudget)}ms(기준선 ${Math.round(metrics.baselineLatencyP95Ms)}ms × ${criteria.maxLatencyP95Ratio} + ${criteria.latencyToleranceMs}ms)를 넘었습니다.`,
    });
  }

  if (!metrics.costPriced) {
    // 가격표에 없는 모델은 비용이 0으로 집계된다. 0을 "무료"로 읽고
    // 승격시키면 청구서가 도착한 뒤에야 알게 된다.
    failures.push({
      criterion: "cost",
      observed: null,
      threshold: null,
      message:
        "카나리 모델이 가격표에 없어 비용을 판정할 수 없습니다 (0으로 집계됨). 가격표에 추가한 뒤 다시 시도하세요.",
    });
  } else if (metrics.baselineCostUsd === 0) {
    // 기준선이 무료인데 카나리가 유료면 그 자체가 회귀다.
    if (metrics.canaryCostUsd > 0) {
      failures.push({
        criterion: "cost",
        observed: metrics.canaryCostUsd,
        threshold: 0,
        message: `기준선 비용이 $0인데 카나리는 $${metrics.canaryCostUsd.toFixed(4)}입니다.`,
      });
    }
  } else {
    const ratio = metrics.canaryCostUsd / metrics.baselineCostUsd;
    if (ratio > criteria.maxCostRatio) {
      failures.push({
        criterion: "cost",
        observed: ratio,
        threshold: criteria.maxCostRatio,
        message: `비용 ${ratio.toFixed(2)}배 ($${metrics.canaryCostUsd.toFixed(4)} / $${metrics.baselineCostUsd.toFixed(4)}) — 허용 ${criteria.maxCostRatio}배를 넘었습니다.`,
      });
    }
  }

  return {
    promotable: failures.length === 0,
    failures,
    summary:
      failures.length === 0
        ? `승격 가능 — 표본 ${metrics.samples}건, 일치도 ${(metrics.meanAgreement ?? 0).toFixed(3)}, 실패율 ${(errorRate * 100).toFixed(1)}%.`
        : `승격 불가 (${failures.length}건): ${failures.map((f) => f.criterion).join(", ")}`,
  };
}

/* ── 운영 중 중단 판정 ──────────────────────────────────────── */

export interface HaltCriteria {
  /** 이 표본 수 미만이면 중단하지 않는다 — 초기 한두 건의 잡음으로 멈추지 않도록 */
  minSamples: number;
  /** 이 실패율을 넘으면 중단 */
  maxErrorRate: number;
  /** 이 일치도 아래로 떨어지면 중단 */
  minAgreement: number;
}

/**
 * 중단 기준은 승격 기준보다 **느슨하다.** 일부러 그렇게 뒀다 —
 * "승격시킬 만큼 좋지 않다"와 "지금 당장 멈춰야 한다"는 다른 판단이고,
 * 둘을 같은 임계로 묶으면 승격 기준을 조금 못 넘긴 카나리가 계속 중단되어
 * 표본을 모을 기회 자체를 잃는다.
 */
export const DEFAULT_HALT_CRITERIA: HaltCriteria = {
  minSamples: 5,
  maxErrorRate: 0.25,
  minAgreement: 0.6,
};

export interface HaltDecision {
  halt: boolean;
  reason: string | null;
}

export function evaluateHalt(
  metrics: CanaryMetrics,
  criteria: HaltCriteria = DEFAULT_HALT_CRITERIA,
): HaltDecision {
  if (metrics.samples < criteria.minSamples) {
    return { halt: false, reason: null };
  }
  const errorRate = metrics.errorCount / metrics.samples;
  if (errorRate > criteria.maxErrorRate) {
    return {
      halt: true,
      reason: `카나리 실패율 ${(errorRate * 100).toFixed(1)}% (표본 ${metrics.samples}건) — 중단 임계 ${(criteria.maxErrorRate * 100).toFixed(1)}%를 넘었습니다.`,
    };
  }
  // 전부 실패해 성공 표본이 없는 경우는 위 실패율에서 이미 걸린다.
  // 여기 도달하는 null은 표본이 전부 실패했는데 임계는 안 넘은 경우뿐이다.
  if (
    metrics.meanAgreement !== null &&
    metrics.meanAgreement < criteria.minAgreement
  ) {
    return {
      halt: true,
      reason: `카나리 평균 일치도 ${metrics.meanAgreement.toFixed(3)} (표본 ${metrics.samples}건) — 중단 임계 ${criteria.minAgreement} 아래입니다.`,
    };
  }
  return { halt: false, reason: null };
}
