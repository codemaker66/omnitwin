import { expect, test } from "@playwright/test";
import { API, CONFIG_ID, GRAND_HALL_SPACE, VENUE, settleCockpit, stubPlannerBootstrap } from "./support/plan-bootstrap.js";

// ---------------------------------------------------------------------------
// "What are you planning?" (T-674, Blake 26 Oct 2026).
//
// A new, empty layout asks what the event is the first time it opens; the
// answer sets up the room for it (Lay out's starting shape here) and is kept,
// so the layout never asks again. The rest of the suite runs on a device told
// not to ask (playwright.config.ts); these cases turn it back on with
// ?event-question=on. The first two use the stubbed, uncaptured room (the
// question owes nothing to the captured layer); the third opens the Grand
// Hall, whose welcome stands over the question while the captured hall arrives.
// ---------------------------------------------------------------------------

test.describe("the first-open event question", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test.beforeEach(async ({ page }) => {
    await stubPlannerBootstrap(page, true);
    await page.route("**/splats/**", (route) => {
      void route.fulfill({ status: 404, body: "not in this spec" });
    });
  });

  test("a new layout asks what the event is, and a corporate event lays out rows of seats", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/plan/${CONFIG_ID}?event-question=on`);
    const question = page.getByRole("dialog", { name: "What are you planning?" });
    await expect(question).toBeVisible({ timeout: 90_000 });
    await expect(question.getByRole("button", { name: "Wedding: Round tables and gold Chiavari chairs" })).toBeFocused();

    await page.keyboard.press("2");
    await expect(question).toBeHidden();
    await expect(page.getByText("Set up for a corporate event: rows of seats and the venue's pink chairs.")).toBeVisible();

    await settleCockpit(page);
    await page.getByTestId("planner-command-action-auto-fill").click();
    await expect(page.getByTestId("auto-fill-prompt")).toHaveAttribute("aria-label", "Theatre: how many guests?");
  });

  test("the answer is kept, so the layout opens again without asking and names its event", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/plan/${CONFIG_ID}?event-question=on`);
    const question = page.getByRole("dialog", { name: "What are you planning?" });
    await expect(question).toBeVisible({ timeout: 90_000 });
    await question.getByRole("button", { name: /^Wedding/u }).click();
    await expect(question).toBeHidden();

    await page.reload();
    await settleCockpit(page);
    await expect(page.getByRole("button", { name: "The event: Wedding. Change it" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "What are you planning?" })).toHaveCount(0);
  });

  test("after the Grand Hall's welcome, the first panel is in hand and the keys answer", async ({ page }) => {
    test.setTimeout(180_000);
    // A new Grand Hall layout: the welcome opens over the question while the captured hall is on its way,
    // and the hall's requests are held so the welcome waits for "Open planner".
    const grandConfig = {
      id: "e2e-event-kind-grand-hall", spaceId: GRAND_HALL_SPACE.id, venueId: VENUE.id, userId: null,
      name: "Grand Hall layout", isPublicPreview: true, revision: 1, objects: [],
    };
    await page.route("**/splats/**", () => { /* held: the welcome stays until it is answered */ });
    await page.route(`${API}/public/configurations/${grandConfig.id}`, (route) => { void route.fulfill({ json: { data: grandConfig } }); });
    await page.route(`${API}/venues/${VENUE.id}/spaces/${GRAND_HALL_SPACE.id}`, (route) => {
      void route.fulfill({ json: { data: GRAND_HALL_SPACE } });
    });
    await page.goto(`/plan/${grandConfig.id}?event-question=on`);
    const welcome = page.getByRole("dialog", { name: "Opening the Grand Hall" });
    await expect(welcome).toBeVisible({ timeout: 90_000 });
    await welcome.getByRole("button", { name: /Open planner/u }).click();

    // The browser hands focus back to the panel in hand as the welcome closes; it must show it, not only hold it.
    const question = page.getByRole("dialog", { name: "What are you planning?" });
    const wedding = question.getByRole("button", { name: "Wedding: Round tables and gold Chiavari chairs" });
    await expect(wedding).toBeFocused();
    await expect(wedding.locator(".ekp-key")).toHaveCSS("opacity", "1");
    await page.keyboard.press("2");
    await expect(page.getByText("Set up for a corporate event: rows of seats and the venue's pink chairs.")).toBeVisible();
  });
});
