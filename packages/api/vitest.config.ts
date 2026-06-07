import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    testTimeout: 10000,
    // Serial file execution + heap bump avoids V8 "MemoryExhaustion" on
    // Windows when the Drizzle/Fastify test surface is loaded in parallel
    // workers. Vitest 4 moved these fork options to the top-level test config.
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--max-old-space-size=8192"],
  },
});
