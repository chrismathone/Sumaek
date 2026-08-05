import { describe, expect, it } from "vitest";
import { renderMixedText } from "@su-maek/core/math";
import { decodeHwpMath } from "../src/hwp-encoding";

/* ─────────────────────────────────────────────────────────────
 * **해독 결과가 실제로 그려지는지** 확인한다.
 *
 * 다른 해독 테스트는 기대 문자열만 맞춘다. 그 방식으로는 「문자열은 맞는데
 * 화면에는 안 나오는」 결함을 못 잡는다 — 실제로 호(⌒) 표기가 그랬다.
 * `\overparen{AB}`가 기댓값과 정확히 일치했지만 KaTeX가 그 명령을 못 그려서
 * 중3-2 원의 성질의 호 문항이 전부 빨간 오류로 나가고 있었다. 테스트는
 * 초록이었다.
 *
 * 그래서 여기서는 문자열을 보지 않고 **렌더가 성공하는지만** 본다.
 * ───────────────────────────────────────────────────────────── */

const renders = (latex: string): boolean =>
  renderMixedText(`$${latex}$`, "publish").failures.length === 0;

describe("해독 결과는 화면에 그려져야 한다", () => {
  const cases: [string, string][] = [
    ["호 — 글자 앞", "µAB"],
    ["호 — 글자 뒤", "ABµ"],
    ["선분", "ABÓ"],
    ["반직선", "ABê"],
    ["직선", "CA³"],
    ["이음 조각이 낀 선분", "AÕMÓ"],
    ["분수", ";3!;"],
    ["지수", "2Û`"],
  ];

  for (const [name, raw] of cases) {
    it(`${name} — ${raw}`, () => {
      const { latex } = decodeHwpMath(raw, "EHyak-Plain");
      expect(renders(latex), `그려지지 않음: ${latex}`).toBe(true);
    });
  }
});
