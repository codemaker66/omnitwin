import { expect, test, type Page } from "@playwright/test";
import type { SearchResults } from "../src/api/clients.js";
import {
  collectAccessibilityAudit,
  expectAccessibilityAuditClean,
  watchPageProblems,
} from "./support/accessibility-audit.js";

// ---------------------------------------------------------------------------
// E2E: Find in the staff header (T-635, roadmap Tier A #8).
//
// One keystroke to any record while the client is on the phone: Ctrl+K from
// any staff page, a name, a date or a page as it was said, and the place it
// opens. What the client search finds is the API's to decide, proven against
// real PostgreSQL in client-search-postgres.test.ts; here /clients/search
// answers with that test's rows, the calendar with one wedding, and the spec
// proves Find itself, from the keyboard on a desk and by touch on phones.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000009701";
const ROOM_ID = "00000000-0000-4000-8000-000000009702";
const AILSA_ID = "00000000-0000-4000-8000-000000009711";
const DEAL_ID = "00000000-0000-4000-8000-000000009731";
const FRASER_ID = "00000000-0000-4000-8000-000000009741";
/** 10:00 in Glasgow on Wednesday 7 October 2026. */
const NOW = new Date("2026-10-07T09:00:00.000Z");

const VENUE = {
  id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
  logoUrl: null, brandColour: null, timezone: "Europe/London",
  spaces: [{ id: ROOM_ID, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall",
    widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] }],
};

const NOTHING: SearchResults = { users: [], guestLeads: [], configurations: [], contacts: [], accounts: [], deals: [], proposals: [] };
const HENDERSON: SearchResults = {
  ...NOTHING,
  contacts: [{ id: AILSA_ID, name: "Ailsa Henderson", email: "ailsa.henderson@example.test", phone: "0141 555 0142", accountName: "Henderson Family" }],
  deals: [{ id: DEAL_ID, title: "Wedding reception, 5 June", stage: "proposal_sent", preferredDate: "2027-06-05", guestCount: 160, contactName: "Ailsa Henderson" }],
};

const AILSA_PROFILE = {
  contact: {
    id: AILSA_ID, venueId: VENUE_ID, name: "Ailsa Henderson", email: "ailsa.henderson@example.test", phone: "0141 555 0142",
    roleLabel: "Bride", sourceEnquiryId: null, createdAt: "2026-08-14T10:00:00.000Z", account: null,
  },
  deals: [],
  proposals: [],
};

/** The Fraser wedding, confirmed in the Grand Hall on Saturday 14 November. */
const FRASER = {
  entryType: "booking", id: FRASER_ID, spaceId: ROOM_ID, kind: "ink", status: "active", state: "ink",
  title: "Fraser wedding", eventType: "wedding", startsAt: "2026-11-14T13:00:00.000Z", endsAt: "2026-11-14T23:00:00.000Z",
  rank: null, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null,
  eventId: null, seriesId: null,
};

interface Emulator {
  readonly searches: string[];
}

