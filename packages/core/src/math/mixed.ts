import { normalizeMixedText } from "./normalize";
import { renderForAuthoring, renderForPublish } from "./render";

/* ─────────────────────────────────────────────────────────────
 * 혼합 텍스트(`한글 본문 + $수식$ + $$블록$$`) 렌더 — 단일 렌더 계약의 일부.
 * 웹 미리보기·학생 응시·인쇄·리포트가 모두 이 함수를 쓴다.
 * ───────────────────────────────────────────────────────────── */

export interface MixedRenderResult {
  html: string;
  /** 게시 모드에서 렌더 실패한 수식 원문 목록 — 비어있지 않으면 게시 불가 */
  failures: string[];
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

/**
 * 혼합 텍스트를 HTML로 렌더.
 * - publish: 수식 실패는 폴백 없이 failures로 보고 (게이트 처리용).
 * - authoring: 실패 수식은 중립 .math-raw로 표시 (저작·검수 화면 전용).
 */
export function renderMixedText(
  content: string,
  mode: "publish" | "authoring",
): MixedRenderResult {
  const { normalized } = normalizeMixedText(content);
  const failures: string[] = [];
  const parts: string[] = [];

  // 블록 수식 먼저, 그다음 인라인 — 구분자 스캔 순서 규칙
  const tokens = normalized.split(/(\$\$[\s\S]*?\$\$)/g);
  for (const token of tokens) {
    if (token.startsWith("$$") && token.endsWith("$$")) {
      parts.push(renderOne(token.slice(2, -2), true, mode, failures));
      continue;
    }
    // 인라인 분해
    const inlineTokens = token.split(/((?<!\$)\$(?!\$)(?:[^$\\]|\\.)*(?<!\$)\$(?!\$))/g);
    for (const inline of inlineTokens) {
      if (
        inline.length > 1 &&
        inline.startsWith("$") &&
        inline.endsWith("$") &&
        !inline.startsWith("$$")
      ) {
        parts.push(renderOne(inline.slice(1, -1), false, mode, failures));
      } else if (inline) {
        parts.push(escapeHtml(inline));
      }
    }
  }

  return { html: parts.join(""), failures };
}

function renderOne(
  latex: string,
  display: boolean,
  mode: "publish" | "authoring",
  failures: string[],
): string {
  if (mode === "authoring") {
    return renderForAuthoring(latex, display);
  }
  const result = renderForPublish(latex, display);
  if (result.ok) return result.html;
  failures.push(latex);
  // 게시 모드 실패 — 자리에 아무것도 넣지 않는다. 호출자는 failures를 보고
  // 게시를 차단해야 한다 (원시 LaTeX·katex-error·빈 수식 노출 금지).
  return "";
}
