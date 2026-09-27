import { test, expect, type Page } from "@playwright/test";
import { HallkeeperSheetV2Schema, type HallkeeperSheetV2 } from "@omnitwin/types";
import { edgeContrast, unreadableText } from "./support/readability.js";

// ---------------------------------------------------------------------------
// E2E: Hallkeeper page — events sheet web view
//
// The room is the main heading; the event is its subtitle. Setup categories
// reveal each phase's rows while the full manifest remains printable. Review
// metadata is visible in the summary/brief and on the printed approval stamp.
// API fixtures are intercepted before transport, so these tests exercise the
// client workflow and runtime contract, not server-side authorization.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const CONFIG_ID = "10000000-0000-4000-8000-000000000001";

// ---------------------------------------------------------------------------
// Runtime-validated standalone sheet fixture
// ---------------------------------------------------------------------------

// Validate the fixture at the same boundary as the page. Invalid UUIDs must
// fail here rather than masquerading as missing hallkeeper controls.
const MOCK_SHEET = HallkeeperSheetV2Schema.parse({
  venue: {
    name: "Trades Hall Glasgow",
    address: "85 Glassford Street, Glasgow G1 1UH",
    logoUrl: null,
    timezone: "Europe/London",
  },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10, heightM: 7 },
  config: { id: CONFIG_ID, name: "Annual Gala", layoutStyle: "dinner-banquet", guestCount: 120 },
  timing: null,
  instructions: null,
  phases: [
    {
      phase: "structure",
      zones: [
        { zone: "North wall", rows: [
          { key: "structure|North wall|Stage Platform|0", name: "Stage Platform", category: "stage", qty: 1, afterDepth: 0, isAccessory: false, notes: "" },
        ] },
      ],
    },
    {
      phase: "furniture",
      zones: [
        { zone: "Centre", rows: [
          { key: "furniture|Centre|6ft Round Table with 10 chairs|0", name: "6ft Round Table with 10 chairs", category: "table", qty: 10, afterDepth: 0, isAccessory: false, notes: "" },
        ] },
      ],
    },
    {
      phase: "dress",
      zones: [
        { zone: "Centre", rows: [
          { key: "dress|Centre|Ivory Tablecloth|0", name: "Ivory Tablecloth", category: "decor", qty: 10, afterDepth: 0, isAccessory: true, notes: "" },
          { key: "dress|Centre|Gold Organza Runner|1", name: "Gold Organza Runner", category: "decor", qty: 10, afterDepth: 1, isAccessory: true, notes: "" },
        ] },
      ],
    },
  ],
  totals: {
    entries: [
      { name: "6ft Round Table with 10 chairs", category: "table", qty: 10 },
      { name: "Gold Organza Runner", category: "decor", qty: 10 },
      { name: "Ivory Tablecloth", category: "decor", qty: 10 },
      { name: "Stage Platform", category: "stage", qty: 1 },
    ],
    totalRows: 4,
    totalItems: 31,
  },
  diagramUrl: null,
  webViewUrl: `http://localhost:5173/hallkeeper/${CONFIG_ID}`,
  generatedAt: "2026-04-13T10:00:00.000Z",
  approval: null,
});

// ---------------------------------------------------------------------------
// Route-mock helper — fulfils /v2 (new) and leaves /data (v1) unmocked
// so a stale consumer fails loud rather than pretending to work.
// ---------------------------------------------------------------------------

async function mockSheetData(page: Page, data: HallkeeperSheetV2 = MOCK_SHEET): Promise<void> {
  const validated = HallkeeperSheetV2Schema.parse(data);
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, (route) => {
    void route.fulfill({ json: { data: validated } });
  });
  // These standalone legacy sheets have no separately linked event/context or
  // review snapshot. Return their explicit unavailable states without a live API.
  await page.route(`${API}/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({ status: 403, json: { error: "No linked context in this fixture", code: "FORBIDDEN" } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/available-transitions`, (route) => {
    void route.fulfill({ status: 404, json: { error: "No review record", code: "NOT_FOUND" } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/snapshot/latest`, (route) => {
    void route.fulfill({ status: 404, json: { error: "No snapshot", code: "NOT_FOUND" } });
  });
  // Mock the progress endpoint — starts with no checked rows
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/progress`, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({ json: { data: { configId: CONFIG_ID, checked: {} } } });
    } else if (route.request().method() === "PATCH") {
      // Optimistic UI — the page updates locally before the PATCH resolves
      const body = route.request().postDataJSON() as { rowKey: string; checked?: unknown };
      expect(typeof body.checked).toBe("boolean");
      const checked = body.checked;
      void route.fulfill({ json: { data: { configId: CONFIG_ID, rowKey: body.rowKey, checked } } });
    } else {
      void route.continue();
    }
  });
}

