import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildHwpxSync, validateHwpx } from "../../src/hwpx";
import type { HwpxExamDoc, HwpxIssueCode } from "../../src/hwpx";

/* ─────────────────────────────────────────────────────────────
 * HWPX 산출물 형식 검증 (ADR-0013 §6, C-14 대체 검증 6종).
 *
 * 검사기를 믿으려면 "깨진 것을 실제로 잡는다"를 보여야 한다. 그래서 대부분의
 * 테스트가 정상 문서를 만든 뒤 **일부러 망가뜨려** 검사기가 무엇을 잡는지 본다.
 * 정상 문서가 통과하는 것만 확인하는 검사기는 아무것도 보증하지 않는다.
 * ───────────────────────────────────────────────────────────── */

const DOC: HwpxExamDoc = {
  title: "형식 검증 대상",
  questions: [
    {
      number: 1,
      runs: [
        { kind: "text", text: "다음을 계산하시오. " },
        { kind: "equation", latex: "\\frac{b}{a}" },
      ],
      choices: [
        [{ kind: "equation", latex: "1" }],
        [{ kind: "equation", latex: "2" }],
      ],
    },
  ],
};

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

/**
 * 손상본을 다시 묶을 때 쓰는 고정 시각.
 * fflate 는 1980~2099 밖의 mtime 을 거부하므로 0 을 넣으면 안 된다
 * (ZIP 의 DOS 시각 필드가 1980년을 기점으로 하기 때문).
 */
const FIXED_MTIME = Date.UTC(2020, 0, 1);

/** 정상 문서의 section0.xml 을 바꿔치기해 손상된 산출물을 만든다. */
function withSection(transform: (xml: string) => string): Uint8Array {
  const files = unzipSync(buildHwpxSync(DOC));
  const zipInput: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const [path, bytes] of Object.entries(files)) {
    const content =
      path === "Contents/section0.xml"
        ? encoder.encode(transform(decoder.decode(bytes)))
        : bytes;
    zipInput[path] = path === "mimetype" ? [content, { level: 0 }] : content;
  }
  return zipSync(zipInput as Parameters<typeof zipSync>[0], { mtime: FIXED_MTIME });
}

function codes(report: ReturnType<typeof validateHwpx>): HwpxIssueCode[] {
  return report.issues.map((i) => i.code);
}

describe("HWPX 형식 검증 — 정상 문서", () => {
  const report = validateHwpx({ bytes: buildHwpxSync(DOC), expectedEquationCount: 3 });

  it("통과한다", () => {
    expect(report.status).toBe("passed");
    expect(report.issues).toEqual([]);
  });

  it("수식 개수를 센다", () => {
    expect(report.metrics.equationCount).toBe(3);
  });

  it("최소 폭이 0 보다 크다", () => {
    expect(report.metrics.minEquationWidth).toBeGreaterThan(0);
  });

  it("기대 개수를 주지 않으면 개수 검사를 건너뛴다", () => {
    expect(validateHwpx({ bytes: buildHwpxSync(DOC) }).status).toBe("passed");
  });
});

describe("HWPX 형식 검증 — ① ZIP 구조", () => {
  it("ZIP 이 아니면 잡는다", () => {
    const report = validateHwpx({ bytes: encoder.encode("이건 zip 이 아니다") });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("zip_structure");
  });

  it("빈 바이트를 잡는다", () => {
    expect(validateHwpx({ bytes: new Uint8Array(0) }).status).toBe("failed");
  });

  it("mimetype 이 압축돼 있으면 잡는다", () => {
    const files = unzipSync(buildHwpxSync(DOC));
    // level 0 을 빼고 다시 묶는다 = mimetype 이 DEFLATE 로 들어간다.
    const bytes = zipSync(files, { level: 6, mtime: FIXED_MTIME });
    const report = validateHwpx({ bytes });
    expect(report.status).toBe("failed");
    expect(
      report.issues.some((i) => i.message.includes("무압축이 아니다")),
    ).toBe(true);
  });

  it("mimetype 이 첫 엔트리가 아니면 잡는다", () => {
    const files = unzipSync(buildHwpxSync(DOC));
    const reordered: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
    reordered["version.xml"] = files["version.xml"] as Uint8Array;
    reordered["mimetype"] = [files["mimetype"] as Uint8Array, { level: 0 }];
    for (const [path, bytes] of Object.entries(files)) {
      if (path !== "mimetype" && path !== "version.xml") reordered[path] = bytes;
    }
    const report = validateHwpx({
      bytes: zipSync(reordered as Parameters<typeof zipSync>[0], { mtime: FIXED_MTIME }),
    });
    expect(report.status).toBe("failed");
    expect(
      report.issues.some((i) => i.message.includes("첫 엔트리가 mimetype 이 아니다")),
    ).toBe(true);
  });

  it("필수 파일이 빠지면 잡는다", () => {
    const files = unzipSync(buildHwpxSync(DOC));
    delete files["Contents/header.xml"];
    const bytes = zipSync(
      { mimetype: [files["mimetype"] as Uint8Array, { level: 0 }], ...files },
      { mtime: FIXED_MTIME },
    );
    const report = validateHwpx({ bytes });
    expect(report.status).toBe("failed");
    expect(
      report.issues.some((i) => i.message.includes("Contents/header.xml")),
    ).toBe(true);
  });

  it("mimetype 내용이 다르면 잡는다", () => {
    const files = unzipSync(buildHwpxSync(DOC));
    const bytes = zipSync(
      {
        mimetype: [encoder.encode("application/epub+zip"), { level: 0 }],
        ...Object.fromEntries(
          Object.entries(files).filter(([p]) => p !== "mimetype"),
        ),
      } as Parameters<typeof zipSync>[0],
      { mtime: FIXED_MTIME },
    );
    expect(validateHwpx({ bytes }).status).toBe("failed");
  });
});

