import { z } from "zod";
import {
  collectReadingContent,
  readingBlock,
  readingContent,
} from "@su-maek/contracts/content";
import { processExpression, renderMixedText } from "@su-maek/core/math";

/* ─────────────────────────────────────────────────────────────
 * 정제 — 추출본(지면 사본)을 수맥의 표현·구조로 다시 쓰는 층.
 * (설계: docs/refine-design.md · 계약: contracts/src/content/reading.ts)
 *
 * AI는 초안만 쓴다. 이 파일은 그 초안을 믿지 않기 위한 부분이다:
 * 프롬프트(무엇을 시키는가)와 게이트(무엇을 통과시키는가)를 한곳에 둔다.
 *
 * 재서술의 위험 둘 — **지어내기**와 **베끼기** — 에 각각 검사를 세우고,
 * 결과를 refineReport로 남긴다. 경고는 게시를 막지 않지만 검수 화면에
 * 반드시 뜬다. 유출(워터마크·출판사명)만 자동 차단이다 — 검수자가 놓치면
 * 학생 화면에 나가기 때문이다.
 * ───────────────────────────────────────────────────────────── */

/** 결과가 이상하면 어느 프롬프트가 만들었는지 되짚는 열쇠 (macro-policy와 같은 정신) */
export const REFINE_PROMPT_VERSION = "refine/1.0.0";

/** 학생에게 보이는 고지 — draft는 학생에게 안 보이므로 이 문장은 항상 참이다 */
export const REFINE_DISCLOSURE =
  "AI가 교재 내용을 바탕으로 다시 쓴 설명입니다. 선생님 검수를 거쳐 게시됩니다.";

/**
 * 모델이 채워야 하는 출력 계약 — 블록 어휘는 contracts가 진실이다.
 *
 * 모든 제약이 JSON Schema로 표현 가능해야 한다(.refine 금지) — 도구
 * 스키마와 파서가 **같은 계약**이어야 모델이 통과 못 할 것을 만들지
 * 않는다 (적대 검토 D12: 스키마상 합법인데 파서가 거부하는 130자 제목).
 */
export const refineOutput = z.object({
  /** 다듬은 제목 — 원제를 베끼지 말고 새로. 제목은 평문으로 그려지므로 $ 금지 */
  title: z.string().min(1).max(120).regex(/^[^$]*$/, "제목에는 수식($)을 넣지 않는다"),
  blocks: z.array(readingBlock).min(1),
});
export type RefineOutput = z.infer<typeof refineOutput>;

/* ── 본문 걷기 — 계약(contracts)의 수집기를 그대로 쓴다.
 * 게시 검사(web)와 게이트가 같은 수집기를 봐야 서로 어긋나지 않는다. */

interface Collected {
  texts: string[];
  latexes: string[];
}

export function collectBody(body: unknown): Collected {
  const c = collectReadingContent(body);
  return { texts: c.texts, latexes: [...c.inlineLatex, ...c.displayLatex] };
}

/* ── 검사 1: 지어내기 (원본에 없는 수치) ─────────────────────── */

function numbersIn(collected: Collected): Set<string> {
  const all = [...collected.texts, ...collected.latexes].join(" ");
  const found = all.match(/\d+(?:\.\d+)?/g) ?? [];
  return new Set(found);
}

/**
 * 집합 비교다 — 한계를 안다: 부호 뒤집힘·자리 뒤바꿈(2^10→10^2)·개수는
 * 못 잡는다. 허용 목록은 없다 — 처음엔 0~3을 봐줬는데, 중학 수학에서
 * 가장 자주 지어내는 값이 바로 그 범위였다("답은 3입니다"가 프리패스,
 * 적대 검토 D9). 경고는 차단이 아니므로 소음보다 재현율을 택한다.
 */
export function findFabricatedNumbers(
  sourceBody: unknown,
  refinedBody: unknown,
): string[] {
  const source = numbersIn(collectBody(sourceBody));
  const refined = numbersIn(collectBody(refinedBody));
  return [...refined].filter((n) => !source.has(n));
}

/* ── 검사 2: 베끼기 (원문과 연속 일치) ────────────────────────
 * 텍스트만 본다 — 수식은 오히려 지면과 같아야 한다. 정의·기호처럼 달리
 * 쓸 수 없는 문구가 있으므로 **경고이지 차단이 아니다.** */

const MIN_COPY_LEN = 15;

const squeeze = (s: string): string => s.replace(/\s+/g, " ").trim();

