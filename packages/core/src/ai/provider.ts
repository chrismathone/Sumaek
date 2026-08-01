/* ─────────────────────────────────────────────────────────────
 * AI 공급자 추상화 (ADR-0010 · 사용자 합의: 목 어댑터 우선).
 *
 * - 구조화 스키마 출력만 허용 (27장 — AI는 제한된 구조화 스키마만 출력).
 * - OCR 텍스트의 지시문은 데이터로만 처리 — 호출자는 결과를 서버 검증
 *   (수식 게이트·허용 목록)에 통과시킨 뒤에만 저장한다.
 * - AI_PROVIDER=mock 이면 결정론적 목 구현 — 키 없이 전체 파이프라인이
 *   동작하고, anthropic으로 바꾸면 실제 호출로 교체된다.
 * ───────────────────────────────────────────────────────────── */

import { createSeededRandom } from "../shared/deterministic";

export interface ExtractedQuestion {
  /** 인쇄 문항 번호 (원본 기준) */
  printedNumber: string;
  kind: "multiple_choice" | "short_answer";
  /** 혼합 텍스트 (한글 + $수식$) — 저장 전 정규화·게이트 필수 */
  bodyText: string;
  choices?: Array<{ label: string; text: string }>;
  /** AI가 제안한 정답 — 독립 검증 전에는 초안일 뿐 */
  proposedAnswer: string;
  /** 0~1 — 낮으면 사람 검수 필수 */
  confidence: number;
  /** 개념 별칭 제안 (SourceAlias 경유로만 canonical 연결) */
  conceptAliases: string[];
}

export interface ExtractionResult {
  provider: string;
  model: string;
  promptVersion: string;
  pages: number;
  questions: ExtractedQuestion[];
  /** 토큰 사용량 — 비용 집계·한도(인수 37)의 입력. 목도 실제 형태로 채운다 */
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  readonly name: string;
  /** 원본 파일에서 문항 추출 (OCR·구조화). checksum은 멱등성·재현 키 */
  extractQuestions(input: {
    fileName: string;
    checksum: string;
    pageCount: number;
  }): Promise<ExtractionResult>;
}

/**
 * 결정론적 목 공급자 — 같은 checksum은 항상 같은 추출 결과.
 * 실제 수학 문항 픽스처 풀에서 시드 기반으로 선택하며, 일부 문항에는
 * 실전에서 발생하는 손상(JSON escape·낮은 신뢰도)을 재현해
 * 검수 격리 경로가 실제로 작동함을 보여준다.
 */
export const DEFAULT_MOCK_MODEL = "mock-extractor-v1";

export class MockAiProvider implements AiProvider {
  readonly name = "mock";
  /** 보고할 모델 이름 — 모델 레지스트리(인수 36)가 버전을 지정한다 */
  readonly model: string;

  constructor(options: { model?: string } = {}) {
    this.model = options.model ?? DEFAULT_MOCK_MODEL;
  }

