import { describe, expect, it } from "vitest";
import { trimScore } from "@/lib/format";

/* ─────────────────────────────────────────────────────────────
 * 점수 표시 규칙.
 *
 * 학생·학부모가 보는 점수는 **정수부만, 내림**이다. 반올림하면 39.9점이
 * 40점으로 보여 실제보다 높은 점수를 알리게 된다.
 * (화면에 "40.00/40.00점"으로 나오던 것을 "40/40점"으로 바꾼 규칙)
 * ───────────────────────────────────────────────────────────── */

describe("trimScore", () => {
  it("소수점을 버린다 (반올림이 아니라 내림)", () => {
    expect(trimScore("40.00")).toBe("40");
    expect(trimScore("39.9")).toBe("39");
    expect(trimScore("39.5")).toBe("39");
    expect(trimScore("0.99")).toBe("0");
  });

  it("정수는 그대로 둔다", () => {
    expect(trimScore("40")).toBe("40");
    expect(trimScore("0")).toBe("0");
  });

  it("점수가 없으면 대시로 표시한다", () => {
    expect(trimScore(null)).toBe("—");
  });

  it("숫자가 아니면 원문을 그대로 돌려준다 (임의로 0으로 만들지 않는다)", () => {
    expect(trimScore("미채점")).toBe("미채점");
  });
});
