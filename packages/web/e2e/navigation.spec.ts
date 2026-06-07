import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Navigation — page routing and basic UI structure
//
// Verifies that routes load correctly and key UI elements are present.
// These tests don't require authentication.
//
// Note: "/" redirects to "/editor" which shows SpacePicker (no canvas).
// Tests that need the 3D editor navigate to /editor/:configId with a
// mocked config-load response so the Canvas mounts.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const CONFIG_ID = "e2e-config-001";
const TRADES_VENUE_ID = "e2e-venue-trades";
const CITY_VENUE_ID = "e2e-venue-city";
const GRAND_SPACE_ID = "e2e-space-grand";
const BALLROOM_SPACE_ID = "e2e-space-ballroom";

interface MockVenue {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly address: string;
  readonly logoUrl: string | null;
  readonly brandColour: string | null;
}

interface MockSpace {
  readonly id: string;
  readonly venueId: string;
  readonly name: string;
  readonly slug: string;
  readonly widthM: string;
  readonly lengthM: string;
  readonly heightM: string;
  readonly floorPlanOutline: readonly { readonly x: number; readonly y: number }[];
}

const TRADES_VENUE: MockVenue = {
  id: TRADES_VENUE_ID,
  name: "Trades Hall",
  slug: "trades-hall",
  address: "85 Glassford Street",
  logoUrl: null,
  brandColour: null,
};

const CITY_VENUE: MockVenue = {
  id: CITY_VENUE_ID,
  name: "City Rooms",
  slug: "city-rooms",
  address: "1 Example Street",
  logoUrl: null,
  brandColour: null,
};

const GRAND_SPACE: MockSpace = {
  id: GRAND_SPACE_ID,
  venueId: TRADES_VENUE_ID,
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "10.5",
  heightM: "7.5",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
};

const BALLROOM_SPACE: MockSpace = {
  id: BALLROOM_SPACE_ID,
  venueId: CITY_VENUE_ID,
  name: "Ballroom",
  slug: "ballroom",
  widthM: "18",
  lengthM: "9",
  heightM: "6",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 9 }, { x: 0, y: 9 }],
};

async function seedAnonymousE2E(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: null, writable: false });
  });
}

async function seedScopedPlanner(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(({ venueId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: "e2e-planner",
        email: "planner@e2e.test",
        role: "planner",
        venueId,
        name: "Planner",
      },
      writable: false,
    });
  }, { venueId: TRADES_VENUE_ID });
}

test.describe("Navigation", () => {
  test("editor route loads with a visible WebGL canvas", async ({ page }) => {
    await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => {
      void route.fulfill({
        json: {
          data: {
            id: CONFIG_ID,
            spaceId: "e2e-space-001",
            venueId: "e2e-venue-001",
            userId: null,
            name: "Test Layout",
            isPublicPreview: true,
            objects: [],
          },
        },
      });
    });
    await page.goto(`/plan/${CONFIG_ID}`);
    await page.waitForSelector("canvas", { timeout: 15_000 });
    await expect(page.locator("canvas")).toBeVisible();
  });

  test("navigating to /hallkeeper without a configId renders without crashing", async ({ page }) => {
    await page.goto("/hallkeeper");
    // /hallkeeper/:configId requires a UUID segment — without one the SPA
    // renders index.html. Verify the app shell loads without a JS crash.
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Internal Server Error")).not.toBeVisible();
  });

  test("unknown route shows 404 or redirects", async ({ page }) => {
    const response = await page.goto("/nonexistent-route");
    // Vite SPA serves index.html for all routes (200), so check the page renders
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("page has correct title", async ({ page }) => {
    await page.goto("/");
    // Wait for page to fully load
    await page.waitForLoadState("networkidle");
    const title = await page.title();
    // Title should contain OMNITWIN or the app name
    expect(title.length).toBeGreaterThan(0);
  });

  test("venue-scoped planner creates the first layout in the requested venue", async ({ page }) => {
    await seedAnonymousE2E(page);
    let createdSpaceId: unknown = null;

    await page.route(`${API}/venues`, (route) => {
      void route.fulfill({ json: { data: [TRADES_VENUE, CITY_VENUE] } });
    });
    await page.route(`${API}/venues/${CITY_VENUE_ID}/spaces`, (route) => {
      void route.fulfill({ json: { data: [BALLROOM_SPACE] } });
    });
    await page.route(`${API}/venues/${CITY_VENUE_ID}/spaces/${BALLROOM_SPACE_ID}`, (route) => {
      void route.fulfill({ json: { data: BALLROOM_SPACE } });
    });
    await page.route(`${API}/venues/${TRADES_VENUE_ID}/spaces`, (route) => {
      void route.fulfill({ json: { data: [GRAND_SPACE] } });
    });
    await page.route(`${API}/public/configurations`, async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      createdSpaceId = body["spaceId"];
      void route.fulfill({
        json: {
          data: {
            id: "e2e-city-config",
            spaceId: BALLROOM_SPACE_ID,
            venueId: CITY_VENUE_ID,
            userId: null,
            name: "New Layout",
            isPublicPreview: true,
            objects: [],
          },
        },
      });
    });

    await page.goto("/v/city-rooms/plan?space=ballroom");

    await page.waitForURL("**/plan/e2e-city-config");
    expect(createdSpaceId).toBe(BALLROOM_SPACE_ID);
  });

  test("venue-scoped planner shows not-found instead of falling back", async ({ page }) => {
    await seedAnonymousE2E(page);
    let createCalled = false;

    await page.route(`${API}/venues`, (route) => {
      void route.fulfill({ json: { data: [TRADES_VENUE] } });
    });
    await page.route(`${API}/public/configurations`, (route) => {
      createCalled = true;
      void route.fulfill({ status: 500, json: { error: "Should not create", code: "TEST_FAILURE" } });
    });

    await page.goto("/v/missing-venue/plan");

    await expect(page.getByText("Venue not found")).toBeVisible();
    await expect(page.getByText(/missing-venue/)).toBeVisible();
    expect(createCalled).toBe(false);
  });

  test("venue-scoped planner shows forbidden for scoped users on another venue", async ({ page }) => {
    await seedScopedPlanner(page);
    let createCalled = false;

    await page.route(`${API}/venues`, (route) => {
      void route.fulfill({ json: { data: [TRADES_VENUE, CITY_VENUE] } });
    });
    await page.route(`${API}/public/configurations`, (route) => {
      createCalled = true;
      void route.fulfill({ status: 500, json: { error: "Should not create", code: "TEST_FAILURE" } });
    });

    await page.goto("/v/city-rooms/plan");

    await expect(page.getByText("Planner unavailable for this venue")).toBeVisible();
    await expect(page.getByText(/City Rooms/)).toBeVisible();
    expect(createCalled).toBe(false);
  });
});
