import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * 구조화 수학 콘텐츠 블록 (골프롬프트 2O)
 *
 * LaTeX 문자열·Markdown·렌더된 HTML을 콘텐츠의 유일한 진실로 삼지 않는다.
 * 문제·해설·선택지는 순서가 있는 구조화 블록으로 저장한다.
 * 이 스키마는 question_versions.body / explanation의 계약이다.
 * ───────────────────────────────────────────────────────────── */

/** 수식 참조 — 실제 수식 데이터는 math_expressions 테이블의 행 */
export const mathRef = z.object({
  /** math_expressions.id — 웹·PDF·HWP 산출물에서 유지되는 expression_id */
  expressionId: z.uuid(),
  /** 렌더 폴백 방지를 위해 정규화 LaTeX를 인라인 캐시 (원본은 DB가 진실) */
  latex: z.string(),
});

export const textBlock = z.object({
  type: z.literal("text"),
  /** 평문 — 수식은 절대 이 안에 넣지 않는다 (inline_math 블록 사용) */
  text: z.string(),
});

export const inlineMathBlock = z.object({
  type: z.literal("inline_math"),
  math: mathRef,
});

export const displayMathBlock = z.object({
  type: z.literal("display_math"),
  math: mathRef,
});

/**
 * 혼합 인라인 런 — 한글 문장과 인라인 수식이 섞인 한 단락.
 * 한글·수식 경계를 파서 추측이 아니라 구조로 보존한다.
 */
export const paragraphBlock = z.object({
  type: z.literal("paragraph"),
  runs: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({ kind: z.literal("math"), math: mathRef }),
    ]),
  ),
});

/** 선택지 — 표시 문자 ①이 아니라 불변 ID와 순서 (2P) */
export const choiceGroupBlock = z.object({
  type: z.literal("choice_group"),
  choices: z.array(
    z.object({
      /** 불변 선택지 ID — 채점은 이 ID로만 */
      choiceId: z.string(),
      order: z.number().int().min(1),
      content: z.array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("text"), text: z.string() }),
          z.object({ kind: z.literal("math"), math: mathRef }),
        ]),
      ),
      /** 다행 수식 포함 여부 — 세로 배치 결정 입력 (cases/matrix/aligned) */
      hasTallMath: z.boolean().default(false),
    }),
  ),
  /**
   * 배치: auto는 실제 렌더 폭·높이로 열 수 결정.
   * 다행 수식이 있으면 가로 다단 금지 → 한 열 (2P).
   */
  layout: z.enum(["auto", "single_column", "two_column", "inline"]).default("auto"),
});

/** <조건>·<보기> 박스 — 정규식 추측이 아니라 구조화 (2P) */
export const conditionBoxBlock = z.object({
  type: z.literal("condition_box"),
  label: z.string(), // 조건 | 보기 | 규칙 …
  items: z.array(
    z.object({
      marker: z.string().optional(), // ㄱ, ㄴ, (가), (나) …
      content: z.array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("text"), text: z.string() }),
          z.object({ kind: z.literal("math"), math: mathRef }),
        ]),
      ),
    }),
  ),
});

/** 표 — 셀 타입 구분, 원시 HTML 문자열 저장 금지 (2P) */
export const mathTableBlock = z.object({
  type: z.literal("math_table"),
  /** 행 → 셀. 병합은 rowspan/colspan으로 보존 */
  rows: z.array(
    z.array(
      z.object({
        kind: z.enum(["text", "math", "image", "empty"]),
        text: z.string().optional(),
        math: mathRef.optional(),
        assetId: z.uuid().optional(),
        isHeader: z.boolean().default(false),
        rowspan: z.number().int().min(1).default(1),
        colspan: z.number().int().min(1).default(1),
      }),
    ),
  ),
  caption: z.string().optional(),
  /** 접근성 설명과 읽기 순서 */
  a11ySummary: z.string().optional(),
});

/** 도형 — diagram_assets 참조 */
export const diagramBlock = z.object({
  type: z.literal("diagram"),
  diagramAssetId: z.uuid(),
  altText: z.string(),
  caption: z.string().optional(),
});

