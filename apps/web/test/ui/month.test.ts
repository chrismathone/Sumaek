import { describe, expect, it } from "vitest";
import {
  WEEKDAYS,
  resolveMonth,
  shiftMonth,
  weekdayIndex,
  type MonthView,
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

  /* ↑ 위의 「흔들리지 않는다」 스펙은 **이름만 그랬다.** 구현을 주석이 경고한
   * 형태(`new Date(day).getDay()`)로 되돌려도 7건이 전부 통과한다 — 이 저장소가
   * 실제로 도는 두 환경(로컬 KST·CI UTC)에서 실측했다. 두 형태가 갈리는 곳은
   * **오프셋이 음수인** 시간대뿐인데 저장소에 TZ 고정이 0건이었다.
   *
   * 그래서 아래 둘을 더한다. 성질과 기법을 각각 붙잡는다.
   *
   * 함정: 셸 접두(`TZ=... vitest`)는 **Windows에서 조용히 무시된다**(실측 —
   * America/New_York을 줘도 Asia/Seoul로 되돌아온다). 프로세스 안에서
   * `process.env.TZ`에 대입해야 Node가 Date를 다시 계산한다. */
  it("음수 오프셋 시간대에서도 요일이 같다 (이름이 건 그 성질)", () => {
    const orig = process.env.TZ;
    try {
      for (const tz of ["America/New_York", "Pacific/Honolulu", "UTC"]) {
        process.env.TZ = tz;
        const v = resolveMonth("2026-08", "2026-08");
        expect(WEEKDAYS[weekdayIndex(v, "2026-08-01")], tz).toBe("토");
        expect(WEEKDAYS[weekdayIndex(v, "2026-08-31")], tz).toBe("월");
      }
    } finally {
      process.env.TZ = orig;
    }
  });

  /* 위가 시간대 축이라면 이건 기법 축이다 — TZ 조작이 언젠가 막혀도 남는다.
   * 격자와 실제 달력이 **일부러 어긋난** view를 넘기면, 격자에서 세는 구현은
   * 격자의 답을, Date를 거치는 구현은 진짜 달력의 답을 준다. 그 차이는
   * 어느 시간대에서나 존재한다. */
  it("격자에서만 센다 — 실제 달력과 어긋난 view를 줘도 격자를 따른다", () => {
    const fake: MonthView = {
      key: "2026-08",
      firstDay: "2026-08-01",
      lastDay: "2026-08-03",
      days: ["2026-08-01", "2026-08-02", "2026-08-03"],
      leadingBlanks: 0, // 진짜 2026-08-01은 토요일(6)이므로 일부러 어긋냈다
      prevMonth: "2026-07",
      nextMonth: "2026-09",
    };
    // 격자를 따르면 0·1·2 (일·월·화)
    expect(weekdayIndex(fake, "2026-08-01")).toBe(0);
    expect(weekdayIndex(fake, "2026-08-02")).toBe(1);
    expect(weekdayIndex(fake, "2026-08-03")).toBe(2);
    // new Date(...).getDay()를 거치면 6·0·1이 나온다 — 그 구현이면 여기서 깨진다
    expect(weekdayIndex(fake, "2026-08-01")).not.toBe(
      new Date("2026-08-01").getDay(),
    );
  });
});