  private static FIXTURES: Array<Omit<ExtractedQuestion, "printedNumber">> = [
    {
      kind: "short_answer",
      bodyText: "일차방정식 $2x + 5 = 13$ 의 해를 구하시오.",
      proposedAnswer: "4",
      confidence: 0.97,
      conceptAliases: ["일차방정식"],
    },
    {
      kind: "multiple_choice",
      bodyText: "연립방정식 $\\begin{cases} x+2y=7 \\\\ 2x-y=4 \\end{cases}$ 의 해는?",
      choices: [
        { label: "①", text: "$x=3, y=2$" },
        { label: "②", text: "$x=2, y=3$" },
        { label: "③", text: "$x=1, y=3$" },
        { label: "④", text: "$x=3, y=1$" },
      ],
      proposedAnswer: "①",
      confidence: 0.93,
      conceptAliases: ["연립방정식", "가감법"],
    },
    {
      kind: "short_answer",
      // JSON escape 손상 재현 — \f 가 form feed 로 깨진 상태 (정규화가 복구)
      bodyText: "두 수의 곱이 $12$이고 합이 $7$일 때, 두 수 중 큰 수를 구하시오. (\frac{1}{2}점 감점 없음)",
      proposedAnswer: "4",
      confidence: 0.88,
      conceptAliases: ["연립방정식의 활용"],
    },
    {
      kind: "short_answer",
      bodyText: "부등식 $3x - 2 > 7$ 을 만족하는 가장 작은 정수 $x$를 구하시오.",
      proposedAnswer: "4",
      confidence: 0.95,
      conceptAliases: ["일차부등식"],
    },
    {
      kind: "short_answer",
      // 낮은 신뢰도 재현 — 사람 검수 필수 경로
      bodyText: "그래프에서 직선의 기울기를 구하시오. $\\frac{\\Delta y}{\\Delta x}$",
      proposedAnswer: "2/3",
      confidence: 0.41,
      conceptAliases: ["일차함수"],
    },
  ];

  async extractQuestions(input: {
    fileName: string;
    checksum: string;
    pageCount: number;
  }): Promise<ExtractionResult> {
    /* 시드에 모델 이름을 섞는다 — 다른 모델 버전은 다른(그러나 여전히
     * 결정론적인) 추출을 내놓아야 섀도 일치도가 의미를 갖는다.
     * 기본 모델만은 예전 시드를 그대로 쓴다: 기존 골든·픽스처가 이
     * 문자열에 매여 있어 바꾸면 무관한 테스트가 무너진다. */
    const seed =
      this.model === DEFAULT_MOCK_MODEL
        ? `mock-extract:${input.checksum}`
        : `mock-extract:${this.model}:${input.checksum}`;
    const rand = createSeededRandom(seed);
    // 파일당 3~5문항 — 결정론적
    const count = 3 + Math.floor(rand() * 3);
    const questions: ExtractedQuestion[] = [];
    for (let i = 0; i < count; i++) {
      const fixture =
        MockAiProvider.FIXTURES[
          Math.floor(rand() * MockAiProvider.FIXTURES.length)
        ]!;
      questions.push({ ...fixture, printedNumber: String(i + 1) });
    }
    return {
      provider: this.name,
      model: this.model,
      promptVersion: "mock/1.0.0",
      pages: input.pageCount,
      questions,
      // 실측 근사: 페이지당 이미지 토큰 + 문항당 구조화 출력 (결정론적)
      usage: {
        inputTokens: input.pageCount * 1_600,
        outputTokens: questions.length * 350,
      },
    };
  }
}

/** 공급자가 응답하지 못함 — 회로 차단기가 실패로 세는 종류의 오류 */
export class AiProviderUnavailableError extends Error {
  constructor(readonly providerName: string) {
    super(`AI 공급자 응답 실패: ${providerName}`);
    this.name = "AiProviderUnavailableError";
  }
}

/** createAiProvider가 인식하는 테스트·실연 전용 공급자 이름 */
export const FAILING_PROVIDER_NAME = "mock-failing";

/**
 * createAiProviderForModel가 인식하는 테스트·실연 전용 **모델** 이름.
 *
 * 공급자 이름이 아니라 모델 이름인 이유: 섀도 평가는 카나리가 배포 공급자와
 * 같은 공급자일 것을 요구한다(model-registry.selectModels). 그래서 "실사용은
 * 멀쩡한데 카나리만 죽는" 상황을 실연하려면 실패가 모델 축에 있어야 한다.
 *
 * FAILING_PROVIDER_NAME과 같은 규율로 다룬다 — 프로덕션은 이 모델을
 * 레지스트리에 등록하지 않으며, 등록하지 않는 한 도달하지 않는다.
 */
export const FAILING_MODEL_NAME = "mock-failing-v0";

