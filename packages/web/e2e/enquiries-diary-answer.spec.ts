import { expect, test, type Page } from "@playwright/test";
import type { CalendarBookingEntry } from "@omnitwin/types";
import type { Enquiry } from "../src/api/enquiries.js";

// ---------------------------------------------------------------------------
// E2E: the Enquiries desk says where an enquiry stands in the Diary (T-635,
// roadmap Tier A #4; docs/design/enquiry-day-answer-2026-10-13).
//
// Opening an enquiry is all it takes: the Diary's answer for the day asked
// for arrives in the facts with nothing more to press. The fact holds its
// two lines from the first paint, so Approve does not move while the Diary
// is read, when a long answer lands, or when a read fails, on a desk and on a
// phone. The API is emulated as it serves the desk; each day's read is held
// open until the test lets it answer.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000008301";
const HALL_ID = "00000000-0000-4000-8000-000000008302";
const STAFF_ID = "00000000-0000-4000-8000-000000008391";
const NOW = "2026-10-14T09:00:00.000Z";

function wedding(n: number, name: string, preferredDate: string): Enquiry {
  return {
    id: `00000000-0000-4000-8000-00000000831${String(n)}`, venueId: VENUE_ID, spaceId: HALL_ID, configurationId: null,
    userId: null, guestEmail: `guest${String(n)}@diary.test`, guestPhone: null, guestName: name,
    state: "under_review", name, email: `guest${String(n)}@diary.test`, preferredDate, eventType: "wedding",
    estimatedGuests: 140, message: null, source: "website", roomChosen: true,
    createdAt: new Date(Date.parse(NOW) - n * 3_600_000).toISOString(), updatedAt: NOW,
  };
}

// Newest first: Elaine's day answers with a long list, Ross's day fails.
const ELAINE = wedding(1, "Elaine Fraser", "2027-05-14");
const ROSS = wedding(2, "Ross MacLeod", "2027-05-15");

/** Three bookings in the Grand Hall on the 14th, with long titles. */
function longDay(): CalendarBookingEntry[] {
  const entry = (n: number, title: string, from: string, to: string, kind: "ink" | "hold"): CalendarBookingEntry => ({
    entryType: "booking", id: `00000000-0000-4000-9000-00000000831${String(n)}`, spaceId: HALL_ID, kind, status: "active",
    state: kind, title, eventType: "dinner", startsAt: from, endsAt: to, rank: kind === "hold" ? 1 : null, jointFlag: false,
    decisionAt: kind === "hold" ? "2026-12-01T12:00:00.000Z" : null, ownerUserId: null, nextAction: null,
    nextActionDueAt: null, eventId: null, seriesId: null,
  });
  return [
    entry(1, "Royal Faculty of Procurators breakfast briefing and committee papers", "2027-05-14T06:00:00.000Z", "2027-05-14T09:00:00.000Z", "ink"),
    entry(2, "Incorporation of Hammermen of Glasgow quarterly court luncheon", "2027-05-14T10:30:00.000Z", "2027-05-14T14:00:00.000Z", "ink"),
    entry(3, "MacLeod and Stewart wedding with ceilidh until late", "2027-05-14T16:00:00.000Z", "2027-05-14T22:30:00.000Z", "hold"),
  ];
}

interface DayReads {
  /** Lets the held read of a day answer: with its entries, or by failing. */
  readonly answer: (iso: string, how: "entries" | "fail") => void;
  readonly asked: string[];
}

