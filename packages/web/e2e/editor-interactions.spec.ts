import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Editor interactions — keyboard shortcuts, catalogue UX, section slider
//
// Selector strategy:
//   - Keyboard shortcuts: page.keyboard.press(...)
//   - Category headers: getByTestId("category-header-<cat>")
//   - Section slider: getByRole("slider", { name: "Section plane height" })
//   - Auth modal: getByRole("dialog")
//   - Placement hint: getByTestId("placement-hint")
//
// These tests do not require authentication (anonymous editor path).
// ---------------------------------------------------------------------------

test.describe("Editor Interactions", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate directly to /editor/:configId — SpacePicker requires a live
    // API for venue data and has no canvas. Mock the config load so the 3D
    // editor mounts without a running backend.
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
    await page.waitForSelector("canvas", { timeout: 15_000 });
    // Ensure canvas has focus so keyboard events reach window listeners
    await page.locator("canvas").click();
  });

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  test("F key opens the furniture panel", async ({ page }) => {
    await page.keyboard.press("f");
    await expect(page.getByTestId("furniture-panel")).toBeVisible({ timeout: 5_000 });
  });

  test("F key with panel already open closes it", async ({ page }) => {
    await page.keyboard.press("f");
    await page.getByTestId("furniture-panel").waitFor({ state: "visible" });
    // Wait for open animation to settle (450ms) before toggling —
    // Playwright may dispatch the second keypress before React commits
    // the state that enables the toggle.
    await page.waitForTimeout(500);
    // The panel search input auto-focuses on open — click canvas to restore
    // focus so the next 'f' keypress reaches the window shortcut handler
    // (keydown on an input is swallowed by the shortcut guard).
    await page.locator("canvas").click();
    await page.keyboard.press("f");
    await expect(page.getByTestId("furniture-panel")).not.toBeVisible({ timeout: 5_000 });
  });

  test("Ctrl+Z key does not crash the page", async ({ page }) => {
    await page.keyboard.press("Control+z");
    await expect(page.locator("canvas")).toBeVisible();
  });

  test("G key toggles grid snap without crashing", async ({ page }) => {
    await page.keyboard.press("g");
    await expect(page.locator("canvas")).toBeVisible();
    // Toggle off
    await page.keyboard.press("g");
    await expect(page.locator("canvas")).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Furniture catalogue UX
  // ---------------------------------------------------------------------------

  test("furniture panel has a search text input", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });
    await expect(panel.getByRole("textbox")).toBeVisible({ timeout: 3_000 });
  });

  test("catalogue search filters to items matching the query", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });
    await panel.getByRole("textbox").fill("round");
    await expect(panel.getByText("6ft Round Table")).toBeVisible({ timeout: 3_000 });
    // "Banquet Chair" does not contain "round" — should be hidden
    await expect(panel.getByText("Banquet Chair")).not.toBeVisible();
  });

  test("catalogue search shows empty state for a no-match query", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });
    await panel.getByRole("textbox").fill("xyzxyzxyz");
    await expect(panel.getByText(/No items match/)).toBeVisible({ timeout: 3_000 });
  });

  test("clearing search restores all catalogue items", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });
    const input = panel.getByRole("textbox");
    await input.fill("round");
    await expect(panel.getByText("Banquet Chair")).not.toBeVisible();
    await input.fill("");
    await expect(panel.getByText("Banquet Chair")).toBeVisible({ timeout: 3_000 });
  });

  test("clicking a category header collapses its item list", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });
    // Tables category is expanded by default — collapse it
    await panel.getByTestId("category-header-table").click();
    await expect(panel.getByText("6ft Round Table")).not.toBeVisible({ timeout: 3_000 });
  });

  test("clicking a collapsed category header expands it again", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });
    // Collapse
    await panel.getByTestId("category-header-table").click();
    await expect(panel.getByText("6ft Round Table")).not.toBeVisible({ timeout: 3_000 });
    // Re-expand
    await panel.getByTestId("category-header-table").click();
    await expect(panel.getByText("6ft Round Table")).toBeVisible({ timeout: 3_000 });
  });

  // ---------------------------------------------------------------------------
  // Section slider
  // ---------------------------------------------------------------------------

  test("section slider is visible with correct accessible name", async ({ page }) => {
    await expect(
      page.getByRole("slider", { name: "Section plane height" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("section slider can be repositioned without crashing", async ({ page }) => {
    const slider = page.getByRole("slider", { name: "Section plane height" });
    await slider.waitFor({ state: "visible" });
    await slider.fill("50");
    await expect(page.locator("canvas")).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Auth modal
  // ---------------------------------------------------------------------------

  test("Sign In button opens the auth modal", async ({ page }) => {
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("heading", { name: "Sign In to Save" })).toBeVisible();
  });

  test("auth modal closes when Escape is pressed", async ({ page }) => {
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    // Click the modal heading to move focus from the Clerk SignIn iframe
    // (which would swallow keyboard events) back to the React tree.
    await page.getByRole("heading", { name: "Sign In to Save" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 3_000 });
  });

  test("auth modal closes when the backdrop is clicked", async ({ page }) => {
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    // Click the top-left of the viewport — outside the centered modal card,
    // but inside the overlay (zIndex 200, inset 0).
    await page.mouse.click(10, 10);
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 3_000 });
  });

  // ---------------------------------------------------------------------------
  // Placement hint
  // ---------------------------------------------------------------------------

  test("placement hint bar is not in the DOM on initial load", async ({ page }) => {
    // PlacementHint renders only when an item is actively being placed.
    // On fresh load selectedItemId is null, so the component returns null.
    await expect(page.getByTestId("placement-hint")).not.toBeAttached();
  });
});