describe("HWPX 형식 검증 — ② XML 파싱", () => {
  it("깨진 XML 을 잡는다", () => {
    const report = validateHwpx({
      bytes: withSection((xml) => xml.replace("</hs:sec>", "")),
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("xml_parse");
  });

  it("이스케이프되지 않은 & 를 잡는다", () => {
    const report = validateHwpx({
      bytes: withSection((xml) => xml.replace("<hp:t>", "<hp:t>A & B ")),
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("xml_parse");
  });

  it("본문을 못 읽으면 뒤 검사를 건너뛴다 (허위 통과 금지)", () => {
    const report = validateHwpx({
      bytes: withSection(() => "<broken"),
      expectedEquationCount: 3,
    });
    expect(report.status).toBe("failed");
    expect(report.metrics.equationCount).toBe(0);
  });
});

describe("HWPX 형식 검증 — ③ 수식 개수", () => {
  it("기대보다 적으면 잡는다", () => {
    const report = validateHwpx({
      bytes: buildHwpxSync(DOC),
      expectedEquationCount: 5,
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("equation_count");
    expect(report.issues[0]?.message).toContain("문서 3개, 기대 5개");
  });

  it("기대보다 많아도 잡는다", () => {
    const report = validateHwpx({
      bytes: buildHwpxSync(DOC),
      expectedEquationCount: 1,
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("equation_count");
  });
});

describe("HWPX 형식 검증 — ④ 폭 0", () => {
  it("폭이 0 인 수식을 잡는다", () => {
    const report = validateHwpx({
      bytes: withSection((xml) => xml.replace(/<hp:sz width="\d+"/, '<hp:sz width="0"')),
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("zero_width");
    expect(report.metrics.minEquationWidth).toBe(0);
  });

  it("폭 속성이 아예 없으면 잡는다", () => {
    const report = validateHwpx({
      bytes: withSection((xml) => xml.replace(/<hp:sz width="\d+"/, "<hp:sz")),
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("zero_width");
  });

  it("어느 수식이 문제인지 스크립트로 알려준다", () => {
    const report = validateHwpx({
      bytes: withSection((xml) => xml.replace(/<hp:sz width="\d+"/, '<hp:sz width="0"')),
    });
    const issue = report.issues.find((i) => i.code === "zero_width");
    expect(issue?.message).toMatch(/over|1|2/);
  });
});

describe("HWPX 형식 검증 — ⑤ 기준선", () => {
  it("기준선이 허용 오차를 넘으면 잡는다", () => {
    const report = validateHwpx({
      bytes: withSection((xml) => xml.replaceAll('baseLine="85"', 'baseLine="50"')),
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("baseline");
  });

  it("허용 오차 안이면 통과한다", () => {
    const report = validateHwpx({
      bytes: withSection((xml) => xml.replaceAll('baseLine="85"', 'baseLine="86"')),
    });
    expect(report.status).toBe("passed");
  });

  it("기준선이 없으면 잡는다", () => {
    const report = validateHwpx({
      bytes: withSection((xml) => xml.replaceAll(' baseLine="85"', "")),
    });
    expect(report.status).toBe("failed");
    expect(codes(report)).toContain("baseline");
  });
});

describe("HWPX 형식 검증 — ⑥ 골든 대비 편차", () => {
  const golden = [{ script: "{b} over {a}", width: 1105, height: 2400 }];

  it("골든과 같으면 통과한다", () => {
    const report = validateHwpx({ bytes: buildHwpxSync(DOC), golden });
    expect(report.status).toBe("passed");
    expect(report.metrics.goldenComparedCount).toBe(1);
    expect(report.metrics.maxWidthDeviation).toBeLessThan(0.03);
  });

  it("폭 편차가 3% 를 넘으면 검수 대상으로 올린다", () => {
    const report = validateHwpx({
      bytes: buildHwpxSync(DOC),
      golden: [{ script: "{b} over {a}", width: 2000, height: 2400 }],
    });
    // 파일이 깨진 게 아니라 레이아웃이 밀리는 문제 — 사람이 볼 일이다.
    expect(report.status).toBe("review_required");
    expect(codes(report)).toContain("golden_deviation");
    expect(report.metrics.maxWidthDeviation).toBeGreaterThan(0.03);
  });

  it("높이가 다르면 검수 대상으로 올린다", () => {
    const report = validateHwpx({
      bytes: buildHwpxSync(DOC),
      golden: [{ script: "{b} over {a}", width: 1105, height: 1200 }],
    });
    expect(report.status).toBe("review_required");
  });

  it("골든에 없는 수식은 대조하지 않는다", () => {
    const report = validateHwpx({
      bytes: buildHwpxSync(DOC),
      golden: [{ script: "없는 스크립트", width: 100, height: 1200 }],
    });
    expect(report.status).toBe("passed");
    expect(report.metrics.goldenComparedCount).toBe(0);
  });

  it("치명 문제가 함께 있으면 failed 가 우선한다", () => {
    const report = validateHwpx({
      bytes: withSection((xml) => xml.replace(/<hp:sz width="\d+"/, '<hp:sz width="0"')),
      golden: [{ script: "{b} over {a}", width: 9999, height: 2400 }],
    });
    expect(report.status).toBe("failed");
  });
});
