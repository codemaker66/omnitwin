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
// GET /hallkeeper/:configId/data with an auth token (null for unauthenticated
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

interface MockManifestRow {
  readonly code: string;
  readonly item: string;
  readonly qty: number;
  readonly position: string;
  readonly notes: string;
  readonly setupGroup: string;
}

interface MockSheetData {
  readonly venue: {
    readonly name: string;
    readonly address: string;
    readonly logoUrl: null;
  };
  readonly space: {
    readonly name: string;
    readonly widthM: number;
    readonly lengthM: number;
    readonly heightM: number;
  };
  readonly config: {
    readonly id: string;
    readonly name: string;
    readonly layoutStyle: string;
    readonly guestCount: number;
  };
  readonly manifest: {
    readonly rows: readonly MockManifestRow[];
    readonly totals: {
      readonly entries: readonly { readonly item: string; readonly qty: number }[];
      readonly totalChairs: number;
    };
  };
  readonly diagramUrl: null;
  readonly webViewUrl: string;
  readonly generatedAt: string;
}

const MOCK_SHEET: MockSheetData = {
  venue: {
    name: "Trades Hall Glasgow",
    address: "85 Glassford Street, Glasgow G1 1UH",
    logoUrl: null,
  },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10, heightM: 7 },
  config: {
    id: CONFIG_ID,
    name: "Annual Gala",
    layoutStyle: "banquet",
    guestCount: 120,
  },
  manifest: {
    rows: [
      {
        code: "T-01",
        item: "6ft Round Table",
        qty: 10,
        position: "Centre zone",
        notes: "",
        setupGroup: "table",
      },
      {
        code: "C-01",
        item: "Banquet Chair",
        qty: 100,
        position: "Around all tables",
        notes: "10 chairs per table",
        setupGroup: "table",
      },
      {
        code: "S-01",
        item: "Stage Platform",
        qty: 1,
        position: "North end",
        notes: "",
        setupGroup: "stage",
      },
    ],
    totals: {
      entries: [
        { item: "6ft Round Table", qty: 10 },
        { item: "Stage Platform", qty: 1 },
      ],
      totalChairs: 100,
    },
  },
  diagramUrl: null,
  webViewUrl: `http://localhost:5173/hallkeeper/${CONFIG_ID}`,
  generatedAt: "2026-04-13T10:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Route-mock helper
// ---------------------------------------------------------------------------

async function mockSheetData(page: Page, data: MockSheetData = MOCK_SHEET): Promise<void> {
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/data`, (route) => {
    void route.fulfill({ json: { data } });
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
    // Loading state shows "Loading events sheet..." with no h1.
    // Wait for the fetch to resolve and the h1 to appear.
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
  // Manifest accordion
  // -------------------------------------------------------------------------

  test("Setup Manifest heading is visible", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Setup Manifest" })).toBeVisible();
  });

  test("manifest rows from the API response are rendered", async ({ page }) => {
    // { exact: true } avoids matching the totals span "× 6ft Round Table"
    await expect(page.getByText("6ft Round Table", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Stage Platform", { exact: true })).toBeVisible();
  });

  test("manifest group header shows the correct item count", async ({ page }) => {
    // Tables & Seating group has T-01 and C-01 — 2 items
    await expect(page.getByText(/2 items/)).toBeVisible();
  });

  test("manifest row notes are visible when non-empty", async ({ page }) => {
    // C-01 Banquet Chair has notes: "10 chairs per table"
    await expect(page.getByText("10 chairs per table")).toBeVisible();
  });

  test("clicking a manifest group header collapses its rows", async ({ page }) => {
    const groupBtn = page.getByRole("button", { name: /Tables & Seating/ });
    await groupBtn.waitFor({ state: "visible" });
    // { exact: true } targets the manifest row div "6ft Round Table" — not the
    // totals span "× 6ft Round Table" which stays visible after collapse.
    await expect(page.getByText("6ft Round Table", { exact: true }).first()).toBeVisible();
    // Collapse
    await groupBtn.click();
    // After collapse, React removes the rows from the DOM (conditional render).
    // The totals span "× 6ft Round Table" remains — exact match avoids it.
    await expect(page.getByText("6ft Round Table", { exact: true })).not.toBeVisible({ timeout: 3_000 });
  });

  test("clicking a collapsed group header re-expands the rows", async ({ page }) => {
    const groupBtn = page.getByRole("button", { name: /Tables & Seating/ });
    await groupBtn.waitFor({ state: "visible" });
    // Collapse
    await groupBtn.click();
    await expect(page.getByText("6ft Round Table", { exact: true })).not.toBeVisible({ timeout: 3_000 });
    // Re-expand
    await groupBtn.click();
    await expect(page.getByText("6ft Round Table", { exact: true }).first()).toBeVisible({ timeout: 3_000 });
  });

  // -------------------------------------------------------------------------
  // Totals bar
  // -------------------------------------------------------------------------

  test("totals bar is visible with a TOTALS label", async ({ page }) => {
    await expect(page.getByText("TOTALS")).toBeVisible();
  });

  test("totals bar shows the chair count from manifest totals", async ({ page }) => {
    // totalChairs: 100 renders as a standalone <span>100</span> in the totals
    // bar — distinct from manifest row qty which renders as "\u00d7100" (×100)
    await expect(page.getByText("100").first()).toBeVisible();
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
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/data`, (route) => {
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
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/data`, (route) => {
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
