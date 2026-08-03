import { describe, expect, it } from "vitest";
import {
  diffReleases,
  draftMappingMigration,
  statementSimilarity,
  type DiffStandard,
} from "../../src/curriculum/diff";

/* ─────────────────────────────────────────────────────────────
 * 릴리스 차이 계산 (인수 50) — 순수 엔진.
 *
 * 판정 7종(동일·수정·이동·추가·삭제·재코드·분할·통합)과 마이그레이션
 * 초안의 행동 분류를 검증한다. 유사도 판정(분할·통합·재코드)은 후보
 * 추정일 뿐이므로 초안에서 전부 검토 대상이어야 한다 (원칙 13 —
 * 자동 재매핑 없음).
 * ───────────────────────────────────────────────────────────── */

const std = (code: string, statement: string, domainName = "수와 연산"): DiffStandard => ({
  code,
  statement,
  domainName,
});

describe("statementSimilarity", () => {
  it("동일 문장은 1, 무관한 문장은 0에 가깝다", () => {
    expect(statementSimilarity("소인수분해를 할 수 있다.", "소인수분해를 할 수 있다.")).toBe(1);
    expect(
      statementSimilarity("소인수분해를 할 수 있다.", "산점도를 그릴 수 있다."),
    ).toBeLessThan(0.2);
  });

  it("공백 차이는 유사도에 영향을 주지 않는다", () => {
    expect(
      statementSimilarity("소인수분해를  할 수 있다.", "소인수분해를 할 수 있다."),
    ).toBe(1);
  });
});

