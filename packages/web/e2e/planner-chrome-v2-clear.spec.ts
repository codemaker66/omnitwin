import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  PlannerSaveServer,
  SAVE_API,
  SAVE_GRAND_HALL,
  SAVE_SALOON,
  SAVE_VENUE,
  signInAs,
  type SeedUser,
} from "./support/planner-save-server.js";

// ---------------------------------------------------------------------------
// E2E: the new chrome clears away to the hall and comes back (T-680 in
// T-671's chrome). Blake, 28 Oct 2026: "The UI elements, I want to be able to
// minimise them for cleaner design"; "Crest hides; name goes home". Under
// ?chrome=v2 the slate's crest and \ clear every zone but the crest, which
// stays exactly where it stood, and \, the crest or Esc brings them back.
// The layout lives in the in-memory server the planner's other tests use; the
// venue answers with Trades Hall's own crest, as production does.
//
// E2E_SHOTS_DIR, when set, keeps a frame of each state for review.
// ---------------------------------------------------------------------------

const PLANNER: SeedUser = {
  id: "00000000-0000-4000-8000-000000007101",
  email: "planner@fixture.test",
  role: "planner",
  platformRole: "none",
  venueId: SAVE_VENUE.id,
  name: "Fixture Planner",
};
const LAYOUT = "e2e-clear-grand-hall-layout";
const CREST_IMAGE = "/images/venues/trades-hall-glasgow-crest-200.webp";
const SHOTS_DIR = process.env["E2E_SHOTS_DIR"];

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1600, height: 1000 } });

