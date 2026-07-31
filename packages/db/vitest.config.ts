import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    passWithNoTests: true,
  },
});
