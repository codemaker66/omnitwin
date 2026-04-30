import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: Planner submit-for-review flow
//
// Final leg of the three-role journey (planner → staff → hallkeeper).
// The planner is editing a config in the 3D editor; the SubmitForReviewPanel
// surfaces a "Submit for Approval" CTA when the config is in an
// editable review state (draft / changes_requested / rejected).
//
// This spec mocks every backend call that the editor startup + submit
// action performs, then verifies:
//   1. The panel surfaces the submit button in an editable state.
//   2. Clicking submit posts to /configurations/:id/review/submit.
//   3. On success, the panel flips to the locked (submitted) state.
//
// The editor's 3D canvas isn't asserted on — we rely on the panel's
// `data-testid` hooks (`submit-for-review-panel`, `submit-for-review-button`,
// `withdraw-review-button`) which don't depend on R3F rendering.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const CONFIG_ID = "11111111-1111-4111-8111-111111111111";
const SPACE_ID = "22222222-2222-4222-8222-222222222222";
const VENUE_ID = "33333333-3333-4333-8333-333333333333";

const MOCK_OBJECT = {
  id: "e2e-submit-object-001",
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

const MOCK_REVIEW_SNAPSHOT = {
  id: "44444444-4444-4444-8444-444444444444",
  configurationId: CONFIG_ID,
  version: 1,
  payload: {
    config: {
      id: CONFIG_ID,
      name: "Submit Review Layout",
      layoutStyle: "dinner-rounds",
      guestCount: 80,
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
    approval: null,
  },
  diagramUrl: null,
  pdfUrl: null,
  sourceHash: "0".repeat(64),
  createdAt: "2026-04-17T09:00:00.000Z",
  createdBy: null,
  approvedAt: null,
  approvedBy: null,
};

async function seedAuthenticatedPlanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: "e2e-planner-submit",
        email: "planner@e2e.test",
        role: "planner",
        venueId: null,
        name: "E2E Planner",
      },
      writable: false,
    });
  });
}

/**
 * Bare minimum API stubs for the editor + review panel. The editor's
 * auto-save WebSocket is left unmocked — the submit flow doesn't
 * depend on it resolving, just on the REST endpoints.
 */
async function mockSubmitFlow(
  page: Page,
  opts: { initialStatus: "draft" | "changes_requested" | "rejected" },
): Promise<{ submitCalls: number }> {
  const state = { submitCalls: 0, currentStatus: opts.initialStatus as string };

  await page.route(`${API}/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: CONFIG_ID,
          spaceId: SPACE_ID,
          venueId: VENUE_ID,
          userId: "e2e-planner-submit",
          name: "Submit Review Layout",
          isPublicPreview: false,
          objects: [MOCK_OBJECT],
        },
      },
    });
  });

  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: CONFIG_ID,
          spaceId: SPACE_ID,
          venueId: VENUE_ID,
          userId: "e2e-planner-submit",
          name: "Submit Review Layout",
          isPublicPreview: false,
          objects: [MOCK_OBJECT],
        },
      },
    });
  });

  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: SPACE_ID,
          venueId: VENUE_ID,
          name: "Grand Hall",
          slug: "grand-hall",
          widthM: "21",
          lengthM: "10",
          heightM: "7",
        },
      },
    });
  });

  await page.route(`${API}/configurations/${CONFIG_ID}/review/available-transitions*`, (route) => {
    void route.fulfill({
      json: {
        data: {
          configurationId: CONFIG_ID,
          currentStatus: state.currentStatus,
          availableTransitions: ["submitted", "withdrawn"],
        },
      },
    });
  });

  await page.route(`${API}/configurations/${CONFIG_ID}/review/submit`, (route) => {
    state.submitCalls += 1;
    state.currentStatus = "submitted";
    void route.fulfill({
      json: {
        data: {
          created: true,
          snapshot: MOCK_REVIEW_SNAPSHOT,
          reviewStatus: "submitted",
        },
      },
    });
  });

  // Prevent orthographic capture + thumbnail PUT from flaking the test.
  await page.route(`${API}/configurations/${CONFIG_ID}/public-thumbnail`, (route) => {
    void route.fulfill({ status: 200, json: { data: { ok: true } } });
  });

  return state;
}

// Editor cold-start under 8-worker parallelism can comfortably take longer
// than the original 10s budget — the dev server has to serve the R3F + drei
// + Three.js bundle to every worker concurrently. The error contexts from
// previous failures consistently show the panel mounting just *after* the
// 10s timeout fires (the page snapshot at failure time shows the button
// rendered). Bumping to 20s removes the flake without changing what the
// test asserts; in serial / lightly-loaded runs the assertion still
// resolves in well under 10s.
const PANEL_VISIBLE_TIMEOUT = 20_000;

test.describe("Planner submit for review", () => {
  test("draft config surfaces the 'Submit for Approval' button", async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    await mockSubmitFlow(page, { initialStatus: "draft" });
    await page.goto(`/plan/${CONFIG_ID}`);

    const button = page.getByTestId("submit-for-review-button");
    await expect(button).toBeVisible({ timeout: PANEL_VISIBLE_TIMEOUT });
    await expect(button).toHaveText(/Submit for Approval/i);
  });

  test("clicking Submit hits the /submit endpoint and flips UI to locked", async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    const state = await mockSubmitFlow(page, { initialStatus: "draft" });
    await page.goto(`/plan/${CONFIG_ID}`);

    const button = page.getByTestId("submit-for-review-button");
    await expect(button).toBeVisible({ timeout: PANEL_VISIBLE_TIMEOUT });
    await button.click();

    // The submit endpoint was called.
    await expect.poll(() => state.submitCalls, { timeout: 5_000 }).toBeGreaterThan(0);

    // Panel re-renders to the locked state — withdraw replaces submit.
    const withdraw = page.getByTestId("withdraw-review-button");
    await expect(withdraw).toBeVisible({ timeout: 5_000 });
  });

  test("changes_requested state also surfaces the submit button (re-submit path)", async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    await mockSubmitFlow(page, { initialStatus: "changes_requested" });
    await page.goto(`/plan/${CONFIG_ID}`);

    const button = page.getByTestId("submit-for-review-button");
    await expect(button).toBeVisible({ timeout: PANEL_VISIBLE_TIMEOUT });
  });
});
