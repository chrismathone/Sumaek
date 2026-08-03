import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * 정렬 제안 — 미정렬 문항에 canonical 개념 후보를 잇는 층.
 * (설계: docs/align-suggest-design.md · 사람 표: profiles/rpm-2022-concepts.ts)
 *
 * 사람 매핑 표의 원칙은 그대로다: **추측으로 붙이지 않는다.** 표에 없는
 * 문항은 개념 없이 남고, 검수자가 지정한다. 이 층은 그 원칙을 깨는 것이
 * 아니라 검수자의 대기열을 채운다 — 제안은 provenance='ai_suggested'로
 * 저장되고, 숙련도·출제·학생 화면은 그 행을 읽지 않는다. 승인(사람)만이
 * 'human'으로 바꾼다.
 *
 * AI를 믿지 않기 위한 부분이 이 파일이다 (refine.ts와 같은 정신):
 *  - 후보 목록 밖의 slug는 **지어낸 개념**이다 — 그 제안은 통째로 버린다.
 *  - 맞는 개념이 없으면 abstain — 억지로 가장 비슷한 것에 붙이지 않는다.
 *    abstain한 문항은 행이 없으므로 다음 실행에서 다시 대상이 된다
 *    (개념이 새로 정의되면 자연히 재시도된다).
 * ───────────────────────────────────────────────────────────── */

/** 결과가 이상하면 어느 프롬프트가 만들었는지 되짚는 열쇠 */
export const ALIGN_PROMPT_VERSION = "align/1.0.0";

/**
 * 모델이 채워야 하는 출력 계약. 모든 제약이 JSON Schema로 표현 가능해야
 * 한다(.refine 금지) — 도구 스키마와 파서가 같은 계약이어야 모델이
 * 통과 못 할 것을 만들지 않는다. 교차 필드 제약(가중치 합, 후보 소속)은
 * checkAlignment가 본다.
 */
export const alignOutput = z.object({
  /** align — 아래 alignments로 잇는다 · abstain — 맞는 후보가 없다 */
  decision: z.enum(["align", "abstain"]),
  alignments: z
    .array(
      z.object({
        /** 후보 목록에 있는 개념 slug만 — 목록 밖이면 게이트가 버린다 */
        slug: z.string().min(1),
        /** 숙련도 증거 배분 가중치 — 전체 합이 1이어야 한다 */
        weight: z.number().gt(0).max(1),
        /** 이 연결에 대한 확신 0~1 — 검수자 정렬 순서에 쓰인다 */
        confidence: z.number().min(0).max(1),
        /** 발문의 어느 표현이 이 개념을 가리키는지 한 문장 */
        rationale: z.string().min(1).max(300),
      }),
    )
    .max(4)
    /* abstain 초안은 이 필드를 생략한다 — io:"input" 도구 스키마에서
     * optional이 되고, 생략하면 파서가 빈 배열을 채운다 (refine 규약). */
    .default([]),
  /** abstain일 때만 — 왜 맞는 후보가 없는지 */
  abstainReason: z.string().max(300).optional(),
});
export type AlignOutput = z.infer<typeof alignOutput>;

export interface ConceptCandidate {
  slug: string;
  name: string;
  description: string | null;
  gradeBand: string | null;
  domainName: string | null;
}

/* ── 게이트 — 계약 parse 이후의 교차 필드 검사 ─────────────────
 * 실패는 저장하지 않는다. API 경로에서는 사유를 모델에 되돌려 재시도한다. */

export function checkAlignment(
  output: AlignOutput,
  candidates: ConceptCandidate[],
): string[] {
  const problems: string[] = [];
  const known = new Set(candidates.map((c) => c.slug));

  if (output.decision === "abstain") {
    if (output.alignments.length > 0)
      problems.push("abstain인데 alignments가 비어 있지 않다 — 하나만 골라라");
    return problems;
  }

  if (output.alignments.length === 0) {
    problems.push("align인데 alignments가 비었다 — 잇거나 abstain하라");
    return problems;
  }

  const seen = new Set<string>();
  for (const a of output.alignments) {
    /* 후보 밖 slug는 오타가 아니라 지어낸 개념으로 취급한다 — 가장
     * 비슷한 후보로 바꿔 주는 건 이 게이트가 막으려는 바로 그 추측이다. */
    if (!known.has(a.slug)) problems.push(`후보 목록에 없는 slug: ${a.slug}`);
    if (seen.has(a.slug)) problems.push(`중복 slug: ${a.slug}`);
    seen.add(a.slug);
  }

  const sum = output.alignments.reduce((acc, a) => acc + a.weight, 0);
  /* 사람 표와 같은 규약: 합 1 (3분할은 0.34+0.33+0.33). 부동소수 여유만 준다. */
  if (sum < 0.99 || sum > 1.01)
    problems.push(`가중치 합이 1이 아니다: ${sum.toFixed(3)}`);

  return problems;
}

