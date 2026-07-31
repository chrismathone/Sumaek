/**
 * 형식 간 수식 일치 검증 — 게시 게이트 G-09 (ADR-0013 §2·§6-8).
 *
 * 같은 문항이 웹·PDF·HWPX 세 형식으로 나갈 때, 각 수식은 **같은 `expression_id`
 * 와 같은 의미 지문**을 가져야 한다. 이것이 깨지는 방식은 조용하다:
 *
 * - HWPX 변환기가 `\le` 를 `<` 로 떨어뜨려도 파일은 멀쩡히 열린다.
 * - PDF 렌더가 수식 하나를 통째로 빠뜨려도 페이지는 나온다.
 * - 웹에서만 보이는 수식이 인쇄본에 없어도 교사는 인쇄해 보기 전까지 모른다.
 *
 * 세 형식을 대조하는 것만이 이 종류의 손실을 잡는다. 지문 비교는
 * `@su-maek/core/math` 의 `semanticFingerprint` 결과를 쓴다 — 표시 형식 차이는
 * 무시하고 수학적 의미만 본다.
 */

/** ADR-0013 §3 의 3-target. `math_render_artifacts.target` 의 부분집합이다. */
export const CROSS_FORMAT_TARGETS = ["web", "pdf", "hwpx"] as const;

export type CrossFormatTarget = (typeof CROSS_FORMAT_TARGETS)[number];

/** 한 형식에서 실제로 렌더된 수식 하나. */
export interface RenderedExpression {
  readonly expressionId: string;
  readonly target: CrossFormatTarget;
  /** `semanticFingerprint(normalizedLatex)` 결과. */
  readonly semanticFingerprint: string;
}

/** 어느 형식에서 통째로 빠진 수식. */
export interface MissingExpression {
  readonly expressionId: string;
  readonly missingTargets: readonly CrossFormatTarget[];
}

/** 형식마다 의미가 달라진 수식 — 가장 위험한 종류다. */
export interface FingerprintMismatch {
  readonly expressionId: string;
  /** 형식별 지문. 값이 두 종류 이상이면 불일치다. */
  readonly fingerprints: Readonly<Partial<Record<CrossFormatTarget, string>>>;
}

/** 기대 목록에 없는데 산출물에 들어 있는 수식 — 스냅샷이 어긋났다는 신호다. */
export interface UnexpectedExpression {
  readonly expressionId: string;
  readonly targets: readonly CrossFormatTarget[];
}

export interface CrossFormatReport {
  /** G-09 통과 여부. 누락·불일치·초과가 모두 0 이어야 한다. */
  readonly passed: boolean;
  readonly missing: readonly MissingExpression[];
  readonly mismatched: readonly FingerprintMismatch[];
  readonly unexpected: readonly UnexpectedExpression[];
  /** 세 형식 모두에서 같은 지문으로 확인된 수식 수. */
  readonly verifiedCount: number;
}

export interface CrossFormatInput {
  /**
   * 이 문항에 있어야 할 `expression_id` 전체. 보통 `math_expressions` 조회 결과다.
   * 순서는 보지 않는다.
   */
  readonly expectedExpressionIds: readonly string[];
  /** 각 형식의 렌더 결과. 같은 (id, target) 이 여러 번 오면 첫 것만 본다. */
  readonly rendered: readonly RenderedExpression[];
  /** 검사할 형식. 기본은 3-target 전부. */
  readonly targets?: readonly CrossFormatTarget[];
}

/**
 * 세 형식의 수식이 같은 id·같은 의미를 갖는지 대조한다.
 *
 * 예외를 던지지 않고 보고서로 답한다 — 호출자(content-gatekeeper)가 게이트
 * 판정과 격리 사유를 같이 기록해야 하기 때문이다.
 */
export function verifyCrossFormat(input: CrossFormatInput): CrossFormatReport {
  const targets = input.targets ?? CROSS_FORMAT_TARGETS;
  const expected = new Set(input.expectedExpressionIds);

  // (expressionId → target → fingerprint). 같은 조합이 중복되면 첫 값을 남긴다.
  const byExpression = new Map<
    string,
    Map<CrossFormatTarget, string>
  >();
  for (const item of input.rendered) {
    if (!targets.includes(item.target)) continue;
    let perTarget = byExpression.get(item.expressionId);
    if (!perTarget) {
      perTarget = new Map();
      byExpression.set(item.expressionId, perTarget);
    }
    if (!perTarget.has(item.target)) {
      perTarget.set(item.target, item.semanticFingerprint);
    }
  }

  const missing: MissingExpression[] = [];
  const mismatched: FingerprintMismatch[] = [];
  let verifiedCount = 0;

  for (const expressionId of input.expectedExpressionIds) {
    const perTarget = byExpression.get(expressionId) ?? new Map();

    const missingTargets = targets.filter((t) => !perTarget.has(t));
    if (missingTargets.length > 0) {
      missing.push({ expressionId, missingTargets });
    }

    const distinct = new Set(perTarget.values());
    if (distinct.size > 1) {
      mismatched.push({
        expressionId,
        fingerprints: Object.fromEntries(perTarget) as FingerprintMismatch["fingerprints"],
      });
    }

    // 세 형식이 다 있고 지문이 하나로 모일 때만 "확인됨"이다.
    if (missingTargets.length === 0 && distinct.size === 1) verifiedCount += 1;
  }

  const unexpected: UnexpectedExpression[] = [];
  for (const [expressionId, perTarget] of byExpression) {
    if (expected.has(expressionId)) continue;
    unexpected.push({ expressionId, targets: [...perTarget.keys()] });
  }

  return {
    passed:
      missing.length === 0 && mismatched.length === 0 && unexpected.length === 0,
    missing,
    mismatched,
    unexpected,
    verifiedCount,
  };
}
