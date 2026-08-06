import { expect, test, type Page } from "@playwright/test";

const IPHONE_VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
] as const;

async function expectNoPageScroll(page: Page): Promise<void> {
  const extent = await page.evaluate(() => ({
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportHeight: document.documentElement.clientHeight,
    viewportWidth: document.documentElement.clientWidth,
  }));

  expect(extent.scrollHeight, "the quiz should fit without vertical page scrolling").toBeLessThanOrEqual(
    extent.viewportHeight + 1,
  );
  expect(extent.scrollWidth, "the quiz should fit without horizontal page scrolling").toBeLessThanOrEqual(
    extent.viewportWidth + 1,
  );
}

test("stages the quiz across the full desktop viewport with the Convener presiding", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1200 });
  await page.goto("/quiz");
  await expect(page.getByRole("heading", { name: "Which Craft is yours?" })).toBeVisible();

  // The intro is a full-bleed proscenium — curtains, crest rails, the Hall —
  // not the old 520px phone frame floating in dead space.
  const intro = await page.locator(".craft-quiz-intro").boundingBox();
  expect(intro).not.toBeNull();
  if (intro === null) throw new Error("Craft intro geometry is unavailable.");
  expect(intro.width).toBeGreaterThanOrEqual(2000);
  await expect(page.locator(".craft-quiz-curtain")).toHaveCount(2);
  await expectNoPageScroll(page);

  await page.getByRole("button", { name: "Begin the Craft quiz" }).click();

  // The Convener holds the stage beside the question…
  await expect(page.getByRole("button", { name: "Ye Auld Convener — poke the portrait" })).toBeVisible();

  // …and the four options sit in a two-column grid: the second beside the
  // first, the third starting a new row beneath it.
  const options = page.locator(".craft-quiz-option");
  await expect(options).toHaveCount(4);
  const [first, second, third] = await Promise.all([
    options.nth(0).boundingBox(),
    options.nth(1).boundingBox(),
    options.nth(2).boundingBox(),
  ]);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(third).not.toBeNull();
  if (first === null || second === null || third === null) {
    throw new Error("Craft answer geometry is unavailable.");
  }
  // Row-mates centre-align, so tops differ by half the height delta — the
  // contract is shared row + horizontal adjacency, not pixel-equal tops.
  expect(second.y).toBeLessThan(first.y + first.height - 8);
  expect(second.x).toBeGreaterThan(first.x + first.width - 1);
  expect(third.y).toBeGreaterThan(first.y + first.height - 1);
  await expectNoPageScroll(page);
});

for (const viewport of IPHONE_VIEWPORTS) {
  test(`fits every Craft quiz state without page scrolling at ${String(viewport.width)}x${String(viewport.height)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/trades-house/discover-your-craft");
    await page.evaluate(async () => { await document.fonts.ready; });

    await expect(page.getByRole("heading", { name: "Which Craft is yours?" })).toBeVisible();
    await expectNoPageScroll(page);

    await page.getByRole("button", { name: "Begin the Craft quiz" }).click();
    for (let questionIndex = 0; questionIndex < 9; questionIndex += 1) {
      // Two polite status regions coexist now: the quiz's progress announcer
      // and the Convener's speech mirror. Address the quiz's own.
      await expect(page.locator(".craft-quiz-sr-only[role='status']")).toHaveText(`Question ${String(questionIndex + 1)} of 9`);
      if (questionIndex === 4) await expect(page.locator(".craft-quiz-omen")).toBeVisible();
      await expectNoPageScroll(page);
      await page.locator(".craft-quiz-option").first().click();
    }

    await expect(page.getByRole("heading", { name: "THE HAMMERMEN" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Request an introduction" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retake the questions" })).toBeVisible();
    await expectNoPageScroll(page);
  });
}
