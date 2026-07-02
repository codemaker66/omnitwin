import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
    // Serial file execution + heap bump avoids V8 "MemoryExhaustion" on
    // Windows when suites load in parallel workers (see
    // .claude/gotchas/windows-v8-heap.md). Vitest 4 moved these fork
    // options to the top-level test config; fileParallelism=false is the
    // Vitest-4 form of singleFork.
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--max-old-space-size=8192"],
  },
});
