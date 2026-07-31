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

const violations = [];

for (const scanDir of SCAN_DIRS) {
  for await (const file of walk(join(ROOT, scanDir))) {
    const rel = relative(ROOT, file);
    if (ALLOWLIST_FILES.has(rel)) continue;
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (line.includes(ALLOW_MARKER)) return;
      for (const pattern of FORBIDDEN_IDENTIFIERS) {
        if (pattern.test(line)) {
          violations.push({ file: rel, line: i + 1, match: pattern.source, text: line.trim().slice(0, 120) });
        }
      }
      for (const copy of FORBIDDEN_COPY) {
        if (line.includes(copy)) {
          violations.push({ file: rel, line: i + 1, match: copy, text: line.trim().slice(0, 120) });
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
