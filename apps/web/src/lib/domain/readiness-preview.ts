import type { DayPlanStatus } from "@su-maek/core/learning";
import { blockCategory, type BlockCategory } from "./day-progress";

/* ─────────────────────────────────────────────────────────────
 * 날짜별 준비도 미리보기 (T5.4 · G-08).
 *
 * 준비도 게이트(T2.4)는 **게시 시점**에 돈다. 그런데 결손은 그 뒤에도
 * 생긴다 — 자료를 내리거나, 평가 생성이 실패하거나, 학생 계정을 아직 안
 * 만들었거나. 교사가 그것을 아는 시점은 지금까지 학생이 「빈 화면」을 보고
 * 말해 줄 때였다. 그때는 이미 수업 당일이다.
 *
 * 판정을 **새로 만들지 않는다**. 하루 상태는 core의 `decideDayStatus`가
 * 이미 정했고, 차단 사유의 갈래는 T4.4가 정했다. 여기서 더하는 것은 딱
 * 하나 — **계정**이다. 계정이 없으면 나머지 판정이 전부 의미 없다: 자료가
 * 다 있어도 그 학생은 로그인할 수 없어 아무것도 못 본다.
 *
 * 순수 함수다. 미리보기가 아무것도 만들지 않는다는 보장은 여기가 아니라
 * 투영기의 `persist: false`가 한다(T1.3) — 이 파일은 DB를 모른다.
 * ───────────────────────────────────────────────────────────── */

/** 계정이 상태의 맨 앞에 온다 — 없으면 그 학생은 화면 자체에 못 닿는다. */
export type PreviewStatus = "no_account" | DayPlanStatus;

export interface PreviewPlanFacts {
  status: DayPlanStatus;
  requiredTotal: number;
  requiredSatisfied: number;
  /** 막힌 필수 항목의 사유 코드 (항목 단위라 중복 가능) */
  blockedReasons: string[];
  itemCount: number;
}

export interface PreviewInput {
  learnerId: string;
  displayName: string;
  hasAccount: boolean;
  plan: PreviewPlanFacts;
}

export interface PreviewBlocker {
  code: string;
  category: BlockCategory;
}

export interface LearnerPreviewRow {
  learnerId: string;
  displayName: string;
  status: PreviewStatus;
  /** 학생이 그날을 **시작할 수 있는가**. 아직 안 한 것과 할 수 없는 것은 다르다. */
  ready: boolean;
  requiredTotal: number;
  requiredSatisfied: number;
  /** 중복 없이 코드 사전순 — 화면이 순서를 다시 정하지 않게 */
  blockers: PreviewBlocker[];
}

const ACCOUNT_BLOCKER = "account_unlinked";

export function buildPreviewRow(input: PreviewInput): LearnerPreviewRow {
  const codes = new Set(input.plan.blockedReasons);
  if (!input.hasAccount) codes.add(ACCOUNT_BLOCKER);

  const blockers = [...codes].sort().map((code) => ({
    code,
    category: blockCategory(code),
  }));

  /* 계정이 없으면 계획 상태를 앞세우지 않는다. 「진행 중」으로 보이면
   * 교사는 준비가 끝난 줄 안다. */
  const status: PreviewStatus = input.hasAccount
    ? input.plan.status
    : "no_account";

  return {
    learnerId: input.learnerId,
    displayName: input.displayName,
    status,
    /* 배정이 없는 날은 준비된 것이 아니다 — 준비 완료와 배울 것이 없는
     * 것을 합치면 루트를 안 만든 반이 「준비 완료」로 보인다. */
    ready:
      input.hasAccount && blockers.length === 0 && input.plan.itemCount > 0,
    requiredTotal: input.plan.requiredTotal,
    requiredSatisfied: input.plan.requiredSatisfied,
    blockers,
  };
}

export interface PreviewSummary {
  total: number;
  ready: number;
  blocked: number;
  /** 사유별 **학생 수** — 항목 수가 아니다 (T4.4와 같은 셈법) */
  blockers: Array<{ code: string; category: BlockCategory; learners: number }>;
  /** 먼저 볼 학생 — 준비된 학생은 오지 않는다 */
  attention: LearnerPreviewRow[];
}

export function summarizePreview(
  rows: readonly LearnerPreviewRow[],
): PreviewSummary {
  const byCode = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const b of r.blockers) {
      const set = byCode.get(b.code) ?? new Set<string>();
      set.add(r.learnerId);
      byCode.set(b.code, set);
    }
  }

  const blockers = [...byCode.entries()]
    .map(([code, learners]) => ({
      code,
      category: blockCategory(code),
      learners: learners.size,
    }))
    .sort((a, b) =>
      a.learners !== b.learners
        ? b.learners - a.learners
        : a.code < b.code
          ? -1
          : 1,
    );

  const attention = rows
    .filter((r) => !r.ready)
    .sort((a, b) =>
      a.displayName !== b.displayName
        ? a.displayName < b.displayName
          ? -1
          : 1
        : a.learnerId < b.learnerId
          ? -1
          : 1,
    );

  return {
    total: rows.length,
    ready: rows.filter((r) => r.ready).length,
    blocked: attention.length,
    blockers,
    attention,
  };
}