export function findCopiedSpans(
  sourceBody: unknown,
  refinedBody: unknown,
  minLen = MIN_COPY_LEN,
): string[] {
  const source = squeeze(collectBody(sourceBody).texts.join(" "));
  const refined = squeeze(collectBody(refinedBody).texts.join(" "));
  const found: string[] = [];
  let i = 0;
  while (i + minLen <= refined.length) {
    if (!source.includes(refined.slice(i, i + minLen))) {
      i += 1;
      continue;
    }
    let end = i + minLen;
    while (end < refined.length && source.includes(refined.slice(i, end + 1)))
      end += 1;
    const span = refined.slice(i, end);
    /* 수 목록의 쉼표 텍스트런(", , , ,")처럼 글자 없는 일치는 베낀 것이
     * 아니라 조판의 그림자다 — 낱말이 있어야 표절 후보다. */
    if (/[가-힣A-Za-z]/.test(span)) found.push(span);
    i = end;
  }
  return found;
}

/* ── 검사 3: 유출 (워터마크·교재 식별) — 유일한 자동 차단 ────── */

/**
 * 구매자 워터마크 — 프로파일의 purchaserStamp와 같은 꼴 (이메일 + 아이디
 * 단독). 대소문자·구분자 변형(`ST2000423`, `st-2000423`)까지 잡는다 —
 * 정제 단계에는 추출 단계의 span 폐기 같은 별도 방어가 없다.
 */
const WATERMARK = /[\w.+-]+@[\w-]+\.[\w.-]+|\bst[\s-]?\d{6,}\b/i;

/**
 * 유출 검사가 보는 문자열 변형들.
 *
 * 렌더러는 런을 **붙여서** 그린다(runsToMixed의 join("")) — 검사가 띄어서
 * 보면 런 경계에 걸친 워터마크(`buyer@` + `school.kr`)가 빠져나간다
 * (적대 검토 실증). 그래서 붙인 판과, LaTeX 명령·중괄호를 벗긴 판
 * (`\text{개념}\text{원리}` → 개념원리)까지 함께 본다.
 */
function leakVariants(parts: string[]): string[] {
  const spaced = parts.join(" ");
  const glued = parts.join("");
  const noSpace = glued.replace(/\s+/g, "");
  const stripped = glued.replace(/\\[a-zA-Z]+|[{}]/g, "").replace(/\s+/g, "");
  return [spaced, noSpace, stripped];
}

/** 차단 사유에 워터마크 원문을 싣지 않는다 — 로그도 유출 경로다 */
const mask = (s: string): string => `${s.slice(0, 2)}…(${s.length}자)`;

