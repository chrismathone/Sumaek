/**
 * 수동 검증용 샘플 .hwpx 내보내기.
 *
 * 자동 테스트가 확인할 수 있는 것은 "규약을 지킨 바이트를 만들었다"까지다.
 * **한글이 실제로 열어서 우리가 의도한 대로 조판하는지**는 사람이 열어봐야
 * 알 수 있고, 그것이 이 어댑터의 다음 단계 완료 기준이다. 그때 쓸 표본을
 * 만드는 스위치다.
 *
 * 환경 변수가 없으면 건너뛴다 — 평소 테스트 실행이 파일을 남기지 않도록.
 *
 *   HWPX_SAMPLE_OUT=D:\tmp\sample.hwpx pnpm --filter @su-maek/core test
 *
 * 표본에는 검증하고 싶은 것을 일부러 다 넣었다: 한글·수식 혼합 발문,
 * 5지선다, 1단/2단 높이 수식(분수·근호·시그마·극한), XML 특수문자.
 */
import { writeFileSync } from "node:fs";
import { it } from "vitest";

import { buildHwpxSync } from "../../src/hwpx";
import type { HwpxExamDoc } from "../../src/hwpx";

const OUT = process.env["HWPX_SAMPLE_OUT"];

const doc: HwpxExamDoc = {
  title: "수맥 HWPX 생성기 확인용 시험지",
  questions: [
    {
      number: 1,
      runs: [
        { kind: "text", text: "이차방정식 " },
        { kind: "equation", latex: "x^2 - 5x + 6 = 0" },
        { kind: "text", text: "의 두 근의 합은? (부등호 a < b & c > d 포함)" },
      ],
      choices: [
        [{ kind: "equation", latex: "2" }],
        [{ kind: "equation", latex: "\\frac{b}{a}" }],
        [{ kind: "equation", latex: "\\sqrt{2}" }],
        [{ kind: "equation", latex: "\\sum_{k=1}^{n} k" }],
        [{ kind: "text", text: "구할 수 없다" }],
      ],
    },
    {
      number: 2,
      runs: [
        { kind: "text", text: "다음 극한값을 구하시오. " },
        { kind: "equation", latex: "\\lim_{x \\to 0} \\frac{\\sin x}{x}" },
      ],
    },
  ],
};

it.runIf(OUT)("샘플 hwpx 를 파일로 쓴다", () => {
  writeFileSync(OUT as string, buildHwpxSync(doc));
});
