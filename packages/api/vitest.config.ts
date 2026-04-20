import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    testTimeout: 10000,
    // singleFork + heap bump avoids V8 "MemoryExhaustion" on Windows when
    // the Drizzle/Fastify test surface is loaded in parallel workers.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ["--max-old-space-size=8192"],
      },
    },
  },
});
