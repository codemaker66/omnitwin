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

// The reveal is the payoff; the Convener's near-miss aside is a remark ABOUT
// it. Typographic rank has to match that, and it silently did not: the aside's
// size lived on a page-scoped `.page .aside` selector (0,2,0) while every
// responsive rule was `.aside` (0,1,0), so four breakpoints of careful tuning
// never applied and the aside rendered larger than the reveal on desktop —
// and 24% of an iPhone SE. Specificity beats media-query narrowness, so this
// class of bug is invisible in the source: assert the rendered outcome.
async function expectRevealOutranksAside(page: Page): Promise<void> {
  const size = await page.evaluate(() => {
    const px = (selector: string): number => {
      const node = document.querySelector(selector);
      if (node === null) return Number.NaN;
      return Number.parseFloat(window.getComputedStyle(node).fontSize);
    };
    return { reveal: px(".craft-result-reveal"), aside: px(".craft-result-affinities") };
  });

  expect(size.reveal, "the reveal must be rendered").not.toBeNaN();
  expect(size.aside, "the Convener's aside must be rendered").not.toBeNaN();
  expect(
    size.aside,
    `the Convener's aside (${String(size.aside)}px) must not out-typeset the reveal (${String(size.reveal)}px)`,
  ).toBeLessThanOrEqual(size.reveal);
}

// BEGIN opens the threshold, where he says what this is; the reader passes it
// with "Skip ahead" (or "I am ready" once he has finished). Only then the first
// scene. Every walk goes through here.
async function beginAndPassThreshold(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Begin the Craft quiz" }).click();
  const pass = page.getByRole("button", { name: /Skip ahead|I am ready/u });
  await expect(pass).toBeVisible({ timeout: 20_000 });
  await pass.click();
}

// If the twelve finish close, he asks one more thing: two answers, the same
// reply-then-continue rhythm. Whether it fires depends on the path, so every
// walk must be ready for it and must not assume it. Takes the first answer.
async function passDeliberationIfAsked(page: Page, expandsBeforeCommitting: boolean): Promise<void> {
  const deliberating = page.locator('[data-deliberating="true"]');
  const weighing = page.locator(".craft-quiz-weighing");
  await expect(deliberating.or(weighing)).toBeVisible({ timeout: 20_000 });
  if (await deliberating.count() === 0) return;
  const two = page.locator(".craft-quiz-option");
  await expect(two).toHaveCount(2);
  await two.nth(0).click();
  if (expandsBeforeCommitting) await two.nth(0).click();
  const advance = page.getByRole("button", { name: "See your Craft" });
  await expect(advance).toBeVisible({ timeout: 20_000 });
  await expectNoPageScroll(page);
  await advance.click();
}

// Desktop walks the whole quiz in one click per scene; a phone needs one tap to
// open the option and a second to commit.
async function answerEveryScene(page: Page, expandsBeforeCommitting: boolean): Promise<void> {
  await beginAndPassThreshold(page);
  for (let questionIndex = 0; questionIndex < 12; questionIndex += 1) {
    const option = page.locator(".craft-quiz-option").nth(2);
    await expect(option).toBeVisible({ timeout: 20_000 });
    await option.click();
    if (expandsBeforeCommitting) await option.click();
    // On the twelfth reply the button promises the verdict only if the
    // verdict is next; when it hung he says so and it stays "Go on".
    const advance = page.getByRole("button", { name: questionIndex === 11 ? /^(See your Craft|Go on)$/u : "Go on" });
    await expect(advance).toBeVisible({ timeout: 20_000 });
    await advance.click();
  }
  await passDeliberationIfAsked(page, expandsBeforeCommitting);
}

/** The Craft the reveal names. Read, not assumed: the writing moves and the
 *  fixed path lands where the sorting puts it, and asserting a NAME here proved
 *  only that the words had not changed. */
async function revealedCraft(page: Page): Promise<string> {
  const name = page.locator(".craft-quiz-result h1");
  await expect(name).toBeVisible({ timeout: 20_000 });
  return (await name.textContent())?.trim() ?? "";
}

