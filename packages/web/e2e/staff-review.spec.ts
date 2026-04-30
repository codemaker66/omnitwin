import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Staff review flow — dashboard Reviews tab → approve
//
// Covers the staff-side happy path that complements hallkeeper.spec.ts
// (hallkeeper view) and the planner's SubmitForReviewPanel (editor).
// Uses route mocks so the Fastify API isn't required; the test
// verifies the CLIENT code paths for loading pending reviews, opening
// a detail view, and invoking the approve transition.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const CONFIG_ID = "11111111-1111-4111-8111-111111111111";
const VENUE_ID = "22222222-2222-4222-8222-222222222222";
const SPACE_ID = "33333333-3333-4333-8333-333333333333";
const PLANNER_USER_ID = "44444444-4444-4444-8444-444444444444";
const STAFF_USER_ID = "55555555-5555-4555-8555-555555555555";

interface MockPendingReview {
  readonly id: string;
  readonly name: string;
  readonly venueId: string;
  readonly spaceId: string;
  readonly userId: string | null;
  readonly reviewStatus: string;
  readonly submittedAt: string;
  readonly guestCount: number;
  readonly layoutStyle: string;
  readonly updatedAt: string;
  readonly spaceName: string;
}

const MOCK_PENDING: MockPendingReview = {
  id: CONFIG_ID,
  name: "Anderson Wedding Reception",
  venueId: VENUE_ID,
  spaceId: SPACE_ID,
  userId: PLANNER_USER_ID,
  reviewStatus: "submitted",
  submittedAt: "2026-04-17T09:00:00.000Z",
  guestCount: 120,
  layoutStyle: "dinner-rounds",
  updatedAt: "2026-04-17T09:00:00.000Z",
  spaceName: "Grand Hall",
};

const MOCK_APPROVED_SNAPSHOT = {
  id: "66666666-6666-4666-8666-666666666666",
  configurationId: CONFIG_ID,
  version: 1,
  payload: {
    config: {
      id: CONFIG_ID,
      name: "Anderson Wedding Reception",
      layoutStyle: "dinner-rounds",
      guestCount: 120,
    },
    venue: {
      name: "Trades Hall Glasgow",
      address: "85 Glassford Street",
      logoUrl: null,
      timezone: "Europe/London",
    },
    space: {
      name: "Grand Hall",
      widthM: 21,
      lengthM: 10,
      heightM: 7,
    },
    timing: null,
    instructions: null,
    phases: [],
    totals: {
      entries: [],
      totalRows: 0,
      totalItems: 0,
    },
    diagramUrl: null,
    webViewUrl: `http://localhost:5173/hallkeeper/${CONFIG_ID}`,
    generatedAt: "2026-04-17T09:00:00.000Z",
    approval: {
      version: 1,
      approvedAt: "2026-04-17T10:00:00.000Z",
      approverName: "Catherine Tait",
      sourceHash: "a".repeat(64),
    },
  },
  diagramUrl: null,
  pdfUrl: null,
  sourceHash: "a".repeat(64),
  createdAt: "2026-04-17T09:00:00.000Z",
  createdBy: PLANNER_USER_ID,
  approvedAt: "2026-04-17T10:00:00.000Z",
  approvedBy: STAFF_USER_ID,
};

async function seedAuthenticatedStaff(page: Page): Promise<void> {
  await page.addInitScript(({ staffUserId, venueId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: staffUserId,
        email: "staff@e2e.test",
        role: "staff",
        venueId,
        name: "Catherine Tait",
      },
      writable: false,
    });
  }, { staffUserId: STAFF_USER_ID, venueId: VENUE_ID });
}

async function mockReviewsAPIs(page: Page): Promise<void> {
  // Pending list
  await page.route(`${API}/configurations/reviews/pending*`, (route) => {
    void route.fulfill({ json: { data: { entries: [MOCK_PENDING] } } });
  });
  // Available transitions
  await page.route(`${API}/configurations/${CONFIG_ID}/review/available-transitions*`, (route) => {
    void route.fulfill({
      json: {
        data: {
          configurationId: CONFIG_ID,
          currentStatus: "submitted",
          availableTransitions: ["under_review", "approved", "rejected", "changes_requested"],
        },
      },
    });
  });
  // History (empty)
  await page.route(`${API}/configurations/${CONFIG_ID}/review/history*`, (route) => {
    void route.fulfill({
      json: {
        data: { configurationId: CONFIG_ID, entries: [] },
      },
    });
  });
  // Approve action
  await page.route(`${API}/configurations/${CONFIG_ID}/review/approve`, (route) => {
    void route.fulfill({ json: { data: { reviewStatus: "approved", snapshot: MOCK_APPROVED_SNAPSHOT } } });
  });
}

test.describe("Staff review — pending list", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedStaff(page);
    await mockReviewsAPIs(page);
  });

  test("dashboard Reviews tab shows the submitted config in the pending list", async ({ page }) => {
    await page.goto("/dashboard");
    // The dashboard should surface a "Reviews" tab or link; click it.
    // Multiple candidate selectors to tolerate layout changes.
    const reviewsTab = page.getByRole("button", { name: /Reviews/i })
      .or(page.getByRole("link", { name: /Reviews/i }))
      .first();
    await reviewsTab.click({ timeout: 8_000 });
    await expect(page.getByText("Anderson Wedding Reception").first())
      .toBeVisible({ timeout: 8_000 });
  });

  test("opening a pending review shows its detail + available actions", async ({ page }) => {
    await page.goto("/dashboard");
    const reviewsTab = page.getByRole("button", { name: /Reviews/i })
      .or(page.getByRole("link", { name: /Reviews/i }))
      .first();
    await reviewsTab.click({ timeout: 8_000 });
    await page.getByText("Anderson Wedding Reception").first().click();
    await expect(page.getByRole("button", { name: /Approve/i }).first())
      .toBeVisible({ timeout: 8_000 });
  });
});

test.describe("Staff review — approve action", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedStaff(page);
    await mockReviewsAPIs(page);
  });

  test("clicking Approve hits the approve endpoint", async ({ page }) => {
    let approveCalled = false;
    await page.route(`${API}/configurations/${CONFIG_ID}/review/approve`, (route) => {
      approveCalled = true;
      void route.fulfill({ json: { data: { reviewStatus: "approved", snapshot: MOCK_APPROVED_SNAPSHOT } } });
    });

    await page.goto("/dashboard");
    const reviewsTab = page.getByRole("button", { name: /Reviews/i })
      .or(page.getByRole("link", { name: /Reviews/i }))
      .first();
    await reviewsTab.click({ timeout: 8_000 });
    await page.getByText("Anderson Wedding Reception").first().click();
    await page.getByRole("button", { name: /Approve/i }).first().click();

    await page.waitForTimeout(500);
    expect(approveCalled).toBe(true);
  });
});
