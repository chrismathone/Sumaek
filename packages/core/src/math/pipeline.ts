import {
  MACRO_POLICY_VERSION,
  NORMALIZER_VERSION,
} from "./constants";
import { semanticFingerprint } from "./fingerprint";
import {
  normalizeExpression,
  type RepairAction,
  type ReviewFlag,
} from "./normalize";
import { renderForPublish } from "./render";
import { validateExpression, type MathIssue } from "./validate";

/* ─────────────────────────────────────────────────────────────
 * MathContentPipeline — 단일 진입점 (골프롬프트 2P 권장 순서 3~7단계).
 * 원문 보존 → 무손실 정규화 → 구문 검증 → KaTeX 사전 파싱 →
 * 의미 지문 → 렌더 해시 → 게이트 판정.
 * ───────────────────────────────────────────────────────────── */

export type ExpressionParseStatus =
  | "render_validated" // 모든 게이트 통과 — 게시 가능
  | "review_required"; // 격리 — FORMULA_REVIEW_REQUIRED

export interface ProcessedExpression {
  rawSource: string;
  normalizedLatex: string;
  displayMode: "inline" | "display";
  status: ExpressionParseStatus;
  semanticFingerprint: string;
  repairs: RepairAction[];
  reviewFlags: ReviewFlag[];
  issues: MathIssue[];
  renderHash: string | null;
  renderedHtml: string | null;
  versions: {
    normalizer: string;
    macroPolicy: string;
    katex: string;
  };
}

/**
 * 수식 한 건의 전체 처리. 결정론적 — 같은 입력·버전은 같은 결과.
 *
 * 게이트 실패 조건 (하나라도 있으면 review_required):
 * - 검수 필요 플래그 존재 (빈 분수, ≈, 수식 내 한글 등 — 의미 변경 위험)
 * - 구조 오류 (중괄호·환경 불균형, 허용 밖 명령, 파싱 실패)
 * - 게시 렌더 실패 또는 katex-error 노드
 */
export function processExpression(
  rawSource: string,
  displayMode: "inline" | "display",
): ProcessedExpression {
  const norm = normalizeExpression(rawSource);
  const validation = validateExpression(norm.normalized, displayMode === "display");

  let renderHash: string | null = null;
  let renderedHtml: string | null = null;
  const issues: MathIssue[] = [...validation.issues];

  if (validation.ok) {
    const rendered = renderForPublish(norm.normalized, displayMode === "display");
    if (rendered.ok) {
      renderHash = rendered.renderHash;
      renderedHtml = rendered.html;
    } else {
      issues.push({ code: "KATEX_PARSE_ERROR", message: rendered.error });
    }
  }

  const passed =
    issues.length === 0 && norm.reviewFlags.length === 0 && renderHash !== null;

  return {
    rawSource,
    normalizedLatex: norm.normalized,
    displayMode,
    status: passed ? "render_validated" : "review_required",
    semanticFingerprint: semanticFingerprint(norm.normalized),
    repairs: norm.repairs,
    reviewFlags: norm.reviewFlags,
    issues,
    renderHash,
    renderedHtml,
    versions: {
      normalizer: NORMALIZER_VERSION,
      macroPolicy: MACRO_POLICY_VERSION,
      katex: validation.katexVersion,
    },
  };
}
