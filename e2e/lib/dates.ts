/* ─────────────────────────────────────────────────────────────
 * E2E 날짜 헬퍼.
 *
 * 스펙에 고정 날짜를 적지 않는다 — 시드 과정 기간 시작일(2026-08-03)에
 * 하드코딩하면 실제 날짜가 그날을 지나는 순간 스펙이 통째로 깨진다.
 * 실체화 결과에서 날짜를 읽어 **관계**를 단언하거나, 오늘 기준으로 계산한다.
 * (testDir이 ./tests라 이 파일은 테스트로 수집되지 않는다.)
 * ───────────────────────────────────────────────────────────── */

/** 문구에서 YYYY-MM-DD를 나온 순서대로 뽑는다 */
export function isoDatesIn(text: string): string[] {
  return text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
}

/**
 * 문구에서 n번째 날짜를 꺼낸다. 없으면 던진다 —
 * undefined가 단언으로 흘러들어 "왜 실패했는지 모르는 실패"가 되는 것을 막는다.
 */
export function nthIsoDate(text: string, index: number): string {
  const found = isoDatesIn(text)[index];
  if (!found) {
    throw new Error(
      `날짜를 찾지 못했습니다 (index ${index}) — 실제 문구: ${JSON.stringify(text)}`,
    );
  }
  return found;
}

export function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 앱 기준 시간대(Asia/Seoul)의 오늘 */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 오늘 이후의 안전한 미래 날짜 (접수 폼 입력용) */
export function futureIso(days: number): string {
  return isoAddDays(todayIso(), days);
}

/** 두 ISO 날짜 사이의 일수 (b - a) */
export function isoDiffDays(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}
