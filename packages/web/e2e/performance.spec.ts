import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Performance — page load and rendering checks
//
// Verifies that the app loads within acceptable time bounds and doesn't
// produce console errors that indicate broken imports or runtime crashes.
//
// Note: "/" redirects to "/editor" which shows SpacePicker (no canvas).
// Tests that need the 3D editor navigate to /editor/:configId with a
// mocked config-load response so the Canvas mounts.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const CONFIG_ID = "e2e-config-001";

/** Register the mock route used by all editor-canvas tests. */
async function mockEditorConfig(page: import("@playwright/test").Page): Promise<void> {
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: CONFIG_ID,
          spaceId: "e2e-space-001",
          venueId: "e2e-venue-001",
          userId: null,
          name: "Test Layout",
          isPublicPreview: true,
          objects: [],
        },
      },
    });
  });
}

test.describe("Performance", () => {
  test("page loads within 10 seconds", async ({ page }) => {
    await mockEditorConfig(page);
    const start = Date.now();
    await page.goto(`/plan/${CONFIG_ID}`);
    await page.waitForSelector("canvas", { timeout: 15_000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000);
  });

  test("no uncaught JavaScript errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => { errors.push(err.message); });

    await mockEditorConfig(page);
    await page.goto(`/plan/${CONFIG_ID}`);
    await page.waitForSelector("canvas", { timeout: 15_000 });
    // Allow a brief settle period
    await page.waitForTimeout(1_000);

    // Filter out known benign warnings (Three.js deprecation warnings, etc.)
    const criticalErrors = errors.filter((e) =>
      !e.includes("deprecated") &&
      !e.includes("THREE.") &&
      !e.includes("WebGL"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("no failed network requests for core assets", async ({ page }) => {
    const failedRequests: string[] = [];
    page.on("requestfailed", (req) => {
      const url = req.url();
      // Ignore external requests (Clerk, analytics, etc.)
      if (url.includes("localhost") || url.includes("127.0.0.1")) {
        failedRequests.push(`${req.method()} ${url}: ${req.failure()?.errorText ?? "unknown"}`);
      }
    });

    await mockEditorConfig(page);
    await page.goto(`/plan/${CONFIG_ID}`);
    await page.waitForSelector("canvas", { timeout: 15_000 });
    await page.waitForTimeout(2_000);

    // Allow API calls to fail (no backend) but JS/CSS assets must load
    const assetFailures = failedRequests.filter((r) =>
      r.includes(".js") || r.includes(".css") || r.includes(".woff"),
    );
    expect(assetFailures).toHaveLength(0);
  });

  test("code splitting works — hallkeeper chunk loads lazily", async ({ page }) => {
    const loadedScripts: string[] = [];
    page.on("response", (res) => {
      if (res.url().endsWith(".js")) {
        loadedScripts.push(res.url());
      }
    });

    await mockEditorConfig(page);
    await page.goto(`/plan/${CONFIG_ID}`);
    await page.waitForSelector("canvas", { timeout: 15_000 });

    // The route chunks should NOT be loaded on the editor page. Shared
    // domain modules in @omnitwin/types include "hallkeeper" in their file
    // names, so match only actual page/chunk entry points.
    const routeChunks = loadedScripts.filter((s) =>
      s.includes("/src/pages/HallkeeperPage")
      || s.includes("/src/pages/DashboardPage")
      || /assets\/(?:HallkeeperPage|DashboardPage)-/.test(s),
    );
    expect(routeChunks).toHaveLength(0);
  });
});
