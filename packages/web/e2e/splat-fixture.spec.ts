import { expect, test } from "@playwright/test";

test.describe("Spark fixture", () => {
  test("loads the Three.js 0.180 + Spark smoke route", async ({ page }) => {
    const runtimeErrors: string[] = [];

    page.on("pageerror", (error) => {
      runtimeErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(message.text());
      }
    });

    await page.goto("/dev/splat-fixture");
    await expect(page.getByText("Spark fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Three.js 0.180 + Spark 2.0 smoke route.")).toBeVisible();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(async () => {
      const box = await canvas.boundingBox();
      return box === null ? 0 : Math.min(box.width, box.height);
    }).toBeGreaterThan(300);

    expect(runtimeErrors).toEqual([]);
  });
});
