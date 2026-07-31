#!/usr/bin/env node
/**
 * 제품 경계 회귀 검사 (골프롬프트 31장 시나리오 62).
 * 라우트·내비게이션·API·DB 스키마·랜딩 카피에서 수납·상담·전자출결·차량·급여·CRM
 * 모듈이나 "올인원 학원 관리" 류 문구가 발견되면 빌드를 실패시킨다.
 *
 * 사용: node scripts/boundary-check.mjs  (CI와 pnpm build 전에 실행)
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

// 검사 대상: 제품 표면 (스키마, 라우트, 내비, 카피)
const SCAN_DIRS = [
  "packages/db/src/schema",
  "packages/db/migrations",
  "packages/contracts/src",
  "apps/web/src",
  "apps/worker/src",
];

// 금지 스키마·모듈 식별자 (2장 24절 금지 필드 목록)
const FORBIDDEN_IDENTIFIERS = [
  /\bpayment[s]?\b/i,
  /\binvoice[s]?\b/i,
  /\btuition\b/i,
  /\battendance_ledger\b/i,
  /\bguardian_contact[s]?\b/i,
  /\bcounseling_log[s]?\b/i,
  /\bvehicle_route[s]?\b/i,
  /\bpayroll\b/i,
  /\bsales_lead[s]?\b/i,
  /\bcrm\b/i,
];

// 금지 카피 (1A장 — 랜딩·내비 문구)
const FORBIDDEN_COPY = [
  "학원 운영을 한 번에",
  "매출·상담·출결 통합",
  "올인원 학원 관리",
  "수납 관리",
  "전자출결",
  "등하원 알림",
  "셔틀버스",
];

// 허용 컨텍스트: 경계를 "금지"로 언급하는 파일 자체는 제외
const ALLOWLIST_FILES = new Set([
  "scripts/boundary-check.mjs".split("/").join(sep),
]);
const ALLOW_MARKER = "boundary-allow:"; // 주석으로 정당한 예외를 표시 (예: 거부 테스트)

const EXTENSIONS = new Set([".ts", ".tsx", ".sql", ".mjs", ".json", ".md"]);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      yield* walk(full);
    } else if (EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      yield full;
    }
  }
}

/**
 * 검사 의도: 금지 "기능이 존재"하는 것을 잡는다.
 * 경계 자체를 서술하는 문구("전자출결 기능이 아니다", "비범위: 수납")는
 * 정당하다 — 부정·비범위 문맥이면 통과시킨다.
 *
 * 한글 활용형 주의: "아니"로는 "아닙니다"가 걸리지 않는다. 한글은 음절 단위로
 * 합성되므로 아·닙·니·다에 "아니"라는 연속 부분열이 없다. 활용형을 직접 나열한다.
 */
const NEGATION_CONTEXT =
  /아니|아닌|아님|아닙|않|없|금지|비범위|제외|미수집|만들지|복제하지|보관하지|폐기|거부|\bskip\b/;

/**
 * 부정어 판정 범위를 앞뒤 한 줄까지 넓힌다.
 * JSX·마크다운의 한글 산문은 자동 줄바꿈되어 금지어와 부정어가 다른 줄에 놓인다
 * (예: "…결제·상담·전자출결\n원장·보호자 연락처는 수신하지 않고 폐기합니다").
 * 줄 단위로만 보면 이런 문장이 전부 거짓 양성이 된다.
 */
function isNegated(lines, index) {
  for (let i = Math.max(0, index - 1); i <= Math.min(lines.length - 1, index + 1); i += 1) {
    if (NEGATION_CONTEXT.test(lines[i])) return true;
  }
  return false;
}

/** 주석 줄 (스키마·SQL 설명) — 식별자 검사에서 제외 */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*|--|#)/;

const violations = [];

for (const scanDir of SCAN_DIRS) {
  for await (const file of walk(join(ROOT, scanDir))) {
    const rel = relative(ROOT, file);
    if (ALLOWLIST_FILES.has(rel)) continue;
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (line.includes(ALLOW_MARKER)) return;
      const negated = isNegated(lines, i);
      if (!COMMENT_LINE.test(line) && !negated) {
        for (const pattern of FORBIDDEN_IDENTIFIERS) {
          if (pattern.test(line)) {
            violations.push({ file: rel, line: i + 1, match: pattern.source, text: line.trim().slice(0, 120) });
          }
        }
      }
      if (!negated) {
        for (const copy of FORBIDDEN_COPY) {
          if (line.includes(copy)) {
            violations.push({ file: rel, line: i + 1, match: copy, text: line.trim().slice(0, 120) });
          }
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error("✗ 제품 경계 위반이 발견되었습니다 (골프롬프트 1A·24·32장):\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.match}]  ${v.text}`);
  }
  console.error(
    `\n총 ${violations.length}건. 수납·상담·전자출결·차량·급여·CRM은 핵심 제품 범위가 아닙니다.`,
  );
  console.error(
    `정당한 예외(금지 필드 거부 테스트 등)는 해당 줄에 "${ALLOW_MARKER} 사유" 주석을 추가하세요.`,
  );
  process.exit(1);
}

console.log("✓ 제품 경계 검사 통과 — 비범위 모듈·문구 0건");
