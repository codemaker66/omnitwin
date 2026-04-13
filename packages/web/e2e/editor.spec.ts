import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Public editor — the core guest-facing experience
//
// Stable selector strategy:
//   - Toolbar buttons: getByRole("button", { name: "…" }) via aria-label on ToolBtn
//   - Furniture panel: getByTestId("furniture-panel")
//   - Catalogue items: getByText("…") scoped within the furniture panel
//
// These tests do not require authentication (anonymous editor path).
// ---------------------------------------------------------------------------

test.describe("Public Editor", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate directly to /editor/:configId (bypasses SpacePicker, which
    // requires a live API for venue/space data). Mock the config-load call
    // so the 3D editor mounts without a real backend.
    await page.route("http://localhost:3001/public/configurations/e2e-config-001", (route) => {
      void route.fulfill({
        json: {
          data: {
            id: "e2e-config-001",
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
    await page.goto("/editor/e2e-config-001");
    // Wait for the R3F canvas to mount before every test
    await page.waitForSelector("canvas", { timeout: 15_000 });
  });

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------

  test("page loads with a visible WebGL canvas", async ({ page }) => {
    await expect(page.locator("canvas")).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Toolbar presence
  // ---------------------------------------------------------------------------

  test("all core toolbar buttons are present", async ({ page }) => {
    // Each ToolBtn renders a <button aria-label={label} …>. Verifying these
    // labels exist ensures the toolbox mounted and aria attributes are wired.
    await Promise.all(
      [
        "Select & Move",
        "Add Furniture",
        "Rotate",
        "Delete",
        "Undo",
        "Redo",
        "Camera Views",
        "Grid Snap",
        "Show All Walls",
        "Save Layout",
        "Events Sheet",
      ].map((name) => expect(page.getByRole("button", { name })).toBeVisible()),
    );
  });

  // ---------------------------------------------------------------------------
  // Furniture catalogue panel
  // ---------------------------------------------------------------------------

  test("clicking Add Furniture opens the catalogue panel", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    await expect(page.getByTestId("furniture-panel")).toBeVisible({ timeout: 5_000 });
  });

  test("furniture catalogue lists Round Table", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });
    await expect(panel.getByText("Round Table")).toBeVisible({ timeout: 5_000 });
  });

  test("clicking Add Furniture again closes the catalogue panel", async ({ page }) => {
    const btn = page.getByRole("button", { name: "Add Furniture" });
    await btn.click();
    await page.getByTestId("furniture-panel").waitFor({ state: "visible" });
    // Second click toggles the panel closed
    await btn.click();
    await expect(page.getByTestId("furniture-panel")).not.toBeVisible({ timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // Canvas mouse interaction
  // ---------------------------------------------------------------------------

  test("canvas accepts left and right clicks without crashing", async ({ page }) => {
    const canvas = page.locator("canvas");
    await canvas.click();
    await canvas.click({ button: "right" });
    // Canvas must remain visible after interactions
    await expect(canvas).toBeVisible();
  });
});
