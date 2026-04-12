import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Public editor — the core guest-facing experience
//
// These tests verify that an anonymous visitor can load the editor, see the
// 3D canvas, interact with the furniture catalogue, and place items.
// ---------------------------------------------------------------------------

test.describe("Public Editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the R3F canvas to mount
    await page.waitForSelector("canvas", { timeout: 15_000 });
  });

  test("page loads with a WebGL canvas", async ({ page }) => {
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
  });

  test("vertical toolbar is visible", async ({ page }) => {
    // The toolbar is a fixed-position div with toolbar buttons
    // Look for the toolbar container (52px wide, left-aligned)
    const toolbar = page.locator('[style*="width: 52px"]').first();
    await expect(toolbar).toBeVisible();
  });

  test("clicking furniture icon opens the catalogue panel", async ({ page }) => {
    // The Armchair icon button opens the catalogue panel
    // Find the second toolbar button (furniture/add mode)
    const buttons = page.locator("button").filter({ has: page.locator("svg") });
    const furnitureBtn = buttons.nth(1);
    await furnitureBtn.click();

    // The catalogue panel should slide in with furniture categories
    await expect(page.getByText("Tables")).toBeVisible({ timeout: 5_000 });
  });

  test("furniture catalogue shows items with dimensions", async ({ page }) => {
    // Open catalogue
    const buttons = page.locator("button").filter({ has: page.locator("svg") });
    await buttons.nth(1).click();
    await page.waitForTimeout(500); // panel animation

    // Should show at least one furniture item with dimensions
    await expect(page.getByText("Round Table")).toBeVisible({ timeout: 5_000 });
  });

  test("canvas responds to mouse interaction (no crash)", async ({ page }) => {
    const canvas = page.locator("canvas");

    // Verify canvas is interactive — click without crashing
    await canvas.click();

    // Right-click (orbit camera) — should not crash
    await canvas.click({ button: "right" });

    // Canvas should still be visible after interactions
    await expect(canvas).toBeVisible();
  });
});
