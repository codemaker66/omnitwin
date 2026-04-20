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
const CONFIG_ID = "e2e-config-review-001";

interface MockPendingReview {
  readonly id: string;
  readonly name: string;
  readonly venueId: string;
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
  venueId: "e2e-venue-001",
  userId: "e2e-user-planner",
  reviewStatus: "submitted",
  submittedAt: "2026-04-17T09:00:00.000Z",
  guestCount: 120,
  layoutStyle: "dinner-rounds",
  updatedAt: "2026-04-17T09:00:00.000Z",
  spaceName: "Grand Hall",
};

async function seedAuthenticatedStaff(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: "e2e-user-staff",
        email: "staff@e2e.test",
        role: "staff",
        venueId: "e2e-venue-001",
        name: "Catherine Tait",
      },
      writable: false,
    });
  });
}

async function mockReviewsAPIs(page: Page): Promise<void> {
  // Pending list
  await page.route(`${API}/configurations/reviews/pending*`, (route) => {
    void route.fulfill({ json: { data: { reviews: [MOCK_PENDING] } } });
  });
  // Available transitions
  await page.route(`${API}/configurations/${CONFIG_ID}/review/available-transitions`, (route) => {
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
  await page.route(`${API}/configurations/${CONFIG_ID}/review/history`, (route) => {
    void route.fulfill({
      json: {
        data: { configurationId: CONFIG_ID, entries: [] },
      },
    });
  });
  // Approve action
  await page.route(`${API}/configurations/${CONFIG_ID}/review/approve`, (route) => {
    void route.fulfill({ json: { data: { reviewStatus: "approved" } } });
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
      void route.fulfill({ json: { data: { reviewStatus: "approved" } } });
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
