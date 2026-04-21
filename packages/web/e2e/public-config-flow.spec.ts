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
  lengthM: "10",
  heightM: "7",
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

const MOCK_CONFIG_EMPTY: MockConfig = {
  id: CONFIG_ID,
  spaceId: SPACE_ID,
  venueId: VENUE_ID,
  userId: null,
  name: "My Layout",
  isPublicPreview: true,
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
    await page.waitForSelector("canvas", { timeout: 15_000 });
    await expect(page.locator("canvas")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Editor with empty config — save flash, events sheet, SaveSendPanel gate
// ---------------------------------------------------------------------------

test.describe("Editor with empty config", () => {
  test.beforeEach(async ({ page }) => {
    await mockConfigLoad(page);
    await page.goto(`/plan/${CONFIG_ID}`);
    await page.waitForSelector("canvas", { timeout: 15_000 });
  });

  test("Save Layout toolbar button is visible in the editor", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Save Layout" })).toBeVisible();
  });

  test("Save Layout button aria-label changes to 'Auto-saved!' after a successful save", async ({ page }) => {
    // Guest (unauthenticated) save path → publicBatchSave
    await page.route(
      `${API}/public/configurations/${CONFIG_ID}/objects/batch`,
      (route) => { void route.fulfill({ json: { data: [] } }); },
    );
    await page.getByRole("button", { name: "Save Layout" }).click();
    // setSaveFlash(true) fires in the .then() callback after the save resolves.
    // The label reverts after 2 s, so the 5 s timeout is safe.
    await expect(
      page.getByRole("button", { name: "Auto-saved!" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Events Sheet button opens the hallkeeper route in a new browser tab", async ({ page }) => {
    // The hallkeeper route is ProtectedRoute-gated. An unauthenticated public
    // editor user clicking "Events Sheet" opens a new tab at /hallkeeper/<id>
    // which immediately redirects to /login. The test verifies the button
    // triggers the navigation; the redirect itself proves route protection.
    const [newPage] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 5_000 }),
      page.getByRole("button", { name: "Events Sheet" }).click(),
    ]);
    // Initial URL targets hallkeeper; guard then redirects to /login.
    await newPage.waitForURL(/\/(hallkeeper|login)/, { timeout: 5_000 });
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
    await page.waitForSelector("canvas", { timeout: 15_000 });
  });

  test("SaveSendPanel becomes visible when the loaded config has placed objects", async ({ page }) => {
    await expect(page.getByTestId("save-send-panel")).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: "Send to Events Team" }),
    ).toBeVisible();
  });

  test("Send to Events Team button opens the guest enquiry form", async ({ page }) => {
    // flushAutoSave + thumbnail upload are best-effort — mock both so the
    // modal is not blocked by network errors in test.
    await page.route(
      `${API}/public/configurations/${CONFIG_ID}/objects/batch`,
      (route) => { void route.fulfill({ json: { data: [MOCK_OBJECT] } }); },
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
      (route) => { void route.fulfill({ json: { data: [MOCK_OBJECT] } }); },
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
