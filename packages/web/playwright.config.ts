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
const START_SERVER = process.env["E2E_START_SERVER"] !== "false";
const EXPLICIT_BASE_URL = process.env["E2E_BASE_URL"];
const BROWSER_CHANNEL = process.env["E2E_BROWSER_CHANNEL"];
const IS_CI = Boolean(process.env["CI"]);

function selectedDevPort(): string | undefined {
  // Preview mode and an explicitly external target do not use a dev port.
  if (IS_PREVIEW_MODE || (!START_SERVER && EXPLICIT_BASE_URL !== undefined)) return undefined;
  const port = process.env["E2E_PORT"];
  if (port === undefined) return undefined;
  const value = Number(port);
  if (!/^\d+$/.test(port) || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("E2E_PORT must be an integer between 1 and 65535.");
  }
  return value.toString();
}

const DEV_PORT = selectedDevPort();
const DEFAULT_DEV_URL = DEV_PORT === undefined ? "http://localhost:5173" : `http://127.0.0.1:${DEV_PORT}`;
const BASE_URL = EXPLICIT_BASE_URL ?? (IS_PREVIEW_MODE ? "http://127.0.0.1:4176" : DEFAULT_DEV_URL);

function webServerCommand(): string {
  if (IS_PREVIEW_MODE) {
    return "pnpm exec vite preview --host 127.0.0.1 --port 4176";
  }
  // E2E_PORT pins the dev server to a port nothing else squats: vite's
  // default 5173 is contested on shared dev machines, and reuseExistingServer
  // then attaches the run to whatever code the squatter serves. --host
  // 127.0.0.1 on both sides because Windows resolves localhost to ::1 first
  // while vite binds v4, which times out the readiness poll against a
  // healthy server.
  if (DEV_PORT === undefined) return "pnpm dev";
  return `pnpm dev --host 127.0.0.1 --port ${DEV_PORT} --strictPort`;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: process.env["CI"] !== undefined ? 2 : 0,
  workers: process.env["CI"] !== undefined ? 1 : undefined,
  // The GitHub reporter emits failure annotations only when the run ends.
  // Print each case immediately, and leave time for reports and artifact upload
  // before the 30-minute Actions job deadline even if the suite stalls.
  reporter: process.env["CI"] !== undefined ? [["line"], ["github"]] : "html",
  globalTimeout: process.env["CI"] !== undefined ? 26 * 60_000 : undefined,
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
        // Venue-facing visual and date assertions must not depend on the CI
        // runner's host timezone. Trades Hall operates in Europe/London.
        timezoneId: "Europe/London",
        ...(BROWSER_CHANNEL === undefined ? {} : { channel: BROWSER_CHANNEL }),
      },
    },
  ],

  // Start Vite dev/preview before running tests, unless an external base URL
  // is provided with E2E_START_SERVER=false.
  webServer: START_SERVER ? {
    command: webServerCommand(),
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    // 120s: a cold vite boot on a loaded machine can exceed 30s, and a boot
    // timeout reads as a mysterious run failure rather than what it is.
    timeout: IS_PREVIEW_MODE ? 60_000 : 120_000,
  } : undefined,
});
