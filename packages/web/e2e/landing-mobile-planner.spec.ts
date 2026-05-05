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
  { label: "1228x1216 desktop", width: 1228, height: 1216 },
  { label: "1280x800 desktop", width: 1280, height: 800 },
  { label: "1440x1000 desktop", width: 1440, height: 1000 },
  { label: "2048x1000 desktop", width: 2048, height: 1000 },
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

async function expectPlannerSurfaceDoesNotTextSelect(locator: Locator): Promise<void> {
  const selectionStyles = await locator.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      userSelect: styles.userSelect,
      webkitUserSelect: styles.getPropertyValue("-webkit-user-select"),
    };
  });

  expect(selectionStyles.userSelect).toBe("none");
  expect(selectionStyles.webkitUserSelect).toBe("none");
}

async function expectEmbeddedPlannerIsNotClipped(preview: Locator): Promise<void> {
  const geometry = await preview.locator(".body").evaluate((body) => {
    const stage = body.querySelector<HTMLElement>(".stage");
    const rightcol = body.querySelector<HTMLElement>(".rightcol");
    if (stage === null || rightcol === null) {
      throw new Error("Planner body missing expected columns");
    }
    const bodyBox = body.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    const rightBox = rightcol.getBoundingClientRect();
    return {
      clientWidth: body.clientWidth,
      scrollWidth: body.scrollWidth,
      bodyRight: bodyBox.right,
      stageRight: stageBox.right,
      rightRight: rightBox.right,
      bodyHeight: bodyBox.height,
      stageWidth: stageBox.width,
      stageHeight: stageBox.height,
      centralBlankHeight: Math.round(bodyBox.bottom - Math.max(stageBox.bottom, rightBox.bottom)),
      stageTop: stageBox.top,
      viewportHeight: window.innerHeight,
    };
  });

  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.stageRight).toBeLessThanOrEqual(geometry.bodyRight + 1);
  expect(geometry.rightRight).toBeLessThanOrEqual(geometry.bodyRight + 1);
  expect(geometry.stageWidth).toBeGreaterThanOrEqual(450);
  expect(geometry.stageHeight).toBeGreaterThanOrEqual(280);
  expect(geometry.centralBlankHeight).toBeLessThanOrEqual(1);
  expect(geometry.stageTop).toBeLessThan(geometry.viewportHeight);
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
      const viewIn3d = dialog.getByRole("link", { name: /View in 3D/i });
      await expect(viewIn3d).toBeVisible();
      await expectWithinViewport(viewIn3d, viewport.width);
      const viewIn3dBox = await boxFor(viewIn3d);
      expect(viewIn3dBox.height).toBeGreaterThanOrEqual(44);
      expect(viewIn3dBox.width).toBeGreaterThanOrEqual(96);
      await expectPlannerSurfaceDoesNotTextSelect(dialog.locator(".planner-fullscreen"));
      await expectPlannerSurfaceDoesNotTextSelect(dialog.locator(".stage"));
      await expectPlannerSurfaceDoesNotTextSelect(dialog.locator(".furn").first());
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
      await expect(preview.locator(".planner-commandbar")).toBeVisible();
      await expect(preview.locator(".planner-tool-rail")).toBeVisible();
      await expect(preview.locator(".rightcol")).toBeVisible();
      expect((await boxFor(preview)).width).toBeGreaterThan(540);
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
      await expect(page.locator(".planrise img")).toHaveCount(0);
      await expect(page.locator(".planrise-mode-card")).toBeVisible();
      await expectEmbeddedPlannerIsNotClipped(page.locator(".planner-embedded").first());
      await expect(page.getByRole("toolbar", { name: /2D planner tools/i }).getByRole("button", { name: /Camera/i })).toBeVisible();
      await page.getByRole("toolbar", { name: /2D planner tools/i }).getByRole("button", { name: /Camera/i }).click();
      await expect(page.locator(".planner-embedded .camera-point")).toHaveCount(2);
      await expect(page.getByRole("link", { name: /Open The Saloon in the planner/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /Open Robert Adam Room in the planner/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /Open Reception Room in the planner/i })).toBeVisible();
      await page.getByLabel("Choose room").selectOption("robert-adam-room");
      await expect(page.locator(".hero-media-photo img")).toHaveAttribute("src", "/rooms/robert-adam-wedding-opt.jpg");
      await expect(page.locator(".planner-embedded .chrome .title")).toContainText("Robert Adam Room");
      await expect(page.locator(".hero-left").getByRole("link", { name: /Open the Robert Adam Room planner/i })).toHaveAttribute("href", "/plan?space=robert-adam-room");
      await expect(page.getByText("Planrise preview")).toBeVisible();
      await expect(page.getByText("Choose the mood")).toBeVisible();
      await expect(page.getByText("Step from plan into space")).toBeVisible();
      await expect(page.getByText("Send a proper draft")).toBeVisible();
      expect(runtimeErrors).toEqual([]);
    });
  }
});