async function frame(page: Page, name: string): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png` });
}

/**
 * The share of the screen the visible chrome inks: every element in a zone
 * that can be seen and paints (a fill, a border, a shadow, a picture or its
 * own words), as the union of their boxes. A container whose children have
 * gone paints nothing of its own and so counts for nothing.
 */
async function chromeShare(page: Page): Promise<number> {
  return page.evaluate(() => {
    const paints = (element: Element, style: CSSStyleDeclaration): boolean => {
      if (["IMG", "svg", "CANVAS", "VIDEO"].includes(element.tagName)) return true;
      if (style.backgroundImage !== "none") return true;
      if (style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent") return true;
      if (style.boxShadow !== "none") return true;
      if (["Top", "Right", "Bottom", "Left"].some((side) => style.getPropertyValue(`border-${side.toLowerCase()}-width`) !== "0px" && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none")) return true;
      return Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
    };
    const boxes: DOMRect[] = [];
    const visit = (element: Element, faded: boolean): void => {
      const style = getComputedStyle(element);
      if (style.display === "none") return;
      const gone = faded || Number(style.opacity) < 0.01;
      // visibility is inherited and can be turned back on inside (the crest on a hidden plate).
      if (!gone && style.visibility !== "hidden" && paints(element, style)) {
        const box = element.getBoundingClientRect();
        if (box.width > 1 && box.height > 1) boxes.push(box);
      }
      for (const child of Array.from(element.children)) visit(child, gone);
    };
    for (const zone of Array.from(document.querySelectorAll(".pc-zone"))) {
      for (const child of Array.from(zone.children)) visit(child, false);
    }
    // Area of the union on a 4 px grid: overlapping boxes count once.
    const cell = 4;
    const lit = new Set<number>();
    const columns = Math.ceil(innerWidth / cell);
    const rows = Math.ceil(innerHeight / cell);
    for (const box of boxes) {
      for (let y = Math.max(0, Math.floor(box.top / cell)); y < Math.min(rows, Math.ceil(box.bottom / cell)); y += 1) {
        for (let x = Math.max(0, Math.floor(box.left / cell)); x < Math.min(columns, Math.ceil(box.right / cell)); x += 1) lit.add(y * columns + x);
      }
    }
    return (lit.size * cell * cell) / (innerWidth * innerHeight);
  });
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("no box");
  return box;
}

test("the crest and \\ clear the new chrome to the hall, and \\, Esc or the crest bring it back", async ({ browser }) => {
  const server = new PlannerSaveServer();
  server.seedLayout({ id: LAYOUT, spaceId: SAVE_GRAND_HALL.id, userId: PLANNER.id, name: "Wedding breakfast", tablesAtX: [5, 9] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await server.attach(context);
  // Registered after the server's routes, so it answers first: the server's own venue, with Trades Hall's crest.
  await context.route(`${SAVE_API}/venues/${SAVE_VENUE.id}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, json: { data: { ...SAVE_VENUE, logoUrl: CREST_IMAGE, spaces: [SAVE_GRAND_HALL, SAVE_SALOON] } } });
  });
  await signInAs(context, PLANNER);
  const page = await context.newPage();
  await page.goto(`/plan/${LAYOUT}?chrome=v2`);

  const html = page.locator("html");
  const hide = page.getByRole("button", { name: "Hide the tools" });
  const show = page.getByRole("button", { name: "Show the tools" });
  const dock = page.locator(".pc-zone--dock > *").first();
  const title = page.locator(".pc-slate__title");
  await expect(hide).toBeVisible({ timeout: 60_000 });
  await expect(hide.locator("img")).toHaveAttribute("src", CREST_IMAGE);
  await expect(dock).toBeVisible();
  await expect(title).toBeVisible();
  // The room has drawn its first frame before any measure is taken.
  await page.waitForTimeout(1500);
  const crestAtRest = await boxOf(hide);
  const slateAtRest = await boxOf(page.locator(".pc-slate"));
  const doorCard = page.getByTestId("door-clear-notice");
  // The seed sets a table in a door's way, so the door's card is up: assert it,
  // or the check below that the room takes its place would never run.
  await expect(doorCard).toBeVisible();
  const doorAtRest = await boxOf(doorCard);
  const atRest = await chromeShare(page);
  await frame(page, "01-at-rest");

  // The keyboard: \ clears at once. The first-use note shows for 4 s; on a
  // loaded runner the checks below can outlast it, so its words are checked
  // here and its timing in the unit tests.
  await page.keyboard.press("Backslash");
  await frame(page, "02-cleared-with-note");
  await expect(html).toHaveAttribute("data-planner-chrome", "cleared");
  await expect(html).toHaveAttribute("data-planner-chrome-motion", "instant");
  await expect(page.getByTestId("crest-note")).toContainText("The tools are hidden · press \\ or the crest to bring them back");
  await expect(dock).toBeHidden();
  await expect(title).toBeHidden();
  await expect(show).toBeVisible();
  expect(await boxOf(show)).toEqual(crestAtRest);
  const cleared = await chromeShare(page);
  // Where the chrome has gone the room takes the pointer: the slate's words, and the door's card.
  const under = (x: number, y: number): Promise<string> => page.evaluate(([px, py]) => {
    const hit = document.elementFromPoint(px ?? 0, py ?? 0);
    return hit === null ? "nothing" : hit.closest(".pc-slate") !== null ? "slate" : hit.closest(".door-clear-notice") !== null ? "door notice" : hit.closest('[data-pc-zone]') !== null ? "zone" : "room";
  }, [x, y]);
  expect(await under(slateAtRest.x + slateAtRest.width * 0.7, slateAtRest.y + 40)).toBe("room");
  expect(await under(slateAtRest.x + slateAtRest.width * 0.5, slateAtRest.y + slateAtRest.height - 20)).toBe("room");
  expect(await under(doorAtRest.x + doorAtRest.width / 2, doorAtRest.y + doorAtRest.height / 2)).toBe("room");
  // The crest still takes it.
  expect(await under(crestAtRest.x + crestAtRest.width / 2, crestAtRest.y + crestAtRest.height / 2)).toBe("slate");

  // Esc brings them back, as the last rung of the planner's Escape ladder:
  // whatever is still under way goes first (on a loaded runner, the camera's
  // glide into the room can still be running), then the tools come back.
  await expect.poll(async () => {
    await page.keyboard.press("Escape");
    return page.locator("html").getAttribute("data-planner-chrome");
  }, { timeout: 20_000 }).not.toBe("cleared");
  await expect(dock).toBeVisible();
  await expect(title).toBeVisible();
  await expect(hide).toBeVisible();

  // The pointer: the crest clears with motion, and stands still while it does.
  await hide.click();
  await expect(html).toHaveAttribute("data-planner-chrome", "cleared");
  await expect(html).not.toHaveAttribute("data-planner-chrome-motion", "instant");
  expect(await boxOf(show)).toEqual(crestAtRest);
  await expect(dock).toBeHidden();
  await page.waitForTimeout(4500);
  await expect(page.getByTestId("crest-note")).toHaveAttribute("data-shown", "false");
  await frame(page, "03-cleared");

  // The crest brings them back; then \ does the same.
  await show.click();
  await expect(html).not.toHaveAttribute("data-planner-chrome", "cleared");
  await expect(dock).toBeVisible();
  await page.keyboard.press("Backslash");
  await expect(html).toHaveAttribute("data-planner-chrome", "cleared");
  await page.keyboard.press("Backslash");
  await expect(html).not.toHaveAttribute("data-planner-chrome", "cleared");
  await expect(title).toBeVisible();

  // The first Esc above stopped whatever was under way; now one Esc is enough, and no more.
  await page.keyboard.press("Backslash");
  await expect(html).toHaveAttribute("data-planner-chrome", "cleared");
  await page.keyboard.press("Escape");
  await expect(html).not.toHaveAttribute("data-planner-chrome", "cleared");
  await expect(dock).toBeVisible();

  // A panel asked for while cleared opens where it can be seen: L brings Lay out and the tools back together.
  await page.keyboard.press("Backslash");
  await expect(html).toHaveAttribute("data-planner-chrome", "cleared");
  await page.keyboard.press("l");
  await expect(html).not.toHaveAttribute("data-planner-chrome", "cleared");
  const layOut = page.locator(".pc-zone--right > *").first();
  await expect(layOut).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(layOut).toHaveCount(0);
  await expect(html).not.toHaveAttribute("data-planner-chrome", "cleared");

  // / opens the catalogue's search where it can be seen, and what is typed goes into it, not to the planner's keys.
  await page.keyboard.press("Backslash");
  await expect(html).toHaveAttribute("data-planner-chrome", "cleared");
  await page.keyboard.press("/");
  await expect(html).not.toHaveAttribute("data-planner-chrome", "cleared");
  const search = page.getByRole("searchbox", { name: "Search the catalogue" });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await page.keyboard.type("round");
  await expect(search).toHaveValue("round");
  await expect(html).not.toHaveAttribute("data-planner-chrome", "cleared");
  await expect.poll(async () => {
    await page.keyboard.press("Escape");
    return search.isVisible();
  }, { timeout: 10_000 }).toBe(false);
  await page.waitForTimeout(400);
  await frame(page, "04-back");

  test.info().annotations.push({ type: "chrome share", description: `at rest ${(atRest * 100).toFixed(1)} %, cleared ${(cleared * 100).toFixed(2)} %` });
  // Cleared, only the crest and its note are left: well under 1 % of the screen.
  expect(cleared).toBeLessThan(0.01);
  expect(cleared).toBeLessThan(atRest);
  await context.close();
});
