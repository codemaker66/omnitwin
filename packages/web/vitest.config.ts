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
    // The web suite has 140+ heavy `await import(...)` smoke tests that pull in
    // the full R3F/three editor dependency graph and transform it on demand.
    // Under machine load (parallel forks, slow Windows IO) a single import can
    // exceed vitest's 5s default and flake (e.g. "EditorPage exports" timing out
    // at 5000ms). 20s comfortably absorbs load spikes while still catching a
    // genuinely hung test.
    testTimeout: 20000,
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 4,
        execArgv: ["--max-old-space-size=8192"],
      },
    },
  },
});
