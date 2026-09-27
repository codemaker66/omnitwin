import { expect, test, type Page } from "@playwright/test";
import type { Booking, CalendarBookingEntry } from "@omnitwin/types";
import type { Enquiry } from "../src/api/enquiries.js";
import type { Opportunity } from "../src/api/crm.js";

// ---------------------------------------------------------------------------
// E2E: the Enquiries desk hands a lead on (roadmap N6).
//
// Create opportunity lands on the deal, selected in the pipeline beside the
// board, and a second press lands on the same deal rather than making another
// or saying one was "opened" somewhere else. Hold a date in the Diary opens
// the Diary on the date asked for with the hold ready, and the hold is on the
// board once made. The API is emulated as it serves the desk, the pipeline
// and the Diary; it answers a second press as the real route does, with the
// deal the first made, and a hold for a guest who chose no room only with a
// room someone chose.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000008101";
const SPACE_ID = "00000000-0000-4000-8000-000000008102";
const ENQUIRY_ID = "00000000-0000-4000-8000-000000008103";
const DEAL_ID = "00000000-0000-4000-8000-000000008104";
const SALOON_ID = "00000000-0000-4000-8000-000000008105";
const HOLD_ID = "00000000-0000-4000-8000-000000008106";
const STAFF_ID = "00000000-0000-4000-8000-000000008191";
const NOW = "2026-09-27T09:00:00.000Z";

const ENQUIRY: Enquiry = {
  id: ENQUIRY_ID, venueId: VENUE_ID, spaceId: SPACE_ID, configurationId: null, userId: null,
  guestEmail: "elaine@handoff.test", guestPhone: null, guestName: "Elaine Fraser", state: "approved",
  name: "Elaine Fraser", email: "elaine@handoff.test", preferredDate: "2027-05-14", eventType: "wedding",
  estimatedGuests: 120, message: "Is Saturday 14 May free?", source: "walkthrough", roomChosen: false,
  createdAt: NOW, updatedAt: NOW,
};

const DEAL: Opportunity = {
  id: DEAL_ID, venueId: VENUE_ID, clientAccountId: null, primaryContactId: null, sourceEnquiryId: ENQUIRY_ID,
  ownerUserId: null, title: "wedding — Elaine Fraser", stage: "new", eventType: "wedding", preferredDate: "2027-05-14",
  guestCount: 120, estimatedValueMinor: 0, currency: "GBP",
  nextAction: "Prepare a proposal draft and confirm room, date, and guest-count assumptions with the client.",
  nextActionDueAt: null, createdAt: NOW, updatedAt: NOW, closedAt: null, deletedAt: null,
};

interface Presses {
  made: number;
  answered: string[];
  /** Every hold the Diary asked for, and the holds made. */
  holdRequests: Record<string, unknown>[];
  holds: CalendarBookingEntry[];
}

/** A hold as the API serves it, from what the Diary sent. */
function heldFrom(body: Record<string, unknown>): Booking {
  const text = (key: string): string => (typeof body[key] === "string" ? body[key] : "");
  return {
    id: HOLD_ID, venueId: VENUE_ID, spaceId: text("spaceId"), eventId: null, kind: "hold", status: "active",
    state: "hold", title: text("title"), eventType: "wedding", startsAt: text("startsAt"), endsAt: text("endsAt"),
    rank: 1, jointFlag: false, decisionAt: text("decisionAt"), ownerUserId: STAFF_ID, nextAction: text("nextAction"),
    nextActionDueAt: text("nextActionDueAt"), seriesId: null, notes: null, createdBy: STAFF_ID, enquiryId: ENQUIRY_ID,
    createdAt: NOW, updatedAt: NOW,
  };
}

