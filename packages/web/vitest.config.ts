import { defineConfig } from "vitest/config";

// Heap bump on worker Node processes: happy-dom + R3F test fixtures are heavy
// and V8's ~1.7 GB default crashes the suite on Windows with
// "FATAL ERROR: MemoryExhaustion: Crash intentionally because memory is
// exhausted." execArgv is forwarded to every forked worker.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
    environment: "happy-dom",
    passWithNoTests: true,
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 4,
        execArgv: ["--max-old-space-size=8192"],
      },
    },
  },
});