/* ── 문항 본문 → 모델에게 보여 줄 혼합 텍스트 ─────────────────
 * 구조화 블록(paragraph·condition_box·choice_group)을 `$…$` 평문으로 편다.
 * 검수자용이 아니라 프롬프트용이다 — 화면 렌더와 같을 필요는 없지만,
 * 조건 상자와 선택지가 발문과 구분돼 보여야 근거를 잡을 수 있다. */

interface RunLike {
  kind?: string;
  text?: string;
  math?: { latex?: string };
}

function runsToMixed(runs: unknown): string {
  if (!Array.isArray(runs)) return "";
  return (runs as RunLike[])
    .map((r) => (r.kind === "math" ? `$${r.math?.latex ?? ""}$` : (r.text ?? "")))
    .join("");
}

const CHOICE_MARKERS = "①②③④⑤⑥⑦⑧";

export function questionBodyToMixedText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  const parts: string[] = [];
  for (const block of body as Record<string, unknown>[]) {
    if (block.type === "paragraph") {
      const text = runsToMixed(block.runs);
      if (text.trim() !== "") parts.push(text);
      continue;
    }
    if (block.type === "condition_box" && Array.isArray(block.items)) {
      const label = typeof block.label === "string" ? block.label : "조건";
      const items = (block.items as { marker?: string; content?: unknown }[])
        .map((i) => `  ${i.marker ?? "-"} ${runsToMixed(i.content)}`)
        .join("\n");
      parts.push(`[${label}]\n${items}`);
      continue;
    }
    if (block.type === "choice_group" && Array.isArray(block.choices)) {
      const choices = [...(block.choices as { order?: number; content?: unknown }[])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(
          (c, i) =>
            `${CHOICE_MARKERS[(c.order ?? i + 1) - 1] ?? `(${c.order})`} ${runsToMixed(c.content)}`,
        )
        .join("  ");
      parts.push(choices);
    }
  }
  return parts.join("\n");
}

/* ── 프롬프트 ────────────────────────────────────────────────── */

export interface AlignPromptInput {
  /** source_ref에서 읽은 교재 계층 — 유형 머리글이 가장 강한 근거다 */
  chapter: string | null;
  unit: string | null;
  section: string | null;
  typeTitle: string | null;
  kind: string;
  bodyText: string;
  candidates: ConceptCandidate[];
}

export function buildAlignSystemPrompt(): string {
  return [
    "너는 수맥(중학 수학 학습 서비스)의 문항-개념 정렬 검토 보조다. 문항",
    "하나를 읽고, 주어진 후보 개념 목록에서 이 문항이 실제로 요구하는",
    "개념을 고른다. 네 제안은 provenance='ai_suggested'로 저장되고 교사",
    "검수 전에는 숙련도·출제 어디에도 쓰이지 않는다.",
    "",
    "규칙 — 어길 경우 산출물이 기계 게이트에서 걸러진다:",
    "1. **후보 목록에 있는 slug만 쓴다.** 목록에 없는 개념을 만들지 않는다.",
    "2. **맞는 후보가 없으면 abstain한다.** 가장 비슷한 것에 억지로 붙이는",
    "   것이 최악이다 — 틀린 정렬은 숙련도 추정을 조용히 틀어뜨린다.",
    "   문항이 다루는 단원의 개념이 목록에 아직 없으면 반드시 abstain.",
    "3. 개념 하나가 핵심이면 그 하나에 weight 1. 문항이 실제로 여러 개념을",
    "   함께 요구할 때만 나눈다 — 합은 정확히 1 (예: 0.5+0.5, 0.34+0.33+0.33).",
    "4. 유형 머리글이 있으면 그것이 1차 근거다. 발문·조건·선택지로 확인한다.",
    "5. confidence는 이 연결에 대한 확신이다. 유형 머리글과 발문이 모두",
    "   가리키면 높게, 발문만으로 추정했으면 낮게.",
    "6. rationale에는 발문의 어느 표현이 근거인지 짧게 쓴다.",
    "",
    "submit_alignment 도구로만 답한다.",
  ].join("\n");
}

export function buildAlignUserPrompt(input: AlignPromptInput): string {
  const context = [
    input.chapter ? `대단원: ${input.chapter}` : null,
    input.unit ? `중단원: ${input.unit}` : null,
    input.section ? `구역: ${input.section}` : null,
    input.typeTitle ? `유형 머리글: ${input.typeTitle}` : null,
    `문항 종류: ${input.kind}`,
  ].filter((p): p is string => p !== null);

  const candidates = input.candidates.map(
    (c) =>
      `- ${c.slug} — ${c.name}` +
      (c.gradeBand ? ` (${c.gradeBand}${c.domainName ? ` · ${c.domainName}` : ""})` : "") +
      (c.description ? `: ${c.description}` : ""),
  );

  return [
    "## 문항 맥락",
    ...context,
    "",
    "## 문항 본문",
    input.bodyText,
    "",
    "## 후보 개념 (이 목록에 있는 slug만 쓸 수 있다)",
    ...candidates,
  ].join("\n");
}

/** DB numeric(4,3) 규약 — 저장 직전 반올림. 표기가 달라지면 멱등 비교가 흔들린다. */
export const toNumeric3 = (n: number): string => n.toFixed(3);
