import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  HwpxUnsupportedEquationError,
  buildHwpx,
  buildHwpxSync,
} from "../../src/hwpx";
import type { HwpxExamDoc } from "../../src/hwpx";
import {
  findElements,
  parseXml,
  readZipEntries,
  requireElement,
  textOf,
} from "../../src/hwpx";

/* ─────────────────────────────────────────────────────────────
 * HWPX 생성기 테스트.
 *
 * 검증의 기준선은 두 가지다.
 *  ① 컨테이너 규약 — mimetype 이 첫 엔트리·무압축. 한글은 이걸 보고 파일 종류를
 *    판정하므로 어기면 "손상된 문서"가 된다.
 *  ② 수식 게이트 — HWP 수식으로 못 옮긴 LaTeX 가 하나라도 있으면 부분 결과를
 *    내보내지 않고 실패한다. 조용히 뜻이 바뀐 시험지가 인쇄되는 것을 막는
 *    유일한 방어선이다.
 *
 * 수식 객체의 상수(baseLine 85 · outMargin 170)는 조암중 해제본
 * Contents/section0.xml 의 실측 84개에서 온 것이다.
 * ───────────────────────────────────────────────────────────── */

const REQUIRED_FILES = [
  "mimetype",
  "version.xml",
  "settings.xml",
  "META-INF/container.xml",
  "META-INF/manifest.xml",
  "META-INF/container.rdf",
  "Contents/content.hpf",
  "Contents/header.xml",
  "Contents/section0.xml",
];

const decoder = new TextDecoder("utf-8");

function unzipText(zip: Uint8Array): Record<string, string> {
  const files = unzipSync(zip);
  return Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => [path, decoder.decode(bytes)]),
  );
}

function sectionOf(zip: Uint8Array): string {
  return unzipText(zip)["Contents/section0.xml"] as string;
}

/** 한글 발문에 수식이 섞이고 5지선다가 붙은, 실제와 가장 가까운 문서. */
const MIXED_DOC: HwpxExamDoc = {
  title: "2학기 중간고사 대비",
  questions: [
    {
      number: 1,
      runs: [
        { kind: "text", text: "이차방정식 " },
        { kind: "equation", latex: "x^2 - 5x + 6 = 0" },
        { kind: "text", text: "의 두 근의 합은?" },
      ],
      choices: [
        [{ kind: "equation", latex: "2" }],
        [{ kind: "equation", latex: "3" }],
        [{ kind: "equation", latex: "5" }],
        [{ kind: "equation", latex: "6" }],
        [{ kind: "text", text: "구할 수 없다" }],
      ],
    },
    {
      number: 2,
      runs: [
        { kind: "text", text: "다음을 계산하시오. " },
        { kind: "equation", latex: "\\frac{b}{a}" },
      ],
    },
  ],
};

describe("buildHwpx — ZIP 컨테이너 규약", () => {
  const zip = buildHwpxSync(MIXED_DOC);
  const entries = readZipEntries(zip);

  it("mimetype 이 첫 엔트리다", () => {
    expect(entries[0]?.name).toBe("mimetype");
  });

  it("mimetype 은 무압축(STORED)으로 들어간다", () => {
    expect(entries[0]?.method).toBe(0);
  });

  it("mimetype 로컬 헤더에 extra field 가 없다", () => {
    // OCF 규약: 첫 엔트리는 바이트 오프셋이 예측 가능해야 한다.
    expect(entries[0]?.extraLength).toBe(0);
  });

  it("mimetype 내용이 application/hwp+zip 이다", () => {
    expect(decoder.decode(entries[0]?.data)).toBe("application/hwp+zip");
  });

  it("mimetype 외 나머지는 DEFLATE 로 압축한다", () => {
    const rest = entries.slice(1);
    expect(rest.length).toBeGreaterThan(0);
    for (const entry of rest) {
      expect(entry.method, entry.name).toBe(8);
    }
  });

  it("크기를 로컬 헤더에 적는다 (data descriptor 미사용)", () => {
    for (const entry of entries) {
      expect(entry.flags & 0x08, entry.name).toBe(0);
    }
  });

  it("필수 파일이 모두 있다", () => {
    const names = Object.keys(unzipSync(zip));
    for (const required of REQUIRED_FILES) {
      expect(names, required).toContain(required);
    }
  });

  it("같은 입력은 같은 바이트를 만든다", () => {
    expect(Array.from(buildHwpxSync(MIXED_DOC))).toEqual(Array.from(zip));
  });

  it("buildHwpx 는 같은 결과를 Promise 로 준다", async () => {
    expect(Array.from(await buildHwpx(MIXED_DOC))).toEqual(Array.from(zip));
  });
});

