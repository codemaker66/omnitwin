import { defineConfig, devices } from "@playwright/test";

// ---------------------------------------------------------------------------
// Playwright E2E configuration — OMNITWIN web package
//
// Runs against local Vite dev server. Start the API separately if needed.
// Usage:
//   pnpm --filter @omnitwin/web e2e        (runs tests)
//   pnpm --filter @omnitwin/web e2e:ui     (interactive mode)
// ---------------------------------------------------------------------------

const BASE_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] !== undefined ? 2 : 0,
  workers: process.env["CI"] !== undefined ? 1 : undefined,
  reporter: process.env["CI"] !== undefined ? "github" : "html",
  timeout: 30_000,

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start Vite dev server before running tests (only if not already running)
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
  },
});
