import { expect, test } from "@playwright/test";

test("keeps the Craft quiz in its centred portrait frame on a wide viewport", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1200 });
  await page.goto("/trades-house/discover-your-craft");
  await expect(page.getByRole("heading", { name: "Which Craft is yours?" })).toBeVisible();

  const frame = page.locator(".trades-house-craft-quiz-shell");
  const geometry = await frame.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      left: rect.left,
      width: rect.width,
    };
  });

  expect(geometry.width).toBeGreaterThanOrEqual(519);
  expect(geometry.width).toBeLessThanOrEqual(520.5);
  expect(Math.abs(geometry.left - (geometry.clientWidth - geometry.width) / 2)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Begin the Craft quiz" }).click();
  const options = page.locator(".craft-quiz-option");
  await expect(options).toHaveCount(4);
  const [first, second] = await Promise.all([
    options.nth(0).boundingBox(),
    options.nth(1).boundingBox(),
  ]);

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  if (first === null || second === null) throw new Error("Craft answer geometry is unavailable.");
  expect(first.width).toBeLessThanOrEqual(450.5);
  expect(second.y).toBeGreaterThan(first.y + first.height);
});