export function findLeaks(
  refinedBody: unknown,
  refinedTitle: string,
  leakNames: string[],
): string[] {
  const c = collectBody(refinedBody);
  const variants = leakVariants([refinedTitle, ...c.texts, ...c.latexes]);
  const leaks: string[] = [];
  for (const v of variants) {
    const watermark = v.match(WATERMARK);
    if (watermark) {
      leaks.push(`구매자 워터마크 감지: ${mask(watermark[0])}`);
      break;
    }
  }
  for (const name of leakNames) {
    if (!name) continue;
    /* 법인 접두·공백을 누르고 대소문자를 접어 비교 — 「(주)비상교육」 vs
     * 「비상교육」, 「VISANG」 vs 「Visang」. 띄어 쓴 자연어(「개념 원리」)가
     * 거짓 양성이 될 수 있지만, 차단은 건너뛰기일 뿐이고 사유가 그대로
     * 보이므로 사람이 고쳐 다시 돌리면 된다 — 유출이 새는 쪽보다 낫다. */
    const target = name
      .replace(/^\(주\)|^㈜|^주식회사\s*/, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    const nameLower = name.toLowerCase();
    if (
      variants.some((v) => {
        const lower = v.toLowerCase();
        return lower.includes(nameLower) || lower.includes(target);
      })
    ) {
      leaks.push(`교재 식별 노출: ${name}`);
    }
  }
  return leaks;
}

/* ── 게이트 묶음 ─────────────────────────────────────────────── */

export interface RefineWarning {
  kind: "fabricated_number" | "copied_span";
  detail: string;
}

export interface RefineCheck {
  /** 있으면 이 초안은 저장하지 않는다 */
  blockers: string[];
  /** 저장은 하되 검수 화면에 띄운다 */
  warnings: RefineWarning[];
  /** 렌더 안 되는 수식 — 모델에 되돌려 한 번 고치게 한다 */
  renderFailures: string[];
}

export function checkRefined(input: {
  sourceBody: unknown;
  refined: RefineOutput;
  /** 본문에 나타나면 안 되는 교재 식별 문자열 (출판사·교재명·판) */
  leakNames: string[];
  /**
   * 교사용 여백 주석 — 프롬프트에 참고로 들어가므로 **베끼기 대조에도
   * 넣어야 한다.** 안 넣으면 지도 문구 전사가 구조적으로 안 잡힌다
   * (적대 검토 실증: 주석은 sourceBody 밖에 있다).
   */
  teacherNotes?: string[];
}): RefineCheck {
  const { sourceBody, refined, leakNames, teacherNotes } = input;

  /* ── 렌더 게이트: **화면과 같은 경로**(renderMixedText publish)로만
   * 판정한다. processExpression의 status를 쓰면 안 된다 — 그것은 문항
   * 검수 플래그(수식 내 한글, ≈ 등)까지 묶어서, 한국어 개념 설명의
   * `\text{배}` 같은 정상 수식을 "렌더 실패"로 오판하고, display 전용
   * 환경(align)을 inline으로 검사해 반려한다 (적대 검토 D2·D3 실증). */
  const c = collectReadingContent(refined.blocks);
  const renderFailures: string[] = [];
  for (const latex of c.inlineLatex)
    renderFailures.push(...renderMixedText(`$${latex}$`, "publish").failures);
  for (const latex of c.displayLatex)
    renderFailures.push(...renderMixedText(`$$${latex}$$`, "publish").failures);
  /* text 필드 속 `$…$`도 화면에서는 수식으로 실행된다. 홀수 $는 산문을
   * 수식으로 삼켜 버리므로(토크나이저가 다음 $와 짝짓는다) 그 자체로
   * 실패다. */
  for (const text of [refined.title, ...c.texts]) {
    const dollars = (text.match(/\$/g) ?? []).length;
    if (dollars % 2 === 1) {
      renderFailures.push(`홀수 $ (수식 경계 깨짐): "${text.slice(0, 40)}"`);
      continue;
    }
    if (dollars > 0) renderFailures.push(...renderMixedText(text, "publish").failures);
  }

  const copySource =
    teacherNotes && teacherNotes.length > 0
      ? [
          ...(Array.isArray(sourceBody) ? sourceBody : [sourceBody]),
          { type: "text", text: teacherNotes.join("\n") },
        ]
      : sourceBody;
  /* 제목도 지어내기·베끼기 검사 대상이다 — 검사 안 하면 "2의 10제곱은
   * 1024" 같은 제목이 무사통과한다 (적대 검토 D10). */
  const refinedWithTitle = [
    { type: "text", text: refined.title },
    ...refined.blocks,
  ];

  const warnings: RefineWarning[] = [];
  const fabricated = findFabricatedNumbers(sourceBody, refinedWithTitle);
  if (fabricated.length > 0) {
    warnings.push({
      kind: "fabricated_number",
      detail: `원본에 없는 수: ${fabricated.join(", ")} — 지면과 대조할 것`,
    });
  }
  for (const span of findCopiedSpans(copySource, refinedWithTitle)) {
    warnings.push({
      kind: "copied_span",
      detail: `"${span.length > 60 ? `${span.slice(0, 60)}…` : span}"`,
    });
  }

  return {
    blockers: findLeaks(refined.blocks, refined.title, leakNames),
    warnings,
    renderFailures,
  };
}

/**
 * 저장 직전 정규화 — **게이트가 검사한 것과 같은 형태를 저장한다.**
 *
 * processExpression은 정규화(L02: `sqrt{`→`\sqrt{` 복구 등) **후**
 * 검증하는데, 원본 초안을 그대로 저장하면 화면 렌더(정규화 없음)는
 * 다른 것을 그린다 — `sqrt{2}`가 게이트를 통과하고 학생은 이탤릭
 * "sqrt2"를 본다 (적대 검토 실증). 초안은 지면 원문이 아니라 모델
 * 산출물이므로 고쳐 저장해도 불변 원칙에 어긋나지 않는다.
 */
export function normalizeRefinedBlocks(blocks: ReadingContentLike): unknown {
  const clone = JSON.parse(JSON.stringify(blocks)) as unknown;
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const o = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(o)) {
      if (key === "latex" && typeof value === "string") {
        o[key] = processExpression(value, "inline").normalizedLatex;
      } else {
        walk(value);
      }
    }
  };
  walk(clone);
  return clone;
}

type ReadingContentLike = z.infer<typeof readingContent>;

