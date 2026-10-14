import { defineConfig } from "vitest/config";

// Unit tests run in UTC, as CI's Linux runners do. A test that formats a time
// for "the device's" zone otherwise reads differently on a machine set to UK
// time (the ops pages name the venue's clock only for a device elsewhere).
// Forked workers inherit the environment, so they start in UTC.
process.env.TZ = "UTC";

// Heap bump on worker Node processes: happy-dom + R3F test fixtures are heavy
// and V8's ~1.7 GB default crashes the suite on Windows with
// "FATAL ERROR: MemoryExhaustion: Crash intentionally because memory is
// exhausted." execArgv is forwarded to every forked worker.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/vitest-setup.ts"],
    globals: false,
    environment: "happy-dom",
    // The web suite has 140+ heavy `await import(...)` smoke tests that pull in
    // the full R3F/three editor dependency graph and transform it on demand.
    // Under machine load (parallel forks, slow Windows IO) a single import can
    // exceed vitest's 5s default and flake (e.g. "EditorPage exports" timing out
    // at 5000ms). 20s comfortably absorbs load spikes while still catching a
    // genuinely hung test.
    testTimeout: 20000,
    pool: "forks",
    maxWorkers: 4,
    execArgv: ["--max-old-space-size=8192"],
  },
});
