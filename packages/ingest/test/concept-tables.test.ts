import { describe, expect, it } from "vitest";
import {
  RPM_M1_CH1_CONCEPTS,
  RPM_M1_CH1_TITLE_TO_CONCEPT,
  RPM_M1_CH1_UNIT_TO_CONCEPT,
  RPM_M1_CH2_CONCEPTS,
  RPM_M1_CH2_TITLE_TO_CONCEPT,
  RPM_M1_CH2_UNIT_TO_CONCEPT,
  RPM_M1_CH3_CONCEPTS,
  RPM_M1_CH3_TITLE_TO_CONCEPT,
  RPM_M1_CH3_UNIT_TO_CONCEPT,
  RPM_M1_CH4_CONCEPTS,
  RPM_M1_CH4_TITLE_TO_CONCEPT,
  RPM_M1_CH4_UNIT_TO_CONCEPT,
  normalizeConceptKey,
} from "../src/profiles/rpm-2022-concepts";
import type { ConceptDefinition, ConceptWeight } from "../src/profiles/rpm-2022-concepts";

/* 이 표들이 틀리면 **화면에는 아무 표시가 나지 않는다.** 문항은 멀쩡히
 * 들어가고 학생도 정상으로 푸는데, 숙련도 증거만 엉뚱한 개념에 쌓인다.
 * 그래서 눈으로 볼 수 없는 것들을 여기서 건다. */

const CHAPTERS: {
  name: string;
  concepts: ConceptDefinition[];
  title: ReadonlyMap<string, ConceptWeight[]>;
  unit: ReadonlyMap<string, ConceptWeight[]>;
}[] = [
  {
    name: "I. 소인수분해",
    concepts: RPM_M1_CH1_CONCEPTS,
    title: RPM_M1_CH1_TITLE_TO_CONCEPT,
    unit: RPM_M1_CH1_UNIT_TO_CONCEPT,
  },
  {
    name: "II. 정수와 유리수",
    concepts: RPM_M1_CH2_CONCEPTS,
    title: RPM_M1_CH2_TITLE_TO_CONCEPT,
    unit: RPM_M1_CH2_UNIT_TO_CONCEPT,
  },
  {
    name: "III. 문자와 식",
    concepts: RPM_M1_CH3_CONCEPTS,
    title: RPM_M1_CH3_TITLE_TO_CONCEPT,
    unit: RPM_M1_CH3_UNIT_TO_CONCEPT,
  },
  {
    name: "IV. 좌표평면과 그래프",
    concepts: RPM_M1_CH4_CONCEPTS,
    title: RPM_M1_CH4_TITLE_TO_CONCEPT,
    unit: RPM_M1_CH4_UNIT_TO_CONCEPT,
  },
];

describe.each(CHAPTERS)("$name", ({ concepts, title, unit }) => {
  const slugs = new Set(concepts.map((c) => c.slug));

  it("표가 가리키는 개념이 전부 정의돼 있다", () => {
    /* 오타 난 slug는 load.ts에서 `continue`로 조용히 건너뛴다 —
     * 문항은 들어가고 개념만 안 걸린 채 아무 경고가 없다. */
    const dangling = [...title, ...unit]
      .flatMap(([t, ws]) => ws.map((w) => ({ t, slug: w.slug })))
      .filter((x) => !slugs.has(x.slug));
    expect(dangling).toEqual([]);
  });

  it("가중치의 합이 1이다", () => {
    const off = [...title, ...unit]
      .map(([t, ws]) => ({ t, sum: ws.reduce((s, w) => s + w.weight, 0) }))
      .filter((x) => Math.abs(x.sum - 1) > 0.011);
    expect(off).toEqual([]);
  });

  it("한 제목 안에서 같은 개념이 두 번 나오지 않는다", () => {
    const dup = [...title, ...unit].filter(
      ([, ws]) => new Set(ws.map((w) => w.slug)).size !== ws.length,
    );
    expect(dup).toEqual([]);
  });

  it("정의한 개념은 전부 어딘가에서 쓰인다", () => {
    const used = new Set([...title, ...unit].flatMap(([, ws]) => ws.map((w) => w.slug)));
    expect([...slugs].filter((s) => !used.has(s))).toEqual([]);
  });
});

describe("개념 slug는 교재 전체에서 하나의 이름만 갖는다", () => {
  it("같은 slug가 두 대단원에서 다른 이름으로 정의되지 않는다", () => {
    const byslug = new Map<string, string>();
    const clash: string[] = [];
    for (const { concepts } of CHAPTERS)
      for (const c of concepts) {
        const seen = byslug.get(c.slug);
        if (seen !== undefined && seen !== c.name) clash.push(`${c.slug}: ${seen} vs ${c.name}`);
        byslug.set(c.slug, c.name);
      }
    expect(clash).toEqual([]);
  });
});

describe("제목 정규화", () => {
  it("지면의 □는 공백이 아니라 사설 영역 글자다 (U+E22D)", () => {
    // 이걸 놓쳐서 1단원 4문항이 유형 표를 못 찾고 중단원 표로 내려갔다
    expect(normalizeConceptKey("약수의 개수가 주어질 때  안에 들어 갈 수 있는 자연수 구하기")).toBe(
      "약수의 개수가 주어질 때 안에 들어 갈 수 있는 자연수 구하기",
    );
  });

  it("사설 영역 글자가 공백 없이 붙어 있어도 낱말을 붙이지 않는다", () => {
    expect(normalizeConceptKey("가나")).toBe("가 나");
  });

  it("여러 칸 공백은 하나로 누른다", () => {
    expect(normalizeConceptKey("  가   나  ")).toBe("가 나");
  });
});

describe("실제로 걸리는지 — 추출기가 내놓는 제목 그대로", () => {
  const hit = (
    table: ReadonlyMap<string, ConceptWeight[]>,
    t: string,
  ): string[] => (table.get(normalizeConceptKey(t)) ?? []).map((w) => w.slug);

  it("□가 든 제목이 유형 표에 걸린다", () => {
    expect(
      hit(
        RPM_M1_CH1_TITLE_TO_CONCEPT,
        "약수의 개수가 주어질 때  안에 들어 갈 수 있는 자연수 구하기",
      ),
    ).toEqual(["m1-divisors"]);
  });

  it("계층이 같은 이름을 써도 서로 다른 표를 본다", () => {
    // 3단원: 중단원 「일차방정식의 풀이」와 소단원 「일차방정식의 풀이」
    expect(hit(RPM_M1_CH3_TITLE_TO_CONCEPT, "일차방정식의 풀이")).toEqual([
      "m1-linear-equation-solve",
    ]);
    expect(hit(RPM_M1_CH3_UNIT_TO_CONCEPT, "일차방정식의 풀이")).toEqual([
      "m1-equation-identity",
      "m1-equality-properties",
      "m1-linear-equation-solve",
    ]);
    // 1단원: 소단원 「소인수분해」는 단일 개념, 중단원 「소인수분해」는 3분할
    expect(hit(RPM_M1_CH1_TITLE_TO_CONCEPT, "소인수분해")).toEqual([
      "m1-prime-factorization",
    ]);
    expect(hit(RPM_M1_CH1_UNIT_TO_CONCEPT, "소인수분해")).toHaveLength(3);
  });
});