/**
 * 실패를 주입하는 공급자 — 테스트·실연 전용.
 *
 * MockAiProvider는 절대 실패하지 않는다. 그래서 회로 차단(인수 23)과
 * 실패 시 파일 uploaded 복귀는 "코드에 있다"는 것 말고는 실연할 수단이
 * 없었다. 이 공급자는 지정한 횟수만큼 실패한 뒤 목 구현에 위임한다 —
 * 기본은 무한 실패(항상 장애), failures를 주면 그만큼만 실패하고 복구한다.
 *
 * 프로덕션 경로는 이 이름을 쓰지 않는다: AI_PROVIDER를 명시적으로
 * mock-failing 으로 설정했을 때만 선택되고, 기본값은 그대로 mock이다.
 */
export class FailingAiProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  /** 실제로 공급자 본체에 도달한 호출 수 — 회로가 열린 뒤 빠른 실패 검증용 */
  calls = 0;
  private remainingFailures: number;
  private readonly delegate: MockAiProvider;

  constructor(
    options: { name?: string; model?: string; failures?: number } = {},
  ) {
    this.name = options.name ?? FAILING_PROVIDER_NAME;
    this.model = options.model ?? FAILING_MODEL_NAME;
    this.remainingFailures = options.failures ?? Number.POSITIVE_INFINITY;
    this.delegate = new MockAiProvider({ model: this.model });
  }

  async extractQuestions(input: {
    fileName: string;
    checksum: string;
    pageCount: number;
  }): Promise<ExtractionResult> {
    this.calls += 1;
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new AiProviderUnavailableError(this.name);
    }
    // 복구 후 회계도 이 공급자 이름으로 남아야 한다 (비용 집계는 provider 키 기준)
    const result = await this.delegate.extractQuestions(input);
    return { ...result, provider: this.name };
  }
}

/** 공급자 선택 — AI_PROVIDER 환경변수. anthropic 구현은 후속 교체 지점. */
export function createAiProvider(name: string | undefined): AiProvider {
  switch (name) {
    case "anthropic":
      throw new Error(
        "anthropic 공급자는 ANTHROPIC_API_KEY 설정 후 구현을 연결하세요 (현재 mock만 활성).",
      );
    case FAILING_PROVIDER_NAME:
      return new FailingAiProvider();
    case "mock":
    case undefined:
    default:
      return new MockAiProvider();
  }
}

/** 배포가 실제로 쓰는 공급자 이름 — 레지스트리 행이 이것과 다르면 쓰지 않는다 */
export function deployedProviderName(): string {
  return process.env.AI_PROVIDER ?? "mock";
}

/**
 * 공급자 + **모델 버전** 지정 생성 (인수 36).
 *
 * createAiProvider가 배포 설정(AI_PROVIDER)으로 공급자를 고르는 반면,
 * 이 함수는 모델 레지스트리가 지정한 버전까지 고정한다. 알 수 없는 조합은
 * 조용히 기본값으로 떨어지지 않고 던진다 — 오타 난 모델 이름으로 실사용
 * 트래픽이 다른 모델에 흘러가는 것이 카나리가 막으려는 바로 그 사고다.
 */
export function createAiProviderForModel(
  provider: string,
  model: string,
): AiProvider {
  if (model === FAILING_MODEL_NAME) {
    // 실연·테스트 전용 (FAILING_MODEL_NAME 주석 참고).
    return new FailingAiProvider({ name: provider, model });
  }
  switch (provider) {
    case "anthropic":
      throw new Error(
        "anthropic 공급자는 ANTHROPIC_API_KEY 설정 후 구현을 연결하세요 (현재 mock만 활성).",
      );
    case FAILING_PROVIDER_NAME:
      // 이 공급자 계열은 모델과 무관하게 항상 실패한다 (실연 전용).
      return new FailingAiProvider({ name: provider, model });
    case "mock":
      return new MockAiProvider({ model });
    default:
      throw new Error(`알 수 없는 AI 공급자입니다: ${provider}`);
  }
}
