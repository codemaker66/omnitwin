import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Performance — page load and rendering checks
//
// Verifies that the app loads within acceptable time bounds and doesn't
// produce console errors that indicate broken imports or runtime crashes.
// ---------------------------------------------------------------------------

test.describe("Performance", () => {
  test("page loads within 10 seconds", async ({ page }) => {
    const start = Date.now();
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 15_000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000);
  });

  test("no uncaught JavaScript errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => { errors.push(err.message); });

    await page.goto("/");
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

    await page.goto("/");
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

    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 15_000 });

    // The hallkeeper chunk should NOT be loaded on the editor page
    const hallkeeperChunks = loadedScripts.filter((s) => s.includes("hallkeeper") || s.includes("Dashboard"));
    expect(hallkeeperChunks).toHaveLength(0);
  });
});