// ---------------------------------------------------------------------------
// Auth seeding — the hallkeeper route is gated by ProtectedRoute, so tests
// that expect to reach the page must seed an authenticated user before the
// app mounts. main.tsx reads `window.__OMNITWIN_E2E__` + `__OMNITWIN_SEED_USER__`
// on first render (dev-only branch, dead-code-eliminated in prod builds).
// ---------------------------------------------------------------------------

async function seedAuthenticatedPlanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Opt in to the E2E auth bypass
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: "e2e-user-planner",
        email: "planner@e2e.test",
        role: "planner",
        venueId: null,
        name: "E2E Planner",
      },
      writable: false,
    });
  });
}

async function seedUnauthenticatedE2E(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: null, writable: false });
  });
}

// ---------------------------------------------------------------------------
// Hallkeeper page — full-data render tests
// ---------------------------------------------------------------------------

test.describe("Hallkeeper Page", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    await mockSheetData(page);
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByRole("main", { name: "Hallkeeper sheet for Annual Gala at Trades Hall Glasgow" }))
      .toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Room and event identity — venue, room, config, guests, dimensions
  // -------------------------------------------------------------------------

  test("displays the venue name in the page header", async ({ page }) => {
    await expect(page.getByText("Trades Hall Glasgow").first()).toBeVisible();
  });

  test("renders the room heading and config name together", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Grand Hall" })).toBeVisible();
    await expect(page.locator("header").getByText("Annual Gala", { exact: true })).toBeVisible();
  });

  test("displays the selected space in the event room rail", async ({ page }) => {
    await expect(page.getByRole("complementary", { name: "Rooms linked to this event" })
      .getByText("Grand Hall", { exact: true })).toBeVisible();
  });

  test("displays the guest count in the header", async ({ page }) => {
    await expect(page.locator("header").getByText("120 guests", { exact: true })).toBeVisible();
  });

  test("displays the room dimensions in the layout record", async ({ page }) => {
    await expect(page.getByRole("complementary", { name: "Rooms linked to this event" })
      .getByText("21 × 10 m", { exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Setup category navigation preserves every phase, row, quantity, zone and
  // dependency hint without requiring all phases to be visible at once.
  // -------------------------------------------------------------------------

  test("makes every supplied setup phase selectable", async ({ page }) => {
    const category = page.getByRole("combobox", { name: "Setup category" });
    await expect(category.locator("option")).toHaveCount(MOCK_SHEET.phases.length);
    for (const phase of MOCK_SHEET.phases) {
      await category.selectOption(phase.phase);
      await expect(category).toHaveValue(phase.phase);
      for (const zone of phase.zones) {
        for (const row of zone.rows) {
          await expect(page.getByRole("checkbox", { name: new RegExp(row.name) })).toBeVisible();
        }
      }
    }
  });

  test("renders item rows with their quantities", async ({ page }) => {
    for (const phase of MOCK_SHEET.phases) {
      await page.getByRole("combobox", { name: "Setup category" }).selectOption(phase.phase);
      for (const zone of phase.zones) {
        for (const row of zone.rows) {
          await expect(page.getByRole("checkbox", { name: new RegExp(row.name) }))
            .toContainText(`×${String(row.qty)}`);
        }
      }
    }
  });

  test("accessory rows retain their dependency order hint", async ({ page }) => {
    await page.getByRole("combobox", { name: "Setup category" }).selectOption("dress");
    await expect(page.getByRole("checkbox", { name: /Gold Organza Runner/ }))
      .toContainText("after preceding items");
    await expect(page.getByRole("checkbox", { name: /Ivory Tablecloth/ }))
      .not.toContainText("after preceding items");
  });

  test("setup rows identify their supplied zone in each phase", async ({ page }) => {
    for (const phase of MOCK_SHEET.phases) {
      await page.getByRole("combobox", { name: "Setup category" }).selectOption(phase.phase);
      for (const zone of phase.zones) {
        for (const row of zone.rows) {
          await expect(page.getByRole("checkbox", { name: new RegExp(row.name) })).toContainText(zone.zone);
        }
      }
    }
  });

  test("clicking a row toggles its checkbox (aria-checked)", async ({ page }) => {
    const row = page.getByRole("checkbox", { name: /Stage Platform/ });
    await expect(row).toHaveAttribute("aria-checked", "false");
    const saved = page.waitForResponse((response) => response.url() === `${API}/hallkeeper/${CONFIG_ID}/progress`
      && response.request().method() === "PATCH");
    await row.click();
    expect((await saved).ok()).toBe(true);
    await expect(row).toHaveAttribute("aria-checked", "true");
  });

  // -------------------------------------------------------------------------
  // Action buttons
  // -------------------------------------------------------------------------

  test("Download PDF button is present", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
  });

  test("Print button is present", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  });

  test("rejects JSON returned as a successful PDF download", async ({ page }) => {
    const downloads: string[] = [];
    page.on("download", (download) => { downloads.push(download.suggestedFilename()); });
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/sheet?download=true`, (route) =>
      route.fulfill({ status: 200, json: { error: "Unexpected response" } }));
    await page.getByRole("button", { name: "Download PDF" }).click();
    await expect(page.getByRole("alert")).toContainText("PDF could not be downloaded.");
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await expect(page.getByText("PDF download started.")).toHaveCount(0);
    expect(downloads).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Interactive floor plan (diagramUrl: null in mock)
  // -------------------------------------------------------------------------

  test("interactive floor plan is shown when diagramUrl is null", async ({ page }) => {
    await expect(page.getByRole("img", { name: "Interactive floor plan" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Route protection — unauthenticated users redirect to /login
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// On a phone (roadmap N4): the sheet is read at arm's length on the floor, so
// nothing operational is under 12 px, rows and fields are 16 px (a phone zooms
// into a smaller field when it takes focus), a checkbox's edge is 3:1 against
// its row, and every label reads at 4.5:1.
// ---------------------------------------------------------------------------

test.describe("Hallkeeper Page — on a phone", () => {
  test("reads at arm's length: 16 px rows and fields, 3:1 checkboxes, nothing under 12 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedAuthenticatedPlanner(page);
    await mockSheetData(page);
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Grand Hall" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Stage Platform/u })).toBeVisible();
    const px = (selector: string): Promise<number[]> => page.locator(selector).evaluateAll((elements) =>
      elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
    expect(Math.min(...await px(".hkf-check-task strong"))).toBeGreaterThanOrEqual(16);
    expect(Math.min(...await px(".hkf-search, .hkf-category select"))).toBeGreaterThanOrEqual(16);
    expect(await edgeContrast(page, ".hkf-checkbox")).toBeGreaterThanOrEqual(3);
    expect(await unreadableText(page, ".hkf-app", "sheet on a phone")).toEqual([]);
  });

  test("opens on the checklist, shows the plan on request, and lets a stage's content flow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAuthenticatedPlanner(page);
    await mockSheetData(page);
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    const plan = page.getByRole("region", { name: "Room plan" });
    const setup = page.getByRole("region", { name: "Setup workspace" });
    await expect(setup.getByRole("checkbox", { name: /Stage Platform/u })).toBeVisible();
    await expect(plan).toBeHidden();

    await page.getByRole("group", { name: "Show on this phone" }).getByRole("button", { name: "Plan" }).click();
    await expect(plan.getByText("Saved event layout")).toBeVisible();
    await expect(setup).toBeHidden();

    // A stage brings its work back, and its content flows with the page:
    // no scroll box inside the scrolling page.
    await page.getByRole("navigation", { name: "Event workflow views" }).getByRole("button", { name: /Prepare/u }).click();
    const prepare = page.getByRole("region", { name: "Prepare workspace" });
    await expect(prepare).toBeVisible();
    await expect(plan).toBeHidden();
    expect(await prepare.locator(".hkf-stage-content").evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

// A dinner on Saturday 3 October 2026 whose planner recorded the facts a
// hallkeeper must keep in view (roadmap N4): the room ready by 16:00 for an
// 18:30 start, a hearing loop and wheelchair spaces, allergen meals, a contact
// and a florist's deadline.
const FACTS_SHEET = HallkeeperSheetV2Schema.parse({
  ...MOCK_SHEET,
  timing: { eventStart: "2026-10-03T17:30:00.000Z", setupBy: "2026-10-03T15:00:00.000Z", bufferMinutes: 150 },
  instructions: {
    dayOfContact: { name: "Elaine Gray", role: "Events manager", phone: "0141 552 2418" },
    phaseDeadlines: [{ phase: "furniture", deadline: "2026-10-03T13:30:00.000Z", reason: "Florist arrives" }],
    accessibility: { hearingLoopRequired: true, hearingLoopZone: "Centre", wheelchairSpaces: 4 },
    dietary: { nutFree: 3, glutenFree: 2, otherAllergies: "Table 4: sesame." },
  },
});

test.describe("Hallkeeper Page — the facts in view", () => {
  test("a phone shows ready by, access needs, allergies and a tap to call above the stages", async ({ page }) => {
    // 09:00 on the day in Glasgow, so the florist's deadline is still ahead.
    await page.clock.setFixedTime(new Date("2026-10-03T08:00:00.000Z"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedAuthenticatedPlanner(page);
    await mockSheetData(page, FACTS_SHEET);
    await page.goto(`/hallkeeper/${CONFIG_ID}`);

    await expect(page.locator(".hkf-times")).toHaveText(/^Ready by\s*16:00\s*Starts\s*18:30$/u);
    const band = page.getByRole("region", { name: "Keep in view" });
    await expect(band.getByText("Hearing loop in Centre")).toBeVisible();
    await expect(band.getByText("4 wheelchair spaces")).toBeVisible();
    await expect(band.getByText("3 nut-free and 2 gluten-free meals")).toBeVisible();
    await expect(band.getByText("Furniture by 14:30")).toBeVisible();
    const call = band.getByRole("link", { name: "Call Elaine Gray on 0141 552 2418" });
    await expect(call).toHaveAttribute("href", "tel:01415522418");

    // Where the eye lands before any work: begun within the first screen,
    // whole above the stages, and the call a thumb's height.
    const bandBox = await band.boundingBox();
    const stagesBox = await page.getByRole("navigation", { name: "Event workflow views" }).boundingBox();
    const callBox = await call.boundingBox();
    expect(bandBox).not.toBeNull();
    expect(stagesBox).not.toBeNull();
    expect(bandBox?.y ?? Infinity).toBeLessThan(844);
    expect((bandBox?.y ?? 0) + (bandBox?.height ?? 0)).toBeLessThanOrEqual(stagesBox?.y ?? 0);
    expect(callBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await unreadableText(page, ".hkf-app", "facts in view on a phone")).toEqual([]);
  });
});

test.describe("Hallkeeper Page — route protection", () => {
  test("unauthenticated navigation redirects to /login", async ({ page }) => {
    // Explicitly seed the dev-only E2E auth bridge with no user so remote CI
    // cannot hang on Clerk's async loading state before ProtectedRoute runs.
    await seedUnauthenticatedE2E(page);
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    // ProtectedRoute calls <Navigate to="/login" replace />
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Error states — authenticated user, API returns 403 or 404
// ---------------------------------------------------------------------------

test.describe("Hallkeeper Page — authorized error states", () => {
  test("shows an unavailable approved sheet and retries with visible activity", async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    await mockSheetData(page);
    let recovering = false;
    let releaseRetry: (() => void) | undefined;
    const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, async (route) => {
      if (!recovering) {
        await route.fulfill({ status: 503, json: {
          code: "APPROVED_SNAPSHOT_UNAVAILABLE", error: "Internal detail must not be displayed",
        } });
        return;
      }
      await retryGate;
      await route.fulfill({ json: { data: MOCK_SHEET } });
    });
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByRole("alert")).toHaveText("The approved setup sheet is unavailable.");
    await expect(page.getByText("Contact venue staff before using a replacement. You can try again once the approved sheet is available.")).toBeVisible();
    await expect(page.getByText("Internal detail must not be displayed")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Print" })).toHaveCount(0);

    recovering = true;
    await page.getByRole("button", { name: "Try Again" }).click();
    await expect(page.getByText("Loading sheet…", { exact: true })).toBeVisible();
    await expect(page.locator("[data-activity-indicator]")).toBeVisible();
    releaseRetry?.();
    await expect(page.getByRole("heading", { level: 1, name: "Grand Hall" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await expect(page.locator("[data-activity-indicator]")).toHaveCount(0);
  });

  test("removes stale approval and printable contents when the approved PDF is unavailable", async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    await mockSheetData(page, { ...MOCK_SHEET, approval: {
      version: 3, approvedAt: "2026-04-17T14:30:00.000Z", approverName: "Catherine Tait",
    } });
    let releaseDownload: (() => void) | undefined;
    const downloadGate = new Promise<void>((resolve) => { releaseDownload = resolve; });
    const downloads: string[] = [];
    page.on("download", (download) => { downloads.push(download.suggestedFilename()); });
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/sheet?download=true`, async (route) => {
      await downloadGate;
      await route.fulfill({ status: 503, json: { code: "APPROVED_SNAPSHOT_UNAVAILABLE" } });
    });
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByText("Sheet v3 · approved by Catherine Tait", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Download PDF" }).click();
    await expect(page.getByRole("button", { name: "Preparing PDF…" })).toBeDisabled();
    await expect(page.locator("[data-activity-indicator]")).toBeVisible();
    releaseDownload?.();
    await expect(page.getByRole("alert")).toHaveText("The approved setup sheet is unavailable.");
    await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print" })).toHaveCount(0);
    await expect(page.getByText(/Sheet v3 · approved by/)).toHaveCount(0);
    await expect(page.getByRole("status", { name: /Approved version/, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Grand Hall", includeHidden: true })).toHaveCount(0);
    await expect(page.locator("[data-activity-indicator]")).toHaveCount(0);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText("Stage Platform", { exact: true })).toHaveCount(0);
    expect(downloads).toEqual([]);
  });

  test("shows configuration-not-found message when the API returns 404", async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, (route) => {
      void route.fulfill({
        status: 404,
        json: { error: "Configuration not found", code: "NOT_FOUND" },
      });
    });
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(
      page.getByText("Configuration not found."),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("shows permission-denied message when the API returns 403", async ({ page }) => {
    // A planner authenticated but lacking access to THIS config (e.g., wrong venue)
    await seedAuthenticatedPlanner(page);
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, (route) => {
      void route.fulfill({
        status: 403,
        json: { error: "Insufficient permissions", code: "FORBIDDEN" },
      });
    });
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(
      page.getByText("You don't have permission to view this event's sheet."),
    ).toBeVisible({ timeout: 8_000 });
    // Trying again cannot grant access (roadmap N4): the way out is the
    // sheet's navigation.
    await expect(page.getByRole("button", { name: "Try Again" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Today's rooms" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Approval stamp banner — Phase 4c audit trail
//
// When the config is in the `approved` review state, the API returns a
// populated `approval` block on the /v2 payload. The workspace summary and
// brief preserve version, approver and venue-local time; the complete stamp
// remains in the printable handoff. Unapproved sheets must carry neither.
// ---------------------------------------------------------------------------

interface ApprovalFixture {
  readonly version: number;
  readonly approvedAt: string;
  readonly approverName: string;
}

test.describe("Hallkeeper Page — approval stamp banner", () => {
  test("renders the approval banner when approval is populated", async ({ page }) => {
    const approval: ApprovalFixture = {
      version: 3,
      approvedAt: "2026-04-17T14:30:00.000Z",
      approverName: "Catherine Tait",
    };
    await seedAuthenticatedPlanner(page);
    await mockSheetData(page, { ...MOCK_SHEET, approval });
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Grand Hall" })).toBeVisible();

    await expect(page.getByText("Sheet v3 · approved by Catherine Tait", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Brief & contacts" }).click();
    const brief = page.getByRole("dialog", { name: "Brief & contacts" });
    await expect(brief).toContainText("Sheet v3 approved by Catherine Tait on 17/04/2026, 15:30:00.");
    await brief.getByRole("button", { name: "Close brief" }).click();

    // The full approval stamp remains in the printable handoff. Its parent
    // is intentionally hidden from the screen accessibility tree.
    await page.emulateMedia({ media: "print" });
    const banner = page.getByRole("status", {
      name: /Approved version 3 by Catherine Tait/, includeHidden: true,
    });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("v3");
    await expect(banner).toContainText("Catherine Tait");
    await expect(banner).toContainText("17 Apr 2026");
  });

  test("does NOT render the approval banner when approval is null", async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    await mockSheetData(page); // MOCK_SHEET has no approval → null
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Grand Hall" })).toBeVisible();
    await expect(page.getByText(/Sheet v\d+ · approved by/)).toHaveCount(0);
    await page.getByRole("button", { name: "Brief & contacts" }).click();
    await expect(page.getByRole("dialog", { name: "Brief & contacts" })).not.toContainText("approved by");
    await expect(page.getByRole("status", { name: /Approved version/, includeHidden: true })).toHaveCount(0);
  });
});
