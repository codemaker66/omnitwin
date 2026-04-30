import { expect, test, type Locator, type Page } from "@playwright/test";

interface ViewportSpec {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PHONE_VIEWPORTS: readonly ViewportSpec[] = [
  { label: "320x568 phone", width: 320, height: 568 },
  { label: "375x812 phone", width: 375, height: 812 },
  { label: "390x844 phone", width: 390, height: 844 },
  { label: "430x932 phone", width: 430, height: 932 },
];

const TABLET_VIEWPORTS: readonly ViewportSpec[] = [
  { label: "768x1024 tablet portrait", width: 768, height: 1024 },
  { label: "1024x768 tablet landscape", width: 1024, height: 768 },
];

const DESKTOP_VIEWPORT: ViewportSpec = {
  label: "1280x800 desktop",
  width: 1280,
  height: 800,
};

const EXPECTED_NO_RUNTIME_ERRORS: readonly string[] = [];

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

async function boxFor(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Expected locator to have a bounding box");
  return box;
}

async function expectWithinViewport(locator: Locator, width: number): Promise<void> {
  const box = await boxFor(locator);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
}

async function expectWithinParent(child: Locator, parent: Locator): Promise<void> {
  const childBox = await boxFor(child);
  const parentBox = await boxFor(parent);
  expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x - 1);
  expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y - 1);
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(parentBox.x + parentBox.width + 1);
  expect(childBox.y + childBox.height).toBeLessThanOrEqual(parentBox.y + parentBox.height + 1);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

test.describe("Trades Hall landing planner mobile", () => {
  for (const viewport of PHONE_VIEWPORTS) {
    test(`fits the embedded preview and opens full-screen at ${viewport.label}`, async ({ page }) => {
      const runtimeErrors = collectRuntimeErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      await expectNoHorizontalOverflow(page);

      const preview = page.locator(".planner-embedded").first();
      const previewStage = preview.locator(".stage");
      await expect(preview).toBeVisible();
      await expect(previewStage).toBeVisible();
      await expectWithinViewport(preview, viewport.width);
      await expectWithinViewport(preview.locator(".chrome .title"), viewport.width);
      await expectWithinViewport(page.locator(".preview-cta"), viewport.width);
      await expectWithinViewport(preview.locator(".mobile-preview-open"), viewport.width);

      await expectWithinParent(preview.getByRole("button", { name: /STAGE/i }).first(), previewStage);
      await expectWithinParent(preview.getByRole("button", { name: /BAR/i }).first(), previewStage);
      await expectWithinParent(preview.getByRole("button", { name: /DANCEFLOOR/i }).first(), previewStage);
      await expectWithinParent(preview.getByRole("button", { name: /TOP TABLE/i }).first(), previewStage);

      await previewStage.click();

      const dialog = page.getByRole("dialog", { name: /Grand Hall mobile planner/i });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Draft saved locally")).toBeVisible();
      await expect(dialog.locator(".stage")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await dialog.getByRole("button", { name: /Close planner/i }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      expect(runtimeErrors).toEqual(EXPECTED_NO_RUNTIME_ERRORS);
    });
  }

  test("mobile CTA opens the full planner without navigating away", async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await page.locator(".preview-cta").click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("dialog", { name: /Grand Hall mobile planner/i })).toBeVisible();
    expect(runtimeErrors).toEqual(EXPECTED_NO_RUNTIME_ERRORS);
  });

  test("full-screen planner supports selecting and dragging a table", async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator(".planner-embedded .mobile-preview-open").click();

    const dialog = page.getByRole("dialog", { name: /Grand Hall mobile planner/i });
    const table = dialog.locator(".furn.round").first();
    await expect(table).toBeVisible();

    await table.click();
    await expect(table).toHaveClass(/selected/);

    const beforeStyle = await table.getAttribute("style");
    const box = await boxFor(table);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 34, box.y + box.height / 2 + 18, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => table.getAttribute("style")).not.toBe(beforeStyle);
    await expect(table).toHaveClass(/selected/);
    expect(runtimeErrors).toEqual(EXPECTED_NO_RUNTIME_ERRORS);
  });
});

test.describe("Trades Hall landing planner tablet and desktop", () => {
  for (const viewport of TABLET_VIEWPORTS) {
    test(`uses a first-class tablet layout at ${viewport.label}`, async ({ page }) => {
      const runtimeErrors = collectRuntimeErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      await expectNoHorizontalOverflow(page);

      const preview = page.locator(".planner-embedded").first();
      const previewStage = preview.locator(".stage");
      await expect(preview).toBeVisible();
      await expect(previewStage).toBeVisible();
      await expectWithinViewport(preview, viewport.width);
      await expectWithinViewport(page.locator(".preview-cta"), viewport.width);
      await expect(preview.locator(".mobile-preview-open")).toBeHidden();
      await expect(preview.locator(".sidebar")).toBeVisible();
      await expect(preview.locator(".rightcol")).toBeVisible();

      await previewStage.click();
      await expect(page.getByRole("dialog", { name: /Grand Hall mobile planner/i })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(runtimeErrors).toEqual(EXPECTED_NO_RUNTIME_ERRORS);
    });
  }

  test(`keeps the desktop baseline intact at ${DESKTOP_VIEWPORT.label}`, async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await expectNoHorizontalOverflow(page);

    const preview = page.locator(".planner-embedded").first();
    await expect(preview).toBeVisible();
    await expect(preview.locator(".stage")).toBeVisible();
    await expectWithinViewport(preview, DESKTOP_VIEWPORT.width);
    await expectWithinViewport(page.locator(".preview-cta"), DESKTOP_VIEWPORT.width);
    await expect(preview.locator(".mobile-preview-open")).toBeHidden();
    await expect(preview.locator(".sidebar")).toBeVisible();
    await expect(preview.locator(".rightcol")).toBeVisible();
    expect(runtimeErrors).toEqual(EXPECTED_NO_RUNTIME_ERRORS);
  });
});