async function openDesk(page: Page): Promise<DayReads> {
  await page.addInitScript(({ venueId, staffId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: staffId, email: "staff@diary.test", role: "staff", platformRole: "none", venueId, name: "Staff Diary" },
      writable: false,
    });
  }, { venueId: VENUE_ID, staffId: STAFF_ID });
  const held = new Map<string, (how: "entries" | "fail") => void>();
  const reads: DayReads = {
    asked: [],
    answer: (iso, how) => {
      const release = held.get(iso);
      if (release === undefined) throw new Error(`No read of ${iso} is held`);
      held.delete(iso);
      release(how);
    },
  };
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/calendar") {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      // The venue's day runs from 23:00Z the evening before (BST).
      const iso = new Date(Date.parse(from) + 3_600_000).toISOString().slice(0, 10);
      reads.asked.push(iso);
      const how = await new Promise<"entries" | "fail">((resolve) => { held.set(iso, resolve); });
      // A read the desk has given up on may already be gone.
      if (how === "fail") {
        await route.fulfill({ status: 500, json: { error: "Unavailable", code: "INTERNAL" } }).catch(() => undefined);
        return;
      }
      await route.fulfill({ json: { data: {
        venueId: VENUE_ID, range: { from, to },
        rooms: [{ id: HALL_ID, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
        entries: iso === "2027-05-14" ? longDay() : [],
        conflicts: { conflicts: [], checks: {
          inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" },
          turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Every gap is covered by a turnaround rule." },
        } },
      } } }).catch(() => undefined);
    } else if (url.pathname === "/bookings" && request.method() === "GET") {
      await route.fulfill({ json: { data: [] } });
    } else if (url.pathname === "/enquiries") {
      await route.fulfill({ json: { data: [ELAINE, ROSS], meta: { total: 2, limit: 20, offset: 0, order: "created_desc" } } });
    } else if (url.pathname.endsWith("/history")) {
      await route.fulfill({ json: { data: [] } });
    } else if (url.pathname === `/venues/${VENUE_ID}` || url.pathname === "/venues") {
      const venue = { id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
        logoUrl: null, brandColour: null, spaces: [{ id: HALL_ID, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall",
          widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] }] };
      await route.fulfill({ json: { data: url.pathname === "/venues" ? [venue] : venue } });
    } else if (url.pathname === "/notifications/unread-count") {
      await route.fulfill({ json: { data: { unread: 0 } } });
    } else if (url.pathname.startsWith("/notifications")) {
      await route.fulfill({ json: { data: [] } });
    } else {
      await route.fulfill({ status: 404, json: { error: `Not mocked: ${url.pathname}` } });
    }
  });
  await page.goto("/dashboard?view=enquiries");
  return reads;
}

/** Where Approve sits, to the pixel. */
async function approveTop(page: Page): Promise<number> {
  const box = await page.getByRole("button", { name: "Approve…" }).boundingBox();
  if (box === null) throw new Error("Approve is not on screen");
  return box.y;
}

test.describe("Enquiries desk, where an enquiry stands in the Diary", () => {
  test.describe.configure({ timeout: 60_000 });

  for (const [label, width, height] of [["a desk", 1440, 900], ["a phone", 390, 844]] as const) {
    test(`answers with nothing to press, and Approve holds its place on ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.clock.setFixedTime(new Date(NOW));
      const reads = await openDesk(page);

      // Opening the enquiry is the only press.
      await page.getByRole("button", { name: /^Elaine Fraser,/u }).click();
      const fact = page.locator(".enq-facts__diary dd");
      await expect(fact).toHaveText("Reading the Diary…", { timeout: 20_000 });
      const waiting = await approveTop(page);

      reads.answer("2027-05-14", "entries");
      await expect(fact).toHaveText(/^3 bookings: Confirmed 07:00–10:00 · Confirmed 11:30–15:00 · 1st option 17:00–23:30, decides Tue 1 Dec$/u);
      expect(await approveTop(page)).toBe(waiting);
      // The whole answer is in the list, title by title, and said once.
      const inTheDiary = page.getByRole("region", { name: "In the Diary" });
      await expect(inTheDiary).toContainText("Confirmed, Incorporation of Hammermen of Glasgow quarterly court luncheon, 11:30–15:00");
      await expect(page.getByRole("status").filter({ hasText: "In the Diary: 3 bookings" })).toHaveCount(1);

      // The next enquiry's day cannot be read: the same place, honestly said.
      await page.keyboard.press("j");
      await expect(page.getByRole("region", { name: "Ross MacLeod" })).toBeVisible();
      await expect.poll(() => reads.asked.includes("2027-05-15")).toBe(true);
      expect(await approveTop(page)).toBe(waiting);
      reads.answer("2027-05-15", "fail");
      await expect(fact).toHaveText("The Diary could not be read for that day.");
      expect(await approveTop(page)).toBe(waiting);
      await expect(page.getByRole("region", { name: "In the Diary" }).getByRole("button", { name: "Try again" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
});
