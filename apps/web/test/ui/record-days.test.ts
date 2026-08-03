import { describe, expect, it } from "vitest";
import {
  RECORD_ORDER,
  describeDay,
  readRecordDay,
  type DayBucket,
  type RecordKind,
} from "@/lib/learn/record-days";

/* ─────────────────────────────────────────────────────────────
 * 지난 기록의 하루 판정 회귀 검사.
 *
 * 이 판정이 틀리면 달력이 조용히 **벌점표**가 된다 — 기록이 없는 날에
 * 표식이 하나라도 찍히는 순간, 학생은 한 달치 빈 칸을 자기 게으름의
 * 증거로 읽는다. 자료 완료를 누르지 않았을 뿐 공부한 날일 수도 있다.
 * 그래서 「수업이 있었다(학원이 정한 것)」와 「내가 남겼다(내가 한 것)」를
 * 절대 섞지 않는다.
 * ───────────────────────────────────────────────────────────── */

const TODAY = "2026-08-03";

const bucket = (classCount: number, kinds: RecordKind[]): DayBucket => ({
  classCount,
  kinds: new Set(kinds),
});

describe("하루 판정 (readRecordDay)", () => {
  it("수업만 있던 날과 아무것도 없던 날이 갈린다", () => {
    const withClass = readRecordDay(bucket(1, []), "2026-08-01", TODAY);
    expect(withClass.hasClass).toBe(true);
    expect(withClass.hasMark).toBe(false);

    const nothing = readRecordDay(undefined, "2026-08-02", TODAY);
    expect(nothing.hasClass).toBe(false);
    expect(nothing.hasMark).toBe(false);
  });

  /* 이 스펙이 이 파일의 존재 이유다. */
  it("기록이 없는 날은 어떤 표식도 만들지 않는다", () => {
    const d = readRecordDay(bucket(2, []), "2026-08-01", TODAY);
    expect(d.kinds).toEqual([]);
    expect(d.hasMark).toBe(false);
  });

  it("차시 수를 그대로 센다", () => {
    expect(readRecordDay(bucket(3, []), "2026-08-01", TODAY).classCount).toBe(3);
    expect(readRecordDay(undefined, "2026-08-01", TODAY).classCount).toBe(0);
  });

  it("기록 종류는 입력 순서와 무관하게 언제나 같은 차례다", () => {
    const d = readRecordDay(
      bucket(1, ["review", "material", "test"]),
      "2026-08-01",
      TODAY,
    );
    expect(d.kinds).toEqual(["test", "material", "review"]);
    expect(d.kinds).toEqual([...RECORD_ORDER]);
  });

  it("오늘과 앞날을 구분한다", () => {
    expect(readRecordDay(undefined, TODAY, TODAY).isToday).toBe(true);
    expect(readRecordDay(undefined, TODAY, TODAY).ahead).toBe(false);
    expect(readRecordDay(undefined, "2026-08-04", TODAY).ahead).toBe(true);
    expect(readRecordDay(undefined, "2026-08-02", TODAY).ahead).toBe(false);
  });
});

describe("하루 문장 (describeDay)", () => {
  it("시각 채널을 전부 잃어도 같은 사실이 남는다", () => {
    const d = readRecordDay(bucket(1, ["test", "material"]), "2026-08-01", TODAY);
    expect(describeDay(d, "8월 1일")).toBe(
      "8월 1일 · 수업 1차시 · 테스트 응시, 자료 마침",
    );
  });

  it("수업이 없던 날은 그렇다고 말하고, 없는 기록을 지어내지 않는다", () => {
    const d = readRecordDay(undefined, "2026-08-02", TODAY);
    expect(describeDay(d, "8월 2일")).toBe("8월 2일 · 수업 없음");
  });

  it("오늘은 오늘이라 말한다", () => {
    const d = readRecordDay(bucket(1, []), TODAY, TODAY);
    expect(describeDay(d, "8월 3일")).toBe("8월 3일 · 오늘 · 수업 1차시");
  });

  it("앞날의 수업은 「예정」이고 기록 종류가 붙지 않는다", () => {
    const d = readRecordDay(bucket(2, []), "2026-08-10", TODAY);
    expect(describeDay(d, "8월 10일")).toBe("8월 10일 · 수업 2차시 예정");
  });
});
