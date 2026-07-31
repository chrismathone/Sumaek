#!/usr/bin/env node
/**
 * 복구 검증 런처 — 런북이 부르는 경로다.
 *
 *   node scripts/verify-recovery.mjs
 *   node scripts/verify-recovery.mjs --target="postgresql://…/복원본"
 *   node scripts/verify-recovery.mjs --mode=drill
 *
 * 근거: docs/runbooks/05-db-failure-pitr.md 5.7·6장,
 *       docs/phase0/backup-recovery.md 5.1·6장
 *
 * 저장소 루트에는 postgres 드라이버가 없다. 실제 로직은 packages/db가 들고 있고
 * 이 파일은 그것을 tsx로 띄우는 얇은 런처다. 자식의 종료 코드를 그대로 넘긴다.
 *
 * --target 값은 명령줄이 아니라 RECOVERY_DATABASE_URL 환경변수로 전달한다.
 * 셸을 거치며 URL의 특수문자(& $ " 등)가 깨지는 것과, 프로세스 목록에 접속
 * 문자열이 노출되는 것을 동시에 막는다.
 */
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const forwarded = [];
const childEnv = { ...process.env };

for (const arg of args) {
  if (arg.startsWith("--target=")) {
    childEnv.RECOVERY_DATABASE_URL = arg.slice("--target=".length);
    continue;
  }
  if (arg === "--target") {
    console.error(
      '--target 은 등호 형태로 주세요: --target="postgresql://…"',
    );
    process.exit(2);
  }
  if (!/^--[a-z0-9=-]+$/i.test(arg)) {
    console.error(`알 수 없는 인자입니다: ${arg}`);
    console.error("사용: node scripts/verify-recovery.mjs [--target=<url>] [--mode=drill]");
    process.exit(2);
  }
  forwarded.push(arg);
}

const child = spawn(
  "pnpm",
  ["--filter", "@su-maek/db", "exec", "tsx", "scripts/verify-recovery.mts", ...forwarded],
  { stdio: "inherit", shell: true, env: childEnv },
);

child.on("error", (error) => {
  console.error("[verify-recovery] pnpm 실행 실패:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[verify-recovery] 시그널로 종료됨: ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
