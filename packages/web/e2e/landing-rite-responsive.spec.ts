import { expect, test, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// The Rite — responsive audit. Successor to landing-mobile-planner.spec.ts
// (the embedded planner preview was removed by the 2026-07-01 landing
// redesign; see docs/superpowers/specs/2026-07-01-landing-rite-redesign-design.md).
//
// Every viewport must: render the threshold, never overflow horizontally,
// keep the full document reachable (skip → rooms → return → footer), and
// produce zero runtime errors. Reduced motion is emulated so assertions run
// against the deterministic static variant.
// ---------------------------------------------------------------------------

interface ViewportSpec {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly ViewportSpec[] = [
  { label: "320x568 phone", width: 320, height: 568 },
  { label: "390x844 phone", width: 390, height: 844 },
  { label: "768x1024 tablet portrait", width: 768, height: 1024 },
  { label: "1280x800 desktop", width: 1280, height: 800 },
  { label: "2048x1000 desktop", width: 2048, height: 1000 },
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "the rite must never overflow horizontally").toBeLessThanOrEqual(1);
}

for (const viewport of VIEWPORTS) {
  test(`the rite holds its composition at ${viewport.label}`, async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /There is a hall in Glasgow/i }),
    ).toBeVisible();
    await expect(page.locator(".vv-rite")).toHaveClass(/is-static/);
    await expectNoHorizontalOverflow(page);

    // The four chapters and the eight-room index are reachable.
    await page.getByRole("heading", { name: "The Grand Hall", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText("The room the city keeps its promises in.")).toBeVisible();
    await page.getByRole("heading", { name: /Eight rooms, each keeping its own hours/i }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("link", { name: "Explore The Saloon" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The return: CTA into the planner, then the practical footer.
    const cta = page.getByRole("link", { name: /Begin with the room/i });
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/plan?space=grand-hall");
    await expect(page.locator("#contact")).toBeAttached();
    await expectNoHorizontalOverflow(page);

    expect(errors).toEqual([]);
  });
}

test("the enter control descends into the dark", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /There is a hall in Glasgow/i })).toBeVisible();

  await page.getByRole("button", { name: /Enter/i }).click();
  await page.waitForFunction(() => window.scrollY > 10);
});
