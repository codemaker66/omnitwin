import { expect, test } from "@playwright/test";

test.describe("Trades Hall internal visual layer route", () => {
  test("loads the empty internal route without runtime errors", async ({ page }) => {
    const runtimeErrors: string[] = [];

    page.on("pageerror", (error) => {
      runtimeErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(message.text());
      }
    });

    await page.goto("/dev/trades-hall-visual");
    await expect(page.getByRole("heading", { name: "Trades Hall runtime asset loader" })).toBeVisible();
    await expect(page.getByText("No real asset loaded yet")).toBeVisible();
    await expect(page.getByText("Internal visual layer test. Not a verified photoreal runtime package.")).toBeVisible();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(async () => {
      const box = await canvas.boundingBox();
      return box === null ? 0 : Math.min(box.width, box.height);
    }).toBeGreaterThan(300);

    expect(runtimeErrors).toEqual([]);
  });
});
