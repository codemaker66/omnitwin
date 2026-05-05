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
    await page.goto("/plan/e2e-config-001");
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
    // Wait for the panel's open animation (450ms) to complete before toggling
    await page.waitForTimeout(500);
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

  test("right-clicking the planner creates a camera POV reference", async ({ page }) => {
    const canvas = page.locator("canvas");
    await page.getByRole("button", { name: "Camera Views" }).waitFor({ state: "visible" });
    await page.waitForTimeout(250);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    const clickX = box.x + Math.floor(box.width * 0.56);
    const clickY = box.y + Math.floor(box.height * 0.58);
    await page.mouse.move(clickX, clickY);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });

    const composer = page.getByRole("dialog", { name: "Add camera POV" });
    await expect(composer).toBeVisible({ timeout: 5_000 });
    await expect(composer.getByText("Eye height")).toBeVisible();
    await expect(composer.getByRole("button", { name: "Standing" })).toBeVisible();
    const composerBoxBefore = await composer.boundingBox();
    expect(composerBoxBefore).not.toBeNull();
    if (composerBoxBefore === null) return;
    const dragHandle = composer.getByTestId("camera-reference-drag-handle");
    await page.mouse.move(composerBoxBefore.x + 88, composerBoxBefore.y + 22);
    await page.mouse.down();
    await page.mouse.move(composerBoxBefore.x + 248, composerBoxBefore.y - 98, { steps: 6 });
    await page.mouse.up();
    const composerBoxAfter = await composer.boundingBox();
    expect(composerBoxAfter).not.toBeNull();
    if (composerBoxAfter === null) return;
    expect(composerBoxAfter.x).toBeGreaterThan(composerBoxBefore.x + 120);
    expect(composerBoxAfter.y).toBeLessThan(composerBoxBefore.y - 80);
    await expect(dragHandle).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await composer.getByRole("button", { name: "Add + view" }).click();

    await expect(page.getByLabel("POV height")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Camera Views" }).click();
    await expect(page.getByRole("button", { name: /Floor POV Standing POV - Floor grid/ })).toBeVisible({ timeout: 5_000 });
  });

  test("right-drag orbit does not open the camera POV composer", async ({ page }) => {
    const canvas = page.locator("canvas");
    await page.getByRole("button", { name: "Camera Views" }).waitFor({ state: "visible" });
    await page.waitForTimeout(250);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    const startX = box.x + Math.floor(box.width * 0.48);
    const startY = box.y + Math.floor(box.height * 0.58);
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(startX + 96, startY + 24, { steps: 6 });
    await page.mouse.up({ button: "right" });

    await expect(page.getByRole("dialog", { name: "Add camera POV" })).toHaveCount(0);
    await expect(canvas).toBeVisible();
  });
});