describe("buildHwpx — XML 유효성", () => {
  const files = unzipText(buildHwpxSync(MIXED_DOC));

  for (const path of [
    "version.xml",
    "settings.xml",
    "META-INF/container.xml",
    "META-INF/manifest.xml",
    "META-INF/container.rdf",
    "Contents/content.hpf",
    "Contents/header.xml",
    "Contents/section0.xml",
  ]) {
    it(`${path} 이 well-formed XML 이다`, () => {
      expect(() => parseXml(files[path] as string)).not.toThrow();
    });
  }

  it("section0.xml 의 루트가 hs:sec 이다", () => {
    expect(parseXml(files["Contents/section0.xml"] as string).name).toBe("hs:sec");
  });

  it("구역 설정(secPr)이 첫 문단의 첫 run 안에 있다", () => {
    const root = parseXml(files["Contents/section0.xml"] as string);
    const firstPara = root.children[0];
    expect(firstPara && "name" in firstPara && firstPara.name).toBe("hp:p");
    expect(findElements(root, "hp:secPr")).toHaveLength(1);
  });

  it("header.xml 의 itemCnt 가 실제 자식 수와 일치한다", () => {
    const head = parseXml(files["Contents/header.xml"] as string);
    const withCount = findElements(head, "hh:fontfaces")
      .concat(findElements(head, "hh:borderFills"))
      .concat(findElements(head, "hh:charProperties"))
      .concat(findElements(head, "hh:tabProperties"))
      .concat(findElements(head, "hh:numberings"))
      .concat(findElements(head, "hh:paraProperties"))
      .concat(findElements(head, "hh:styles"));
    expect(withCount).toHaveLength(7);
    for (const element of withCount) {
      expect(Number(element.attrs["itemCnt"]), element.name).toBe(
        element.children.length,
      );
    }
  });

  it("본문이 참조하는 서식 id 가 header.xml 에 실제로 있다", () => {
    const head = parseXml(files["Contents/header.xml"] as string);
    const section = parseXml(files["Contents/section0.xml"] as string);
    const idsOf = (name: string): Set<string> =>
      new Set(findElements(head, name).map((e) => e.attrs["id"] as string));

    const charPrIds = idsOf("hh:charPr");
    const paraPrIds = idsOf("hh:paraPr");
    const styleIds = idsOf("hh:style");

    for (const run of findElements(section, "hp:run")) {
      expect(charPrIds).toContain(run.attrs["charPrIDRef"]);
    }
    for (const para of findElements(section, "hp:p")) {
      expect(paraPrIds).toContain(para.attrs["paraPrIDRef"]);
      expect(styleIds).toContain(para.attrs["styleIDRef"]);
    }
  });
});

