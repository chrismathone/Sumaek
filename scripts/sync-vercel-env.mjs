#!/usr/bin/env node
/**
 * .env의 선택된 키를 Vercel 프로덕션 env로 동기화한다.
 *
 *   node scripts/sync-vercel-env.mjs            # 기본 대상 키 전부
 *   node scripts/sync-vercel-env.mjs NEIS_API_KEY
 *
 * - 값이 비어 있으면 건너뛴다 (빈 값으로 프로덕션을 덮어쓰지 않는다).
 * - 기존 값이 있으면 rm 후 add — vercel env add는 중복 이름을 거부한다.
 * - 값은 stdin으로 넘긴다 — 명령행 인자로 넘기면 셸 히스토리에 남는다.
 * - 반영은 다음 배포부터다. 마지막에 안내를 출력한다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_KEYS = [
  "NEIS_API_KEY",
  "DATA_GO_KR_API_KEY",
  /* 인강 빈칸 — 음성 입력(전사)과 분석 */
  "ASSEMBLYAI_API_KEY",
  "DEEPSEEK_API_KEY",
];
const TARGET = "production";

const keys = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_KEYS;

const envPath = resolve(import.meta.dirname, "..", ".env");
let envText;
try {
  envText = readFileSync(envPath, "utf8");
} catch {
  console.error(`✗ .env를 읽을 수 없습니다: ${envPath}`);
  process.exit(1);
}

/** .env 파싱 — 마지막 정의가 이긴다. 값 끝의 CR·공백 제거 (CRLF 실사고 방어) */
function readEnvValue(name) {
  let value;
  for (const line of envText.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (match && match[1] === name) value = match[2].trim();
  }
  return value;
}

/** 로컬 미러 갱신 — Next 웹 서버는 apps/web/.env만 읽는다 */
function mirrorToWebEnv(name, value) {
  const webEnvPath = resolve(import.meta.dirname, "..", "apps", "web", ".env");
  if (!existsSync(webEnvPath)) return false;
  const lines = readFileSync(webEnvPath, "utf8").split("\n");
  const index = lines.findIndex((l) => l.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1] === name);
  const entry = `${name}=${value}`;
  if (index >= 0) {
    if (lines[index].trimEnd() === entry) return false;
    lines[index] = entry;
  } else {
    lines.push(entry);
  }
  writeFileSync(webEnvPath, lines.join("\n"));
  return true;
}

function vercel(args, input) {
  return spawnSync("vercel", args, {
    input,
    encoding: "utf8",
    shell: process.platform === "win32", // Windows에서 vercel.cmd 해석
  });
}

let synced = 0;
let skipped = 0;
for (const name of keys) {
  const value = readEnvValue(name);
  if (value === undefined) {
    console.log(`- ${name}: .env에 정의가 없어 건너뜀`);
    skipped++;
    continue;
  }
  if (value === "") {
    console.log(`- ${name}: 값이 비어 있어 건너뜀 (.env에 키를 채운 뒤 다시 실행)`);
    skipped++;
    continue;
  }

  const mirrored = mirrorToWebEnv(name, value);

  // 기존 값 제거 — 없으면 실패하는데 그건 정상이라 무시한다
  vercel(["env", "rm", name, TARGET, "--yes"]);

  const added = vercel(["env", "add", name, TARGET], value);
  if (added.status === 0) {
    console.log(
      `✓ ${name}: ${TARGET} 반영 (값 길이 ${value.length})${mirrored ? " + apps/web/.env 미러" : ""}`,
    );
    synced++;
  } else {
    console.error(`✗ ${name}: vercel env add 실패\n${added.stderr || added.stdout}`);
    process.exitCode = 1;
  }
}

console.log(`\n동기화 ${synced}건 · 건너뜀 ${skipped}건`);
if (synced > 0) {
  console.log("반영은 다음 배포부터입니다: vercel deploy --prod --yes");
}