/* ── 프롬프트 ────────────────────────────────────────────────── */

export interface RefinePromptInput {
  conceptName: string;
  sourceTitle: string;
  /** 추출본 본문을 `$…$` 혼합 텍스트로 편 것 */
  sourceText: string;
  subsection: string | null;
  teacherNotes: string[];
}

export function buildRefineSystemPrompt(): string {
  return [
    "너는 수맥(중학 수학 학습 서비스)의 개념 설명 집필자다. 교재 지면에서",
    "추출한 개념 설명(추출본)을 바탕으로, 중학생이 화면에서 읽을 개념",
    "설명을 **다시 쓴다**. 목적은 복제가 아니라 재서술이다 — 뜻은 지면과",
    "같게, 표현과 짜임은 새로.",
    "",
    "규칙 — 어길 경우 산출물이 기계 게이트에서 걸러진다:",
    "1. 원문 문장을 그대로 옮기지 않는다. 뜻을 이해하고 우리말로 다시 쓴다.",
    "   (정의의 핵심 용어·기호는 당연히 같아도 된다.)",
    "2. **원본에 없는 수·예시·사실을 만들지 않는다.** 숫자는 추출본에 있는",
    "   것만 쓴다. 새 예시가 필요해 보여도 만들지 않는다 — 그것은 검수자의",
    "   일이다.",
    "3. 수식은 KaTeX가 그릴 수 있는 LaTeX로. \\cancel은 쓰지 않는다 —",
    "   표에서 지워진 셀은 math_table의 emphasis:\"struck\"으로 나타낸다.",
    "4. 존댓말 평서문(~입니다)으로, 중학교 1학년이 읽는다고 생각하고 쓴다.",
    "5. 교사 주석(있다면)은 무엇을 강조할지 참고만 하고 본문에 옮기지 않는다.",
    "6. 교재명·출판사명·이메일·아이디 같은 출처 식별 정보를 절대 쓰지 않는다.",
    "7. 마커 문자(❶, ⑴, ①, ▶ 등)를 텍스트에 넣지 않는다 — 순서와 위계는",
    "   블록 구조(steps·heading)가 대신한다.",
    "8. 블록은 뜻에 맞게 고른다: definition(용어의 정의), key_point(꼭",
    "   기억할 정리), callout(tone: example 예 / note 참고 / caution 주의 /",
    "   supplement 보충), steps(순서 있는 절차), math_table(표),",
    "   display_math(강조할 수식 한 줄), paragraph(흐름 문장),",
    "   heading(소제목). 문단 안 줄바꿈은 {\"kind\":\"text\",\"text\":\"\\n\"} 런.",
    "   공약수로 나누는 세로셈은 math_table에 variant:\"division\"을 쓴다 —",
    "   나누는 수를 각 행 첫 칸에, 마지막 몫 행의 첫 칸은 kind:\"empty\".",
    "9. 제목도 새로 짓는다 — 원제를 그대로 쓰지 않는다.",
    "",
    "submit_reading 도구로만 답한다.",
  ].join("\n");
}

export function buildRefineUserPrompt(input: RefinePromptInput): string {
  const parts = [
    `## 개념: ${input.conceptName}`,
    input.subsection ? `소단원: ${input.subsection}` : null,
    `추출본 제목(원제 — 그대로 쓰지 말 것): ${input.sourceTitle}`,
    "",
    "## 추출본 본문 (지면 사본 — 이 내용만 근거로 쓴다)",
    input.sourceText,
  ];
  if (input.teacherNotes.length > 0) {
    parts.push(
      "",
      "## 교사용 여백 주석 (강조점 참고용 — 본문에 옮기지 말 것)",
      ...input.teacherNotes.map((n) => `- ${n.replace(/\n/g, " / ")}`),
    );
  }
  return parts.filter((p): p is string => p !== null).join("\n");
}

/** 추출본 블록 → 모델에게 보여 줄 혼합 텍스트 (CLI·프롬프트 공용) */
export function bodyToMixedText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return (body as Record<string, unknown>[])
    .map((block) => {
      if (block.type === "text") return String(block.text ?? "");
      if (block.type === "paragraph" && Array.isArray(block.runs)) {
        return (block.runs as { kind?: string; text?: string; math?: { latex?: string } }[])
          .map((r) => (r.kind === "math" ? `$${r.math?.latex ?? ""}$` : (r.text ?? "")))
          .join("");
      }
      return "";
    })
    .filter((t) => t !== "")
    .join("\n\n");
}
