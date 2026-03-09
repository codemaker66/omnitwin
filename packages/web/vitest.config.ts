import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
    environment: "happy-dom",
    passWithNoTests: true,
  },
});
