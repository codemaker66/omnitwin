import { expect, test, type Page } from "@playwright/test";
import type { Camera, Mesh, Scene, WebGLRenderer } from "three";
import type { BatchObjectInput } from "../src/api/configurations.js";

declare global {
  interface Window {
    __venPerf?: { gl: WebGLRenderer; scene: Scene; camera: Camera };
  }
}

const API = "http://localhost:3001";
const CONFIG_ID = "e2e-mobile-config";
const VENUE_ID = "e2e-mobile-venue";
const SPACE_ID = "e2e-mobile-space";
const TABLE_ASSET_ID = "a1ef4d89-7786-5878-bee1-87b3fac28200";

const TRUTH_MODE_SUMMARY_FIXTURE = {
  targetType: "configuration",
  targetId: CONFIG_ID,
  source: "Planning context - not a measured source of record",
  confidence: "unknown",
  assumption: "Human review required before reliance",
  evidenceStatus: "not_checked",
  reviewGate: "Human review required",
  staleState: "unknown",
  safeWording: ["Planning evidence - human review required before operational reliance."],
  humanReviewRequired: true,
  counts: {
    evidenceItems: 0,
    checkResults: 0,
    assumptions: 0,
    reviewGates: 0,
    staleEvents: 0,
  },
} as const;

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
  assetDefinitionId: TABLE_ASSET_ID,
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
  revision: 1,
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

