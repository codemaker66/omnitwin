import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:3001";
const CONFIG_ID = "e2e-mobile-config";
const VENUE_ID = "e2e-mobile-venue";
const SPACE_ID = "e2e-mobile-space";

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ViewportCase {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

const PHONE_VIEWPORTS: readonly ViewportCase[] = [
  { name: "phone 320", width: 320, height: 568 },
  { name: "phone 375", width: 375, height: 812 },
  { name: "phone 390", width: 390, height: 844 },
  { name: "phone 430", width: 430, height: 932 },
];

const TABLET_VIEWPORTS: readonly ViewportCase[] = [
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
];

const MOCK_OBJECT = {
  id: "e2e-mobile-obj-001",
  configurationId: CONFIG_ID,
  assetDefinitionId: "round-table-6ft",
  positionX: "0",
  positionY: "0",
  positionZ: "0",
  rotationX: "0",
  rotationY: "0",
  rotationZ: "0",
  scale: "1",
  sortOrder: 0,
  metadata: null,
};

const MOCK_CONFIG = {
  id: CONFIG_ID,
  spaceId: SPACE_ID,
  venueId: VENUE_ID,
  userId: null,
  name: "Mobile Layout",
  isPublicPreview: true,
  objects: [MOCK_OBJECT],
};

const MOCK_SPACE = {
  id: SPACE_ID,
  venueId: VENUE_ID,
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "10.5",
  heightM: "7",
  floorPlanOutline: [
    { x: 0, y: 0 },
    { x: 21, y: 0 },
    { x: 21, y: 10.5 },
    { x: 0, y: 10.5 },
  ],
};

function expectWithinViewport(box: Box | null, viewport: ViewportCase): void {
  expect(box).not.toBeNull();
  if (box === null) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

function expectOutsideSceneCenter(box: Box | null, viewport: ViewportCase): void {
  expect(box).not.toBeNull();
  if (box === null) return;
  const center = {
    x: viewport.width * 0.26,
    y: viewport.height * 0.18,
    width: viewport.width * 0.48,
    height: viewport.height * 0.58,
  };
  const overlaps =
    box.x < center.x + center.width
    && box.x + box.width > center.x
    && box.y < center.y + center.height
    && box.y + box.height > center.y;
  expect(overlaps).toBe(false);
}

async function mockPlannerApis(page: Page): Promise<void> {
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({ json: { data: MOCK_CONFIG } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({ json: { data: MOCK_SPACE } });
  });
  await page.route(`${API}/public/configurations/${CONFIG_ID}/objects/batch`, (route) => {
    void route.fulfill({ json: { data: [MOCK_OBJECT] } });
  });
  await page.route(`${API}/public/configurations/${CONFIG_ID}/thumbnail`, (route) => {
    void route.fulfill({ json: { data: MOCK_CONFIG } });
  });
}

async function openPlanner(page: Page, viewport: ViewportCase): Promise<readonly string[]> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => { consoleErrors.push(error.message); });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await mockPlannerApis(page);
  await page.goto(`/plan/${CONFIG_ID}`);
  await page.waitForSelector("canvas", { timeout: 15_000 });
  return consoleErrors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > window.innerWidth + 1
  ));
  expect(hasOverflow).toBe(false);
}

test.describe("3D planner mobile shell", () => {
  for (const viewport of PHONE_VIEWPORTS) {
    test(`${viewport.name} uses touch-native chrome without clipped controls`, async ({ page }) => {
      const consoleErrors = await openPlanner(page, viewport);

      await expectNoHorizontalOverflow(page);
      await expect(page.getByTestId("planner-3d-shell")).toBeVisible();

      await expect(page.getByText("Click", { exact: true })).not.toBeVisible();
      await expect(page.getByText("Q", { exact: true })).not.toBeVisible();
      await expect(page.getByText("E", { exact: true })).not.toBeVisible();
      await expect(page.getByText("Esc", { exact: true })).not.toBeVisible();

      const sendButton = page.getByRole("button", { name: "Send to Events Team" });
      await expect(sendButton).toBeVisible();
      const sendBox = await sendButton.boundingBox();
      expectWithinViewport(sendBox, viewport);
      expectOutsideSceneCenter(sendBox, viewport);

      const topBar = page.getByTestId("mobile-planner-topbar");
      await expect(topBar).toBeVisible();
      expectWithinViewport(await topBar.boundingBox(), viewport);

      const toolbar = page.getByTestId("planner-toolbar");
      await expect(toolbar).toBeVisible();
      expectWithinViewport(await toolbar.boundingBox(), viewport);

      await expect(page.getByText(/Save Layout|Saved just now|Unsaved changes|Saving|Save failed|Offline/)).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Add" })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "View" })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "More" })).toBeVisible();

      await toolbar.getByRole("button", { name: "Add" }).click();
      await page.getByTestId("furniture-panel").getByText("6ft Round Table").click();
      const placingSheet = page.getByTestId("mobile-planner-sheet");
      await expect(placingSheet).toBeVisible();
      await expect(page.getByText("Tap to place 6ft Round Table")).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Rotate" })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(page.getByText("Don't show again")).not.toBeVisible();
      await expect(page.getByTestId("placement-hint")).not.toBeVisible();
      expectWithinViewport(await placingSheet.boundingBox(), viewport);

      expect(consoleErrors).toEqual([]);
    });
  }

  for (const viewport of TABLET_VIEWPORTS) {
    test(`${viewport.name} keeps a roomy planner layout`, async ({ page }) => {
      const consoleErrors = await openPlanner(page, viewport);

      await expectNoHorizontalOverflow(page);
      const toolbar = page.getByTestId("planner-toolbar");
      await expect(toolbar).toBeVisible();
      const toolbarBox = await toolbar.boundingBox();
      expectWithinViewport(toolbarBox, viewport);
      expect(toolbarBox?.height ?? 0).toBeGreaterThan(viewport.height * 0.75);
      expect(toolbarBox?.width ?? 0).toBeLessThanOrEqual(80);

      const sendButton = page.getByRole("button", { name: "Send to Events Team" });
      await expect(sendButton).toBeVisible();
      expectWithinViewport(await sendButton.boundingBox(), viewport);
      await expect(page.getByTestId("mobile-planner-topbar")).not.toBeVisible();

      expect(consoleErrors).toEqual([]);
    });
  }

  test("desktop keeps keyboard shortcut hints", async ({ page }) => {
    const desktop = { name: "desktop", width: 1280, height: 800 };
    const consoleErrors = await openPlanner(page, desktop);

    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Rotate" }).hover();
    await expect(page.getByText("SHORTCUT")).toBeVisible();
    await expect(page.getByText("Q / E")).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