describe("diffReleases — 판정 7종", () => {
  it("동일·수정·이동을 코드 일치로 가른다", () => {
    const from = [
      std("9수01-01", "소인수분해의 뜻을 알고, 자연수를 소인수분해 할 수 있다."),
      std("9수01-02", "최대공약수를 구할 수 있다."),
      std("9수02-01", "문자를 사용한 식으로 나타낼 수 있다.", "변화와 관계"),
    ];
    const to = [
      std("9수01-01", "소인수분해의 뜻을 알고, 자연수를 소인수분해 할 수 있다."),
      std("9수01-02", "최대공약수와 최소공배수를 구하고 활용할 수 있다."),
      std("9수02-01", "문자를 사용한 식으로 나타낼 수 있다.", "자료와 가능성"),
    ];
    const diff = diffReleases(from, to);
    expect(diff.unchanged.map((c) => c.code)).toEqual(["9수01-01"]);
    expect(diff.modified.map((c) => c.code)).toEqual(["9수01-02"]);
    expect(diff.moved.map((c) => c.code)).toEqual(["9수02-01"]);
    expect(diff.moved[0]!.statementChanged).toBe(false);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("유사한 짝이 없는 코드는 추가·삭제다", () => {
    const diff = diffReleases(
      [std("9수01-01", "소인수분해의 뜻을 알고 활용할 수 있다.")],
      [std("9수05-01", "산점도를 보고 상관관계를 말할 수 있다.")],
    );
    expect(diff.removed).toEqual(["9수01-01"]);
    expect(diff.added).toEqual(["9수05-01"]);
    expect(diff.recoded).toEqual([]);
  });

  it("재코드 — 문장이 거의 같고 코드만 바뀐 1:1 상호 최선 매칭", () => {
    const diff = diffReleases(
      [
        std("9수01-05", "정수와 유리수의 뜻을 알고 대소 관계를 판단할 수 있다."),
        std("9수01-06", "제곱근의 뜻을 알고 그 성질을 이해한다."),
      ],
      [
        std("9수01-07", "정수와 유리수의 뜻을 알고 대소 관계를 판단할 수 있다."),
        std("9수03-02", "피타고라스 정리를 증명할 수 있다.", "도형과 측정"),
      ],
    );
    expect(diff.recoded).toHaveLength(1);
    expect(diff.recoded[0]).toMatchObject({ fromCode: "9수01-05", toCode: "9수01-07" });
    expect(diff.recoded[0]!.similarity).toBeGreaterThan(0.9);
    // 짝을 못 찾은 나머지는 각각 삭제·추가
    expect(diff.removed).toEqual(["9수01-06"]);
    expect(diff.added).toEqual(["9수03-02"]);
  });

  it("분할 — 옛 기준 하나가 새 기준 여럿과 강하게 닮으면 1→N", () => {
    const diff = diffReleases(
      [
        std(
          "9수02-13",
          "미지수가 2개인 연립일차방정식을 풀 수 있고, 이를 활용하여 문제를 해결할 수 있다.",
        ),
      ],
      [
        std("9수02-14", "미지수가 2개인 연립일차방정식을 풀 수 있다."),
        std("9수02-15", "연립일차방정식을 활용하여 문제를 해결할 수 있다."),
      ],
    );
    expect(diff.split).toHaveLength(1);
    expect(diff.split[0]!.fromCode).toBe("9수02-13");
    expect(diff.split[0]!.toCodes.sort()).toEqual(["9수02-14", "9수02-15"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("통합 — 옛 기준 여럿이 새 기준 하나로 합쳐지면 N→1", () => {
    const diff = diffReleases(
      [
        std("9수01-02", "최대공약수의 성질을 이해하고 이를 구할 수 있다."),
        std("9수01-03", "최소공배수의 성질을 이해하고 이를 구할 수 있다."),
      ],
      [
        std("9수01-09", "최대공약수와 최소공배수의 성질을 이해하고 이를 구할 수 있다."),
      ],
    );
    expect(diff.merged).toHaveLength(1);
    expect(diff.merged[0]!.fromCodes.sort()).toEqual(["9수01-02", "9수01-03"]);
    expect(diff.merged[0]!.toCode).toBe("9수01-09");
  });

  it("결정론 — 같은 입력을 여러 번 넣어도 같은 결과", () => {
    const from = [
      std("A-01", "소인수분해의 뜻을 알고 자연수를 분해할 수 있다."),
      std("A-02", "최대공약수와 최소공배수를 구할 수 있다."),
      std("A-03", "정수와 유리수의 사칙계산을 할 수 있다."),
    ];
    const to = [
      std("B-01", "소인수분해의 뜻을 알고 자연수를 분해할 수 있다."),
      std("B-02", "최대공약수를 구할 수 있다."),
      std("B-03", "최소공배수를 구할 수 있다."),
    ];
    const first = JSON.stringify(diffReleases(from, to));
    for (let i = 0; i < 5; i += 1) {
      expect(JSON.stringify(diffReleases(from, to))).toBe(first);
    }
  });

  it("임계값을 올리면 약한 닮음은 재코드로 잇지 않는다", () => {
    const from = [std("A-01", "일차방정식을 풀 수 있다.")];
    const to = [std("B-01", "일차부등식을 풀 수 있다.")];
    const loose = diffReleases(from, to, { similarityThreshold: 0.3 });
    const strict = diffReleases(from, to, { similarityThreshold: 0.9 });
    expect(loose.recoded).toHaveLength(1);
    expect(strict.recoded).toHaveLength(0);
    expect(strict.removed).toEqual(["A-01"]);
    expect(strict.added).toEqual(["B-01"]);
  });
});

describe("draftMappingMigration — 마이그레이션 초안", () => {
  const mapping = (standardCode: string, internalId: string) => ({
    standardCode,
    internalType: "canonical_concept",
    internalId,
    relationType: "covers",
  });

  it("동일은 carry, 수정·이동·재코드·분할·통합은 전부 검토 대상", () => {
    const from = [
      std("K-01", "소인수분해의 뜻을 알고 자연수를 분해할 수 있다."),
      std("K-02", "일차방정식을 풀고 활용할 수 있다."),
      std(
        "K-03",
        "미지수가 2개인 연립일차방정식을 풀 수 있고, 이를 활용하여 문제를 해결할 수 있다.",
      ),
    ];
    const to = [
      std("K-01", "소인수분해의 뜻을 알고 자연수를 분해할 수 있다."),
      std("K-02", "일차방정식을 풀고 다양한 상황에 활용할 수 있다."),
      std("K-04", "미지수가 2개인 연립일차방정식을 풀 수 있다."),
      std("K-05", "연립일차방정식을 활용하여 문제를 해결할 수 있다."),
    ];
    const diff = diffReleases(from, to);
    const draft = draftMappingMigration(diff, [
      mapping("K-01", "concept-pf"),
      mapping("K-02", "concept-lineq"),
      mapping("K-03", "concept-simeq"),
    ]);

    const carry = draft.filter((d) => d.action === "carry");
    expect(carry).toHaveLength(1);
    expect(carry[0]).toMatchObject({ fromCode: "K-01", toCode: "K-01", internalId: "concept-pf" });

    const review = draft.filter((d) => d.action === "carry_review");
    // 수정 1건 + 분할 1→2 (매핑 1개 × 파생 2) = 3건
    expect(review).toHaveLength(3);
    expect(
      review.filter((d) => d.fromCode === "K-03").map((d) => d.toCode).sort(),
    ).toEqual(["K-04", "K-05"]);

    // 초안에 활성 이관은 없다 — carry조차 저장 시 draft (원칙 13)
    expect(draft.every((d) => d.action !== ("activate" as never))).toBe(true);
  });

  it("대응이 사라지면 폐기 검토, 새 기준은 새 큐레이션 목록", () => {
    const diff = diffReleases(
      [std("K-01", "히스토그램을 그리고 해석할 수 있다.", "자료와 가능성")],
      [std("K-09", "산점도와 상관관계를 이해한다.", "자료와 가능성")],
    );
    const draft = draftMappingMigration(diff, [mapping("K-01", "concept-histogram")]);
    expect(draft.filter((d) => d.action === "retire_review")).toHaveLength(1);
    const curate = draft.filter((d) => d.action === "curate_new");
    expect(curate).toHaveLength(1);
    expect(curate[0]!.toCode).toBe("K-09");
    expect(curate[0]!.internalId).toBeNull();
  });

  it("매핑이 없는 기준의 변화는 초안 행을 만들지 않는다 (추가 제외)", () => {
    const diff = diffReleases(
      [std("K-01", "소인수분해를 할 수 있다.")],
      [std("K-01", "소인수분해를 확실히 할 수 있다.")],
    );
    expect(draftMappingMigration(diff, [])).toEqual([]);
  });
});