async function mockPlannerApis(page: Page, onSave?: (objects: readonly BatchObjectInput[]) => void): Promise<void> {
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({ json: { data: {
      id: VENUE_ID, name: "Trades Hall", slug: "trades-hall",
      address: "85 Glassford Street", logoUrl: null, brandColour: null,
      spaces: [MOCK_SPACE],
    } } });
  });
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({ json: { data: MOCK_CONFIG } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({ json: { data: MOCK_SPACE } });
  });
  await page.route(`${API}/public/configurations/${CONFIG_ID}/objects/batch`, (route) => {
    const body = route.request().postDataJSON() as { readonly objects: readonly BatchObjectInput[] };
    onSave?.(body.objects);
    const objects = body.objects.map((object, index) => ({
      ...object, id: object.id ?? `e2e-saved-${String(index)}`, configurationId: CONFIG_ID,
      positionX: String(object.positionX), positionY: String(object.positionY), positionZ: String(object.positionZ),
      rotationX: String(object.rotationX), rotationY: String(object.rotationY), rotationZ: String(object.rotationZ),
      scale: String(object.scale), metadata: object.metadata ?? null,
    }));
    void route.fulfill({ json: { data: { objects, revision: 2 } } });
  });
  await page.route(`${API}/public/configurations/${CONFIG_ID}/thumbnail`, (route) => {
    void route.fulfill({ json: { data: MOCK_CONFIG } });
  });
  await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
    void route.fulfill({ json: { data: null } });
  });
  await page.route(`${API}/truth-mode/summary*`, (route) => {
    void route.fulfill({ json: { data: TRUTH_MODE_SUMMARY_FIXTURE } });
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
    test(`${viewport.name} uses touch-native chrome without clipped controls`, async ({ page }, testInfo) => {
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

      await expect(topBar.getByText("Layout saved", { exact: true })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Add" })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "View" })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "More" })).toBeVisible();

      const add = toolbar.getByRole("button", { name: "Add", exact: true });
      await add.click();
      const catalogue = page.getByRole("region", { name: "Furniture catalogue", exact: true });
      await expect(catalogue).toBeVisible();
      // Measure the settled sheet, not its intentional entrance translation.
      await expect.poll(async () => {
        const box = await catalogue.boundingBox();
        return box !== null && box.x >= -1 && box.y >= -1
          && box.x + box.width <= viewport.width + 1
          && box.y + box.height <= viewport.height + 1;
      }, { message: "catalogue entrance settles fully inside the viewport" }).toBe(true);
      await catalogue.getByRole("button", { name: "Close furniture catalogue" }).click();
      await expect(catalogue).toBeHidden();
      await expect(add).toBeFocused();
      await add.click();
      await catalogue.getByRole("textbox", { name: "Search furniture" }).focus();
      await page.keyboard.press("Escape");
      await expect(catalogue).toBeHidden();
      await expect(add).toBeFocused();
      await add.click();
      const item = catalogue.getByText("6ft Round Table", { exact: true });
      await item.scrollIntoViewIfNeeded();
      await expect.poll(() => item.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), { message: "catalogue item must receive the pointer above the open schedule" }).toBe(true);
      if (viewport.width === 320) {
        await testInfo.attach("small-phone-catalogue", { body: await page.screenshot(), contentType: "image/png" });
      }
      await item.click();
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
      const tools = page.getByRole("toolbar", { name: "Planner tools" });
      await expect(tools).toBeVisible();
      expectWithinViewport(await tools.boundingBox(), viewport);
      for (const name of ["Select", "Move", "Rotate", "Scale", "Measure"]) {
        const tool = tools.getByRole("button", { name, exact: true });
        await expect(tool).toBeVisible();
        expectWithinViewport(await tool.boundingBox(), viewport);
      }
      // The current reference viewer discloses extra tools instead of using
      // the retired full-height rail. Verify the real controls remain usable.
      const more = page.getByRole("button", { name: "More planner tools", exact: true });
      await more.click();
      await expect(more).toHaveAttribute("aria-expanded", "true");
      const toolbar = page.getByTestId("planner-toolbar");
      await expect(toolbar).toBeVisible();
      expectWithinViewport(await toolbar.boundingBox(), viewport);
      await expect(toolbar.getByRole("button", { name: "Add Furniture", exact: true })).toBeVisible();
      await more.click();
      await expect(toolbar).toBeHidden();

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
    await page.getByRole("button", { name: "More planner tools", exact: true }).click();
    await page.getByTestId("planner-toolbar").getByRole("button", { name: "Rotate", exact: true }).hover();
    await expect(page.getByText("SHORTCUT")).toBeVisible();
    await expect(page.getByText("Q / E")).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});


test.describe("Small phone canvas placement", () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true });

  test("a table chosen above the expanded schedule is placed and saved through touch", async ({ page }, testInfo) => {
    let savedObjects: readonly BatchObjectInput[] = [];
    await mockPlannerApis(page, (objects) => { savedObjects = objects; });
    await page.goto(`/plan/${CONFIG_ID}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cockpit-shell")).toBeVisible();
    const toolbar = page.getByTestId("planner-toolbar");
    const schedule = page.getByRole("contentinfo", { name: "Your event schedule" });
    await expect(schedule.getByRole("button", { name: "Hide event schedule" })).toHaveAttribute("aria-expanded", "true");
    const add = toolbar.getByRole("button", { name: "Add", exact: true });
    await add.tap();
    const catalogue = page.getByRole("region", { name: "Furniture catalogue" });
    const table = catalogue.getByText("6ft Round Table", { exact: true });
    await table.scrollIntoViewIfNeeded();
    const close = catalogue.getByRole("button", { name: "Close furniture catalogue" });
    expectWithinViewport(await close.boundingBox(), { name: "small phone", width: 320, height: 568 });
    await expect.poll(() => close.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), { message: "Close stays reachable after catalogue scrolling" }).toBe(true);
    await close.tap();
    await expect(catalogue).toBeHidden();
    await add.tap();
    await table.tap();
    await expect(page.getByTestId("mobile-planner-sheet")).toBeVisible();

    // Read actual floor triangles and project interior samples through the live
    // camera. This chooses a visible floor point without moving the camera,
    // seeding placed objects, forcing input or closing the schedule.
    const visibleFloorPoint = async (): Promise<{ x: number; y: number } | null> => page.evaluate(() => {
      const runtime = window.__venPerf;
      if (runtime === undefined) return null;
      const floor = runtime.scene.getObjectByName("planner-interaction-floor") as Mesh | undefined;
      if (floor === undefined) return null;
      const positions = floor.geometry.getAttribute("position");
      const indices = floor.geometry.getIndex();
      const count = indices?.count ?? positions.count;
      const bounds = runtime.gl.domElement.getBoundingClientRect();
      const obstructions = Array.from(document.querySelectorAll(".generated-furniture-proxy-badge, .room-resolve-caption, .mobile-planner-utilities, [data-testid=mobile-planner-sheet], [data-testid=mobile-planner-topbar], .client-event-dock, [data-testid=planner-toolbar]"))
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
        }).map((element) => element.getBoundingClientRect());
      for (let offset = 0; offset + 2 < count; offset += 3) {
        for (let a = 1; a < 8; a += 1) {
          for (let b = 1; b < 8 - a; b += 1) {
            const weights = [a / 8, b / 8, 1 - (a + b) / 8];
            const point = runtime.camera.position.clone().set(0, 0, 0);
            for (let corner = 0; corner < 3; corner += 1) {
              const index = indices?.getX(offset + corner) ?? offset + corner;
              const weight = weights[corner] ?? 0;
              point.x += positions.getX(index) * weight;
              point.y += positions.getY(index) * weight;
              point.z += positions.getZ(index) * weight;
            }
            point.applyMatrix4(floor.matrixWorld).project(runtime.camera);
            const x = bounds.x + (point.x + 1) * bounds.width / 2;
            const y = bounds.y + (1 - point.y) * bounds.height / 2;
            // A touch needs useful clear space, not a one-pixel gap between overlays.
            const offsets = [-22, 0, 22];
            const clearTouchArea = offsets.every((dx) => offsets.every((dy) => (
              document.elementFromPoint(x + dx, y + dy) === runtime.gl.domElement
            )));
            const visuallyClear = obstructions.every((box) => (
              x + 22 <= box.left || x - 22 >= box.right || y + 22 <= box.top || y - 22 >= box.bottom
            ));
            if (point.z >= -1 && point.z <= 1 && clearTouchArea && visuallyClear) return { x, y };
          }
        }
      }
      return null;
    });
    await testInfo.attach("small-phone-placement-geometry", {
      body: JSON.stringify(await page.evaluate(() => {
        const runtime = window.__venPerf;
        const floor = runtime?.scene.getObjectByName("planner-interaction-floor") as Mesh | undefined;
        return {
          runtimePresent: runtime !== undefined,
          floorPresent: floor !== undefined,
          positionCount: floor?.geometry.getAttribute("position").count,
          camera: runtime?.camera.position.toArray(),
          surfaces: Array.from(document.querySelectorAll("canvas, .cockpit-stage, .client-event-dock, [data-testid=mobile-planner-sheet], [role=status]")).map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return {
              tag: element.tagName, name: element.getAttribute("aria-label"), className: element.className,
              text: element.tagName === "CANVAS" ? "" : element.textContent?.slice(0, 100),
              bounds: { x, y, width, height },
            };
          }),
        };
      }), null, 2),
      contentType: "application/json",
    });
    await expect.poll(visibleFloorPoint, { message: "expanded schedule leaves a clear 44px floor target available for touch placement" }).not.toBeNull();
    const point = await visibleFloorPoint();
    expect(point).not.toBeNull();
    if (point === null) throw new Error("No visible floor point");
    await testInfo.attach("small-phone-clear-floor", { body: JSON.stringify({ point, touchTargetSizePx: 44 }), contentType: "application/json" });
    await testInfo.attach("small-phone-before-touch", { body: await page.screenshot(), contentType: "image/png" });
    await page.touchscreen.tap(point.x, point.y);
    const chairs = page.getByRole("dialog");
    await expect(chairs.getByRole("button", { name: "Table Only", exact: true })).toBeVisible();
    await chairs.getByRole("button", { name: "Table Only", exact: true }).tap();
    await expect(chairs).toBeHidden();
    await page.getByRole("button", { name: "Send to Events Team" }).tap();
    await expect.poll(() => savedObjects.length).toBe(2);
    expect(savedObjects.every((object) => object.assetDefinitionId === TABLE_ASSET_ID)).toBe(true);
    expect(savedObjects.some((object) => object.id === MOCK_OBJECT.id)).toBe(true);
    await expect(page.getByRole("dialog")).toBeVisible();
    await testInfo.attach("small-phone-placed-table", { body: await page.screenshot(), contentType: "image/png" });
  });
});
