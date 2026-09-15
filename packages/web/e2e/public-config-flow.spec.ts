import { test, expect, type Locator, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Public configuration flow
//   space picker → config creation → save state → events sheet → enquiry
//
// Selector strategy:
//   - Space cards:        getByTestId("space-card-<slug>")
//   - SaveSendPanel:      getByTestId("save-send-panel")
//   - Enquiry form:       getByTestId("guest-enquiry-form")
//   - Toolbar buttons:    getByRole("button", { name: "…" }) via aria-label
//
// Configuration, venue and enquiry requests use page.route() fixtures; the
// rendered planner and its real controls remain active. API base URL matches
// the VITE_API_URL default.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "e2e-venue-001";
const SPACE_ID = "e2e-space-001";
const CONFIG_ID = "e2e-config-001";

// Keep this file's real R3F canvases sequential without cascading one failure
// into unrelated unrun cases. Each test creates its own page and API fixtures.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: null });
  });
  await mockSpacePickerApis(page);
});

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
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({ json: { data: { ...MOCK_VENUE, spaces: [MOCK_SPACE] } } });
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
  await expect(page.getByRole("toolbar", { name: "Planner tools", exact: true })).toBeVisible({ timeout: 15_000 });
}

async function openPlannerTools(page: Page): Promise<Locator> {
  const toggle = page.getByRole("button", { name: "More planner tools", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const tools = page.getByTestId("planner-toolbar");
  await expect(tools).toBeVisible();
  return tools;
}

async function expectClear(a: Locator, b: Locator, gap = 8): Promise<void> {
  await expect(a).toBeVisible();
  await expect(b).toBeVisible();
  const aBox = await a.boundingBox();
  const bBox = await b.boundingBox();
  expect(aBox).not.toBeNull();
  expect(bBox).not.toBeNull();
  if (aBox === null || bBox === null) throw new Error("Visible panels must have bounds");
  const clearance = Math.max(
    aBox.x - bBox.x - bBox.width,
    bBox.x - aBox.x - aBox.width,
    aBox.y - bBox.y - bBox.height,
    bBox.y - aBox.y - aBox.height,
  );
  expect(clearance).toBeGreaterThanOrEqual(gap);
}

async function expectPanelCopyContained(panel: Locator, child: Locator): Promise<void> {
  await child.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  });
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  if (panelBox === null) throw new Error("Panel must have bounds");
  // A fixed-width child can fit while its text overflows. Measure both after
  // scrolling each row into the actual dock's visible area.
  const bounds = await child.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = element.getBoundingClientRect();
    const text = range.getBoundingClientRect();
    return {
      left: Math.min(rect.left, text.left),
      right: Math.max(rect.right, text.right),
      top: Math.min(rect.top, text.top),
      bottom: Math.max(rect.bottom, text.bottom),
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(panelBox.x + 8);
  expect(bounds.right).toBeLessThanOrEqual(panelBox.x + panelBox.width - 8);
  expect(bounds.top).toBeGreaterThanOrEqual(panelBox.y + 8);
  expect(bounds.bottom).toBeLessThanOrEqual(panelBox.y + panelBox.height - 8);
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

    const inspector = page.getByRole("complementary", { name: "Furniture inspector" });
    await expect(inspector).toBeVisible();
    for (const label of ["Tables", "Placed chairs", "Objects"]) {
      await expect(inspector.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) })
        .locator("dd")).toHaveText("0");
    }
    await expect(inspector.getByRole("button", { name: "Add furniture", exact: true })).toBeEnabled();
    await expect(page.getByTestId("save-send-panel")).not.toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Editor with empty config — save state, events sheet, SaveSendPanel gate
// ---------------------------------------------------------------------------

