import { describe, expect, it } from "vitest";
import {
  CallTimeoutError,
  CircuitOpenError,
} from "../../src/ai/circuit-breaker";
import {
  AiProviderUnavailableError,
  DEFAULT_MOCK_MODEL,
  MockAiProvider,
  createAiProviderForModel,
  type AiProvider,
  type ExtractedQuestion,
  type ExtractionResult,
} from "../../src/ai/provider";
import {
  runShadowExtraction,
  scoreExtractionAgreement,
} from "../../src/ai/shadow";

/* ─────────────────────────────────────────────────────────────
 * 섀도 평가 (인수 36).
 *
 * 검증하는 주장 셋:
 *   1. 카나리 실패는 던지지 않는다 — 사용자 경로에 닿을 수 없다.
 *   2. 카나리 산출물은 반환값에 담기지 않는다.
 *   3. 일치도는 실제로 차이를 잡는다 (정답·본문·유형·문항 수).
 * ───────────────────────────────────────────────────────────── */

const INPUT = { fileName: "a.pdf", checksum: "abc", pageCount: 2 };

function question(
  overrides: Partial<ExtractedQuestion> = {},
): ExtractedQuestion {
  return {
    printedNumber: "1",
    kind: "short_answer",
    bodyText: "$2x = 4$",
    proposedAnswer: "2",
    confidence: 0.9,
    conceptAliases: [],
    ...overrides,
  };
}

