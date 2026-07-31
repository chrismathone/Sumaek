import katex from "katex";
import { ALLOWED_COMMANDS, MATH_LIMITS } from "./constants";

/* ─────────────────────────────────────────────────────────────
 * 수식 구조·구문 검증 (골프롬프트 2P·2Q 게시 전 게이트).
 * throwOnError: false를 믿지 않는다 — 파싱 오류를 명시적으로 수집한다.
 * ───────────────────────────────────────────────────────────── */

export type MathIssueCode =
  | "INPUT_TOO_LONG"
  | "UNBALANCED_BRACES"
  | "UNBALANCED_ENV"
  | "UNCLOSED_DELIMITER"
  | "UNSUPPORTED_COMMAND"
  | "KATEX_PARSE_ERROR"
  | "NESTING_TOO_DEEP";

export interface MathIssue {
  code: MathIssueCode;
  message: string;
  index?: number;
  command?: string;
}

export interface MathValidationReport {
  ok: boolean;
  issues: MathIssue[];
  unsupportedCommands: string[];
  katexVersion: string;
}

/** `{}` 균형 검사 — `\{` `\}` escape는 리터럴 */
export function checkBraceBalance(s: string): MathIssue | null {
  let depth = 0;
  let maxDepth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    } else if (c === "}") {
      depth--;
      if (depth < 0) {
        return {
          code: "UNBALANCED_BRACES",
          message: `닫는 중괄호가 여는 것보다 많습니다 (위치 ${i})`,
          index: i,
        };
      }
    }
  }
  if (depth !== 0) {
    return {
      code: "UNBALANCED_BRACES",
      message: `닫히지 않은 중괄호 ${depth}개`,
    };
  }
  if (maxDepth > MATH_LIMITS.maxNestingDepth) {
    return {
      code: "NESTING_TOO_DEEP",
      message: `중첩 깊이 ${maxDepth} > 한도 ${MATH_LIMITS.maxNestingDepth}`,
    };
  }
  return null;
}

/** `\begin{env}` / `\end{env}` 스택 검사 */
export function checkEnvBalance(s: string): MathIssue | null {
  const stack: string[] = [];
  const re = /\\(begin|end)\{([a-zA-Z*]+)\}/g;
  for (const m of s.matchAll(re)) {
    const [, kind, env] = m;
    if (kind === "begin") {
      stack.push(env as string);
    } else {
      const open = stack.pop();
      if (open !== env) {
        return {
          code: "UNBALANCED_ENV",
          message: `\\end{${env}}가 \\begin{${open ?? "?"}}와 맞지 않습니다`,
          index: m.index,
        };
      }
    }
  }
  if (stack.length > 0) {
    return {
      code: "UNBALANCED_ENV",
      message: `닫히지 않은 환경: ${stack.join(", ")}`,
    };
  }
  return null;
}

/** 혼합 텍스트의 `$` 구분자 짝 검사 (미닫힌 구분자 0건 게이트) */
export function checkDollarBalance(mixed: string): MathIssue | null {
  // $$ 블록 먼저 제거 후 남은 단독 $ 개수 확인
  const withoutBlocks = mixed.replace(/\$\$[\s\S]*?\$\$/g, "");
  let count = 0;
  for (let i = 0; i < withoutBlocks.length; i++) {
    if (withoutBlocks[i] === "\\") {
      i++;
      continue;
    }
    if (withoutBlocks[i] === "$") count++;
  }
  if (count % 2 !== 0) {
    return {
      code: "UNCLOSED_DELIMITER",
      message: "미닫힌 $ 수식 구분자가 있습니다",
    };
  }
  // 홀수 $$ 검사
  const blockCount = (mixed.match(/\$\$/g) ?? []).length;
  if (blockCount % 2 !== 0) {
    return {
      code: "UNCLOSED_DELIMITER",
      message: "미닫힌 $$ 수식 구분자가 있습니다",
    };
  }
  return null;
}

/** 허용 목록 밖 명령 추출 — 조용히 삭제하지 않고 보고한다 (2O) */
export function findUnsupportedCommands(latex: string): string[] {
  const found = new Set<string>();
  for (const m of latex.matchAll(/\\([a-zA-Z]+)/g)) {
    const cmd = m[1] as string;
    if (!ALLOWED_COMMANDS.has(cmd)) found.add(cmd);
  }
  return [...found].sort();
}

/**
 * KaTeX 서버 사전 파싱 — 게시 경로 표준.
 * trust는 기본 차단, `\htmlClass`만 허용 (기하 호 표기 전용).
 */
export function katexParse(
  latex: string,
  displayMode: boolean,
): MathIssue | null {
  try {
    katex.renderToString(latex, {
      throwOnError: true,
      strict: "ignore",
      output: "htmlAndMathml",
      displayMode,
      maxExpand: MATH_LIMITS.maxExpandMacros,
      trust: (ctx) => ctx.command === "\\htmlClass",
    });
    return null;
  } catch (error) {
    return {
      code: "KATEX_PARSE_ERROR",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 단일 수식의 전체 검증 (정규화 이후 normalized_latex 대상) */
export function validateExpression(
  normalizedLatex: string,
  displayMode: boolean,
): MathValidationReport {
  const issues: MathIssue[] = [];

  if (normalizedLatex.length > MATH_LIMITS.maxInputLength) {
    issues.push({
      code: "INPUT_TOO_LONG",
      message: `입력 길이 ${normalizedLatex.length} > 한도 ${MATH_LIMITS.maxInputLength}`,
    });
  }

  const brace = checkBraceBalance(normalizedLatex);
  if (brace) issues.push(brace);
  const env = checkEnvBalance(normalizedLatex);
  if (env) issues.push(env);

  const unsupported = findUnsupportedCommands(normalizedLatex);
  for (const cmd of unsupported) {
    issues.push({
      code: "UNSUPPORTED_COMMAND",
      message: `허용 목록에 없는 명령: \\${cmd}`,
      command: cmd,
    });
  }

  // 구조 검사를 통과했을 때만 KaTeX 파싱 시도 (에러 메시지 노이즈 방지)
  if (issues.length === 0) {
    const parse = katexParse(normalizedLatex, displayMode);
    if (parse) issues.push(parse);
  }

  return {
    ok: issues.length === 0,
    issues,
    unsupportedCommands: unsupported,
    katexVersion: (katex as unknown as { version?: string }).version ?? "unknown",
  };
}