async function openDesk(page: Page): Promise<Presses> {
  await page.addInitScript(({ venueId, staffId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: staffId, email: "staff@handoff.test", role: "staff", platformRole: "none", venueId, name: "Staff Handoff" },
      writable: false,
    });
    window.localStorage.setItem(`venviewer:diary-welcome-seen:${staffId}`, "1");
  }, { venueId: VENUE_ID, staffId: STAFF_ID });
  const presses: Presses = { made: 0, answered: [], holdRequests: [], holds: [] };
  await page.route(`${API}/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/calendar") {
      const from = Date.parse(url.searchParams.get("from") ?? "");
      const to = Date.parse(url.searchParams.get("to") ?? "");
      void route.fulfill({ json: { data: {
        venueId: VENUE_ID,
        range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
        rooms: [
          { id: SPACE_ID, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
          { id: SALOON_ID, name: "Saloon", slug: "saloon", sortOrder: 1 },
        ],
        entries: presses.holds.filter((row) => Date.parse(row.startsAt) < to && Date.parse(row.endsAt) > from),
        conflicts: { conflicts: [], checks: {
          inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" },
          turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Every gap is covered by a turnaround rule." },
        } },
        turnaroundRules: [],
        decisionsDue: { holds: [], total: 0 },
        nextActionsDue: { holds: [], total: 0 },
        contested: { dates: [], total: 0 },
      } } });
    } else if (url.pathname === "/bookings/from-enquiry" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      presses.holdRequests.push(body);
      // As the route does: the room a guest did not choose is not taken.
      if (typeof body["spaceId"] !== "string") {
        void route.fulfill({ status: 400, json: { error: "Choose a room for this hold. The guest did not choose one.", code: "ROOM_NOT_CHOSEN" } });
        return;
      }
      const held = heldFrom(body);
      presses.holds.push({ ...held, entryType: "booking", ownerName: "Staff Handoff" } as CalendarBookingEntry);
      void route.fulfill({ status: 201, json: { data: held } });
    } else if (url.pathname === "/enquiries") {
      void route.fulfill({ json: { data: [ENQUIRY], meta: { total: 1, limit: 20, offset: 0, order: "created_desc" } } });
    } else if (url.pathname === `/enquiries/${ENQUIRY_ID}/history`) {
      void route.fulfill({ json: { data: [] } });
    } else if (url.pathname === `/enquiries/${ENQUIRY_ID}`) {
      void route.fulfill({ json: { data: ENQUIRY } });
    } else if (url.pathname === `/crm/from-enquiry/${ENQUIRY_ID}` && request.method() === "POST") {
      // The real route makes one deal per enquiry and answers every later
      // press with it.
      const created = presses.made === 0;
      presses.made += 1;
      presses.answered.push(DEAL_ID);
      void route.fulfill({
        status: created ? 201 : 200,
        json: { data: { created, opportunity: DEAL, clientAccount: null, contact: null, followUpTask: null } },
      });
    } else if (url.pathname === "/crm/pipeline") {
      const opportunities = presses.made === 0 ? [] : [DEAL];
      void route.fulfill({ json: { data: {
        opportunities, todayTasks: [], stageCounts: { new: opportunities.length }, pipelineValueMinor: 0, currency: "GBP",
        page: { total: opportunities.length, limit: 50, offset: 0, taskTotal: 0, taskLimit: 50, taskOffset: 0 },
      } } });
    } else if (url.pathname === `/opportunities/${DEAL_ID}`) {
      void route.fulfill({ json: { data: { opportunity: DEAL, activities: [], tasks: [], proposals: [] } } });
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
  await page.routeWebSocket(`${API.replace(/^http/u, "ws")}/ws/diary`, (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string };
      if (message.type === "auth") {
        ws.send(JSON.stringify({ type: "hello", venueId: VENUE_ID, presence: [{ userId: STAFF_ID, name: "Staff Handoff", role: "staff" }] }));
      }
    });
  });
  await page.goto("/dashboard?view=enquiries");
  return presses;
}

async function pressCreateOpportunity(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Elaine Fraser,/u }).click();
  await page.getByRole("region", { name: "Elaine Fraser" }).getByRole("button", { name: "Create opportunity" }).click();
}

test.describe("Enquiries desk, handing a lead on", () => {
  test("Create opportunity lands on the deal, selected in the pipeline, and a second press lands on the same deal", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const presses = await openDesk(page);

    await pressCreateOpportunity(page);
    await expect(page).toHaveURL(new RegExp(`[?&]view=pipeline&opportunity=${DEAL_ID}$`, "u"));
    const detail = page.getByRole("region", { name: DEAL.title });
    await expect(detail.getByRole("heading", { level: 2, name: DEAL.title })).toBeVisible();
    // The board is beside it, with the deal on it.
    await expect(page.getByTestId(`opportunity-${DEAL_ID}`)).toBeVisible();
    // No notice claims the deal was opened somewhere else.
    await expect(page.getByText("Existing opportunity opened")).toHaveCount(0);

    // Back to the desk, and a second press lands on the same deal.
    await page.goBack();
    await expect(page).toHaveURL(/view=enquiries/u);
    await pressCreateOpportunity(page);
    await expect(page).toHaveURL(new RegExp(`[?&]view=pipeline&opportunity=${DEAL_ID}$`, "u"));
    await expect(page.getByRole("region", { name: DEAL.title }).getByRole("heading", { level: 2, name: DEAL.title })).toBeVisible();
    expect(presses.made).toBe(2);
    expect(presses.answered).toEqual([DEAL_ID, DEAL_ID]);
    await expect(page.getByText("Existing opportunity opened")).toHaveCount(0);
  });

  test("Hold a date in the Diary opens the Diary on the date asked for, and the hold is on the board once made", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date(NOW));
    const presses = await openDesk(page);

    await page.getByRole("button", { name: /^Elaine Fraser,/u }).click();
    await page.getByRole("region", { name: "Elaine Fraser" }).getByRole("link", { name: "Hold a date in the Diary" }).click();

    // The Diary opens on the week asked for with the hold ready, and the
    // address forgets the enquiry, so a reload or Back holds nothing twice.
    const drawer = page.getByRole("dialog", { name: "Hold a date for this enquiry" });
    await expect(drawer).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/diary\?date=2027-05-14$/u);
    await expect(drawer.getByLabel("Title")).toHaveValue("Elaine Fraser — Wedding");
    await expect(drawer.getByLabel("Starts")).toHaveValue(/^2027-05-14T/u);
    // The guest chose no room, so none is taken for them.
    await expect(drawer.getByLabel("Room")).toHaveValue("");

    await drawer.getByLabel("Room").selectOption({ label: "Saloon" });
    await drawer.getByLabel("Decision date").fill("2027-04-30T12:00");
    await drawer.getByLabel("Next action", { exact: true }).fill("Send the wedding brochure.");
    await drawer.getByLabel("Next action due").fill("2026-10-02T09:00");
    await drawer.getByRole("button", { name: "Hold the date" }).click();

    await expect(drawer).toHaveCount(0);
    expect(presses.holdRequests).toHaveLength(1);
    expect(presses.holdRequests[0]).toMatchObject({ enquiryId: ENQUIRY_ID, spaceId: SALOON_ID });
    await expect(page.getByRole("button", { name: /^Elaine Fraser — Wedding — /u })).toBeVisible();

    // Back on the desk and forward again: the Diary holds nothing twice.
    await page.goBack();
    await expect(page).toHaveURL(/view=enquiries/u);
    await page.goForward();
    await expect(page.getByRole("button", { name: /^Elaine Fraser — Wedding — /u })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Hold a date for this enquiry" })).toHaveCount(0);
    expect(presses.holdRequests).toHaveLength(1);
  });
});
