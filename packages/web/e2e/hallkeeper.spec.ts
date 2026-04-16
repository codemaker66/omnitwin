import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Hallkeeper page — events sheet web view
//
// Selector strategy:
//   - Venue name:       getByText("Trades Hall Glasgow")
//   - Config name h1:   getByRole("heading", { level: 1, name: "Annual Gala" })
//   - Space chip:       getByText("Grand Hall")
//   - Manifest h2:      getByRole("heading", { name: "Setup Manifest" })
//   - Manifest rows:    getByText("6ft Round Table")
//   - Group headers:    getByRole("button", { name: /Tables & Seating/ })
//   - Action buttons:   getByRole("button", { name: "Download PDF" | "Print" })
//   - Totals bar:       getByText("TOTALS")
//
// All API calls are intercepted with page.route(). HallkeeperPage calls
// GET /hallkeeper/:configId/v2 with an auth token (null for unauthenticated
// users). Playwright intercepts at CDP level before the request leaves the
// browser, so the actual auth middleware is bypassed entirely.
//
// Note: the HallkeeperPage has no enquiry form and no copy-link button —
// those features are not yet implemented in the current build. Tests cover
// what the page actually renders.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const CONFIG_ID = "e2e-config-001";

// ---------------------------------------------------------------------------
// Typed mock fixture — mirrors HallkeeperPage.tsx SheetData interface
// ---------------------------------------------------------------------------

interface MockV2Row {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly qty: number;
  readonly afterDepth: number;
  readonly isAccessory: boolean;
  readonly notes: string;
}

interface MockSheetDataV2 {
  readonly venue: { readonly name: string; readonly address: string; readonly logoUrl: null };
  readonly space: { readonly name: string; readonly widthM: number; readonly lengthM: number; readonly heightM: number };
  readonly config: { readonly id: string; readonly name: string; readonly layoutStyle: string; readonly guestCount: number };
  readonly timing: null | { readonly eventStart: string; readonly setupBy: string; readonly bufferMinutes: number };
  readonly phases: readonly {
    readonly phase: string;
    readonly zones: readonly { readonly zone: string; readonly rows: readonly MockV2Row[] }[];
  }[];
  readonly totals: {
    readonly entries: readonly { readonly name: string; readonly category: string; readonly qty: number }[];
    readonly totalRows: number;
    readonly totalItems: number;
  };
  readonly diagramUrl: null;
  readonly webViewUrl: string;
  readonly generatedAt: string;
}

const MOCK_SHEET: MockSheetDataV2 = {
  venue: {
    name: "Trades Hall Glasgow",
    address: "85 Glassford Street, Glasgow G1 1UH",
    logoUrl: null,
  },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10, heightM: 7 },
  config: { id: CONFIG_ID, name: "Annual Gala", layoutStyle: "dinner-banquet", guestCount: 120 },
  timing: null,
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
};

// ---------------------------------------------------------------------------
// Route-mock helper — fulfils /v2 (new) and leaves /data (v1) unmocked
// so a stale consumer fails loud rather than pretending to work.
// ---------------------------------------------------------------------------

async function mockSheetData(page: Page, data: MockSheetDataV2 = MOCK_SHEET): Promise<void> {
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, (route) => {
    void route.fulfill({ json: { data } });
  });
  // Mock the progress endpoint — starts with no checked rows
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/progress`, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({ json: { data: { configId: CONFIG_ID, checked: {} } } });
    } else if (route.request().method() === "PATCH") {
      // Optimistic UI — the page updates locally before the PATCH resolves
      const body = route.request().postDataJSON() as { rowKey: string };
      void route.fulfill({ json: { data: { configId: CONFIG_ID, rowKey: body.rowKey, checked: true } } });
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

// ---------------------------------------------------------------------------
// Hallkeeper page — full-data render tests
// ---------------------------------------------------------------------------

test.describe("Hallkeeper Page", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    await mockSheetData(page);
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    // The skeleton shows during parallel fetch of /v2 + /progress.
    // Wait for the h1 (event name) to confirm data has loaded.
    await page.waitForSelector("h1", { timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Header — venue, config name, space chip, guest count, dimensions
  // -------------------------------------------------------------------------

  test("displays the venue name in the page header", async ({ page }) => {
    await expect(page.getByText("Trades Hall Glasgow").first()).toBeVisible();
  });

  test("renders the config name as the page h1", async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: "Annual Gala" }),
    ).toBeVisible();
  });

  test("displays the space name in the header meta chips", async ({ page }) => {
    await expect(page.getByText("Grand Hall").first()).toBeVisible();
  });

  test("displays the guest count in the header", async ({ page }) => {
    // guestCount: 120 renders as a large standalone number in the header
    await expect(page.getByText("120").first()).toBeVisible();
  });

  test("displays the room dimensions chip in the header", async ({ page }) => {
    // Chip text: "{widthM}m × {lengthM}m" — scoped to <header> to avoid
    // matching the footer which shows the same dimensions as part of a longer string
    await expect(page.locator("header").getByText(/21m/)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Phase sections — v2 replaces the single "Setup Manifest" accordion
  // with per-phase blocks (structure / furniture / dress / technical /
  // final). Each phase has zone subheaders and checkable rows.
  // -------------------------------------------------------------------------

  test("renders a phase heading for every phase in the payload", async ({ page }) => {
    await expect(page.getByText(/Phase 1 — Structure/)).toBeVisible();
    await expect(page.getByText(/Phase 2 — Furniture/)).toBeVisible();
    await expect(page.getByText(/Phase 3 — Dress/)).toBeVisible();
  });

  test("renders item rows with their quantities", async ({ page }) => {
    await expect(page.getByText("6ft Round Table with 10 chairs")).toBeVisible();
    await expect(page.getByText("Stage Platform")).toBeVisible();
    await expect(page.getByText("Ivory Tablecloth")).toBeVisible();
  });

  test("accessory rows with afterDepth > 0 show an 'after' badge", async ({ page }) => {
    // Gold Organza Runner has afterDepth=1 → should carry the badge
    const runnerRow = page.getByText("Gold Organza Runner").locator("..");
    await expect(runnerRow.getByText("after")).toBeVisible();
  });

  test("zone subheaders are rendered under each phase", async ({ page }) => {
    // The mock has all items in "Centre" and one in "North wall"
    await expect(page.getByText(/▹ North wall/).first()).toBeVisible();
    await expect(page.getByText(/▹ Centre/).first()).toBeVisible();
  });

  test("clicking a row toggles its checkbox (aria-checked)", async ({ page }) => {
    const row = page.getByRole("checkbox", { name: /Stage Platform/ });
    await expect(row).toHaveAttribute("aria-checked", "false");
    await row.click();
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

  // -------------------------------------------------------------------------
  // Diagram placeholder (diagramUrl: null in mock)
  // -------------------------------------------------------------------------

  test("floor plan placeholder is shown when diagramUrl is null", async ({ page }) => {
    await expect(page.getByText("Floor plan diagram")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Route protection — unauthenticated users redirect to /login
// ---------------------------------------------------------------------------

test.describe("Hallkeeper Page — route protection", () => {
  test("unauthenticated navigation redirects to /login", async ({ page }) => {
    // No seedAuthenticatedPlanner() — page mounts with isAuthenticated=false
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
      page.getByText("You don't have permission to view this events sheet."),
    ).toBeVisible({ timeout: 8_000 });
  });
});
