import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Public configuration flow
//   space picker → config creation → save flash → events sheet → enquiry
//
// Selector strategy:
//   - Space cards:        getByTestId("space-card-<slug>")
//   - SaveSendPanel:      getByTestId("save-send-panel")
//   - Enquiry form:       getByTestId("guest-enquiry-form")
//   - Toolbar buttons:    getByRole("button", { name: "…" }) via aria-label
//
// All external API calls are intercepted with page.route() so these tests
// run without a live backend. API base URL matches the VITE_API_URL default.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "e2e-venue-001";
const SPACE_ID = "e2e-space-001";
const CONFIG_ID = "e2e-config-001";
const WIDGET_COLLISION_ARTIFACT_DIR = "C:/Users/blake/omnitwin2/artifacts/t469-widget-collision-2026-06-22";

// Every active test in this file boots the real R3F planner. Running those
// canvases concurrently in separate Chromium workers contends for the shared
// GPU process and can starve both React and Playwright polling even though the
// page eventually becomes interactive. Keep this WebGL-heavy flow serial;
// Playwright can still run other spec files in parallel around it.
test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Typed mock fixtures
// ---------------------------------------------------------------------------

interface MockPlacedObject {
  readonly id: string;
  readonly configurationId: string;
  readonly assetDefinitionId: string;
  readonly positionX: string;
  readonly positionY: string;
  readonly positionZ: string;
  readonly rotationX: string;
  readonly rotationY: string;
  readonly rotationZ: string;
  readonly scale: string;
  readonly sortOrder: number;
  readonly metadata: null;
}

interface MockConfig {
  readonly id: string;
  readonly spaceId: string;
  readonly venueId: string;
  readonly userId: string | null;
  readonly name: string;
  readonly isPublicPreview: boolean;
  readonly revision: number;
  readonly objects: readonly MockPlacedObject[];
}