function result(questions: ExtractedQuestion[], model = "m"): ExtractionResult {
  return {
    provider: "mock",
    model,
    promptVersion: "v1",
    pages: 2,
    questions,
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

describe("scoreExtractionAgreement", () => {
  it("완전히 같으면 1", () => {
    const a = result([question(), question({ printedNumber: "2" })]);
    expect(scoreExtractionAgreement(a, a).score).toBe(1);
  });

  it("정답만 다르면 0.5만큼 깎인다 (가장 무거운 항목)", () => {
    const base = result([question()]);
    const canary = result([question({ proposedAnswer: "3" })]);
    const breakdown = scoreExtractionAgreement(base, canary);
    expect(breakdown.score).toBeCloseTo(0.5, 5);
    expect(breakdown.answerMismatches).toBe(1);
    expect(breakdown.bodyMismatches).toBe(0);
  });

  it("본문만 다르면 0.3만큼 깎인다", () => {
    const base = result([question()]);
    const canary = result([question({ bodyText: "$2x = 5$" })]);
    const breakdown = scoreExtractionAgreement(base, canary);
    expect(breakdown.score).toBeCloseTo(0.7, 5);
    expect(breakdown.bodyMismatches).toBe(1);
  });

  it("문항 유형만 다르면 0.2만큼 깎인다", () => {
    const base = result([question()]);
    const canary = result([question({ kind: "multiple_choice" })]);
    const breakdown = scoreExtractionAgreement(base, canary);
    expect(breakdown.score).toBeCloseTo(0.8, 5);
    expect(breakdown.kindMismatches).toBe(1);
  });

  it("카나리가 문항을 놓치면 빈 자리가 0점으로 잡힌다", () => {
    const base = result([question(), question({ printedNumber: "2" })]);
    const canary = result([question()]);
    const breakdown = scoreExtractionAgreement(base, canary);
    expect(breakdown.missingSlots).toBe(1);
    expect(breakdown.baselineQuestions).toBe(2);
    expect(breakdown.canaryQuestions).toBe(1);
    expect(breakdown.score).toBeCloseTo(0.5, 5); // 1점 + 0점 / 2자리
  });

  it("카나리가 문항을 더 만들어도 깎인다", () => {
    const base = result([question()]);
    const canary = result([question(), question({ printedNumber: "2" })]);
    expect(scoreExtractionAgreement(base, canary).score).toBeCloseTo(0.5, 5);
  });

  it("양쪽 다 0문항이면 이견이 없다", () => {
    expect(scoreExtractionAgreement(result([]), result([])).score).toBe(1);
  });
});

/** 지정한 오류를 던지는 공급자 */
function throwingProvider(error: unknown): AiProvider {
  return {
    name: "mock",
    extractQuestions: () => Promise.reject(error),
  };
}

describe("runShadowExtraction — 카나리는 사용자에게 닿을 수 없다", () => {
  it("성공하면 일치도·토큰·지연을 관측으로 돌려준다", async () => {
    const baseline = result([question()]);
    const canary = new MockAiProvider({ model: "mock-extractor-v2" });
    const clock = [1_000, 1_120];
    const observation = await runShadowExtraction({
      baseline,
      canary,
      canaryModel: "mock-extractor-v2",
      input: INPUT,
      now: () => clock.shift() ?? 1_120,
    });
    expect(observation.ok).toBe(true);
    expect(observation.errorKind).toBeNull();
    expect(observation.latencyMs).toBe(120);
    expect(observation.agreement).not.toBeNull();
    expect(observation.inputTokens).toBeGreaterThan(0);
  });

  it("카나리가 장애로 죽어도 던지지 않는다", async () => {
    const observation = await runShadowExtraction({
      baseline: result([question()]),
      canary: throwingProvider(new AiProviderUnavailableError("mock")),
      canaryModel: "v2",
      input: INPUT,
    });
    expect(observation.ok).toBe(false);
    expect(observation.errorKind).toBe("unavailable");
    expect(observation.agreement).toBeNull();
  });

  it("회로가 열려 있으면 circuit_open으로 기록된다", async () => {
    const observation = await runShadowExtraction({
      baseline: result([question()]),
      canary: throwingProvider(new CircuitOpenError("mock", 30_000)),
      canaryModel: "v2",
      input: INPUT,
    });
    expect(observation.ok).toBe(false);
    expect(observation.errorKind).toBe("circuit_open");
  });

  it("시간 초과는 timeout으로 기록된다", async () => {
    const observation = await runShadowExtraction({
      baseline: result([question()]),
      canary: throwingProvider(new CallTimeoutError("mock", 30_000)),
      canaryModel: "v2",
      input: INPUT,
    });
    expect(observation.errorKind).toBe("timeout");
  });

  it("예상 못 한 오류도 삼켜서 other로 기록한다", async () => {
    const observation = await runShadowExtraction({
      baseline: result([question()]),
      canary: throwingProvider(new TypeError("응답 파싱 실패")),
      canaryModel: "v2",
      input: INPUT,
    });
    expect(observation.ok).toBe(false);
    expect(observation.errorKind).toBe("other");
    expect(observation.errorMessage).toContain("응답 파싱 실패");
  });

  it("관측에는 카나리 산출물이 없다 — 저장할 방법 자체를 없앴다", async () => {
    // 카나리가 기준선과 전혀 다른 문항을 냈는데도, 관측에는 문항이 담기지
    // 않는다. 호출자가 실수로라도 카나리 결과를 저장할 수 없다.
    const alien = result([question({ bodyText: "카나리만의 문항", proposedAnswer: "999" })]);
    const observation = await runShadowExtraction({
      baseline: result([question()]),
      canary: { name: "mock", extractQuestions: async () => alien },
      canaryModel: "v2",
      input: INPUT,
    });
    expect(observation.ok).toBe(true);
    expect(JSON.stringify(observation)).not.toContain("카나리만의 문항");
    expect(JSON.stringify(observation)).not.toContain("999");
  });
});

describe("createAiProviderForModel — 모델 버전 고정", () => {
  it("기본 모델의 추출은 예전과 같다 (기존 골든·픽스처 보호)", async () => {
    const legacy = await new MockAiProvider().extractQuestions(INPUT);
    const explicit = await new MockAiProvider({
      model: DEFAULT_MOCK_MODEL,
    }).extractQuestions(INPUT);
    expect(explicit).toEqual(legacy);
    expect(legacy.model).toBe(DEFAULT_MOCK_MODEL);
  });

  it("다른 모델은 다른(그러나 결정론적인) 결과를 낸다", async () => {
    const v2 = createAiProviderForModel("mock", "mock-extractor-v2");
    const once = await v2.extractQuestions(INPUT);
    const twice = await v2.extractQuestions(INPUT);
    expect(twice).toEqual(once); // 결정론
    expect(once.model).toBe("mock-extractor-v2");

    // 모델이 다르면 어딘가는 달라야 섀도 일치도가 의미를 갖는다.
    const checksums = ["abc", "def", "ghi", "jkl", "mno"];
    const differs = await Promise.all(
      checksums.map(async (checksum) => {
        const base = await new MockAiProvider().extractQuestions({
          ...INPUT,
          checksum,
        });
        const other = await v2.extractQuestions({ ...INPUT, checksum });
        return (
          scoreExtractionAgreement(base, other).score < 1
        );
      }),
    );
    expect(differs.some(Boolean)).toBe(true);
  });

  it("알 수 없는 공급자는 조용히 기본값으로 떨어지지 않고 던진다", () => {
    // 오타 난 공급자로 실사용 트래픽이 다른 모델에 흘러가는 것이
    // 카나리가 막으려는 바로 그 사고다.
    expect(() => createAiProviderForModel("typo-vendor", "x")).toThrow(
      /알 수 없는 AI 공급자/,
    );
  });
});