// The last answer hands over to his deliberation, and the verdict follows only
// after it. This is a full-viewport screen like every other, so it owes the
// same no-scroll promise — and it must not leak the answer while it runs.
async function expectDeliberationThenVerdict(page: Page): Promise<void> {
  const weighing = page.locator(".craft-quiz-weighing");
  await expect(weighing).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".craft-quiz-result h1")).toBeHidden();
  await expectNoPageScroll(page);
  // Skipping is offered because anyone who has answered twelve dilemmas is
  // entitled to be impatient; taking it must land on the same verdict.
  await expect(page.getByRole("button", { name: "Tell me now" })).toBeVisible();
}

// The desktop RESULT had no coverage at all — the desktop tests stopped at the
// intro — which is how the payoff for twelve scenes came to overflow by 243px
// in a 650px phone column on a 1600px screen without a single test going red.
// Three aspects: the short laptop, the commonest monitor, and a large one.
for (const desktop of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const) {
  test(`lands the Craft reveal whole on desktop at ${String(desktop.width)}x${String(desktop.height)}`, async ({ page }) => {
    await page.setViewportSize(desktop);
    await page.goto("/quiz");
    await page.evaluate(async () => { await document.fonts.ready; });

    await answerEveryScene(page, false);
    await expectDeliberationThenVerdict(page);

    expect(await revealedCraft(page)).toMatch(/^THE /u);
    await expect(page.getByRole("link", { name: "Request an introduction" })).toBeVisible();
    // The whole point of leaving the phone frame: the reveal uses the screen.
    const shell = await page.locator(".trades-house-craft-quiz-shell").boundingBox();
    expect(shell?.width ?? 0, "the reveal must not render in the 520px phone cage").toBeGreaterThan(900);
    await expectRevealOutranksAside(page);
    await expectNoPageScroll(page);
  });
}

