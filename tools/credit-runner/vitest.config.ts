import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    environment: "node",
    // The night test drives real git worktrees and child processes.
    testTimeout: 60000,
    pool: "forks",
    fileParallelism: false,
  },
});
