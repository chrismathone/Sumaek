import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * 읽기 자료(learning_materials.body) 블록 어휘 — 정제 시스템의 계약
 * (docs/refine-design.md 결정 2)
 *
 * 문항 블록(./index.ts)과 별도 union인 이유:
 *
 * 1. **자료 수식은 `{ latex }`만 요구한다.** 문항의 mathRef는
 *    expressionId(math_expressions 행)가 필수다 — 채점·동치검사의 키이기
 *    때문이다. 자료 수식은 그 대상이 아니고, 이미 반입된 자료도 latex만
 *    담고 있다. 계약이 현실을 뒤늦게 위반으로 만들면 안 된다.
 * 2. **문항 union은 불변이어야 한다.** question_versions.body의 계약에
 *    읽기 전용 블록을 섞으면 "문항에 정의 카드가 올 수 있다"가 계약이 된다.
 *
 * 표시 문자를 저장하지 않는다(2P의 정신): ❶·②·— 같은 마커는 렌더러가
 * 붙인다. steps는 순서만 알고, callout은 tone만 안다.
 * ───────────────────────────────────────────────────────────── */

/** 자료 수식 — expressionId는 있으면 좋고 없어도 된다 */
export const materialMath = z.object({
  expressionId: z.uuid().optional(),
  latex: z.string().min(1),
});

/** 혼합 인라인 런 — 자료 전용 (수식이 latex-only). 빈 텍스트 런은 막는다 —
 *  조용한 빈칸이 곧 조용한 누락이다 (줄바꿈 런 "\n"은 통과한다). */
export const materialRun = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1) }),
  z.object({ kind: z.literal("math"), math: materialMath }),
]);

/* ── 기존 반입 본문과의 하위 호환 (text · paragraph) ─────────── */

export const readingTextBlock = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const readingParagraphBlock = z.object({
  type: z.literal("paragraph"),
  runs: z.array(materialRun),
});

/* ── 정제본이 쓰는 구조 블록 ─────────────────────────────────── */

/** 본문 소제목 — ⑴⑵⑶ 묶음의 머리. level은 화면 위계(h3·h4에 대응) */
export const readingHeadingBlock = z.object({
  type: z.literal("heading"),
  level: z.union([z.literal(2), z.literal(3)]),
  runs: z.array(materialRun).min(1),
});

/** 용어 정의 카드 — term이 눈에 띄고, content가 정의문 */
export const readingDefinitionBlock = z.object({
  type: z.literal("definition"),
  term: z.string().min(1),
  content: z.array(materialRun).min(1),
});

/** 핵심 정리 박스 — 개념서의 색 박스 자리. 항목 하나가 런 배열 하나 */
export const readingKeyPointBlock = z.object({
  type: z.literal("key_point"),
  title: z.string().optional(),
  items: z.array(z.array(materialRun).min(1)).min(1),
});

/** 순서 있는 단계 — 번호 글리프(❶)는 저장하지 않는다. 렌더러가 붙인다 */
export const readingStepsBlock = z.object({
  type: z.literal("steps"),
  title: z.string().optional(),
  items: z.array(z.object({ content: z.array(materialRun).min(1) })).min(1),
});

export const readingDisplayMathBlock = z.object({
  type: z.literal("display_math"),
  math: materialMath,
});

/**
 * 표 — 문항 math_table과 같은 뼈대에 `emphasis`가 더해진다.
 * 에라토스테네스의 체는 `\cancel` LaTeX가 아니라 **지워진 셀**(struck)로
 * 저장하고, 사선은 CSS가 긋는다. 데이터는 뜻만 안다.
 *
 * 셀은 kind별 union이다 — `{kind:"math"}`에 math가 없거나 `{kind:"empty"}`에
 * text가 실리는 것을 계약이 막는다(적대 검토 D6: 조용한 빈칸·유령 값).
 */
const tableCellCommon = {
  isHeader: z.boolean().default(false),
  emphasis: z.enum(["bold", "struck"]).optional(),
  colspan: z.number().int().min(1).max(12).default(1),
  rowspan: z.number().int().min(1).max(12).default(1),
};

export const readingTableCell = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1), ...tableCellCommon }),
  z.object({ kind: z.literal("math"), math: materialMath, ...tableCellCommon }),
  z.object({ kind: z.literal("empty"), ...tableCellCommon }),
]);