// Two desktop aspects on purpose: the tall one, and the short-wide one that
// exposed the phone-skin geometry leaks (the 625px core cap and the rails
// hanging below the fold were invisible at 1200 tall).
for (const desktop of [{ width: 2048, height: 1200 }, { width: 2000, height: 930 }] as const) {
  test(`stages the quiz as a full-viewport invitation at ${String(desktop.width)}x${String(desktop.height)}`, async ({ page }) => {
    await page.setViewportSize(desktop);
    await page.goto("/quiz");
    await expect(page.getByRole("heading", { name: "Which Craft is yours?" })).toBeVisible();

    // The intro is a full-bleed poster: no curtains, no photo backdrop —
    // the engraved-invitation contract.
    await expect(page.locator(".craft-quiz-curtain")).toHaveCount(0);
    await expect(page.locator(".craft-quiz-intro-backdrop")).toHaveCount(0);

    const intro = await page.locator(".craft-quiz-intro").boundingBox();
    const core = await page.locator(".craft-quiz-intro-core").boundingBox();
    expect(intro).not.toBeNull();
    expect(core).not.toBeNull();
    if (intro === null || core === null) throw new Error("Craft intro geometry is unavailable.");
    expect(intro.width).toBeGreaterThanOrEqual(desktop.width - 4);
    expect(intro.height).toBeGreaterThanOrEqual(desktop.height - 4);
    // The centre column must STRETCH — a shorter core is the 625px-cap leak.
    expect(core.height).toBeGreaterThanOrEqual(intro.height - 8);

    // Both crest rails sit fully inside the viewport, all seven items each —
    // a rail box can pass while overflow clips its crests, so check the last
    // item of each roll, not just the rail.
    const rails = page.locator(".craft-quiz-rail");
    await expect(rails).toHaveCount(2);
    const railBoxes: { x: number; width: number }[] = [];
    for (const railIndex of [0, 1]) {
      const rail = rails.nth(railIndex);
      await expect(rail.locator(".craft-quiz-rail-item")).toHaveCount(7);
      const railBox = await rail.boundingBox();
      const lastItem = await rail.locator(".craft-quiz-rail-item").last().boundingBox();
      expect(railBox).not.toBeNull();
      expect(lastItem).not.toBeNull();
      if (railBox === null || lastItem === null) throw new Error("Craft rail geometry is unavailable.");
      expect(railBox.x).toBeGreaterThanOrEqual(-1);
      expect(railBox.x + railBox.width).toBeLessThanOrEqual(desktop.width + 1);
      expect(lastItem.y + lastItem.height).toBeLessThanOrEqual(desktop.height + 1);
      railBoxes.push({ x: railBox.x, width: railBox.width });
    }

    // Containment is not placement: the DOM-order grid bug centred the RIGHT
    // rail and passed every box check above. Assert the columns' order —
    // left rail, then the core, then the right rail.
    const [leftRail, rightRail] = railBoxes;
    expect(leftRail).toBeDefined();
    expect(rightRail).toBeDefined();
    if (leftRail === undefined || rightRail === undefined) throw new Error("Craft rail order is unavailable.");
    expect(leftRail.x + leftRail.width).toBeLessThanOrEqual(core.x + 2);
    expect(core.x + core.width).toBeLessThanOrEqual(rightRail.x + 2);

    await expect(page.locator(".craft-quiz-achievement")).toBeVisible();
    await expect(page.locator(".craft-quiz-intro-foot")).toBeVisible();
    await expectNoPageScroll(page);

    await beginAndPassThreshold(page);

  // The Convener holds the stage beside the question…
  await expect(page.getByRole("button", { name: /Convener — poke the portrait/u })).toBeVisible();

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
}

for (const viewport of IPHONE_VIEWPORTS) {
  test(`fits every Craft quiz state without page scrolling at ${String(viewport.width)}x${String(viewport.height)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/trades-house/discover-your-craft");
    await page.evaluate(async () => { await document.fonts.ready; });

    await expect(page.getByRole("heading", { name: "Which Craft is yours?" })).toBeVisible();
    await expectNoPageScroll(page);

    await beginAndPassThreshold(page);
    for (let questionIndex = 0; questionIndex < 12; questionIndex += 1) {
      // Two polite status regions coexist now: the quiz's progress announcer
      // and the Convener's speech mirror. Address the quiz's own.
      await expect(page.locator(".craft-quiz-sr-only[role='status']"))
        .toHaveText(`Question ${String(questionIndex + 1)} of 12`, { timeout: 20_000 });
      if (questionIndex === 6) await expect(page.locator(".craft-quiz-omen")).toBeVisible();
      // The scene and four priced options fit a phone because the options
      // collapse to their leads — so the no-scroll rule still holds here.
      await expectNoPageScroll(page);
      // The third option every time is a fixed path through axis space that
      // the geometry puts nearest the Maltmen by a wide margin. On a phone the
      // first tap opens it and the second commits.
      const option = page.locator(".craft-quiz-option").nth(2);
      await option.click();
      // Expanded, it must STILL fit — that is the harder half of the promise.
      await expect(page.locator(".craft-quiz-option-confirm")).toBeVisible();
      await expectNoPageScroll(page);
      await option.click();

      // His reply is its own panel and it WAITS. Nothing advances on a timer,
      // so the scene is still on screen behind it — and the reply must fit too.
      const advance = page.getByRole("button", { name: questionIndex === 11 ? /^(See your Craft|Go on)$/u : "Go on" });
      await expect(advance).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".craft-quiz-question-count"))
        .toHaveText(`QUESTION ${String(questionIndex + 1)} OF 12`);
      await expectNoPageScroll(page);
      await advance.click();
    }

    await passDeliberationIfAsked(page, true);
    await expectDeliberationThenVerdict(page);
    expect(await revealedCraft(page)).toMatch(/^THE /u);
    await expect(page.getByRole("link", { name: "Request an introduction" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retake the questions" })).toBeVisible();
    await expectRevealOutranksAside(page);
    await expectNoPageScroll(page);
  });
}

// The deliberation is skippable on purpose. Proving the skip lands on the SAME
// craft matters: a ceremony that can change the answer is not a ceremony.
test("the deliberation can be skipped, and skipping does not change the Craft", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/quiz");
  await page.evaluate(async () => { await document.fonts.ready; });

  await answerEveryScene(page, false);
  await expect(page.locator(".craft-quiz-weighing")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Tell me now" }).click();
  const skipped = await revealedCraft(page);

  // The same path, waited out.
  await page.goto("/quiz");
  await page.evaluate(async () => { await document.fonts.ready; });
  await answerEveryScene(page, false);
  await expect(page.locator(".craft-quiz-weighing")).toBeVisible({ timeout: 20_000 });
  const waited = await revealedCraft(page);
  expect(waited, "skipping the ceremony must not change the Craft").toBe(skipped);
  expect(skipped).toMatch(/^THE /u);
  await expectNoPageScroll(page);
});
