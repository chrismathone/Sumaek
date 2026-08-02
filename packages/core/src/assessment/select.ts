import { hashObject, seededShuffle } from "../shared/deterministic";

/* ─────────────────────────────────────────────────────────────
 * 자동 문항 선정 엔진 (골프롬프트 17장·2I).
 *
 * - 결정론: 같은 풀 스냅샷·정책·시드는 같은 선택 (불변 조건 12).
 * - 선정 이유를 문항마다 저장한다 (17장 — 오늘 배운 개념/약점 보강/오답
 *   복습/간격 반복/확인 필요/난이도 적응).
 * - 문항 부족은 조용히 다른 문항으로 메우지 않고 shortfall로 보고한다 —
 *   평가는 review_required로 남고 선생님이 판단한다 (2Q 원칙과 동일).
 * - 후보 풀은 호출 전에 이미 걸러져 있어야 한다: 검수 완료, 사용 권한
 *   유효, 수식 게이트 통과 (원칙 9 — 여기서 재검증하지 않는 대신 입력
 *   계약으로 명시).
 * ───────────────────────────────────────────────────────────── */

export type SelectionReason =
  | "today_concept"
  | "weakness"
  | "wrong_answer_review"
  | "spaced_review"
  | "anchor"
  | "adaptive"
  | "cumulative";

export interface PoolQuestion {
  questionId: string;
  questionVersionId: string;
  conceptIds: string[];
  /** 난이도 밴드: low | mid | high (경험 통계·내용 수준 종합 — 호출자 산출) */
  difficultyBand: "low" | "mid" | "high";
  /** 최근 출제일 (재출제 제한 판정용) */
  lastUsedOn?: string | null;
  /** 노출 횟수 (편중 방지 정렬 보조) */
  exposureCount?: number;
}

export interface SelectionBucket {
  reason: SelectionReason;
  /** 목표 문항 수 */
  count: number;
  candidates: PoolQuestion[];
  /**
   * 호출자가 준 후보 순서를 그대로 지킨다 (셔플·노출순 정렬을 하지 않는다).
   *
   * 복습 버킷이 이것을 쓴다 — 후보가 **예측 기억률 오름차순**으로 들어오고,
   * "가장 많이 잊은 것부터"가 곧 우선순위다. 노출 횟수로 다시 정렬하면 그
   * 순서가 무너진다.
   */
  preserveOrder?: boolean;
  /**
   * 이 버킷만 재출제 제한(`excludeUsedSince`)에서 면제한다.
   *
   * 복습이 이것을 쓴다. 복습 항목은 "최근에 그 문항을 틀려서" 생기므로
   * `lastUsedOn`이 반드시 제한 창 안이고, 그래서 복습 버킷은 **구조적으로
   * 통째로 탈락**했다(실측: 쓸 수 있는 문항이 159개인데 0건이 됨). 복습의
   * 목적이 "틀렸던 그 문항을 다시 내는 것"이므로 여기서는 제한을 적용하지
   * 않는다. 다른 버킷의 동작은 그대로다.
   */
  allowRecentlyUsed?: boolean;
}

export interface SelectionConstraints {
  /** 난이도 분포 목표 (합이 총 문항 수와 같아야 함, 생략 시 미적용) */
  difficultyDistribution?: { low: number; mid: number; high: number };
  /** 같은 개념 최대 문항 수 (생략 시 무제한) */
  maxPerConcept?: number;
  /** 이 날짜 이후 출제된 문항 제외 (재출제 제한) */
  excludeUsedSince?: string;
}

export interface SelectedQuestion {
  questionId: string;
  questionVersionId: string;
  reason: SelectionReason;
  difficultyBand: "low" | "mid" | "high";
}

export interface SelectionShortfall {
  reason: SelectionReason;
  requested: number;
  selected: number;
  cause: "pool_empty" | "constraints_exhausted";
}

export interface SelectionResult {
  selected: SelectedQuestion[];
  shortfalls: SelectionShortfall[];
  /** 입력(버킷·제약·시드)의 해시 — 재현 검증용 */
  inputHash: string;
  outputHash: string;
}

export function selectQuestions(
  buckets: readonly SelectionBucket[],
  constraints: SelectionConstraints,
  seed: string,
): SelectionResult {
  const inputHash = hashObject({ buckets, constraints, seed });

  const chosen: SelectedQuestion[] = [];
  const chosenIds = new Set<string>();
  const conceptCounts = new Map<string, number>();
  const bandCounts = { low: 0, mid: 0, high: 0 };
  const shortfalls: SelectionShortfall[] = [];

  const bandTarget = constraints.difficultyDistribution ?? null;

  const violatesConstraints = (
    q: PoolQuestion,
    bucket?: SelectionBucket,
  ): boolean => {
    if (chosenIds.has(q.questionId)) return true;
    if (
      constraints.excludeUsedSince &&
      !bucket?.allowRecentlyUsed &&
      q.lastUsedOn &&
      q.lastUsedOn >= constraints.excludeUsedSince
    ) {
      return true;
    }
    if (constraints.maxPerConcept !== undefined) {
      for (const c of q.conceptIds) {
        if ((conceptCounts.get(c) ?? 0) >= constraints.maxPerConcept) return true;
      }
    }
    return false;
  };

  const bandFull = (band: "low" | "mid" | "high"): boolean =>
    bandTarget !== null && bandCounts[band] >= bandTarget[band];

  const take = (q: PoolQuestion, reason: SelectionReason) => {
    chosen.push({
      questionId: q.questionId,
      questionVersionId: q.questionVersionId,
      reason,
      difficultyBand: q.difficultyBand,
    });
    chosenIds.add(q.questionId);
    bandCounts[q.difficultyBand] += 1;
    for (const c of q.conceptIds) {
      conceptCounts.set(c, (conceptCounts.get(c) ?? 0) + 1);
    }
  };

  // 버킷 순서 자체가 우선순위 — 호출자(정책)가 정한 순서를 보존한다.
  for (const bucket of buckets) {
    // 결정론적 셔플: 시드 + 버킷 이유. 노출 횟수 낮은 문항 우선(편중 방지),
    // 동률은 셔플 순서.
    const ordered = bucket.preserveOrder
      ? bucket.candidates.slice()
      : seededShuffle(bucket.candidates, `${seed}:${bucket.reason}`)
          .slice()
          .sort((a, b) => (a.exposureCount ?? 0) - (b.exposureCount ?? 0));

    let picked = 0;

    // 1차: 난이도 분포를 지키며 선택
    for (const q of ordered) {
      if (picked >= bucket.count) break;
      if (violatesConstraints(q, bucket)) continue;
      if (bandFull(q.difficultyBand)) continue;
      take(q, bucket.reason);
      picked++;
    }
    // 2차: 분포 때문에 못 채웠으면 분포 제약을 완화해 채운다
    // (부족한 채 내보내는 것보다 분포 이탈이 낫다 — 이탈은 결과에 드러남)
    if (picked < bucket.count) {
      for (const q of ordered) {
        if (picked >= bucket.count) break;
        if (violatesConstraints(q, bucket)) continue;
        take(q, bucket.reason);
        picked++;
      }
    }

    if (picked < bucket.count) {
      shortfalls.push({
        reason: bucket.reason,
        requested: bucket.count,
        selected: picked,
        cause: bucket.candidates.length === 0 ? "pool_empty" : "constraints_exhausted",
      });
    }
  }

  return {
    selected: chosen,
    shortfalls,
    inputHash,
    outputHash: hashObject(chosen),
  };
}