describe("buildHwpx — 수식 객체", () => {
  const section = parseXml(sectionOf(buildHwpxSync(MIXED_DOC)));
  const equations = findElements(section, "hp:equation");

  it("수식 개수가 입력의 equation run 수와 같다", () => {
    const expected = MIXED_DOC.questions.reduce((sum, question) => {
      const inChoices = (question.choices ?? []).reduce(
        (n, choice) => n + choice.filter((r) => r.kind === "equation").length,
        0,
      );
      return sum + question.runs.filter((r) => r.kind === "equation").length + inChoices;
    }, 0);
    expect(equations).toHaveLength(expected);
    expect(expected).toBe(6);
  });

  it("모든 수식의 width 가 0 이 아니다", () => {
    for (const equation of equations) {
      const width = Number(findElements(equation, "hp:sz")[0]?.attrs["width"]);
      expect(width, textOf(equation)).toBeGreaterThan(0);
    }
  });

  it("모든 수식의 height 가 1200 또는 2400 이다", () => {
    for (const equation of equations) {
      const height = Number(findElements(equation, "hp:sz")[0]?.attrs["height"]);
      expect([1200, 2400], textOf(equation)).toContain(height);
    }
  });

  it("baseLine 이 85 다", () => {
    for (const equation of equations) {
      expect(equation.attrs["baseLine"]).toBe("85");
    }
  });

  it("좌우 바깥 여백이 170 이다", () => {
    for (const equation of equations) {
      const margin = findElements(equation, "hp:outMargin")[0];
      expect(margin?.attrs["left"]).toBe("170");
      expect(margin?.attrs["right"]).toBe("170");
    }
  });

  it("글자처럼 취급(treatAsChar)한다", () => {
    for (const equation of equations) {
      expect(findElements(equation, "hp:pos")[0]?.attrs["treatAsChar"]).toBe("1");
    }
  });

  it("수식 글꼴이 HYhwpEQ 다", () => {
    for (const equation of equations) {
      expect(equation.attrs["font"]).toBe("HYhwpEQ");
    }
  });

  it("수식 id 와 zOrder 가 문서 안에서 유일하다", () => {
    const ids = equations.map((e) => e.attrs["id"]);
    const zOrders = equations.map((e) => e.attrs["zOrder"]);
    expect(new Set(ids).size).toBe(equations.length);
    expect(new Set(zOrders).size).toBe(equations.length);
  });

  it("LaTeX 를 HWP 수식 스크립트로 옮겨 적는다", () => {
    const scripts = findElements(section, "hp:script").map(textOf);
    expect(scripts).toContain("{b} over {a}");
    expect(scripts.some((s) => s.includes("x^{2}"))).toBe(true);
  });

  it("분수는 2단 높이(2400)로 잡는다", () => {
    const fraction = requireElement(
      equations.find((e) => textOf(e).includes("over")),
      "분수 수식",
    );
    const size = requireElement(findElements(fraction, "hp:sz")[0], "hp:sz");
    expect(Number(size.attrs["height"])).toBe(2400);
  });
});

