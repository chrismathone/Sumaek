import { describe, expect, it } from "vitest";
import {
  NEIS_ALLOWED_FIELDS,
  classifyScheduleEvent,
  mergeConsecutiveDates,
} from "@/lib/integrations/neis";

/* NEIS 학사일정 분류·병합 (인수 61) — 순수 부분.
 * 픽스처는 2026-08-03 실호출 응답(중동중학교)에서 딴 실제 형태다.
 * 네트워크 경로(fetch)는 E2E가 실호출로 덮는다. */

describe("classifyScheduleEvent — 학원 수업 조정에 의미 있는 것만", () => {
  it("공휴일은 버린다 — 전국 공통은 특일 API(연 1회)가 담당", () => {
    expect(
      classifyScheduleEvent({ date: "2026-03-01", eventName: "3·1절", dayOff: "공휴일" }),
    ).toBeNull();
    // 이름에 '평가'가 들어가도 공휴일이면 버린다 (우선순위)
    expect(
      classifyScheduleEvent({
        date: "2026-05-05",
        eventName: "평가의 날(공휴일)",
        dayOff: "공휴일",
      }),
    ).toBeNull();
  });

  it("지필 시험·고사는 school_exam — 정규 진도를 멈추는 기간", () => {
    for (const eventName of ["1학기 중간고사", "2학기 기말고사", "지필평가", "1차 지필평가"]) {
      expect(
        classifyScheduleEvent({ date: "2026-10-06", eventName, dayOff: null }),
      ).toBe("school_exam");
    }
  });

  it("모의·진단·수행평가는 시험으로 치지 않는다 — 학원 진도를 멈출 이유가 없다", () => {
    for (const eventName of ["전국연합 모의고사", "진단평가", "기초학력 진단검사", "수행평가 주간"]) {
      expect(
        classifyScheduleEvent({ date: "2026-03-12", eventName, dayOff: null }),
      ).toBeNull();
    }
  });

  it("휴업일·방학·일반 행사는 버린다 — 학교가 쉬는 날은 학원 수업일", () => {
    for (const event of [
      { date: "2026-05-04", eventName: "재량휴업일", dayOff: "휴업일" },
      { date: "2026-07-20", eventName: "여름방학", dayOff: "휴업일" },
      { date: "2026-03-03", eventName: "개학식/입학식", dayOff: null },
    ]) {
      expect(classifyScheduleEvent(event)).toBeNull();
    }
  });
});

describe("mergeConsecutiveDates — 시험 3일을 휴일 1행으로", () => {
  it("같은 이름의 연속 일자를 기간으로 합친다", () => {
    const ranges = mergeConsecutiveDates([
      { date: "2026-10-06", name: "2학기 중간고사" },
      { date: "2026-10-07", name: "2학기 중간고사" },
      { date: "2026-10-08", name: "2학기 중간고사" },
    ]);
    expect(ranges).toEqual([
      { name: "2학기 중간고사", startsOn: "2026-10-06", endsOn: "2026-10-08" },
    ]);
  });

  it("주말로 끊기면 별도 기간이 된다 (연속이 아님)", () => {
    const ranges = mergeConsecutiveDates([
      { date: "2026-10-08", name: "기말고사" },
      { date: "2026-10-09", name: "기말고사" },
      { date: "2026-10-12", name: "기말고사" }, // 월요일 — 사흘 건너뜀
    ]);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ name: "기말고사", startsOn: "2026-10-08", endsOn: "2026-10-09" });
    expect(ranges[1]).toEqual({ name: "기말고사", startsOn: "2026-10-12", endsOn: "2026-10-12" });
  });

  it("이름이 다르면 합치지 않고, 같은 날 중복 행은 무시한다", () => {
    const ranges = mergeConsecutiveDates([
      { date: "2026-10-06", name: "중간고사" },
      { date: "2026-10-06", name: "중간고사" }, // 중복
      { date: "2026-10-07", name: "수행평가" },
    ]);
    expect(ranges).toEqual([
      { name: "수행평가", startsOn: "2026-10-07", endsOn: "2026-10-07" },
      { name: "중간고사", startsOn: "2026-10-06", endsOn: "2026-10-06" },
    ]);
  });

  it("입력 순서와 무관하게 결정론적이다", () => {
    const shuffled = mergeConsecutiveDates([
      { date: "2026-10-08", name: "중간고사" },
      { date: "2026-10-06", name: "중간고사" },
      { date: "2026-10-07", name: "중간고사" },
    ]);
    expect(shuffled).toEqual([
      { name: "중간고사", startsOn: "2026-10-06", endsOn: "2026-10-08" },
    ]);
  });
});

describe("허용 필드 (인수 61)", () => {
  it("주소·전화 등 불필요 개인·연락 필드는 허용 목록에 없다", () => {
    const forbidden = ["ORG_RDNMA", "ORG_TELNO", "ORG_FAXNO", "HMPG_ADRES"];
    for (const field of forbidden) {
      expect(NEIS_ALLOWED_FIELDS).not.toContain(field);
    }
  });
});
