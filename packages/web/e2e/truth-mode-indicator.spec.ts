import { expect, test, type Page } from "@playwright/test";

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

test.describe("Truth Mode L1/L2 foundation", () => {
  test("opens the gated summary without mobile overflow or false verification", async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/dev/splat-fixture?truth=1");

    const indicator = page.getByTestId("truth-mode-indicator");
    await expect(indicator).toBeVisible();
    await expect(indicator.getByText("Truth Mode L1")).toBeVisible();
    await expect(indicator.getByText("Procedural content present")).toBeVisible();
    await expect(indicator.getByText("Measured runtime not loaded")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByTestId("truth-mode-toggle").click();
    await expect(page.getByRole("dialog", { name: /Truth Mode summary/i })).toBeVisible();
    await expect(page.getByText("Procedural runtime", { exact: true })).toBeVisible();
    await expect(page.getByText(/No signed measured RuntimeVenueManifest asset/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Provenance drawer unavailable/i })).toBeDisabled();
    await expect(page.getByText("Verified")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: /Close Truth Mode summary/i }).click();
    await expect(page.getByRole("dialog", { name: /Truth Mode summary/i })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(runtimeErrors).toEqual([]);
  });
});
