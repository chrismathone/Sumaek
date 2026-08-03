import { describe, expect, it } from "vitest";
import {
  WEEKDAYS,
  resolveMonth,
  shiftMonth,
  weekdayIndex,
} from "@/lib/calendar/month";

/* 월간 격자의 날짜 계산 회귀 검사.
 *
 * 여기가 틀리면 화면은 멀쩡히 그려지고 날짜만 하루씩 어긋난다 — 눈으로
 * 잡기 가장 어려운 종류다. 특히 요일은 서버가 KST가 아닌 곳에 있을 때만
 * 어긋나므로 개발 기계에서는 영영 드러나지 않는다. */

describe("월 해석 (resolveMonth)", () => {
  it("윤년 2월은 29일, 평년 2월은 28일이다", () => {
    expect(resolveMonth("2028-02", "2026-08").days).toHaveLength(29);
    expect(resolveMonth("2026-02", "2026-08").days).toHaveLength(28);
  });

  it("첫날·마지막날과 날짜 나열이 맞는다", () => {
    const v = resolveMonth("2026-08", "2026-01");
    expect(v.firstDay).toBe("2026-08-01");
    expect(v.lastDay).toBe("2026-08-31");
    expect(v.days).toHaveLength(31);
    expect(v.days[0]).toBe("2026-08-01");
    expect(v.days.at(-1)).toBe("2026-08-31");
  });

  it("해를 넘는 이동이 맞는다", () => {
    expect(resolveMonth("2026-12", "2026-08").nextMonth).toBe("2027-01");
    expect(resolveMonth("2026-01", "2026-08").prevMonth).toBe("2025-12");
    expect(shiftMonth(2026, 1, -1)).toBe("2025-12");
    expect(shiftMonth(2026, 12, 1)).toBe("2027-01");
  });

  it("첫 주 빈칸은 1일의 요일 수만큼이다", () => {
    // 2026-08-01은 토요일 → 앞에 6칸
    expect(resolveMonth("2026-08", "2026-01").leadingBlanks).toBe(6);
    // 2026-11-01은 일요일 → 빈칸 없음
    expect(resolveMonth("2026-11", "2026-01").leadingBlanks).toBe(0);
  });

  it("형식이 어긋난 ?month는 조용히 fallback으로 되돌아간다", () => {
    for (const bad of ["2026-13", "2026-00", "abc", "", "2026-8", "26-08"]) {
      expect(resolveMonth(bad, "2026-08").key, `입력 ${JSON.stringify(bad)}`).toBe(
        "2026-08",
      );
    }
    expect(resolveMonth(undefined, "2026-08").key).toBe("2026-08");
  });
});

describe("요일 (weekdayIndex)", () => {
  it("격자 배열에서 세므로 실행 환경 시간대에 흔들리지 않는다", () => {
    const v = resolveMonth("2026-08", "2026-08");
    // 2026-08-01 토요일(6) → 02 일요일(0) → 03 월요일(1)
    expect(WEEKDAYS[weekdayIndex(v, "2026-08-01")]).toBe("토");
    expect(WEEKDAYS[weekdayIndex(v, "2026-08-02")]).toBe("일");
    expect(WEEKDAYS[weekdayIndex(v, "2026-08-03")]).toBe("월");
    expect(WEEKDAYS[weekdayIndex(v, "2026-08-31")]).toBe("월");
  });

  it("그 달에 없는 날짜는 0으로 되돌린다 (던지지 않는다)", () => {
    const v = resolveMonth("2026-08", "2026-08");
    expect(weekdayIndex(v, "2026-09-01")).toBe(0);
  });
});
