import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next의 tsconfig은 jsx:"preserve" — vitest(esbuild)는 그대로 못 돌린다.
  // 컴포넌트 테스트(ReadingBody)를 위해 automatic 런타임으로 변환한다.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    // 라이브 DB 통합 테스트 — 파일 간 직렬 실행 (상태 경합 방지)
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./test/stubs/server-only.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
