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

const DESKTOP_VIEWPORTS: readonly ViewportSpec[] = [
  { label: "1280x800 desktop", width: 1280, height: 800 },
  { label: "1440x1000 desktop", width: 1440, height: 1000 },
];

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

async function expectCoreLanding(page: Page, viewport: ViewportSpec): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole("heading", { level: 1, name: /Design your event inside the real Grand Hall/i })).toBeVisible();
  await expect(page.getByText(/Try a wedding, gala, or conference layout to scale/i)).toBeVisible();
  await expect(page.getByText(/Powered by Venviewer/i).first()).toBeVisible();

  const heroPrimary = page.locator(".hero-left").getByRole("link", { name: /Open the Grand Hall planner/i });
  await expect(heroPrimary).toBeVisible();
  await expectWithinViewport(heroPrimary, viewport.width);

  const preview = page.locator(".planner-embedded").first();
  await expect(preview).toBeVisible();
  await expectWithinViewport(preview, viewport.width);

  const photo = page.locator(".hero-media-photo").first();
  await expect(photo).toBeVisible();
  await expectWithinViewport(photo, viewport.width);
}

test.describe("Trades Hall landing page redesign", () => {
  for (const viewport of PHONE_VIEWPORTS) {
    test(`phone landing is fitted and opens the mobile planner at ${viewport.label}`, async ({ page }) => {
      const runtimeErrors = collectRuntimeErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");

      await expectCoreLanding(page, viewport);
      await expect(page.locator(".planner-embedded .sidebar")).toBeHidden();
      await expect(page.locator(".planner-embedded .rightcol")).toBeHidden();
      await expect(page.getByText(/Open the real planner in 3D/i)).toHaveCount(0);

      await page.locator(".hero-left").getByRole("link", { name: /Open the Grand Hall planner/i }).click();

      const dialog = page.getByRole("dialog", { name: /Grand Hall mobile planner/i });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("To-scale draft preview")).toBeVisible();
      await expect(dialog.locator(".stage")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await dialog.getByRole("button", { name: /Close planner/i }).click();
      await expect(dialog).toBeHidden();
      await expectNoHorizontalOverflow(page);
      expect(runtimeErrors).toEqual([]);
    });
  }

  for (const viewport of TABLET_VIEWPORTS) {
    test(`tablet layout remains roomy at ${viewport.label}`, async ({ page }) => {
      const runtimeErrors = collectRuntimeErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");

      await expectCoreLanding(page, viewport);
      const preview = page.locator(".planner-embedded").first();
      await expect(preview.locator(".sidebar")).toBeVisible();
      await expect(preview.locator(".rightcol")).toBeVisible();
      expect((await boxFor(preview)).width).toBeGreaterThan(620);
      expect(runtimeErrors).toEqual([]);
    });
  }

  for (const viewport of DESKTOP_VIEWPORTS) {
    test(`desktop renders the premium Grand Hall module at ${viewport.label}`, async ({ page }) => {
      const runtimeErrors = collectRuntimeErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");

      await expectCoreLanding(page, viewport);
      await expect(page.locator(".planrise-stage")).toBeVisible();
      await expect(page.getByText("Planrise preview")).toBeVisible();
      await expect(page.getByText("Choose the mood")).toBeVisible();
      await expect(page.getByText("Step from plan into space")).toBeVisible();
      await expect(page.getByText("Send a proper draft")).toBeVisible();
      expect(runtimeErrors).toEqual([]);
    });
  }
});
