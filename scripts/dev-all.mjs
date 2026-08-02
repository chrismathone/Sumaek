#!/usr/bin/env node
/**
 * 웹 + 워커 동시 실행 — `pnpm dev:all`.
 *
 * 왜 필요한가: 지금까지 로컬 개발에서 워커를 띄우는 방법은 두 번째 터미널에
 * `pnpm dev:worker`를 사람이 직접 치는 것뿐이었다. 안 치면 웹은 멀쩡히 돌고
 * outbox만 조용히 쌓인다 — 화면에는 "자동 재계산됨"이라 나오는데 아무 일도
 * 일어나지 않는다. 잊을 수 있는 절차는 결국 잊힌다.
 *
 * 어느 한쪽이 죽으면 다른 쪽도 내린다. 반쪽만 살아 있는 상태가 가장 헷갈린다.
 * 배포는 이 스크립트를 쓰지 않는다 — apps/worker/Dockerfile을 본다.
 *
 * 저장소에 동시 실행 의존성(concurrently 등)을 새로 넣지 않았다.
 * scripts/verify-recovery.mjs와 같은 방식(node:child_process spawn)이다.
 */
import { spawn } from "node:child_process";

const targets = [
  { name: "web   ", args: ["--filter", "@su-maek/web", "dev"] },
  { name: "worker", args: ["--filter", "@su-maek/worker", "dev"] },
];

const children = [];
let stopping = false;

/** 한쪽이 끝나면 전부 내린다 — 반쪽만 도는 상태를 만들지 않는다 */
function stopAll(reason, code) {
  if (stopping) return;
  stopping = true;
  console.log(`[dev:all] ${reason} — 나머지도 종료합니다`);
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  // 자식이 정리할 시간을 준 뒤 종료 코드를 넘긴다
  setTimeout(() => process.exit(code), 3_000).unref();
}

for (const target of targets) {
  const child = spawn("pnpm", target.args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  children.push(child);

  const prefix = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) out.write(`[${target.name}] ${line}\n`);
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);

  child.on("error", (error) => {
    console.error(`[dev:all] ${target.name} 실행 실패: ${error.message}`);
    stopAll(`${target.name} 실행 실패`, 1);
  });
  child.on("exit", (code, signal) => {
    stopAll(
      `${target.name} 종료 (code=${code ?? "-"} signal=${signal ?? "-"})`,
      code ?? 1,
    );
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopAll(`${signal} 수신`, 0));
}