async function openWorkspace(page: Page, { role, path, width = 1440, height = 900 }: {
  readonly role: "staff" | "sales";
  readonly path: string;
  readonly width?: number;
  readonly height?: number;
}): Promise<Emulator> {
  const personId = role === "staff" ? "00000000-0000-4000-8000-000000009791" : "00000000-0000-4000-8000-000000009792";
  await page.setViewportSize({ width, height });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ venueId, id, seededRole }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id, email: `${seededRole}@find.test`, role: seededRole, platformRole: "none", venueId, name: "Catherine Tait" },
      writable: false,
    });
    window.localStorage.setItem(`venviewer:diary-welcome-seen:${id}`, "1");
  }, { venueId: VENUE_ID, id: personId, seededRole: role });

  const emulator: Emulator = { searches: [] };
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    const at = url.pathname;
    if (at === "/clients/search") {
      const q = url.searchParams.get("q") ?? "";
      emulator.searches.push(q);
      void route.fulfill({ json: { data: q.toLowerCase().startsWith("hender") ? HENDERSON : NOTHING } });
    } else if (at === "/clients/upcoming" || at === "/clients/recent") {
      void route.fulfill({ json: { data: [] } });
    } else if (at === `/clients/contacts/${AILSA_ID}/profile`) {
      void route.fulfill({ json: { data: AILSA_PROFILE } });
    } else if (at === "/enquiries") {
      void route.fulfill({ json: { data: [], meta: { total: 0, limit: 20, offset: 0, order: "created_desc" } } });
    } else if (at === "/calendar") {
      const from = url.searchParams.get("from") ?? NOW.toISOString();
      const to = url.searchParams.get("to") ?? NOW.toISOString();
      const covers = Date.parse(from) <= Date.parse(FRASER.startsAt) && Date.parse(to) >= Date.parse(FRASER.endsAt);
      void route.fulfill({ json: { data: {
        venueId: VENUE_ID, range: { from, to },
        rooms: [{ id: ROOM_ID, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
        entries: covers ? [FRASER] : [],
        conflicts: { conflicts: [], checks: {
          inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" },
          turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Every gap is covered by a turnaround rule." },
        } },
        turnaroundRules: [], decisionsDue: { holds: [], total: 0 }, nextActionsDue: { holds: [], total: 0 },
        contested: { dates: [], total: 0 },
      } } });
    } else if (at === `/venues/${VENUE_ID}` || at === "/venues") {
      void route.fulfill({ json: { data: at === "/venues" ? [VENUE] : VENUE } });
    } else if (at === `/venues/${VENUE_ID}/requests`) {
      void route.fulfill({ json: { data: [] } });
    } else if (at === "/notifications/unread-count") {
      void route.fulfill({ json: { data: { unread: 0 } } });
    } else if (at.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
    } else {
      void route.fulfill({ status: 404, json: { error: `Not emulated: ${at}` } });
    }
  });
  await page.routeWebSocket(/\/ws\//u, (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string };
      if (message.type === "auth") ws.send(JSON.stringify({ type: "hello", venueId: VENUE_ID, presence: [] }));
    });
  });
  await page.goto(path);
  // Arrival is not what this spec proves; a cold dev server can take a while
  // to compile the staff pages the first time.
  await expect(page.locator("header.dashboard-layout-header .dashboard-layout-title"))
    .toHaveText("Trades Hall Glasgow", { timeout: 20_000 });
  return emulator;
}

/** The row Enter would open, as it is read out. */
async function activeRow(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const field = document.querySelector('[role="dialog"][aria-label="Find"] [role="combobox"]');
    const id = field?.getAttribute("aria-activedescendant");
    return id === null || id === undefined ? null : document.getElementById(id)?.getAttribute("aria-label") ?? null;
  });
}

