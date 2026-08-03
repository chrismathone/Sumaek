/* ─────────────────────────────────────────────────────────────
 * 지난 기록 — 날짜 하나를 읽는 순수 함수.
 *
 * today-steps.ts의 readDay()를 **지난 날에 돌리지 않는다.** readDay는
 * 「그날 무엇이 배정됐는가」와 「무엇을 했는가」를 둘 다 받아야 하는데,
 * 지난 날에 대해 우리가 가진 것은 한 쪽뿐이다 — learner_material_progress는
 * (learner_id, material_id) 고유의 **가변 상태 행**이라 그날의 배정을
 * 복원할 수 없다. 억지로 판정하면 끝난 날에 「할 차례 2건」(벌) 아니면
 * 배정 없던 날에 「다 마쳤습니다」(거짓 격려)가 나온다. 물려받는 것은
 * StepBadge·OrbitStop이라는 **모양**이지 판정이 아니다.
 *
 * orbitOf()도 쓰지 않는다 — 그것은 레일 순번 기준이다. 일반화하면 레일의
 * 의미가 달력 개념에 의존하게 된다.
 *
 * 그리고 이 화면은 **기록이 없는 날에 아무 표식도 만들지 않는다.** 빈 칸에
 * ×나 「미완료」를 찍는 순간 달력이 벌점표가 된다. 자료 완료를 누르지
 * 않았을 뿐 공부한 날일 수도 있다 — 화면은 아는 것만 말한다.
 * ───────────────────────────────────────────────────────────── */

export type RecordKind = "test" | "material" | "review";

/** 표시 순서 고정 — 같은 종류가 언제나 같은 자리에 온다 */
export const RECORD_ORDER: readonly RecordKind[] = ["test", "material", "review"];

export const RECORD_LABEL: Record<RecordKind, string> = {
  test: "테스트 응시",
  material: "자료 마침",
  review: "복습 마침",
};

export interface DayBucket {
  classCount: number;
  kinds: Set<RecordKind>;
}

export interface DayRead {
  /** 그 날 수업이 있(었)다 — 학원이 정한 것 */
  hasClass: boolean;
  classCount: number;
  /** 내가 남긴 기록이 하나라도 있다 — 내가 한 것 */
  hasMark: boolean;
  kinds: RecordKind[];
  /** 아직 오지 않은 날 */
  ahead: boolean;
  isToday: boolean;
}

export function readRecordDay(
  bucket: DayBucket | undefined,
  day: string,
  today: string,
): DayRead {
  const kinds = RECORD_ORDER.filter((k) => bucket?.kinds.has(k) ?? false);
  return {
    hasClass: (bucket?.classCount ?? 0) > 0,
    classCount: bucket?.classCount ?? 0,
    hasMark: kinds.length > 0,
    kinds,
    ahead: day > today,
    isToday: day === today,
  };
}

/**
 * 칸 하나의 문장 — 시각 채널을 전부 잃어도 사실이 남는다.
 *
 * 46px 칸에는 좌측 선과 ✓ 하나밖에 들어가지 않는다. 그 둘이 말하지 못하는
 * 것(차시 수, 무엇을 남겼는지)을 이 문장이 aria-label로 말한다.
 */
export function describeDay(d: DayRead, isoDay: string): string {
  const parts: string[] = [isoDay];
  if (d.isToday) parts.push("오늘");
  parts.push(
    d.hasClass ? `수업 ${d.classCount}차시${d.ahead ? " 예정" : ""}` : "수업 없음",
  );
  if (d.hasMark) parts.push(d.kinds.map((k) => RECORD_LABEL[k]).join(", "));
  return parts.join(" · ");
}
