import { expect, test, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// The front door — responsive audit (T-616). Successor to
// landing-rite-responsive.spec.ts: on 26 September 2026 Blake retired the
// Rite and the other older home page designs from public addresses, and `/`
// became the one home page, carrying the Grand Hall, the rooms, capacities by
// layout, the wedding rates and the enquiry form.
//
// Every viewport must: render the hero, never overflow horizontally, keep the
// whole page reachable (rooms → capacities → rates → the form → the legal
// links beside it), and produce zero runtime errors. Reduced motion is
// emulated so assertions run against the settled page.
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
  expect(overflow, "the front door must never overflow horizontally").toBeLessThanOrEqual(1);
}

for (const viewport of VIEWPORTS) {
  test(`the front door holds its composition at ${viewport.label}`, async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Grand Hall", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The rooms, then the facts that decide a booking.
    await page.getByRole("heading", { name: "More rooms", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByTestId("room-card-saloon")).toBeVisible();
    const capacities = page.getByRole("table");
    await capacities.scrollIntoViewIfNeeded();
    await expect(capacities.getByRole("row", { name: /The Grand Hall/u })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("heading", { name: "Wedding hire", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText("£2,900", { exact: true })).toBeVisible();

    // The form that reaches the venue, and the privacy notice beside it.
    const composer = page.getByTestId("enquiry-composer");
    await composer.scrollIntoViewIfNeeded();
    await expect(composer.getByRole("button", { name: "Send enquiry" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const legal = page.getByRole("navigation", { name: "Legal" });
    await legal.scrollIntoViewIfNeeded();
    await expect(legal.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");

    expect(errors).toEqual([]);
  });
}

test("every Ask about a date reaches the composer, from the front door and from a link that went nowhere", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Grand Hall", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Ask about a date" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.hash === "#enquire");
  await expect(page.getByTestId("enquiry-composer")).toBeInViewport();

  // The designed not-found page sends a visitor to the same form; the front
  // door loads after the hash was read, so it must find the form itself.
  await page.goto("/an-old-link-that-has-moved");
  await expect(page.getByRole("heading", { level: 1, name: "That link has expired or moved" })).toBeVisible();
  await page.getByRole("link", { name: "Ask about a date" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.hash === "#enquire");
  await expect(page.getByTestId("enquiry-composer")).toBeInViewport();
});