async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("Find", () => {
  test("a booker finds a client, a date and a booking on the board from the keyboard, from any staff page", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    const emulator = await openWorkspace(page, { role: "staff", path: "/dashboard?view=search" });
    await expect(page.getByRole("main")).toHaveAccessibleName("Clients");

    // A name as it was heard: the best finding is first, and the person's own.
    await page.keyboard.press("Control+k");
    const find = page.getByRole("dialog", { name: "Find" });
    const field = find.getByRole("combobox", { name: "Find" });
    await expect(field).toBeFocused();
    await expect(find.getByText("Dates, pages, people, organisations, deals, proposals and layouts, by a near spelling too.")).toBeVisible();
    await page.keyboard.type("henderson");
    await expect(find.getByRole("option", { name: /^Ailsa Henderson, contact/u })).toBeVisible();
    await expect.poll(() => activeRow(page)).toBe("Ailsa Henderson, contact, Henderson Family · ailsa.henderson@example.test");
    expect(emulator.searches.at(-1)).toBe("henderson");
    expect(emulator.searches.every((q) => q.length >= 2)).toBe(true);
    await expect(find.getByRole("option", { name: /^Wedding reception, 5 June, deal, Saturday 5 June 2027/u })).toBeVisible();
    await expect(find.getByRole("option", { name: "Search clients for “henderson”, See everything found on the Clients desk" })).toBeVisible();

    const audit = await collectAccessibilityAudit(page, {
      name: "Find with clients found", path: "/dashboard?view=search", problems, maxFocusSteps: 6,
    });
    expectAccessibilityAuditClean(audit);

    // Enter opens her on the Clients desk, with what was found beside her.
    await field.focus();
    await page.keyboard.press("Enter");
    await expect(find).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`view=search&q=henderson&client=contact%3A${AILSA_ID}`, "u"));
    await expect(page.getByRole("heading", { level: 2, name: "Ailsa Henderson" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search clients" })).toHaveValue("henderson");

    // A date as it was said: the Diary on that day, answering room by room.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("14 nov");
    await expect.poll(() => activeRow(page)).toBe("Saturday 14 November 2026, See each room in the Diary");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "The Diary" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Go to date" })).toHaveValue("Saturday 14 November 2026");
    await expect(page.locator(".diary-goto-answer")).toContainText("Confirmed, Fraser wedding, 13:00–23:00");
    await expect(page).toHaveURL(/\/diary\?view=week&date=2026-11-14$/u);

    // On the Diary, Find brings what the board has read: the booking is focused there.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("fraser");
    await expect(find.getByText("On the board")).toBeVisible();
    await expect.poll(() => activeRow(page)).toMatch(/^Fraser wedding, booking, Grand Hall/u);
    await page.keyboard.press("Enter");
    await expect(find).toHaveCount(0);
    await expect(page.locator(`#diary-block-${FRASER_ID}`)).toBeFocused();

    expect(problems.pageErrors).toEqual([]);
  });

  test("on a phone Find is a magnifier that opens a whole-width sheet, and sales is offered only what it may open", async ({ page }) => {
    await openWorkspace(page, { role: "staff", path: "/dashboard?view=search", width: 390, height: 844 });
    const button = page.getByRole("button", { name: "Find" });
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await button.click();
    const find = page.getByRole("dialog", { name: "Find" });
    const field = find.getByRole("combobox", { name: "Find" });
    await expect(field).toBeFocused();
    // 16 px or more, so the phone never zooms into the field.
    expect(await field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    await field.fill("pipe");
    await find.getByRole("option", { name: /^Pipeline, page/u }).click();
    await expect(page).toHaveURL(/\/dashboard\?view=pipeline$/u);
    await expect(find).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 640 });
    await button.click();
    await expect(find).toBeVisible();
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    const sheet = await find.boundingBox();
    expect((sheet?.x ?? -1) >= 0 && (sheet?.x ?? 0) + (sheet?.width ?? 999) <= 320).toBe(true);
    await find.getByRole("button", { name: "Close Find" }).click();
    await expect(find).toHaveCount(0);

    // Sales works the pipeline but not the Clients desk (Blake's C2): its Find
    // offers dates and pages, and never asks the client search.
    const sales = await page.context().newPage();
    const salesSearches = await openWorkspace(sales, { role: "sales", path: "/dashboard?view=enquiries" });
    await sales.keyboard.press("Control+k");
    const salesFind = sales.getByRole("dialog", { name: "Find" });
    await expect(salesFind.getByRole("combobox", { name: "Find" })).toHaveAttribute("placeholder", "A date or a page");
    await expect(salesFind.getByText("Dates and pages.")).toBeVisible();
    await sales.keyboard.type("henderson");
    await expect(salesFind.getByText("Nothing found for “henderson”.")).toBeVisible();
    await sales.waitForTimeout(500);
    expect(salesSearches.searches).toEqual([]);
    await expect(salesFind.getByRole("option")).toHaveCount(0);
    await sales.close();
  });
});
