import { describe, expect, it } from "vitest";
import {
  MAX_GRANT_HOURS,
  checkGrantReason,
  checkGrantWindow,
  grantState,
  isGrantActive,
  minutesRemaining,
} from "../../src/authz/break-glass";
import { DEFAULT_MATRIX, MENU_KEYS, canAccess, canWrite, isPermissionLocked, resolveMatrix } from "../../src/authz/matrix";

/* ─────────────────────────────────────────────────────────────
 * break-glass 승인 판정 (인수 28).
 *
 * 이 파일이 "만료가 실제로 닫는다"를 붙잡는 지점이다 — 판정이 여기 하나뿐이라
 * (SQL where 절에 복제하지 않았다) 여기가 무너지면 집행 전체가 무너진다.
 * ───────────────────────────────────────────────────────────── */

const T0 = new Date("2026-08-01T09:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function grant(overrides: Partial<{
  approvedAt: Date | string | null;
  expiresAt: Date | string;
  revokedAt: Date | string | null;
}> = {}) {
  return {
    approvedAt: minutes(-10),
    expiresAt: minutes(60),
    revokedAt: null,
    ...overrides,
  };
}

describe("승인 상태 판정", () => {
  it("승인·미만료·미회수면 유효하다", () => {
    expect(grantState(grant(), T0)).toBe("active");
    expect(isGrantActive(grant(), T0)).toBe(true);
  });

  it("만료 시각이 지나면 닫힌다 — 자동 만료의 실체", () => {
    const g = grant({ expiresAt: minutes(30) });
    expect(isGrantActive(g, minutes(29))).toBe(true);
    expect(grantState(g, minutes(31))).toBe("expired");
    expect(isGrantActive(g, minutes(31))).toBe(false);
  });

  it("만료 경계는 열린 구간이다 — 만료 시각 그 순간 이미 닫혀 있다", () => {
    const g = grant({ expiresAt: minutes(30) });
    expect(isGrantActive(g, minutes(30))).toBe(false);
    expect(grantState(g, minutes(30))).toBe("expired");
  });

  it("회수되면 만료 전에도 닫힌다", () => {
    const g = grant({ revokedAt: minutes(5) });
    expect(isGrantActive(g, minutes(10))).toBe(false);
    expect(grantState(g, minutes(10))).toBe("revoked");
  });

  it("회수가 만료보다 먼저 보고된다 — 소유자에게는 '사람이 끊었다'가 사실이다", () => {
    const g = grant({ expiresAt: minutes(30), revokedAt: minutes(5) });
    expect(grantState(g, minutes(90))).toBe("revoked");
  });

  it("승인자가 없으면 열리지 않는다 (사유·기간만 적힌 요청)", () => {
    const g = grant({ approvedAt: null });
    expect(grantState(g, T0)).toBe("pending_approval");
    expect(isGrantActive(g, T0)).toBe(false);
  });

  it("문자열 타임스탬프(DB 직렬화)도 같은 판정을 준다", () => {
    const g = grant({ expiresAt: minutes(30).toISOString() });
    expect(isGrantActive(g, minutes(29))).toBe(true);
    expect(isGrantActive(g, minutes(31))).toBe(false);
  });

  it("미래에 예약된 회수는 아직 회수가 아니다", () => {
    const g = grant({ revokedAt: minutes(20) });
    expect(grantState(g, minutes(10))).toBe("active");
    expect(grantState(g, minutes(25))).toBe("revoked");
  });

  it("남은 시간은 닫힌 뒤 0 아래로 내려가지 않는다", () => {
    const g = grant({ expiresAt: minutes(30) });
    expect(minutesRemaining(g, T0)).toBe(30);
    expect(minutesRemaining(g, minutes(90))).toBe(0);
  });
});

describe("발급 검증", () => {
  it("만료 시각이 없으면 거절한다 — 무기한 승인은 만들 수 없다", () => {
    const r = checkGrantWindow({ now: T0, expiresAt: null });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("무기한");
  });

  it("과거 만료는 거절한다", () => {
    expect(checkGrantWindow({ now: T0, expiresAt: minutes(-1) }).ok).toBe(false);
    expect(checkGrantWindow({ now: T0, expiresAt: T0 }).ok).toBe(false);
  });

  it(`상한 ${MAX_GRANT_HOURS}시간을 넘으면 거절한다`, () => {
    const limit = MAX_GRANT_HOURS * 60;
    expect(checkGrantWindow({ now: T0, expiresAt: minutes(limit) }).ok).toBe(true);
    const over = checkGrantWindow({ now: T0, expiresAt: minutes(limit + 1) });
    expect(over.ok).toBe(false);
    expect(over.message).toContain(`${MAX_GRANT_HOURS}시간`);
  });

  it("사유는 공백만으로 통과하지 않는다", () => {
    expect(checkGrantReason("     ").ok).toBe(false);
    expect(checkGrantReason("조사").ok).toBe(false);
    expect(checkGrantReason("일정 실체화 실패 조사 #123").ok).toBe(true);
  });
});

describe("운영자 역할의 권한 표면", () => {
  it("어떤 메뉴에서도 쓰기가 열리지 않는다 — 승인은 기간이지 권한이 아니다", () => {
    for (const menu of MENU_KEYS) {
      expect(canWrite(DEFAULT_MATRIX, "operator", menu), menu).toBe(false);
    }
  });

  it("학습자 개인 데이터 화면은 승인 중에도 닫혀 있다", () => {
    for (const menu of ["learners", "mastery", "reports", "grading", "today", "groups", "inbox"] as const) {
      expect(canAccess(DEFAULT_MATRIX, "operator", menu), menu).toBe(false);
    }
  });

  it("진단에 필요한 화면은 읽기로 열린다", () => {
    for (const menu of ["audit", "settings", "integrations", "routes", "tests"] as const) {
      expect(canAccess(DEFAULT_MATRIX, "operator", menu), menu).toBe(true);
    }
  });

  it("워크스페이스 오버라이드로도 운영자에게 쓰기를 열 수 없다", () => {
    const m = resolveMatrix([
      { menu: "settings", role: "operator", access: "full" },
      { menu: "learners", role: "operator", access: "full" },
    ]);
    expect(isPermissionLocked("settings", "operator")).toBe(true);
    expect(canWrite(m, "operator", "settings")).toBe(false);
    expect(canAccess(m, "operator", "learners")).toBe(false);
  });
});
