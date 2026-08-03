import { describe, expect, it } from "vitest";
import {
  alignOutput,
  buildAlignSystemPrompt,
  buildAlignUserPrompt,
  checkAlignment,
  questionBodyToMixedText,
  toNumeric3,
  type ConceptCandidate,
} from "../src/align";

/* ─────────────────────────────────────────────────────────────
 * 정렬 제안 게이트 — 지어낸 개념(후보 밖 slug)과 어긋난 가중치가
 * 조용히 저장되면 숙련도 추정이 학생 화면 어디에도 안 보인 채 틀어진다.
 * 각 게이트가 실제로 잡는지 고정된 예로 확인한다.
 * ───────────────────────────────────────────────────────────── */

const CANDIDATES: ConceptCandidate[] = [
  {
    slug: "m1-gcd",
    name: "최대공약수",
    description: "공약수와 최대공약수를 구하고 활용 문제에 적용한다.",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
  {
    slug: "m1-lcm",
    name: "최소공배수",
    description: "공배수와 최소공배수를 구하고 활용 문제에 적용한다.",
    gradeBand: "middle-1",
    domainName: "수와 연산",
  },
];

const align = (alignments: { slug: string; weight: number }[]) =>
  alignOutput.parse({
    decision: "align",
    alignments: alignments.map((a) => ({
      ...a,
      confidence: 0.8,
      rationale: "유형 머리글이 이 개념을 가리킨다",
    })),
  });

describe("checkAlignment — 게이트", () => {
  it("후보 밖 slug는 지어낸 개념이다 — 통째로 거부", () => {
    const problems = checkAlignment(align([{ slug: "m1-fraction", weight: 1 }]), CANDIDATES);
    expect(problems.some((p) => p.includes("m1-fraction"))).toBe(true);
  });

  it("중복 slug를 잡는다", () => {
    const problems = checkAlignment(
      align([
        { slug: "m1-gcd", weight: 0.5 },
        { slug: "m1-gcd", weight: 0.5 },
      ]),
      CANDIDATES,
    );
    expect(problems.some((p) => p.includes("중복"))).toBe(true);
  });

  it("가중치 합이 1이 아니면 거부 — 사람 표와 같은 규약", () => {
    const problems = checkAlignment(
      align([
        { slug: "m1-gcd", weight: 0.5 },
        { slug: "m1-lcm", weight: 0.4 },
      ]),
      CANDIDATES,
    );
    expect(problems.some((p) => p.includes("가중치 합"))).toBe(true);
  });

  it("3분할 0.34+0.33+0.33은 통과한다 (사람 표의 중단원 분배 꼴)", () => {
    const candidates = [
      ...CANDIDATES,
      { slug: "m1-divisors", name: "약수", description: null, gradeBand: "middle-1", domainName: null },
    ];
    const problems = checkAlignment(
      align([
        { slug: "m1-gcd", weight: 0.34 },
        { slug: "m1-lcm", weight: 0.33 },
        { slug: "m1-divisors", weight: 0.33 },
      ]),
      candidates,
    );
    expect(problems).toEqual([]);
  });

  it("abstain은 alignments가 비어야 한다 — 잇는 것과 물러서는 것을 섞지 않는다", () => {
    const output = alignOutput.parse({
      decision: "abstain",
      alignments: [
        { slug: "m1-gcd", weight: 1, confidence: 0.5, rationale: "…" },
      ],
      abstainReason: "정수와 유리수 단원인데 후보가 없다",
    });
    expect(checkAlignment(output, CANDIDATES).length).toBeGreaterThan(0);
  });

  it("align인데 alignments가 비면 거부 — 결정 없는 결정은 없다", () => {
    const output = alignOutput.parse({ decision: "align", alignments: [] });
    expect(checkAlignment(output, CANDIDATES).length).toBeGreaterThan(0);
  });

  it("정상 제안(단일 개념 weight 1)은 통과", () => {
    expect(checkAlignment(align([{ slug: "m1-gcd", weight: 1 }]), CANDIDATES)).toEqual([]);
  });
});

describe("alignOutput — 계약", () => {
  it("weight 0·음수·1 초과, confidence 범위 밖을 거부한다", () => {
    const base = { decision: "align" as const };
    const mk = (weight: number, confidence: number) => ({
      ...base,
      alignments: [{ slug: "m1-gcd", weight, confidence, rationale: "r" }],
    });
    expect(alignOutput.safeParse(mk(0, 0.5)).success).toBe(false);
    expect(alignOutput.safeParse(mk(1.2, 0.5)).success).toBe(false);
    expect(alignOutput.safeParse(mk(1, 1.5)).success).toBe(false);
    expect(alignOutput.safeParse(mk(1, 0.5)).success).toBe(true);
  });

  it("abstain 초안은 alignments를 생략할 수 있다 — 파서가 빈 배열을 채운다 (시범 실측 결함)", () => {
    const parsed = alignOutput.parse({
      decision: "abstain",
      abstainReason: "후보에 이 단원 개념이 없다",
    });
    expect(parsed.alignments).toEqual([]);
    expect(checkAlignment(parsed, CANDIDATES)).toEqual([]);
  });

  it("개념 5개 이상 제안을 거부한다 — 산탄총 정렬 방지", () => {
    const many = {
      decision: "align",
      alignments: Array.from({ length: 5 }, (_, i) => ({
        slug: `s${i}`,
        weight: 0.2,
        confidence: 0.5,
        rationale: "r",
      })),
    };
    expect(alignOutput.safeParse(many).success).toBe(false);
  });
});

describe("questionBodyToMixedText — 프롬프트용 평문화", () => {
  it("발문·조건 상자·선택지를 구분해 편다", () => {
    const body = [
      {
        type: "paragraph",
        runs: [
          { kind: "text", text: "두 수 " },
          { kind: "math", math: { expressionId: "e1", latex: "2^{2}\\times 3" } },
          { kind: "text", text: "의 최대공약수는?" },
        ],
      },
      {
        type: "condition_box",
        label: "조건",
        items: [{ marker: "㈎", content: [{ kind: "text", text: "서로소이다" }] }],
      },
      {
        type: "choice_group",
        choices: [
          { choiceId: "c2", order: 2, content: [{ kind: "text", text: "6" }] },
          { choiceId: "c1", order: 1, content: [{ kind: "math", math: { latex: "2" } }] },
        ],
      },
    ];
    const text = questionBodyToMixedText(body);
    expect(text).toContain("두 수 $2^{2}\\times 3$의 최대공약수는?");
    expect(text).toContain("[조건]");
    expect(text).toContain("㈎ 서로소이다");
    /* 선택지는 order 순 — 배열 순서가 아니라 */
    expect(text).toContain("① $2$  ② 6");
  });

  it("블록 배열이 아니면 빈 문자열 — 지어내지 않는다", () => {
    expect(questionBodyToMixedText(null)).toBe("");
    expect(questionBodyToMixedText({ type: "paragraph" })).toBe("");
  });
});

describe("프롬프트", () => {
  it("시스템 프롬프트가 abstain 규칙과 후보 제한을 명시한다", () => {
    const system = buildAlignSystemPrompt();
    expect(system).toContain("abstain");
    expect(system).toContain("후보 목록에 있는 slug만");
  });

  it("사용자 프롬프트에 유형 머리글·본문·후보가 실리고, 없는 계층은 줄이 생기지 않는다", () => {
    const prompt = buildAlignUserPrompt({
      chapter: "I 소인수분해",
      unit: "최대공약수와 최소공배수",
      section: null,
      typeTitle: "최대공약수 구하기",
      kind: "multiple_choice",
      bodyText: "두 수의 최대공약수는?",
      candidates: CANDIDATES,
    });
    expect(prompt).toContain("유형 머리글: 최대공약수 구하기");
    expect(prompt).toContain("두 수의 최대공약수는?");
    expect(prompt).toContain("- m1-gcd — 최대공약수");
    expect(prompt).toContain("(middle-1 · 수와 연산)");
    expect(prompt).not.toContain("구역:");
  });
});

describe("toNumeric3 — numeric(4,3) 저장 규약", () => {
  it("소수 셋째 자리로 고정한다", () => {
    expect(toNumeric3(1)).toBe("1.000");
    expect(toNumeric3(0.335)).toBe("0.335");
    expect(toNumeric3(0.87654)).toBe("0.877");
  });
});
