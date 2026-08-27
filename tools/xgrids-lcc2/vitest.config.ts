import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--max-old-space-size=8192"],
  },
});
