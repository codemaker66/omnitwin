import { expect, test } from "@playwright/test";

test.describe("Native Gaussian fixture", () => {
  test("loads the Three.js r186 native Gaussian smoke route", async ({ page }) => {
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
    await expect(page.getByText("Native Gaussian fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Three.js r186 Gaussian splat smoke route.")).toBeVisible();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-renderer", "three-native");
    await expect(canvas).toHaveAttribute("data-backend", /^(webgpu|webgl2)$/u);
    await expect.poll(async () => {
      const box = await canvas.boundingBox();
      return box === null ? 0 : Math.min(box.width, box.height);
    }).toBeGreaterThan(300);

    expect(runtimeErrors).toEqual([]);
  });
});
