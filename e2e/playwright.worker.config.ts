import { defineConfig, devices } from "@playwright/test";

/* ─────────────────────────────────────────────────────────────
 * 실워커 E2E 구성 (T6.2 · G-10).
 *
 * 기본 구성(playwright.config.ts)은 웹만 띄운다. 그래서 지금까지 E2E가
 * 검증한 것은 **사람이 누른 것**뿐이었다 — 큐에 쌓인 일을 실제로 하는
 * 프로세스는 한 번도 뜨지 않았다. 「교사가 아무 버튼도 누르지 않아도
 * 학생에게 시험이 나타나는가」는 그 프로세스 없이는 물을 수조차 없다.
 *
 * 여기서는 웹과 **진짜 워커**를 함께 띄운다. 워커는 HTTP 서버가 아니라
 * 폴링 루프라 url·port로 준비를 잴 수 없다 — 시작 로그를 기다린다.
 *
 * 왜 별도 구성인가: 이 스펙 한 벌은 빈 조직을 세워 학생의 하루까지
 * 완주하므로 기본 스위트보다 훨씬 느리다. 기본 구성에 섞으면 스펙 하나
 * 고칠 때마다 그 시간을 전부 문다. 기본 구성은 이 파일들을 testIgnore로
 * 뺀다.
 * ───────────────────────────────────────────────────────────── */

/** 실워커 스펙 — 기본 구성의 testIgnore와 **같은 목록**이어야 한다 */
export const WORKER_SPECS = ["**/autonomous-day.spec.ts"];

export default defineConfig({
  testDir: "./tests",
  testMatch: WORKER_SPECS,
  globalTeardown: "./global-teardown.ts",
  /* 한 라이브 DB를 공유한다 — 병렬은 상태 경합으로 플레이키 */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  /* 재시도를 켜지 않는다. 이 스펙은 「빈 조직에서 한 번에 되는가」를 묻는
   * 것이라, 두 번째 시도로 통과하면 답이 뒤집힌다 — 실패가 실패로 남아야
   * 워커가 죽었는지 화면이 깨졌는지 들여다보게 된다. */
  retries: 0,
  reporter: [["html", { open: "never" }], ["list"]],
  /* 빈 조직 세우기 → 설정 8단계 → 워커 대기 → 학생 완주까지 한 테스트다.
   * 기본 30초로는 첫 컴파일에서만 다 쓴다. */
  timeout: 300_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  },
  /* 프로젝트는 하나다.
   *
   * 360px 검사(T1.4·T4.4의 밀린 항목)를 별도 프로젝트로 두면 그 프로젝트도
   * 빈 조직 세우기부터 전부 다시 한다 — 재는 것은 화면 폭인데 값은 두
   * 배를 문다. 대신 스펙이 다 세워 놓은 화면에서 **뷰포트만 바꿔** 잰다.
   * 같은 데이터, 다른 폭 — 그것이 원래 재려던 것이다. */
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      name: "web",
      command: "pnpm --filter @su-maek/web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      cwd: "..",
      timeout: 120_000,
    },
    {
      name: "worker",
      command: "pnpm --filter @su-maek/worker start",
      cwd: "..",
      /* 준비 판정 — main.ts의 시작 줄. 이것을 못 보면 워커 없이 도는 대신
       * 구성 단계에서 죽는다. 워커가 안 떴는데 스펙이 「평가가 안 생긴다」로
       * 깨지면 원인을 찾는 데 한참 걸린다. */
      wait: { stdout: /\[su-maek worker\].*시작/ },
      stdout: "pipe",
      stderr: "pipe",
      /* 워커는 기존 것을 재사용하지 않는다. 사람이 띄워 둔 워커는 이 스펙이
       * 요구하는 짧은 생산자 간격을 갖고 있지 않다. */
      reuseExistingServer: false,
      env: {
        /* 기본 60초를 그대로 두면 스펙이 평가 하나를 1분 기다린다.
         * 첫 회차는 어차피 즉시 돌지만(main.ts), 루트 게시가 그 뒤에
         * 오므로 두 번째 회차를 기다려야 한다. */
        ASSESSMENT_PRODUCER_INTERVAL_MS: "3000",
        WORKER_CONCURRENCY: "4",
      },
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGINT", timeout: 10_000 },
    },
  ],
});
