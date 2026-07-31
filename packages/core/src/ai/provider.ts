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
export class MockAiProvider implements AiProvider {
  readonly name = "mock";

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
    const rand = createSeededRandom(`mock-extract:${input.checksum}`);
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
      model: "mock-extractor-v1",
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

/** 공급자 선택 — AI_PROVIDER 환경변수. anthropic 구현은 후속 교체 지점. */
export function createAiProvider(name: string | undefined): AiProvider {
  switch (name) {
    case "anthropic":
      throw new Error(
        "anthropic 공급자는 ANTHROPIC_API_KEY 설정 후 구현을 연결하세요 (현재 mock만 활성).",
      );
    case "mock":
    case undefined:
    default:
      return new MockAiProvider();
  }
}
