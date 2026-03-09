import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"],
    globals: false,
    environment: "node",
    passWithNoTests: true,
    typecheck: {
      enabled: true,
    },
  },
});
