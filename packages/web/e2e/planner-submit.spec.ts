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

  await page.route(`${API}/configurations/${CONFIG_ID}/review/available-transitions`, (route) => {
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
          snapshot: { id: "snap-e2e", version: 1, configurationId: CONFIG_ID },
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

test.describe("Planner submit for review", () => {
  test("draft config surfaces the 'Submit for Approval' button", async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    await mockSubmitFlow(page, { initialStatus: "draft" });
    await page.goto(`/plan/${CONFIG_ID}`);

    const button = page.getByTestId("submit-for-review-button");
    await expect(button).toBeVisible({ timeout: 10_000 });
    await expect(button).toHaveText(/Submit for Approval/i);
  });

  test("clicking Submit hits the /submit endpoint and flips UI to locked", async ({ page }) => {
    await seedAuthenticatedPlanner(page);
    const state = await mockSubmitFlow(page, { initialStatus: "draft" });
    await page.goto(`/plan/${CONFIG_ID}`);

    const button = page.getByTestId("submit-for-review-button");
    await expect(button).toBeVisible({ timeout: 10_000 });
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
    await expect(button).toBeVisible({ timeout: 10_000 });
  });
});
