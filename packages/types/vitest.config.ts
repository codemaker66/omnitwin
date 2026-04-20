import { defineConfig } from "vitest/config";

// Forks pool + per-worker heap bump: Windows V8 hits its ~1.7 GB default heap
// limit during large Vitest suites (esp. with typecheck=true) and crashes with
// "FATAL ERROR: MemoryExhaustion: Crash intentionally because memory is
// exhausted." singleFork serialises test files into one worker so heap is
// reclaimed between files instead of accumulating across parallel workers.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"],
    globals: false,
    environment: "node",
    passWithNoTests: true,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ["--max-old-space-size=8192"],
      },
    },
    typecheck: {
      enabled: true,
    },
  },
});