export const readingMathTableBlock = z.object({
  type: z.literal("math_table"),
  rows: z.array(z.array(readingTableCell).min(1)).min(1),
  caption: z.string().optional(),
  /**
   * 표의 뜻: grid(격자 표 — 곱셈표·체)와 division(공약수로 나누는 세로셈).
   * 세로셈을 격자로 그리면 계산이 아니라 자료 표로 읽힌다 — 지면의 세로셈은
   * 나누는 수 오른쪽 세로줄과 단계 사이 가로줄뿐이다. 데이터는 뜻만 알고,
   * 선은 렌더러가 긋는다.
   */
  variant: z.enum(["grid", "division"]).default("grid"),
});

/**
 * 예·참고·주의·보충 콜아웃. content는 중첩 1단만 — 콜아웃 속 콜아웃은
 * 계약이 막는다 (지면에도 없고, 렌더러가 감당할 이유도 없다).
 */
export const readingCalloutBlock = z.object({
  type: z.literal("callout"),
  tone: z.enum(["example", "note", "caution", "supplement"]),
  /** 톤 기본 라벨(예·참고·주의·보충)을 덮을 때만 */
  label: z.string().optional(),
  content: z
    .array(
      z.discriminatedUnion("type", [
        readingParagraphBlock,
        readingDisplayMathBlock,
        readingMathTableBlock,
      ]),
    )
    .min(1),
});

/** 원본 이미지 크롭 — 자산 파이프라인이 생기면 쓴다 (문항 쪽과 같은 꼴) */
export const readingImageBlock = z.object({
  type: z.literal("image_crop"),
  assetId: z.uuid(),
  altText: z.string(),
});

export const readingBlock = z.discriminatedUnion("type", [
  readingTextBlock,
  readingParagraphBlock,
  readingHeadingBlock,
  readingDefinitionBlock,
  readingKeyPointBlock,
  readingStepsBlock,
  readingDisplayMathBlock,
  readingMathTableBlock,
  readingCalloutBlock,
  readingImageBlock,
]);

export const readingContent = z.array(readingBlock);

export type MaterialMath = z.infer<typeof materialMath>;
export type MaterialRun = z.infer<typeof materialRun>;
export type ReadingBlock = z.infer<typeof readingBlock>;
export type ReadingContent = z.infer<typeof readingContent>;

/**
 * 본문 걷기 — 게이트(ingest)와 게시 검사(web)가 **같은 수집기**를 쓴다.
 * 필드 이름으로 걷는다: 어휘에 블록이 늘어도 검사가 소리 없이 구멍 나지
 * 않는다 (text·latex 필드명은 계약의 일부). display_math의 latex만
 * display로 분리한다 — 검사는 화면과 같은 모드로 렌더해야 한다.
 */
export interface CollectedReading {
  /** text·term·title·caption·label·altText 문자열 전부 */
  texts: string[];
  inlineLatex: string[];
  displayLatex: string[];
}

const TEXT_KEYS = new Set(["text", "term", "title", "caption", "label", "altText"]);

function collectInto(node: unknown, out: CollectedReading): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectInto(item, out);
    return;
  }
  const o = node as Record<string, unknown>;
  const isDisplay = o.type === "display_math";
  for (const [key, value] of Object.entries(o)) {
    if (typeof value === "string") {
      if (TEXT_KEYS.has(key)) out.texts.push(value);
      continue;
    }
    if (key === "math" && value !== null && typeof value === "object") {
      const latex = (value as { latex?: unknown }).latex;
      if (typeof latex === "string")
        (isDisplay ? out.displayLatex : out.inlineLatex).push(latex);
      continue;
    }
    collectInto(value, out);
  }
}

export function collectReadingContent(body: unknown): CollectedReading {
  const out: CollectedReading = { texts: [], inlineLatex: [], displayLatex: [] };
  collectInto(body, out);
  return out;
}

/** 구조 블록이 하나라도 있으면 참 — 평문 편집을 잠그는 기준 (결정 5) */
export function hasStructuredBlocks(body: unknown): boolean {
  if (!Array.isArray(body)) return false;
  return body.some(
    (b) =>
      typeof b === "object" &&
      b !== null &&
      "type" in b &&
      (b as { type?: unknown }).type !== "text" &&
      (b as { type?: unknown }).type !== "paragraph",
  );
}