test.describe("Editor with empty config", () => {
  test.beforeEach(async ({ page }) => {
    await mockConfigLoad(page);
    await page.goto(`/plan/${CONFIG_ID}`);
    await waitForPlannerReady(page);
  });

  test("Saved layout action is visible in the editor toolbar", async ({ page }) => {
    const tools = await openPlannerTools(page);
    await expect(tools.getByRole("button", { name: "Layout saved", exact: true })).toBeVisible();
  });

  test("Save action reports pending and saved states for a successful public request", async ({ page }) => {
    let finishSave: (() => void) | undefined;
    const saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
    let saveRequests = 0;
    await page.route(`${API}/public/configurations/${CONFIG_ID}/objects/batch`, async (route) => {
      saveRequests += 1;
      await saveGate;
      await route.fulfill({ json: { data: { objects: [], revision: 2 } } });
    });
    const tools = await openPlannerTools(page);
    try {
      await tools.getByRole("button", { name: "Layout saved", exact: true }).click();
      await expect.poll(() => saveRequests).toBe(1);
      const pending = tools.getByRole("button", { name: /^Saving/ });
      await expect(pending).toBeVisible();
      await expect(pending).toBeDisabled();
    } finally {
      finishSave?.();
    }
    await expect(tools.getByRole("button", { name: "Layout saved", exact: true })).toBeEnabled();
    await expect(page.getByRole("banner", { name: "Room and save status" })
      .getByRole("status")).toHaveText("Layout saved");
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
    const tools = await openPlannerTools(page);
    const [newPage] = await Promise.all([
      page.waitForEvent("popup", { timeout: 15_000 }),
      tools.getByRole("button", { name: "Events Sheet", exact: true }).click(),
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
    const tools = await openPlannerTools(page);
    await tools.getByText("Recorded evidence", { exact: true }).click();
    await expect(truthRail).toBeVisible();
    await truthRail.scrollIntoViewIfNeeded();
    await expectClear(sendPanel, truthRail);
    await expect(truthRail).toContainText("human review required");
  });

  test("Layout evidence keeps long recommendation copy inside the panel", async ({ page }) => {
    await page.setViewportSize({ width: 1493, height: 1053 });
    await mockConfigLoad(page, { ...MOCK_CONFIG_EMPTY, objects: mockSeatedRoundTables(18, 8) });
    await page.goto(`/plan/${CONFIG_ID}`);
    await waitForPlannerReady(page);
    await page.getByRole("navigation", { name: "Planner lenses" })
      .getByRole("button", { name: "Evidence", exact: true }).click();
    const panel = page.getByTestId("evidence-lens-panel");
    await expect(panel).toBeVisible();
    const recommendations = panel.locator('[data-testid^="evidence-check-"] .lens-panel__row-meta');
    await expect(recommendations).not.toHaveCount(0);
    const copy = await recommendations.allTextContents();
    expect(copy.some((text) => text.length > 100)).toBe(true);
    for (const recommendation of await recommendations.all()) {
      await expectPanelCopyContained(panel, recommendation);
    }
    await expectPanelCopyContained(panel, panel.locator(".lens-panel__footer"));
    await expect(panel.locator(".lens-panel__footer")).toContainText("human review");
  });

  test("Plan navigation and capacity controls clear the event schedule and command deck", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1493, height: 1053 });
    await mockConfigLoad(page, { ...MOCK_CONFIG_EMPTY, objects: mockSeatedRoundTables(18, 8) });
    await page.goto(`/plan/${CONFIG_ID}`);
    await waitForPlannerReady(page);

    // Navigation and recorded evidence live in the Design lens's disclosure.
    // They are embedded in its scrolling menu, not floating over capacity.
    const tools = await openPlannerTools(page);
    await tools.getByText("Plan navigation", { exact: true }).click();
    const minimap = page.getByTestId("cockpit-minimap-embedded");
    await expect(minimap.getByRole("complementary", { name: "Plan view minimap" })).toBeVisible();
    await minimap.scrollIntoViewIfNeeded();
    const viewMode = page.getByRole("group", { name: "View mode", exact: true });
    const schedule = page.getByRole("contentinfo", { name: "Your event schedule" });
    const commandDeck = page.getByRole("region", { name: "Planner command deck" });
    await expectClear(tools, viewMode);
    await expectClear(tools, schedule);
    await expectClear(tools, commandDeck);
    await tools.getByText("Recorded evidence", { exact: true }).click();
    const truth = page.getByTestId("cockpit-truth-rail");
    await truth.scrollIntoViewIfNeeded();
    await expect(truth).toBeVisible();
    await expectClear(minimap, truth);
    await expect(page.getByTestId("truth-mode-indicator")).not.toBeAttached();
    await testInfo.attach("plan-navigation-and-evidence", {
      body: await page.screenshot({ path: testInfo.outputPath("plan-navigation-and-evidence.png") }),
      contentType: "image/png",
    });

    await page.getByRole("button", { name: "More planner tools", exact: true }).click();
    await expect(tools).not.toBeAttached();
    await page.getByRole("navigation", { name: "Planner lenses" })
      .getByRole("button", { name: "Guests", exact: true }).click();
    const capacity = page.getByTestId("guests-lens-panel");
    await expect(capacity).toBeVisible();
    const seats = capacity.locator(".lens-panel__metric").filter({ hasText: "Seats placed" });
    await expect(seats.locator(".lens-panel__metric-value")).toHaveText("144");
    await expectClear(capacity, commandDeck);
    await expectClear(capacity, schedule);
    await expectClear(capacity, viewMode);
    for (const metric of await capacity.locator(".lens-panel__metric").all()) {
      await expectPanelCopyContained(capacity, metric);
    }
    await expectPanelCopyContained(capacity, capacity.locator(".lens-panel__footer"));
    await expect(capacity.locator(".lens-panel__footer")).toContainText("Not occupancy or fire limits");
    await testInfo.attach("capacity-controls-clear", {
      body: await page.screenshot({ path: testInfo.outputPath("capacity-controls-clear.png") }),
      contentType: "image/png",
    });
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
      page.getByRole("heading", { name: "Layout sent" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
