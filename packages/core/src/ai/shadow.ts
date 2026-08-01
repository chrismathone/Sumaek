/* ─────────────────────────────────────────────────────────────
 * 섀도 평가 (인수 36) — 카나리 모델을 실사용 트래픽에 얹되
 * **결과는 쓰지 않고 기록만 한다.**
 *
 * 안전 규칙 두 가지가 이 파일의 설계를 전부 결정한다:
 *
 *  1. 카나리는 사용자에게 영향을 줄 수 없다. 그래서 이 모듈은 절대 던지지
 *     않는다 — 실패·시간 초과·회로 열림은 전부 "관측 결과"로 바뀐다.
 *  2. 카나리 산출물은 반환값에 **담기지 않는다.** ShadowObservation에는
 *     questions가 없다. 호출자가 실수로 카나리 결과를 저장할 방법 자체를
 *     없앤 것이다 — 규율이 아니라 타입으로 막는다.
 * ───────────────────────────────────────────────────────────── */

import { CallTimeoutError, CircuitOpenError } from "./circuit-breaker";
import {
  AiProviderUnavailableError,
  type AiProvider,
  type ExtractionResult,
} from "./provider";

export interface ShadowExtractionInput {
  fileName: string;
  checksum: string;
  pageCount: number;
}

export type ShadowErrorKind =
  | "circuit_open"
  | "timeout"
  | "unavailable"
  | "other";

/** 문항 단위 일치도 가중치 — 합이 1이다 */
export const AGREEMENT_WEIGHTS = {
  /** 정답이 가장 무겁다: 어긋나면 채점이 통째로 틀린다 */
  answer: 0.5,
  /** 본문은 정규화·게이트가 뒤따르므로 정답보다 가볍다 */
  body: 0.3,
  /** 문항 유형(객관식/단답)이 다르면 응시 화면 자체가 달라진다 */
  kind: 0.2,
} as const;

export interface AgreementBreakdown {
  /** 0~1 */
  score: number;
  baselineQuestions: number;
  canaryQuestions: number;
  /** 양쪽에 다 있는 자리에서 어긋난 수 */
  answerMismatches: number;
  bodyMismatches: number;
  kindMismatches: number;
  /** 한쪽에만 있는 자리 수 — 문항 수가 다르면 여기로 잡힌다 */
  missingSlots: number;
}

/**
 * 두 추출 결과의 일치도.
 *
 * 인쇄 문항 번호 기준이 아니라 **순서(index) 기준**으로 짝짓는다.
 * 카나리가 문항 하나를 통째로 놓치면 그 뒤가 전부 한 칸씩 밀려 점수가
 * 크게 떨어지는데, 그것이 맞다 — 문항 경계를 잘못 잡은 추출은 실제로
 * 그만큼 위험하다.
 */
export function scoreExtractionAgreement(
  baseline: ExtractionResult,
  canary: ExtractionResult,
): AgreementBreakdown {
  const a = baseline.questions;
  const b = canary.questions;
  const slots = Math.max(a.length, b.length);
  const breakdown: AgreementBreakdown = {
    score: 1,
    baselineQuestions: a.length,
    canaryQuestions: b.length,
    answerMismatches: 0,
    bodyMismatches: 0,
    kindMismatches: 0,
    missingSlots: 0,
  };
  // 양쪽 다 0문항이면 이견이 없다 (추출 실패는 error로 따로 잡힌다).
  if (slots === 0) return breakdown;

  let total = 0;
  for (let i = 0; i < slots; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) {
      breakdown.missingSlots += 1;
      continue; // 점수 0 — total에 더하지 않는다
    }
    let itemScore = 0;
    if (left.proposedAnswer.trim() === right.proposedAnswer.trim()) {
      itemScore += AGREEMENT_WEIGHTS.answer;
    } else {
      breakdown.answerMismatches += 1;
    }
    if (left.bodyText.trim() === right.bodyText.trim()) {
      itemScore += AGREEMENT_WEIGHTS.body;
    } else {
      breakdown.bodyMismatches += 1;
    }
    if (left.kind === right.kind) {
      itemScore += AGREEMENT_WEIGHTS.kind;
    } else {
      breakdown.kindMismatches += 1;
    }
    total += itemScore;
  }
  breakdown.score = total / slots;
  return breakdown;
}

/**
 * 섀도 1회의 관측 결과.
 *
 * **questions가 없다.** 카나리 산출물은 이 경계를 넘지 못한다 (파일 머리
 * 주석 규칙 2).
 */
export interface ShadowObservation {
  canaryProvider: string;
  canaryModel: string;
  ok: boolean;
  errorKind: ShadowErrorKind | null;
  errorMessage: string | null;
  latencyMs: number;
  /** 실패했으면 null */
  agreement: AgreementBreakdown | null;
  inputTokens: number;
  outputTokens: number;
}

export function classifyShadowError(error: unknown): ShadowErrorKind {
  if (error instanceof CircuitOpenError) return "circuit_open";
  if (error instanceof CallTimeoutError) return "timeout";
  if (error instanceof AiProviderUnavailableError) return "unavailable";
  return "other";
}

/**
 * 카나리를 한 번 호출하고 기준선과 비교한다. **절대 던지지 않는다.**
 *
 * 기준선(baseline)은 이미 사용자에게 반환된 실사용 결과다 — 여기서 다시
 * 호출하지 않는다. 즉 사용자 경로는 이 함수가 무엇을 하든 이미 끝나 있다.
 *
 * @param canary 회로 차단기로 감싼 카나리 공급자. 감싸는 책임은 호출자에게
 *   있고, 그 차단기는 실사용 차단기와 **달라야 한다** — 카나리 장애가
 *   실사용 공급자의 회로를 열면 섀도가 사용자에게 영향을 준 것이 된다.
 * @param now 테스트 주입용 시계. 기본은 Date.now.
 */
export async function runShadowExtraction(args: {
  baseline: ExtractionResult;
  canary: AiProvider;
  canaryModel: string;
  input: ShadowExtractionInput;
  now?: () => number;
}): Promise<ShadowObservation> {
  const now = args.now ?? Date.now;
  const startedAt = now();
  try {
    const result = await args.canary.extractQuestions(args.input);
    return {
      canaryProvider: args.canary.name,
      canaryModel: args.canaryModel,
      ok: true,
      errorKind: null,
      errorMessage: null,
      latencyMs: Math.max(0, now() - startedAt),
      agreement: scoreExtractionAgreement(args.baseline, result),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    };
  } catch (error) {
    return {
      canaryProvider: args.canary.name,
      canaryModel: args.canaryModel,
      ok: false,
      errorKind: classifyShadowError(error),
      // 원문 메시지를 남긴다 — 무엇이 어떻게 실패했는지 잃으면
      // 중단 사유가 "실패율이 높다"까지밖에 못 간다.
      errorMessage:
        error instanceof Error ? error.message : String(error),
      latencyMs: Math.max(0, now() - startedAt),
      agreement: null,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}
