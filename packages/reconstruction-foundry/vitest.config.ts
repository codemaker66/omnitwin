import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    environment: "node",
    // 60s, not 20s. The two slowest candidate.test.ts cases do real
    // crypto + upload simulation: ~8.1s each when this package has the
    // runner to itself, but CI runs `pnpm -r test` with workspace
    // concurrency 4, so they overlap the packages/web suite and were
    // KILLED at the 20s cap (not hung — the same code path passes in the
    // very same file once web finishes). A cap calibrated on one idle
    // Windows box is a CI-calibration defect, so give real headroom
    // rather than re-tuning it every time the machine is busy.
    testTimeout: 60_000,
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--max-old-space-size=8192"],
  },
});
