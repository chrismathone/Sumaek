import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    // 브라우저를 띄우는 테스트가 있어 기본 5초로는 모자라다.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