/** 원본 이미지 크롭 폴백 — 해상도·출처 좌표·대체 텍스트 유지 */
export const imageCropBlock = z.object({
  type: z.literal("image_crop"),
  assetId: z.uuid(),
  altText: z.string(),
  sourceCoords: z
    .object({
      page: z.number().int(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

/** 풀이 단계 (해설·완성 예제) */
export const workedStepBlock = z.object({
  type: z.literal("worked_step"),
  stepNumber: z.number().int().min(1),
  content: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({ kind: z.literal("math"), math: mathRef }),
    ]),
  ),
  /** 루브릭 채점 시 이 단계의 배점 근거 */
  rubricKey: z.string().optional(),
});

/** 답 기입란 (단답·다중 빈칸) */
export const answerBlankBlock = z.object({
  type: z.literal("answer_blank"),
  blankId: z.string(),
  /** 기대 답 형식: number | fraction | expression | text */
  expectedFormat: z.enum(["number", "fraction", "expression", "text"]),
  unit: z.string().optional(),
});

/** 인쇄 분할 허용 지점 힌트 (2P PDF·인쇄) */
export const pageBreakHintBlock = z.object({
  type: z.literal("page_break_hint"),
  allowBreak: z.boolean(),
});

export const structuredContentBlock = z.discriminatedUnion("type", [
  textBlock,
  paragraphBlock,
  inlineMathBlock,
  displayMathBlock,
  choiceGroupBlock,
  conditionBoxBlock,
  mathTableBlock,
  diagramBlock,
  imageCropBlock,
  workedStepBlock,
  answerBlankBlock,
  pageBreakHintBlock,
]);

export const structuredContent = z.array(structuredContentBlock);

export type MathRef = z.infer<typeof mathRef>;
export type StructuredContentBlock = z.infer<typeof structuredContentBlock>;
export type StructuredContent = z.infer<typeof structuredContent>;

/* ── 정답 계약 (2N 채점과 증거) ─────────────────────────────── */

/** 단답 정답 — 수치·분수·동치식·단위·조건을 분리해 정규화 */
export const shortAnswerKey = z.object({
  kind: z.literal("short_answer"),
  accepted: z.array(
    z.object({
      /** 정규화된 기준 표현 */
      value: z.string(),
      form: z.enum(["number", "fraction", "decimal", "expression", "text"]),
      unit: z.string().optional(),
      /** 동치 검사 허용 여부와 안전 범위 가정 */
      allowEquivalence: z.boolean().default(false),
      equivalenceAssumptions: z.string().optional(),
    }),
  ),
  /** 정의역·분기로 모호하면 자동 확정 금지 → 예외함 */
  ambiguityNote: z.string().optional(),
});

export const multipleChoiceKey = z.object({
  kind: z.literal("multiple_choice"),
  /** 정답 선택지 ID (복수 정답 가능) */
  correctChoiceIds: z.array(z.string()).min(1),
});

export const multiBlankKey = z.object({
  kind: z.literal("multi_blank"),
  blanks: z.array(
    z.object({
      blankId: z.string(),
      key: shortAnswerKey.omit({ kind: true }),
      points: z.number().nonnegative(),
    }),
  ),
});

export const essayKey = z.object({
  kind: z.literal("essay"),
  /** 핵심 단계·추론·표현 루브릭 (문자열 유사도 채점 금지) */
  rubric: z.array(
    z.object({
      rubricKey: z.string(),
      description: z.string(),
      points: z.number().nonnegative(),
      /** 필수 단계 여부 */
      required: z.boolean().default(false),
    }),
  ),
});

export const answerKey = z.discriminatedUnion("kind", [
  shortAnswerKey,
  multipleChoiceKey,
  multiBlankKey,
  essayKey,
]);

export type AnswerKey = z.infer<typeof answerKey>;

/* ── 학생 답안 계약 ─────────────────────────────────────────── */

export const studentAnswer = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("multiple_choice"),
    selectedChoiceIds: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("short_answer"),
    /** 정규화 전 원문 그대로 보존 */
    rawText: z.string(),
  }),
  z.object({
    kind: z.literal("multi_blank"),
    blanks: z.array(z.object({ blankId: z.string(), rawText: z.string() })),
  }),
  z.object({
    kind: z.literal("essay"),
    text: z.string(),
    /** 손글씨 이미지 등 첨부 자산 */
    assetIds: z.array(z.uuid()).default([]),
  }),
]);

export type StudentAnswer = z.infer<typeof studentAnswer>;