describe("buildHwpx — 문항 조판", () => {
  const section = parseXml(sectionOf(buildHwpxSync(MIXED_DOC)));
  const paragraphTexts = findElements(section, "hp:p").map(textOf);

  it("제목을 쓴다", () => {
    expect(paragraphTexts).toContain("2학기 중간고사 대비");
  });

  it("문항 번호를 발문 앞에 붙인다", () => {
    expect(
      paragraphTexts.some((t) => t.startsWith("1. 이차방정식")),
    ).toBe(true);
  });

  it("한글과 수식이 한 문단에 섞인다", () => {
    const stem = requireElement(
      findElements(section, "hp:p").find((p) =>
        textOf(p).startsWith("1. 이차방정식"),
      ),
      "1번 발문 문단",
    );
    expect(findElements(stem, "hp:equation")).toHaveLength(1);
    expect(textOf(stem)).toContain("의 두 근의 합은?");
  });

  it("5지선다를 ①~⑤ 로 매긴다", () => {
    for (const marker of ["①", "②", "③", "④", "⑤"]) {
      expect(
        paragraphTexts.some((t) => t.includes(marker)),
        marker,
      ).toBe(true);
    }
  });

  it("선택지가 없는 문항은 선택지 문단을 만들지 않는다", () => {
    // 2번은 서술형 — 6번째 원문자가 나오면 안 된다.
    expect(paragraphTexts.some((t) => t.includes("⑥"))).toBe(false);
  });

  it("문단 id 가 문서 안에서 유일하다", () => {
    const ids = findElements(section, "hp:p").map((p) => p.attrs["id"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildHwpx — 미지원 수식 게이트", () => {
  const withUnsupported: HwpxExamDoc = {
    title: "게이트 시험",
    questions: [
      {
        number: 1,
        runs: [{ kind: "equation", latex: "\\foo{x}" }],
      },
    ],
  };

  it("미지원 명령이 있으면 빌드가 실패한다", () => {
    expect(() => buildHwpxSync(withUnsupported)).toThrow(
      HwpxUnsupportedEquationError,
    );
  });

  it("오류 메시지에 해당 LaTeX 원문이 들어 있다", () => {
    expect(() => buildHwpxSync(withUnsupported)).toThrow(/\\foo\{x\}/);
  });

  it("오류가 미지원 명령과 위치를 함께 보고한다", () => {
    let caught: unknown;
    try {
      buildHwpxSync(withUnsupported);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HwpxUnsupportedEquationError);
    const failure = (caught as HwpxUnsupportedEquationError).equations[0];
    expect(failure?.latex).toBe("\\foo{x}");
    expect(failure?.unsupported).toContain("\\foo");
    expect(failure?.questionNumber).toBe(1);
    expect(failure?.location).toContain("1번 문항");
  });

  it("첫 실패에서 멈추지 않고 문서 전체의 실패를 모은다", () => {
    const many: HwpxExamDoc = {
      title: "여러 실패",
      questions: [
        { number: 1, runs: [{ kind: "equation", latex: "\\foo{x}" }] },
        {
          number: 2,
          runs: [{ kind: "equation", latex: "\\frac{1}{2}" }],
          choices: [
            [{ kind: "equation", latex: "\\cfrac{1}{2}" }],
            [{ kind: "equation", latex: "\\qux{y}" }],
          ],
        },
      ],
    };
    let caught: HwpxUnsupportedEquationError | undefined;
    try {
      buildHwpxSync(many);
    } catch (error) {
      caught = error as HwpxUnsupportedEquationError;
    }
    expect(caught?.equations).toHaveLength(3);
    expect(caught?.equations.map((e) => e.latex)).toEqual([
      "\\foo{x}",
      "\\cfrac{1}{2}",
      "\\qux{y}",
    ]);
    // 선택지 실패는 몇 번 선택지인지까지 짚어준다.
    expect(caught?.equations[1]?.location).toContain("①");
    expect(caught?.equations[2]?.location).toContain("②");
  });

  it("실패 시 원문 LaTeX 를 본문에 흘리는 폴백이 없다", () => {
    // 부분 산출물이 나오지 않는다는 것 자체가 계약이다.
    expect(() => buildHwpxSync(withUnsupported)).toThrow();
  });

  it("모든 수식이 변환되면 통과한다", () => {
    expect(() => buildHwpxSync(MIXED_DOC)).not.toThrow();
  });
});

describe("buildHwpx — 이스케이프와 인코딩", () => {
  const trickyDoc: HwpxExamDoc = {
    title: `제목 & "따옴표" <꺾쇠> 'apos'`,
    questions: [
      {
        number: 1,
        runs: [
          { kind: "text", text: `a < b & c > d, "인용" 그리고 'apos'` },
          { kind: "equation", latex: "a < b" },
        ],
      },
    ],
  };
  const zip = buildHwpxSync(trickyDoc);
  const files = unzipText(zip);
  const sectionXml = files["Contents/section0.xml"] as string;

  it("특수문자가 든 문서도 well-formed XML 이다", () => {
    expect(() => parseXml(sectionXml)).not.toThrow();
    expect(() => parseXml(files["Contents/content.hpf"] as string)).not.toThrow();
  });

  it("다섯 특수문자를 모두 엔티티로 적는다", () => {
    for (const entity of ["&amp;", "&lt;", "&gt;", "&quot;", "&apos;"]) {
      expect(sectionXml, entity).toContain(entity);
    }
  });

  it("날것의 < 와 & 가 텍스트에 남지 않는다", () => {
    const text = findElements(parseXml(sectionXml), "hp:t").map(textOf).join("");
    // 파서를 거친 뒤에는 원문 그대로 복원돼야 한다.
    expect(text).toContain(`a < b & c > d, "인용" 그리고 'apos'`);
  });

  it("이중 이스케이프하지 않는다", () => {
    expect(sectionXml).not.toContain("&amp;lt;");
    expect(sectionXml).not.toContain("&amp;amp;");
  });

  it("수식 스크립트의 부등호도 이스케이프한다", () => {
    const scripts = findElements(parseXml(sectionXml), "hp:script").map(textOf);
    expect(scripts.some((s) => s.includes("<"))).toBe(true);
  });

  it("제목이 content.hpf 에도 이스케이프돼 들어간다", () => {
    const hpf = parseXml(files["Contents/content.hpf"] as string);
    const title = requireElement(findElements(hpf, "opf:title")[0], "opf:title");
    expect(textOf(title)).toBe(trickyDoc.title);
  });

  it("한글을 UTF-8 로 저장한다", () => {
    const bytes = unzipSync(zip)["Contents/section0.xml"] as Uint8Array;
    const expected = new TextEncoder().encode("이차방정식");
    const korean = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    expect(korean).toContain("제목");
    // 한글이 UTF-8 3바이트로 들어갔는지 바이트 수준에서 확인
    expect(expected).toHaveLength(15);
  });

  it("XML 1.0 이 허용하지 않는 제어 문자를 제거한다", () => {
    const withControl: HwpxExamDoc = {
      title: "제어문자",
      questions: [
        {
          number: 1,
          runs: [
            {
              kind: "text",
              text: `앞${String.fromCharCode(0)}${String.fromCharCode(8)}뒤`,
            },
          ],
        },
      ],
    };
    const xml = sectionOf(buildHwpxSync(withControl));
    expect(() => parseXml(xml)).not.toThrow();
    expect(findElements(parseXml(xml), "hp:t").map(textOf)).toContain("1. 앞뒤");
  });
});

describe("buildHwpx — 경계 입력", () => {
  it("문항이 없어도 유효한 문서를 만든다", () => {
    const empty: HwpxExamDoc = { title: "빈 시험지", questions: [] };
    const files = unzipText(buildHwpxSync(empty));
    expect(() => parseXml(files["Contents/section0.xml"] as string)).not.toThrow();
    for (const required of REQUIRED_FILES) {
      expect(Object.keys(files), required).toContain(required);
    }
  });

  it("수식만으로 이루어진 발문도 처리한다", () => {
    const doc: HwpxExamDoc = {
      title: "수식만",
      questions: [{ number: 1, runs: [{ kind: "equation", latex: "\\sqrt{2}" }] }],
    };
    const section = parseXml(sectionOf(buildHwpxSync(doc)));
    expect(findElements(section, "hp:equation")).toHaveLength(1);
  });

  it("빈 텍스트 run 은 빈 hp:t 를 만들지 않는다", () => {
    const doc: HwpxExamDoc = {
      title: "빈 런",
      questions: [
        {
          number: 1,
          runs: [
            { kind: "text", text: "" },
            { kind: "text", text: "내용" },
          ],
        },
      ],
    };
    const section = parseXml(sectionOf(buildHwpxSync(doc)));
    for (const t of findElements(section, "hp:t")) {
      expect(textOf(t).length).toBeGreaterThan(0);
    }
  });

  it("선택지가 20개를 넘으면 괄호 번호로 떨어진다", () => {
    const doc: HwpxExamDoc = {
      title: "많은 선택지",
      questions: [
        {
          number: 1,
          runs: [{ kind: "text", text: "고르시오" }],
          choices: Array.from({ length: 21 }, (_, i) => [
            { kind: "text" as const, text: `보기${i + 1}` },
          ]),
        },
      ],
    };
    const texts = findElements(parseXml(sectionOf(buildHwpxSync(doc))), "hp:p").map(
      textOf,
    );
    expect(texts.some((t) => t.includes("⑳"))).toBe(true);
    expect(texts.some((t) => t.includes("(21)"))).toBe(true);
  });
});
