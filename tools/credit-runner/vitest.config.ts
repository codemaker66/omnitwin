import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    environment: "node",
    // The review and verifier tests drive real git repositories.
    testTimeout: 60000,
    pool: "forks",
    fileParallelism: false,
  },
});
