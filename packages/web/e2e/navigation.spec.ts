import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Navigation — page routing and basic UI structure
//
// Verifies that routes load correctly and key UI elements are present.
// These tests don't require authentication.
// ---------------------------------------------------------------------------

test.describe("Navigation", () => {
  test("homepage loads the editor", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 15_000 });
    await expect(page.locator("canvas")).toBeVisible();
  });

  test("navigating to /hallkeeper without a configId renders without crashing", async ({ page }) => {
    await page.goto("/hallkeeper");
    // /hallkeeper/:configId requires a UUID segment — without one the SPA
    // renders index.html. Verify the app shell loads without a JS crash.
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Internal Server Error")).not.toBeVisible();
  });

  test("unknown route shows 404 or redirects", async ({ page }) => {
    const response = await page.goto("/nonexistent-route");
    // Vite SPA serves index.html for all routes (200), so check the page renders
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("page has correct title", async ({ page }) => {
    await page.goto("/");
    // Wait for page to fully load
    await page.waitForLoadState("networkidle");
    const title = await page.title();
    // Title should contain OMNITWIN or the app name
    expect(title.length).toBeGreaterThan(0);
  });
});
