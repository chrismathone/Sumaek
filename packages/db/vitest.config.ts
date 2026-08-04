import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    /* 픽스처 설정도 같은 DB 왕복을 한다 — 오히려 테스트 하나보다 무겁다.
     * 기본 hookTimeout(10초)만 남겨 두면 부하가 조금만 올라도 beforeAll이
     * 먼저 끊긴다. 실측: 전체 스위트에서 서로 다른 파일이 번갈아 「Hook timed
     * out in 10000ms」로 실패했고 단독 실행은 1초 미만이었다. 원인은 그 파일이
     * 아니라 한도의 비대칭이다. */
    hookTimeout: 30_000,
    passWithNoTests: true,
  },
});
