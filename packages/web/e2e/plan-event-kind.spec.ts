import { expect, test } from "@playwright/test";
import { CONFIG_ID, settleCockpit, stubPlannerBootstrap } from "./support/plan-bootstrap.js";

// ---------------------------------------------------------------------------
// "What are you planning?" (T-674, Blake 26 Oct 2026).
//
// A new, empty layout asks what the event is the first time it opens; the
// answer sets up the room for it (Lay out's starting shape here) and is kept,
// so the layout never asks again. The rest of the suite runs on a device told
// not to ask (playwright.config.ts); these cases turn it back on with
// ?event-question=on. The room is the stubbed, uncaptured one: the question
// owes nothing to the captured layer.
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
});
