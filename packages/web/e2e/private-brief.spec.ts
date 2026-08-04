import { expect, test, type Page } from "@playwright/test";

const PRIVATE_BRIEF_PATH = "/private/brief/trades-hall-2026-04-27/";

const DANGEROUS_CLAIMS: readonly RegExp[] = [
  /Black Label/i,
  /surveyor-grade/i,
  /photoreal digital twin/i,
  /laser-survey accuracy/i,
  /cinema-grade fidelity/i,
  /independent reviewers/i,
  /clinical study/i,
];

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.describe("private brief exposure", () => {
  test("does not serve the Trades Hall private brief from the public app", async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const response = await page.goto(PRIVATE_BRIEF_PATH);

    expect(response?.status() ?? 200).toBeLessThan(500);
    // Assert that SOME public landing rendered, not which one. This used to
    // wait for /See your evening before it happens/ — the Spotlight page's h1 —
    // which stopped being the homepage in 757efa67 (11 Jul), when "/" became
    // FreshPage. The guard itself never broke: the catch-all route still
    // redirects the private brief to "/". Only the copy moved. Re-coupling this
    // to a specific headline would just re-break it the next time the homepage
    // is rewritten, which happens often; the URL check below plus a rendered
    // h1 is what this test actually needs to prove.
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    const bodyText = await page.locator("body").innerText();
    for (const claim of DANGEROUS_CLAIMS) {
      expect(bodyText).not.toMatch(claim);
    }
    expect(errors).toEqual([]);
  });
});
