#!/usr/bin/env node
/**
 * 읽기 모델 재생성 런처 — 런북이 부르는 경로다.
 *
 *   node scripts/rebuild-read-models.mjs
 *   node scripts/rebuild-read-models.mjs --dry-run
 *   node scripts/rebuild-read-models.mjs --org <uuid> --learner <uuid>
 *
 * 근거: docs/runbooks/README.md 10장, docs/runbooks/05-db-failure-pitr.md 6장 V-9,
 *       docs/phase0/backup-recovery.md 3.1 R-7·5.1 V-10
 *
 * 저장소 루트에는 postgres 드라이버도 숙련도 엔진도 없다. 실제 로직은
 * packages/db가 들고 있고 이 파일은 tsx로 그것을 띄우는 얇은 런처다.
 * 자식의 종료 코드를 그대로 넘긴다 (--dry-run은 불일치가 있으면 1로 끝난다).
 */
import { spawn } from "node:child_process";

const ALLOWED_FLAGS = new Set(["--dry-run", "--help"]);
const ALLOWED_VALUE_FLAGS = new Set(["--org", "--learner"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const args = process.argv.slice(2);
const forwarded = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (ALLOWED_FLAGS.has(arg)) {
    forwarded.push(arg);
    continue;
  }
  if (ALLOWED_VALUE_FLAGS.has(arg)) {
    const value = args[i + 1];
    if (!value || !UUID_RE.test(value)) {
      console.error(`${arg} 에는 UUID가 필요합니다.`);
      process.exit(2);
    }
    forwarded.push(arg, value);
    i += 1;
    continue;
  }
  console.error(`알 수 없는 인자입니다: ${arg}`);
  console.error("사용: node scripts/rebuild-read-models.mjs [--org <uuid>] [--learner <uuid>] [--dry-run]");
  process.exit(2);
}

const child = spawn(
  "pnpm",
  ["--filter", "@su-maek/db", "exec", "tsx", "scripts/rebuild-read-models.mts", ...forwarded],
  { stdio: "inherit", shell: true },
);

child.on("error", (error) => {
  console.error("[rebuild-read-models] pnpm 실행 실패:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[rebuild-read-models] 시그널로 종료됨: ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
