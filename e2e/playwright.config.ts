import { defineConfig, devices } from "@playwright/test";

import { WORKER_SPECS } from "./playwright.worker.config";

export default defineConfig({
  testDir: "./tests",
  /* 실워커가 필요한 스펙은 여기서 뺀다 — 이 구성은 워커를 띄우지 않으므로
   * 「평가가 안 생긴다」로 반드시 깨진다. 목록은 워커 구성이 갖고 있고
   * 여기서 가져다 쓴다: 두 곳에 적으면 한쪽만 늘어난다. */
  testIgnore: WORKER_SPECS,
  // 스펙이 만든 반·루트·학습자를 실행 후 정리한다 (앱에 삭제 UI가 없다)
  globalTeardown: "./global-teardown.ts",
  // 스펙들이 하나의 라이브 DB를 공유한다 — 병렬 실행은 상태 경합으로 플레이키.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["iPad (gen 11)"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm --filter @su-maek/web dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    cwd: "..",
    timeout: 120_000,
  },
});
