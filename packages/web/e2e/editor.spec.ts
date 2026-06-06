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

  test("desktop planner shows a premium status command surface", async ({ page }) => {
    const statusHeader = page.getByTestId("planner-status-header");
    await expect(statusHeader).toBeVisible({ timeout: 5_000 });
    await expect(statusHeader).toContainText("Grand Hall");
    await expect(statusHeader).toContainText("Guest draft");
    await expect(statusHeader).toContainText("3D planning");
    await expect(statusHeader).toContainText(/Save Layout|Saved just now|Unsaved changes|Saving/);
    await expect.poll(async () =>
      statusHeader.evaluate((node) => getComputedStyle(node).userSelect),
    ).toBe("none");

    const commandDeck = page.getByTestId("planner-command-deck");
    await expect(commandDeck).toBeVisible({ timeout: 5_000 });
    await expect(commandDeck).toContainText("Build the room from the floor");
    await commandDeck.getByTestId("planner-command-action-open-catalogue").click();
    const furniturePanel = page.getByTestId("furniture-panel");
    await expect(furniturePanel).toBeVisible({ timeout: 5_000 });

    const headerBox = await statusHeader.boundingBox();
    const panelBox = await furniturePanel.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    if (headerBox !== null && panelBox !== null) {
      expect(panelBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
    }
  });

  test("desktop toolbar starts below the command header", async ({ page }) => {
    const statusHeader = page.getByTestId("planner-status-header");
    const toolbar = page.getByTestId("planner-toolbar");
    await expect(statusHeader).toBeVisible({ timeout: 5_000 });
    await expect(toolbar).toBeVisible({ timeout: 5_000 });

    const boxes = await Promise.all([
      statusHeader.boundingBox(),
      toolbar.boundingBox(),
      page.getByRole("button", { name: "Select & Move" }).boundingBox(),
    ]);
    const [headerBox, toolbarBox, selectButtonBox] = boxes;
    expect(headerBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    expect(selectButtonBox).not.toBeNull();
    if (headerBox === null || toolbarBox === null || selectButtonBox === null) return;

    const headerBottom = headerBox.y + headerBox.height;
    expect(toolbarBox.y).toBeGreaterThanOrEqual(headerBottom - 1);
    expect(selectButtonBox.y).toBeGreaterThanOrEqual(headerBottom + 6);
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
        "Laser Diagram",
        "Grid Snap",
        "Show All Walls",
        "Save Layout",
        "Events Sheet",
      ].map((name) => expect(page.getByRole("button", { name })).toBeVisible()),
    );
    await expect(page.getByRole("button", { name: "Toggle wall visibility panel" })).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // Furniture catalogue panel
  // ---------------------------------------------------------------------------

  test("clicking Add Furniture opens the catalogue panel", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    await expect(page.getByTestId("furniture-panel")).toBeVisible({ timeout: 5_000 });
  });

  test("laser diagram tool draws persisted floor markup", async ({ page }) => {
    await page.getByRole("button", { name: "Laser Diagram" }).click();
    const panel = page.getByTestId("markup-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await expect(panel).toContainText("Draw on the floor");
    await expect(page.getByText("Click to add furniture")).toHaveCount(0);

    const canvasBox = await page.locator("canvas").boundingBox();
    expect(canvasBox).not.toBeNull();
    if (canvasBox === null) return;

    const startX = canvasBox.x + canvasBox.width * 0.42;
    const startY = canvasBox.y + canvasBox.height * 0.56;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 120, startY + 46, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => page.evaluate(() => {
      const raw = window.localStorage.getItem("venviewer:planner-markup:v1:e2e-config-001");
      if (raw === null) return 0;
      const parsed = JSON.parse(raw) as { readonly strokes?: readonly unknown[] };
      return parsed.strokes?.length ?? 0;
    })).toBeGreaterThan(0);

    await panel.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => page.evaluate(() => {
      const raw = window.localStorage.getItem("venviewer:planner-markup:v1:e2e-config-001");
      if (raw === null) return 0;
      const parsed = JSON.parse(raw) as { readonly strokes?: readonly unknown[] };
      return parsed.strokes?.length ?? 0;
    })).toBe(0);
  });

  test("furniture catalogue lists Round Table", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });
    await expect(panel.getByText("Round Table")).toBeVisible({ timeout: 5_000 });
  });

  test("furniture catalogue exposes section jumps without deep scrolling", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });

    await expect(panel.getByTestId("catalogue-workflow-cards")).toBeVisible();
    await expect(panel.getByText("Build the room")).toBeVisible();
    const sectionJumps = panel.locator('[data-testid^="catalogue-section-jump-"]');
    await expect.poll(async () => sectionJumps.count()).toBeGreaterThan(5);
    await expect(panel.getByTestId("catalogue-section-jump-table")).toBeVisible();
    await expect(panel.getByTestId("catalogue-section-jump-chair")).toBeVisible();

    await panel.getByTestId("catalogue-section-jump-chair").click();
    await expect(panel.getByTestId("chair-brush-hint")).toBeVisible();
    await expect(panel.getByText("Drag straight across the floor for a row.")).toBeVisible();

    await panel.getByTestId("catalogue-section-jump-stage").click();
    await expect(panel.getByTestId("category-header-stage")).toBeVisible({ timeout: 5_000 });
  });

  test("dragging catalogue furniture lifts a polished placement token", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });

    const chairRow = panel.getByTestId("catalogue-item-banquet-chair");
    await chairRow.scrollIntoViewIfNeeded();
    const rowBox = await chairRow.boundingBox();
    const canvasBox = await page.locator("canvas").boundingBox();
    expect(rowBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    if (rowBox === null || canvasBox === null) return;

    const startX = rowBox.x + rowBox.width * 0.42;
    const startY = rowBox.y + rowBox.height * 0.5;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 20, startY + 6, { steps: 2 });

    const preview = page.getByTestId("catalogue-drag-preview");
    await expect(preview).toBeVisible({ timeout: 2_000 });
    await expect(preview).toContainText("Banquet Chair");
    await expect(preview).toContainText("Drop to place");

    await page.mouse.move(canvasBox.x + canvasBox.width * 0.62, canvasBox.y + canvasBox.height * 0.56, { steps: 12 });
    await page.mouse.up();

    await expect(preview).toHaveCount(0, { timeout: 3_000 });
    await expect(panel).toBeVisible();
  });

  test("planner chrome text cannot be drag-highlighted", async ({ page }) => {
    await page.getByRole("button", { name: "Add Furniture" }).click();
    const panel = page.getByTestId("furniture-panel");
    await panel.waitFor({ state: "visible" });
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    if (panelBox === null) return;

    await page.mouse.move(panelBox.x + 42, panelBox.y + 62);
    await page.mouse.down();
    await page.mouse.move(panelBox.x + panelBox.width - 36, panelBox.y + 390, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await expect.poll(async () =>
      panel.evaluate((node) => getComputedStyle(node).userSelect),
    ).toBe("none");
    await expect.poll(async () =>
      page.getByRole("textbox", { name: "Search furniture" }).evaluate((node) => getComputedStyle(node).userSelect),
    ).toBe("none");
    const search = page.getByRole("textbox", { name: "Search furniture" });
    await search.fill("chair");
    await expect(search).toHaveValue("chair");
  });

  test("active furniture toolbar caption fits inside its button", async ({ page }) => {
    const addFurnitureButton = page.getByRole("button", { name: "Add Furniture" });
    await addFurnitureButton.click();
    const caption = page.getByTestId("tool-caption-add-furniture");
    await expect(caption).toBeVisible();

    const fitsInsideButton = await caption.evaluate((node) => {
      const button = node.closest("button");
      if (button === null) return false;
      const captionBox = node.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      return captionBox.left >= buttonBox.left
        && captionBox.right <= buttonBox.right
        && node.scrollWidth <= node.clientWidth;
    });

    expect(fitsInsideButton).toBe(true);
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
    const nameInput = composer.getByLabel("Name");
    await expect(nameInput).toHaveJSProperty("draggable", false);
    await expect.poll(async () =>
      nameInput.evaluate((input) => {
        const event = new DragEvent("dragstart", { bubbles: true, cancelable: true });
        return !input.dispatchEvent(event) && event.defaultPrevented;
      }),
    ).toBe(true);
    await expect.poll(async () =>
      nameInput.evaluate((input) => getComputedStyle(input, "::selection").backgroundColor),
    ).toBe("rgba(191, 153, 55, 0.5)");
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
    await page.waitForTimeout(1_600);
    const povBox = await canvas.boundingBox();
    expect(povBox).not.toBeNull();
    if (povBox === null) return;
    const lookStartX = povBox.x + Math.floor(povBox.width * 0.5);
    const lookStartY = povBox.y + Math.floor(povBox.height * 0.5);
    await page.mouse.move(lookStartX, lookStartY);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(lookStartX + 120, lookStartY - 24, { steps: 6 });
    await page.mouse.up({ button: "right" });
    await expect(page.getByRole("dialog", { name: "Add camera POV" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("POV height")).toHaveCount(0);
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
