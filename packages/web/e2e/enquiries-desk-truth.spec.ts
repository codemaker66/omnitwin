import { expect, test, type Page } from "@playwright/test";
import type { Enquiry } from "../src/api/enquiries.js";
import { unreadableText } from "./support/readability.js";

// ---------------------------------------------------------------------------
// E2E: the Enquiries desk tells the truth about a lead (roadmap N6).
//
// An enquiry from the venue's own pages names no room, but is filed under the
// venue's first. The desk never names or pictures that room as the guest's
// choice: the room reads "Not chosen", the guest's own words are quoted, and
// a quiet chip says where the enquiry came from. A planner enquiry beside it
// keeps its room and photograph. The API is emulated as it serves the desk.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000008001";
const SPACE_ID = "00000000-0000-4000-8000-000000008002";

function enquiry(n: number, fields: Partial<Enquiry>): Enquiry {
  return {
    id: `00000000-0000-4000-8000-${String(800_000_000_000 + n)}`,
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    configurationId: null,
    userId: null,
    guestEmail: `guest${String(n)}@truth.test`,
    guestPhone: null,
    guestName: null,
    state: "submitted",
    name: `Guest ${String(n)}`,
    email: `guest${String(n)}@truth.test`,
    preferredDate: "2027-05-14",
    eventType: "wedding",
    estimatedGuests: 120,
    message: null,
    createdAt: `2026-09-2${String(n)}T09:00:00.000Z`,
    updatedAt: `2026-09-2${String(n)}T09:00:00.000Z`,
    ...fields,
  };
}

const ROOMLESS = enquiry(6, {
  name: "Elaine Fraser",
  source: "walkthrough",
  roomChosen: false,
  message: "Is Saturday 14 May free? We are about 120.",
});
const PLANNED = enquiry(5, {
  name: "Ross MacLeod",
  configurationId: "00000000-0000-4000-8000-000000008009",
  source: "planner",
  roomChosen: true,
  message: "Our layout is attached.",
});

/** The labels this desk adds or rewords: the stage and source, the facts and the quote. */
async function unreadableLead(page: Page, state: string): Promise<string[]> {
  const found: string[] = [];
  for (const scope of [".enq-panel__status", ".enq-facts", ".enq-quote"]) found.push(...await unreadableText(page, scope, state));
  return found;
}

async function openDesk(page: Page): Promise<void> {
  await page.addInitScript(({ venueId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: "00000000-0000-4000-8000-000000008091", email: "staff@truth.test", role: "staff", platformRole: "none", venueId, name: "Staff Truth" },
      writable: false,
    });
  }, { venueId: VENUE_ID });
  const rows = [ROOMLESS, PLANNED];
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    const single = /^\/enquiries\/([^/]+)(\/history)?$/u.exec(url.pathname);
    if (url.pathname === "/enquiries") {
      void route.fulfill({ json: { data: rows, meta: { total: rows.length, limit: 20, offset: 0, order: "created_desc" } } });
    } else if (single !== null) {
      const row = rows.find((candidate) => candidate.id === single[1]);
      if (row === undefined) void route.fulfill({ status: 404, json: { error: "Enquiry not found", code: "NOT_FOUND" } });
      else void route.fulfill({ json: { data: single[2] === "/history" ? [] : row } });
    } else if (url.pathname === `/venues/${VENUE_ID}` || url.pathname === "/venues") {
      const venue = { id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
        logoUrl: null, brandColour: null, spaces: [{ id: SPACE_ID, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall",
          widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] }] };
      void route.fulfill({ json: { data: url.pathname === "/venues" ? [venue] : venue } });
    } else if (url.pathname === "/notifications/unread-count") {
      void route.fulfill({ json: { data: { unread: 0 } } });
    } else if (url.pathname.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
    } else {
      void route.fulfill({ status: 404, json: { error: `Not mocked: ${url.pathname}` } });
    }
  });
  await page.goto("/dashboard?view=enquiries");
}

test.describe("Enquiries desk, the truth about a lead", () => {
  test("names and pictures no room a guest did not choose, quotes their words and says where they came from", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDesk(page);

    // The planner's enquiry names the room its guest laid out, once the rooms are read.
    const planned = page.getByRole("button", { name: /^Ross MacLeod,/u });
    await expect(planned).toContainText("Grand Hall");
    const roomless = page.getByRole("button", { name: /^Elaine Fraser,/u });
    await expect(roomless).not.toContainText("Grand Hall");
    await expect(roomless).toContainText("“Is Saturday 14 May free? We are about 120.”");

    await roomless.click();
    const panel = page.getByRole("region", { name: "Elaine Fraser" });
    await expect(panel.locator(".enq-facts")).toContainText("Not chosen");
    await expect(panel.getByText("From the walkthrough", { exact: true })).toBeVisible();
    await expect(panel.locator(".enq-room-photo")).toHaveCount(0);
    await expect(panel).not.toContainText("Grand Hall");
    await expect(panel.locator(".enq-quote")).toHaveText("Is Saturday 14 May free? We are about 120.");
    expect(await unreadableLead(page, "a roomless enquiry")).toEqual([]);

    await planned.click();
    const plannedPanel = page.getByRole("region", { name: "Ross MacLeod" });
    await expect(plannedPanel.locator(".enq-facts__room")).toHaveText("Grand Hall");
    await expect(plannedPanel.getByText("From the planner", { exact: true })).toBeVisible();
    await expect(plannedPanel.locator(".enq-room-photo img")).toHaveAttribute("src", "/images/venue/ladder/grand-hall-room-768.webp");
  });

  test("keeps the source chip beside the stage on a phone, inside the screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDesk(page);
    await page.getByRole("button", { name: /^Elaine Fraser,/u }).click();
    const panel = page.getByRole("region", { name: "Elaine Fraser" });
    const chip = panel.getByText("From the walkthrough", { exact: true });
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await unreadableLead(page, "a roomless enquiry on a phone")).toEqual([]);
  });
});
