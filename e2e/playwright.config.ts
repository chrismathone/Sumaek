import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
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
