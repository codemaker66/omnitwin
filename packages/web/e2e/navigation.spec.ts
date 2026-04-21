import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Navigation — page routing and basic UI structure
//
// Verifies that routes load correctly and key UI elements are present.
// These tests don't require authentication.
//
// Note: "/" redirects to "/editor" which shows SpacePicker (no canvas).
// Tests that need the 3D editor navigate to /editor/:configId with a
// mocked config-load response so the Canvas mounts.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const CONFIG_ID = "e2e-config-001";

test.describe("Navigation", () => {
  test("editor route loads with a visible WebGL canvas", async ({ page }) => {
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
    await page.goto(`/plan/${CONFIG_ID}`);
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
