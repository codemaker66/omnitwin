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
    await expect(page.getByRole("heading", { name: /Design your event inside the real Grand Hall/i })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    const bodyText = await page.locator("body").innerText();
    for (const claim of DANGEROUS_CLAIMS) {
      expect(bodyText).not.toMatch(claim);
    }
    expect(errors).toEqual([]);
  });
});