interface RectSnapshot {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

interface CollisionSnapshot {
  readonly status: "measured";
  readonly bottomOverlap: number;
  readonly capacityOverlap: number;
  readonly capacityBottomOverlap: number;
  readonly capacityChildrenFit: boolean;
  readonly capacityCommandDeckGap: number;
  readonly capacityCommandDeckOverlap: number;
  readonly minimapCapacityGap: number;
  readonly standaloneTruthAttached: boolean;
  readonly truthChildrenFit: boolean;
  readonly truthMinimapHorizontalOverlap: number;
  readonly truthMinimapVerticalGap: number;
  readonly truthOverlap: number;
  readonly truthStatusLineFits: boolean;
  readonly truthToolbarOverlap: number;
  readonly viewModeMinimapOverlap: number;
  readonly viewModeToolbarOverlap: number;
  readonly bottom: RectSnapshot;
  readonly capacity: RectSnapshot;
  readonly commandDeck: RectSnapshot;
  readonly minimap: RectSnapshot;
  readonly toolbar: RectSnapshot;
  readonly truth: RectSnapshot | null;
  readonly viewMode: RectSnapshot;
}

interface MissingCollisionTarget {
  readonly status: "missing-target";
  readonly missing: string;
}

type CollisionCheck = CollisionSnapshot | MissingCollisionTarget;

const MOCK_VENUE = {
  id: VENUE_ID,
  name: "Trades Hall Glasgow",
  slug: "trades-hall-glasgow",
  address: "85 Glassford Street, Glasgow G1 1UH",
  logoUrl: null,
  brandColour: null,
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

const MOCK_OBJECT: MockPlacedObject = {
  id: "e2e-obj-001",
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

function mockRoundTables(count: number): readonly MockPlacedObject[] {
  return Array.from({ length: count }, (_, i) => ({
    ...MOCK_OBJECT,
    id: `e2e-round-table-${String(i + 1)}`,
    positionX: String(i * 8),
    sortOrder: i,
  }));
}

function mockSeatedRoundTables(tableCount: number, chairsPerTable: number): readonly MockPlacedObject[] {
  const tables = mockRoundTables(tableCount);
  const chairs = Array.from({ length: tableCount * chairsPerTable }, (_, i) => {
    const tableIndex = Math.floor(i / chairsPerTable);
    const seatIndex = i % chairsPerTable;
    const angle = (Math.PI * 2 * seatIndex) / chairsPerTable;
    const tableX = tableIndex * 8;
    return {
      ...MOCK_OBJECT,
      id: `e2e-banquet-chair-${String(i + 1)}`,
      assetDefinitionId: "banquet-chair",
      positionX: (tableX + Math.cos(angle) * 1.45).toFixed(2),
      positionZ: (Math.sin(angle) * 1.45).toFixed(2),
      sortOrder: tableCount + i,
    };
  });
  return [...tables, ...chairs];
}

const MOCK_CONFIG_EMPTY: MockConfig = {
  id: CONFIG_ID,
  spaceId: SPACE_ID,
  venueId: VENUE_ID,
  userId: null,
  name: "My Layout",
  isPublicPreview: true,
  revision: 1,
  objects: [],
};

const MOCK_CONFIG_WITH_OBJECTS: MockConfig = {
  ...MOCK_CONFIG_EMPTY,
  objects: [MOCK_OBJECT],
};

// ---------------------------------------------------------------------------
// Route-mock helpers
// ---------------------------------------------------------------------------

async function mockConfigLoad(page: Page, config: MockConfig = MOCK_CONFIG_EMPTY): Promise<void> {
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({ json: { data: config } });
  });
}

async function mockSpacePickerApis(page: Page): Promise<void> {
  await page.route(`${API}/venues`, (route) => {
    void route.fulfill({ json: [MOCK_VENUE] });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces`, (route) => {
    void route.fulfill({ json: [MOCK_SPACE] });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({ json: { data: MOCK_SPACE } });
  });
}

/**
 * Wait for the requested configuration to own the interactive planner shell.
 *
 * A visible canvas is not an editor-readiness signal: R3F may replace it while
 * WebGL starts, and the planner deliberately keeps its non-3D controls usable
 * independently of renderer warm-up. The configuration id proves bootstrap
 * completed for the requested draft; the toolbar proves its actions are ready.
 */
async function waitForPlannerReady(page: Page, configId = CONFIG_ID): Promise<void> {
  const plannerShell = page.getByTestId("planner-3d-shell");
  await expect(plannerShell).toHaveAttribute("data-planner-config-id", configId, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("planner-toolbar")).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Space picker — venue landing page
// ---------------------------------------------------------------------------

// Skipped after the rebrand: `/editor` now renders the public LandingPage
// (Trades Hall marketing site) rather than the SpacePicker splash. The
// planner app moved to `/plan`, which auto-creates a Grand Hall config
// and never surfaces SpacePicker on the happy path. SpacePicker itself
// is still in the codebase as a fallback when auto-create fails —
// covered by its unit tests in components/editor/__tests__/SpacePicker.test.ts.
test.describe.skip("Space picker", () => {
  test.beforeEach(async ({ page }) => {
    await mockSpacePickerApis(page);
    await page.goto("/editor");
  });

  test("renders the venue landing page with the venue name", async ({ page }) => {
    await expect(page.getByText("Trades Hall Glasgow").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("space cards appear for each venue space returned by the API", async ({ page }) => {
    await expect(page.getByTestId("space-card-grand-hall")).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Config creation — clicking a space card
// ---------------------------------------------------------------------------

// Also skipped — same reason as "Space picker" above. Clicking a space
// card is the SpacePicker flow which is no longer reached on the happy path.
test.describe.skip("Config creation from space picker", () => {
  test("clicking a space card creates a config and enters the 3D editor", async ({ page }) => {
    await mockSpacePickerApis(page);
    // Mock the POST that creates the config
    await page.route(`${API}/public/configurations`, (route) => {
      void route.fulfill({ status: 201, json: { data: MOCK_CONFIG_EMPTY } });
    });
    // Mock the subsequent GET that loads the new config in the editor
    await mockConfigLoad(page);

    await page.goto("/editor");
    await page.getByTestId("space-card-grand-hall").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByTestId("space-card-grand-hall").click();

    // After config creation the router navigates to /editor/:configId
    await page.waitForURL(`**/plan/${CONFIG_ID}`, { timeout: 10_000 });
    await waitForPlannerReady(page);
    await expect(page.locator("canvas")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Public /plan entry — auto-created blank Grand Hall draft
// ---------------------------------------------------------------------------

test.describe("Grand Hall public blank draft", () => {
  test("opening /plan creates an empty editable hall", async ({ page }) => {
    await mockSpacePickerApis(page);
    await page.route(`${API}/public/configurations`, (route) => {
      void route.fulfill({ status: 201, json: { data: MOCK_CONFIG_EMPTY } });
    });

    await page.goto("/plan");
    await page.waitForURL(`**/plan/${CONFIG_ID}`, { timeout: 10_000 });
    await waitForPlannerReady(page);

    await expect(page.getByTestId("planner-spatial-hud")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("save-send-panel")).not.toBeAttached();
    await expect(page.getByText("Start placing furniture to grade your layout")).toBeVisible();
    await expect(page.getByText("0 placed items")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Editor with empty config — save flash, events sheet, SaveSendPanel gate
// ---------------------------------------------------------------------------

test.describe("Editor with empty config", () => {
  test.beforeEach(async ({ page }) => {
    await mockConfigLoad(page);
    await page.goto(`/plan/${CONFIG_ID}`);
    await waitForPlannerReady(page);
  });

  test("Save Layout toolbar button is visible in the editor", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Save Layout" })).toBeVisible();
  });

  test("Save Layout button aria-label changes to 'Saved just now' after a successful save", async ({ page }) => {
    // Guest (unauthenticated) save path → publicBatchSave
    await page.route(
      `${API}/public/configurations/${CONFIG_ID}/objects/batch`,
      (route) => { void route.fulfill({ json: { data: { objects: [], revision: 2 } } }); },
    );
    await page.getByRole("button", { name: "Save Layout" }).click();
    // setSaveFlash(true) fires in the .then() callback after the save resolves.
    // The label reverts after 2 s, so the 5 s timeout is safe.
    await expect(
      page.getByRole("button", { name: "Saved just now" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Events Sheet button opens the hallkeeper route in a new browser tab", async ({ page }) => {
    // The hallkeeper route is ProtectedRoute-gated. An unauthenticated public
    // editor user clicking "Events Sheet" opens a new tab at /hallkeeper/<id>
    // which immediately redirects to /login. The test verifies the button
    // triggers the navigation; the redirect itself proves route protection.
    //
    // Listen for the more-specific `popup` event on the originating page
    // (window.open from a user gesture) instead of the broader context-level
    // `page` event. The bumped 15s timeout absorbs cold-start variance when
    // the suite runs at full parallelism — the underlying dev server can
    // take noticeably longer to serve the new tab's bundle than 5s under
    // load, even though window.open fires immediately.
    const [newPage] = await Promise.all([
      page.waitForEvent("popup", { timeout: 15_000 }),
      page.getByRole("button", { name: "Events Sheet" }).click(),
    ]);
    // Initial URL targets hallkeeper; guard then redirects to /login.
    await newPage.waitForURL(/\/(hallkeeper|login)/, { timeout: 10_000 });
    expect(newPage.url()).toMatch(/\/(hallkeeper|login)/);
    await newPage.close();
  });

  test("SaveSendPanel is not in the DOM when the config has no placed objects", async ({ page }) => {
    // SaveSendPanel renders null when objects.length === 0 or configId === null.
    // With an empty config, it is never attached.
    await expect(page.getByTestId("save-send-panel")).not.toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Editor with objects loaded — SaveSendPanel + guest enquiry flow
// ---------------------------------------------------------------------------

test.describe("Editor with placed objects", () => {
  test.beforeEach(async ({ page }) => {
    await mockConfigLoad(page, MOCK_CONFIG_WITH_OBJECTS);
    await page.goto(`/plan/${CONFIG_ID}`);
    await waitForPlannerReady(page);
  });

  test("SaveSendPanel becomes visible when the loaded config has placed objects", async ({ page }) => {
    await expect(page.getByTestId("save-send-panel")).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: "Send to Events Team" }),
    ).toBeVisible();
  });

  test("SaveSendPanel clears the cockpit Truth Mode rail", async ({ page }) => {
    const sendPanel = page.getByTestId("save-send-panel");
    const truthRail = page.getByTestId("cockpit-truth-rail");

    await expect(sendPanel).toBeVisible({ timeout: 5_000 });
    await expect(truthRail).toBeVisible({ timeout: 5_000 });

    const sendBox = await sendPanel.boundingBox();
    const railBox = await truthRail.boundingBox();

    expect(sendBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    if (sendBox === null || railBox === null) return;

    expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(railBox.x - 8);
  });

  test("Layout grade card keeps long recommendation copy inside the panel", async ({ page }) => {
    await page.setViewportSize({ width: 1493, height: 1053 });
    await mockConfigLoad(page, { ...MOCK_CONFIG_EMPTY, objects: mockSeatedRoundTables(18, 8) });
    await page.goto(`/plan/${CONFIG_ID}`);
    await waitForPlannerReady(page);
    await expect(page.getByTestId("planner-layout-grade")).toBeVisible({ timeout: 5_000 });

    const layout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="planner-layout-grade"]');
      if (panel === null) return { status: "missing-panel" as const };

      const children = [
        panel.querySelector<HTMLElement>(".planner-spatial-hud__title"),
        panel.querySelector<HTMLElement>(".planner-spatial-hud__grade-row"),
        panel.querySelector<HTMLElement>(".planner-spatial-hud__grade-recommendation"),
      ];
      if (children.some((child) => child === null)) return { status: "missing-child" as const };

      const panelRect = panel.getBoundingClientRect();
      const childRects = children.map((child) => {
        if (child === null) throw new Error("unreachable");
        const rect = child.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
        };
      });
      const inset = 8;

      return {
        status: "measured" as const,
        fits: childRects.every((rect) =>
          rect.left >= panelRect.left + inset
          && rect.right <= panelRect.right - inset
          && rect.top >= panelRect.top + inset
          && rect.bottom <= panelRect.bottom - inset,
        ),
        panel: {
          bottom: panelRect.bottom,
          left: panelRect.left,
          right: panelRect.right,
          top: panelRect.top,
        },
        children: childRects,
      };
    });

    expect(layout.status).toBe("measured");
    if (layout.status === "measured") {
      expect(layout.fits).toBe(true);
    }
  });

  test("Plan View widget clears the Capacity HUD and Event Phase Graph", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1493, height: 1053 });
    await page.evaluate(() => {
      window.localStorage.removeItem("venviewer:floating-widget:cockpit-minimap:v2");
    });
    await mockConfigLoad(page, { ...MOCK_CONFIG_EMPTY, objects: mockSeatedRoundTables(18, 8) });
    await page.goto(`/plan/${CONFIG_ID}`);
    await waitForPlannerReady(page);

    const minimap = page.locator("[data-floating-widget-id='cockpit-minimap']");
    const viewMode = page.locator("[data-floating-widget-id='planner-view-mode']");
    await expect(minimap).toBeVisible({ timeout: 5_000 });
    await expect(viewMode).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("truth-mode-indicator")).not.toBeAttached();
    await expect(page.getByTestId("cockpit-truth-rail")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("planner-capacity-panel")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("cockpit-bottom")).toBeVisible({ timeout: 5_000 });

    const collision = await page.evaluate<CollisionCheck>(() => {
      function snapshot(selector: string): RectSnapshot | null {
        const element = document.querySelector<HTMLElement>(selector);
        if (element === null) return null;
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
        };
      }

      function overlapArea(a: RectSnapshot, b: RectSnapshot): number {
        const left = Math.max(a.left, b.left);
        const right = Math.min(a.right, b.right);
        const top = Math.max(a.top, b.top);
        const bottom = Math.min(a.bottom, b.bottom);
        return Math.max(0, right - left) * Math.max(0, bottom - top);
      }

      function childrenFitInside(parentSelector: string, inset: number): boolean {
        const parent = document.querySelector<HTMLElement>(parentSelector);
        if (parent === null) return false;
        const parentRect = parent.getBoundingClientRect();
        const children = Array.from(parent.children);
        return children.every((child) => {
          const rect = child.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return true;
          return rect.left >= parentRect.left + inset
            && rect.right <= parentRect.right - inset
            && rect.top >= parentRect.top + inset
            && rect.bottom <= parentRect.bottom - inset;
        });
      }

      function elementFitsInside(parentSelector: string, childSelector: string, inset: number): boolean {
        const parent = document.querySelector<HTMLElement>(parentSelector);
        const child = document.querySelector<HTMLElement>(childSelector);
        if (parent === null || child === null) return false;
        const parentRect = parent.getBoundingClientRect();
        const rect = child.getBoundingClientRect();
        return rect.left >= parentRect.left + inset
          && rect.right <= parentRect.right - inset
          && rect.top >= parentRect.top + inset
          && rect.bottom <= parentRect.bottom - inset;
      }

      function horizontalOverlap(a: RectSnapshot, b: RectSnapshot): number {
        return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      }

      function axisClearance(a: RectSnapshot, b: RectSnapshot): number {
        const horizontalGap = Math.max(a.left - b.right, b.left - a.right);
        const verticalGap = Math.max(a.top - b.bottom, b.top - a.bottom);
        return Math.max(horizontalGap, verticalGap);
      }

      const minimapRect = snapshot("[data-floating-widget-id='cockpit-minimap']");
      if (minimapRect === null) return { status: "missing-target", missing: "cockpit-minimap" };

      const capacityRect = snapshot("[data-testid='planner-capacity-panel']");
      if (capacityRect === null) return { status: "missing-target", missing: "planner-capacity-panel" };

      const truthRect = snapshot("[data-testid='truth-mode-indicator']");

      const bottomRect = snapshot("[data-testid='cockpit-bottom']");
      if (bottomRect === null) return { status: "missing-target", missing: "cockpit-bottom" };

      const commandDeckRect = snapshot("[data-testid='planner-command-deck']");
      if (commandDeckRect === null) return { status: "missing-target", missing: "planner-command-deck" };

      const toolbarRect = snapshot("[data-testid='planner-toolbar']");
      if (toolbarRect === null) return { status: "missing-target", missing: "planner-toolbar" };

      const viewModeRect = snapshot("[data-floating-widget-id='planner-view-mode']");
      if (viewModeRect === null) return { status: "missing-target", missing: "planner-view-mode" };

      return {
        status: "measured",
        minimap: minimapRect,
        capacity: capacityRect,
        truth: truthRect,
        bottom: bottomRect,
        commandDeck: commandDeckRect,
        toolbar: toolbarRect,
        viewMode: viewModeRect,
        capacityOverlap: overlapArea(minimapRect, capacityRect),
        capacityBottomOverlap: overlapArea(capacityRect, bottomRect),
        capacityChildrenFit: childrenFitInside("[data-testid='planner-capacity-panel']", 6),
        capacityCommandDeckGap: axisClearance(capacityRect, commandDeckRect),
        capacityCommandDeckOverlap: overlapArea(capacityRect, commandDeckRect),
        minimapCapacityGap: axisClearance(minimapRect, capacityRect),
        standaloneTruthAttached: truthRect !== null,
        truthChildrenFit: truthRect === null || childrenFitInside("[data-testid='truth-mode-toggle']", 4),
        truthMinimapHorizontalOverlap: truthRect === null ? 0 : horizontalOverlap(minimapRect, truthRect),
        truthMinimapVerticalGap: truthRect === null ? Number.POSITIVE_INFINITY : minimapRect.top - truthRect.bottom,
        truthOverlap: truthRect === null ? 0 : overlapArea(minimapRect, truthRect),
        truthStatusLineFits: truthRect === null || elementFitsInside(
          "[data-testid='truth-mode-toggle']",
          "[data-testid='truth-mode-status-line']",
          4,
        ),
        truthToolbarOverlap: truthRect === null ? 0 : overlapArea(truthRect, toolbarRect),
        viewModeMinimapOverlap: overlapArea(viewModeRect, minimapRect),
        viewModeToolbarOverlap: overlapArea(viewModeRect, toolbarRect),
        bottomOverlap: overlapArea(minimapRect, bottomRect),
      };
    });

    const screenshotPath = `${WIDGET_COLLISION_ARTIFACT_DIR}/plan-minimap-capacity-clear.png`;
    await mkdir(dirname(screenshotPath), { recursive: true });
    const screenshot = await page.screenshot({ path: screenshotPath, fullPage: false });
    await testInfo.attach("plan-minimap-collision-proof", {
      body: screenshot,
      contentType: "image/png",
    });

    expect(collision.status).toBe("measured");
    if (collision.status === "measured") {
      expect(collision.capacityOverlap).toBe(0);
      expect(collision.truthOverlap).toBe(0);
      expect(collision.bottomOverlap).toBe(0);
      expect(collision.capacityBottomOverlap).toBe(0);
      expect(collision.capacityCommandDeckOverlap).toBe(0);
      expect(collision.capacityCommandDeckGap).toBeGreaterThanOrEqual(8);
      expect(collision.capacityChildrenFit).toBe(true);
      expect(collision.minimapCapacityGap).toBeGreaterThanOrEqual(8);
      expect(collision.standaloneTruthAttached).toBe(false);
      expect(collision.truthChildrenFit).toBe(true);
      expect(collision.truthStatusLineFits).toBe(true);
      expect(collision.truthToolbarOverlap).toBe(0);
      expect(collision.viewModeToolbarOverlap).toBe(0);
      expect(collision.viewModeMinimapOverlap).toBe(0);
      if (collision.truthMinimapHorizontalOverlap > 0) {
        expect(collision.truthMinimapVerticalGap).toBeGreaterThanOrEqual(16);
      }
      expect(collision.minimap.bottom).toBeLessThanOrEqual(collision.bottom.top - 8);
      expect(collision.capacity.bottom).toBeLessThanOrEqual(collision.bottom.top - 8);
    }
  });

  test("Send to Events Team button opens the guest enquiry form", async ({ page }) => {
    // flushAutoSave + thumbnail upload are best-effort — mock both so the
    // modal is not blocked by network errors in test.
    await page.route(
      `${API}/public/configurations/${CONFIG_ID}/objects/batch`,
      (route) => { void route.fulfill({ json: { data: { objects: [MOCK_OBJECT], revision: 2 } } }); },
    );
    await page.route(
      `${API}/public/configurations/${CONFIG_ID}/thumbnail`,
      (route) => { void route.fulfill({ json: { data: MOCK_CONFIG_WITH_OBJECTS } }); },
    );

    await page.getByRole("button", { name: "Send to Events Team" }).click();
    await expect(page.getByTestId("guest-enquiry-form")).toBeVisible({ timeout: 8_000 });
  });

  test("submitting the enquiry with a valid email shows the success state", async ({ page }) => {
    await page.route(
      `${API}/public/configurations/${CONFIG_ID}/objects/batch`,
      (route) => { void route.fulfill({ json: { data: { objects: [MOCK_OBJECT], revision: 2 } } }); },
    );
    await page.route(
      `${API}/public/configurations/${CONFIG_ID}/thumbnail`,
      (route) => { void route.fulfill({ json: { data: MOCK_CONFIG_WITH_OBJECTS } }); },
    );
    await page.route(
      `${API}/public/enquiries`,
      (route) => { void route.fulfill({ json: { enquiryId: "e2e-enq-001", message: "Enquiry received" } }); },
    );

    // Open the enquiry modal
    await page.getByRole("button", { name: "Send to Events Team" }).click();
    await page.getByTestId("guest-enquiry-form").waitFor({ state: "visible", timeout: 8_000 });

    // Fill the required email field and submit
    await page.locator("#ge-email").fill("test@example.com");
    await page
      .getByTestId("guest-enquiry-form")
      .getByRole("button", { name: "Send to Events Team" })
      .click();

    // Success state renders with this heading when no name was entered
    await expect(
      page.getByRole("heading", { name: "Your layout is on its way" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
