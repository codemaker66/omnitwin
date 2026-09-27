import { test, expect, type Page } from "@playwright/test";
import { VALID_CONFIGURATION_REVIEW_TRANSITIONS, type ConfigurationReviewStatus } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// E2E: Staff review flow — dashboard More → Pending reviews → approve
//
// Covers the staff-side happy path that complements hallkeeper.spec.ts
// (hallkeeper view) and the planner's SubmitForReviewPanel (editor).
// Uses route mocks so the Fastify API isn't required; the review's gates
// are the transitions the state machine allows from where it stands, and
// each accepted move changes it, as the API does.
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
  readonly reviewStatus: ConfigurationReviewStatus;
  readonly submittedAt: string;
  readonly guestCount: number;
  readonly layoutStyle: string;
  readonly updatedAt: string;
  readonly spaceName: string;
  readonly plannerName: string | null;
  readonly eventStartsAt: string | null;
  readonly stageSince: string | null;
  readonly stageByName: string | null;
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
  plannerName: "Morag Anderson",
  eventStartsAt: "2026-06-13T13:00:00.000Z",
  stageSince: "2026-04-17T09:00:00.000Z",
  stageByName: "Morag Anderson",
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

async function mockReviewsAPIs(page: Page, initial: ConfigurationReviewStatus = "submitted"): Promise<void> {
  let status = initial;
  const pending = (): boolean => status === "submitted" || status === "under_review" || status === "changes_requested";
  await page.route(`${API}/configurations/reviews/pending*`, (route) => {
    void route.fulfill({ json: { data: { entries: pending() ? [{ ...MOCK_PENDING, reviewStatus: status }] : [] } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/available-transitions*`, (route) => {
    void route.fulfill({
      json: {
        data: {
          configurationId: CONFIG_ID,
          currentStatus: status,
          availableTransitions: VALID_CONFIGURATION_REVIEW_TRANSITIONS[status],
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
  await page.route(`${API}/configurations/${CONFIG_ID}/snapshot/latest`, (route) => {
    void route.fulfill({ json: { data: { ...MOCK_APPROVED_SNAPSHOT, approvedAt: null, approvedBy: null,
      payload: { ...MOCK_APPROVED_SNAPSHOT.payload, approval: null } } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/viewers**`, (route) => {
    void route.fulfill(route.request().method() === "DELETE" ? { status: 204 }
      : { json: { data: route.request().url().endsWith("/heartbeat") ? { ok: true } : { configurationId: CONFIG_ID, viewers: [] } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/start-review`, (route) => {
    status = "under_review";
    void route.fulfill({ json: { data: { reviewStatus: status } } });
  });
  // Approve action
  await page.route(`${API}/configurations/${CONFIG_ID}/review/approve`, (route) => {
    status = "approved";
    void route.fulfill({ json: { data: { reviewStatus: "approved", snapshot: MOCK_APPROVED_SNAPSHOT } } });
  });
}

async function openPendingReviews(page: Page): Promise<void> {
  await page.goto("/dashboard");
  const navigation = page.getByRole("navigation", { name: "Staff dashboard" });
  const more = navigation.getByRole("button", { name: "More", exact: true });
  await more.click({ timeout: 8_000 });
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await navigation.getByRole("button", { name: "Pending reviews", exact: true }).click({ timeout: 8_000 });
  await expect(page).toHaveURL(/\/dashboard\?view=reviews$/u);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { level: 1, name: "Pending reviews", exact: true }))
    .toBeVisible({ timeout: 8_000 });
}

function queueRow(page: Page) {
  return page.locator('button[data-review-id][aria-label^="Anderson Wedding Reception,"]');
}

test.describe("Staff review — pending list", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedStaff(page);
    await mockReviewsAPIs(page);
  });

  test("dashboard Reviews tab shows the submitted config in the pending list", async ({ page }) => {
    await openPendingReviews(page);
    const review = queueRow(page);
    await expect(review).toBeVisible({ timeout: 8_000 });
    await expect(review).toContainText("To start");
    await expect(review).toContainText("Grand Hall · 120 guests · Planned by Morag Anderson");
    await expect(review).toHaveAttribute("aria-label", /event Sat 13 Jun 2026/u);
  });

  test("opening a pending review shows its detail + available actions", async ({ page }) => {
    await openPendingReviews(page);
    await queueRow(page).click();
    await expect(page.getByRole("heading", { level: 2, name: MOCK_PENDING.name, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the layout (opens in a new tab)" })).toHaveAttribute("href", `/plan/${CONFIG_ID}`);
    await expect(page.getByRole("link", { name: "Preview the setup sheet (opens in a new tab)" })).toHaveAttribute("href", `/hallkeeper/${CONFIG_ID}`);
    // A submitted layout is started before it is decided: the state machine
    // offers starting the review, or withdrawing it, and nothing else.
    for (const action of ["Start review", "Withdraw…"]) {
      const button = page.getByRole("button", { name: action, exact: true });
      await expect(button).toBeVisible({ timeout: 8_000 });
      await expect(button).toBeEnabled();
    }
    await expect(page.getByRole("button", { name: "Approve…", exact: true })).toHaveCount(0);
  });
});

test.describe("Staff review — approve action", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedStaff(page);
    await mockReviewsAPIs(page, "under_review");
  });

  test("clicking Approve hits the approve endpoint", async ({ page }) => {
    const approveRequests: { readonly method: string; readonly body: unknown }[] = [];
    page.on("request", (request) => {
      if (request.url() === `${API}/configurations/${CONFIG_ID}/review/approve`) {
        approveRequests.push({ method: request.method(), body: request.postDataJSON() as unknown });
      }
    });

    await openPendingReviews(page);
    await queueRow(page).click();
    await page.getByRole("button", { name: "Approve…", exact: true }).click();
    await expect(page.getByTestId("approve-consequence")).toHaveText("Approving emails the planner and your venue's hallkeepers.");
    await page.getByRole("button", { name: "Approve and email", exact: true }).click();

    // A native action sends one ordinary approval, without silently choosing
    // demo-only notification suppression or a different configuration.
    await expect.poll(() => approveRequests).toEqual([{ method: "POST", body: {} }]);
    await expect(page.getByText("Approved. The planner and your hallkeepers are being emailed.")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("heading", { name: "No layouts waiting" })).toBeVisible();
    await expect(queueRow(page)).toHaveCount(0);
  });
});
