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
  /* 세 폭에서 **여정 전체**를 돈다 (T6.3 인수 3).
   *
   * T6.2에서는 desktop 하나였고, 360px 검사는 다 세워 놓은 화면에서 뷰포트만
   * 바꿔 했다. 그것으로 잡히는 것은 **보이는가**뿐이다 — 좁은 폭에서 폼을
   * 채우고 체크박스를 누르고 표에서 행을 집는 **조작**은 실제로 그 폭에서
   * 해 봐야 안다. 교사가 태블릿으로 반을 만드는 일은 실제로 일어난다.
   *
   * 값은 세 배다(빈 조직을 세 번 세운다). 그만큼을 무는 이유는 이 여정이
   * 제품의 유일한 끝-끝 경로이기 때문이다 — 여기서 안 막히면 어디서도
   * 안 막힌다. */
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "tablet", use: { ...devices["iPad (gen 11)"] } },
    /* 360px — 실기기 최소폭. Pixel 7 기본(412px)보다 좁게 잡는다:
     * 갤럭시 S 계열 표준 폭이고, 거기서 되면 아래로는 없다. */
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } },
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
