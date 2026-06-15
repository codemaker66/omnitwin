import { defineConfig, devices } from "@playwright/test";

// ---------------------------------------------------------------------------
// Playwright E2E configuration — OMNITWIN web package
//
// Runs against local Vite dev server. Start the API separately if needed.
// Usage:
//   pnpm --filter @omnitwin/web e2e        (runs tests)
//   pnpm --filter @omnitwin/web e2e:ui     (interactive mode)
//   $env:E2E_WEB_SERVER="preview"; pnpm --filter @omnitwin/web e2e
//     (runs against an existing production build via Vite preview)
// ---------------------------------------------------------------------------

const WEB_SERVER_MODE = process.env["E2E_WEB_SERVER"] ?? "dev";
const IS_PREVIEW_MODE = WEB_SERVER_MODE === "preview";
const BASE_URL = process.env["E2E_BASE_URL"] ??
  (IS_PREVIEW_MODE ? "http://127.0.0.1:4176" : "http://localhost:5173");
const START_SERVER = process.env["E2E_START_SERVER"] !== "false";
const BROWSER_CHANNEL = process.env["E2E_BROWSER_CHANNEL"];

function webServerCommand(): string {
  if (IS_PREVIEW_MODE) {
    return "pnpm exec vite preview --host 127.0.0.1 --port 4176";
  }
  return "pnpm dev";
}

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
      use: {
        ...devices["Desktop Chrome"],
        ...(BROWSER_CHANNEL === undefined ? {} : { channel: BROWSER_CHANNEL }),
      },
    },
  ],

  // Start Vite dev/preview before running tests, unless an external base URL
  // is provided with E2E_START_SERVER=false.
  webServer: START_SERVER ? {
    command: webServerCommand(),
    url: BASE_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: IS_PREVIEW_MODE ? 60_000 : 30_000,
  } : undefined,
});
