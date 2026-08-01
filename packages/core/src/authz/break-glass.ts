/* ─────────────────────────────────────────────────────────────
 * break-glass 운영자 접근 판정 (27장 · 인수 28).
 *
 * 이 파일이 승인의 **유일한 판정 근거**다. SQL에도 같은 조건을 적어 두면
 * 두 곳이 조용히 어긋나고, 어긋난 쪽이 느슨하면 만료된 승인으로 문이 열린다.
 * 그래서 질의는 후보 행만 가져오고(정렬·상한), 열림/닫힘은 여기서만 정한다.
 *
 * 시각은 전부 **절대 시각(timestamptz)** 이다. 조직 시간대는 "하루"의 경계를
 * 정할 때 쓰는 개념이고, 승인 창은 하루가 아니라 시:분이다 — 여름/겨울 시간
 * 전환이나 조직 시간대 변경으로 창이 늘어나면 안 된다. now도 호출자가
 * DB의 now()를 넘겨준다 (앱 서버 시계와 DB 시계가 어긋나도 판정은 하나).
 * ───────────────────────────────────────────────────────────── */

/** 승인 최대 기간 — threat-model Q-11(2인 승인·최대 4시간·자동 만료) */
export const MAX_GRANT_HOURS = 4;

const HOUR_MS = 60 * 60 * 1000;

export interface OperatorGrantWindow {
  /** 승인자가 승인한 시각. null이면 아직 승인 전이다 */
  approvedAt: Date | string | null;
  /** 만료 시각 — 필수. 무기한 승인은 만들 수 없다 */
  expiresAt: Date | string;
  /** 조기 회수 시각 */
  revokedAt: Date | string | null;
}

export type GrantState =
  /** 사유·기간은 적혔지만 승인자가 없다 — 접근은 열리지 않는다 */
  | "pending_approval"
  /** 사람이 끊었다 */
  | "revoked"
  /** 시간이 끊었다 */
  | "expired"
  /** 지금 열려 있다 */
  | "active";

function ms(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * 승인 상태 판정.
 *
 * 순서가 의미를 갖는다 — 회수를 만료보다 먼저 본다. 회수된 승인이 만료 시각을
 * 지나면 "만료"로 보이겠지만, 소유자에게는 "사람이 끊었다"가 사실이다.
 */
export function grantState(
  grant: OperatorGrantWindow,
  now: Date,
): GrantState {
  if (grant.revokedAt !== null && ms(grant.revokedAt) <= now.getTime()) {
    return "revoked";
  }
  if (grant.approvedAt === null) return "pending_approval";
  // 경계는 닫힌 구간이 아니다 — expiresAt에 도달한 순간 이미 만료다
  if (ms(grant.expiresAt) <= now.getTime()) return "expired";
  return "active";
}

/** 접근을 열어도 되는가 — 게이트가 부르는 단 하나의 질문 */
export function isGrantActive(grant: OperatorGrantWindow, now: Date): boolean {
  return grantState(grant, now) === "active";
}

export interface GrantWindowCheck {
  ok: boolean;
  /** 거절 사유 (ok면 빈 문자열) */
  message: string;
}

/**
 * 발급 시각 검증 — 무기한 금지·과거 금지·상한 초과 금지.
 * DB의 CHECK 제약과 이중 방어다 (사용자에게는 여기서 읽을 수 있는 말로 거절).
 */
export function checkGrantWindow(options: {
  now: Date;
  expiresAt: Date | null;
  maxHours?: number;
}): GrantWindowCheck {
  const { now, expiresAt } = options;
  const maxHours = options.maxHours ?? MAX_GRANT_HOURS;
  if (expiresAt === null || Number.isNaN(expiresAt.getTime())) {
    return { ok: false, message: "만료 시각을 지정하세요. 무기한 접근은 만들 수 없습니다." };
  }
  if (expiresAt.getTime() <= now.getTime()) {
    return { ok: false, message: "만료 시각은 지금보다 뒤여야 합니다." };
  }
  if (expiresAt.getTime() - now.getTime() > maxHours * HOUR_MS) {
    return {
      ok: false,
      message: `운영자 접근은 최대 ${maxHours}시간까지만 승인할 수 있습니다.`,
    };
  }
  return { ok: true, message: "" };
}

/** 사유 검증 — 공백만 적어 통과시키는 길을 막는다 */
export function checkGrantReason(reason: string): GrantWindowCheck {
  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    return {
      ok: false,
      message: "접근 사유를 5자 이상 적으세요 (소유자에게 그대로 고지됩니다).",
    };
  }
  return { ok: true, message: "" };
}

/** 남은 시간(분) — 0 이하면 이미 닫혔다. UI 표시용(판정은 grantState) */
export function minutesRemaining(
  grant: { expiresAt: Date | string },
  now: Date,
): number {
  return Math.max(
    0,
    Math.floor((ms(grant.expiresAt) - now.getTime()) / 60_000),
  );
}
