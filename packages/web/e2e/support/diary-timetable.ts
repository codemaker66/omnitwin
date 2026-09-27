import { expect, type CDPSession, type Page } from "@playwright/test";
import type {
  Booking,
  BookingKind,
  CalendarBookingEntry,
  CalendarResponse,
} from "@omnitwin/types";
import type { Enquiry } from "../../src/api/enquiries.js";

// ---------------------------------------------------------------------------
// The Diary timetable's emulated world (T-619), shared by
// e2e/diary-timetable.spec.ts. GET /calendar serves the requested range of
// one Trades Hall week and a venue-wide decisions list; GET /enquiries the
// open tray; /ws/diary answers as the hub does — a hello with presence, then
// an ack for every command. The clock is fixed on Wednesday 16 September
// 2026, so a plain /diary opens on that week.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    /** pointercancel events the page saw — set up by the phone case. */
    __diaryPointerCounts?: { cancel: number };
  }
}

export const API = "http://localhost:3001";
export const NOW = "2026-09-16T08:00:00.000Z"; // Wednesday 16 September, 09:00 BST
export const VENUE_ID = "00000000-0000-4000-8000-000000009001";
export const GRAND_HALL = "00000000-0000-4000-8000-000000009101";
export const SALOON = "00000000-0000-4000-8000-000000009102";
export const ROBERT_ADAM = "00000000-0000-4000-8000-000000009103";
export const MACLEOD = "00000000-0000-4000-8000-000000009201";
export const STAFF = {
  id: "00000000-0000-4000-8000-000000009191",
  email: "fiona@diary.test",
  role: "staff",
  platformRole: "none",
  venueId: VENUE_ID,
  name: "Fiona Coordinator",
} as const;

function entry(id: string, overrides: Partial<CalendarBookingEntry> & { title: string; startsAt: string; endsAt: string }): CalendarBookingEntry {
  const kind: BookingKind = overrides.kind ?? "hold";
  return {
    entryType: "booking",
    id,
    spaceId: GRAND_HALL,
    kind,
    status: "active",
    state: kind,
    eventType: null,
    rank: kind === "hold" ? 1 : null,
    jointFlag: false,
    decisionAt: kind === "hold" ? "2026-10-02T11:00:00.000Z" : null,
    ownerUserId: kind === "hold" ? STAFF.id : null,
    ownerName: kind === "hold" ? STAFF.name : null,
    nextAction: kind === "hold" ? "Send the menu." : null,
    nextActionDueAt: kind === "hold" ? "2026-09-30T09:00:00.000Z" : null,
    eventId: null,
    seriesId: null,
    notes: null,
    ...overrides,
  };
}

const WEEK: readonly CalendarBookingEntry[] = [
  entry("00000000-0000-4000-8000-000000009202", {
    kind: "ink", title: "Hammermen annual dinner", eventType: "dinner",
    startsAt: "2026-09-17T17:00:00.000Z", endsAt: "2026-09-17T22:00:00.000Z",
    clientName: "The Incorporation of Hammermen", guestCount: 180,
  }),
  entry(MACLEOD, {
    title: "MacLeod wedding", eventType: "wedding",
    startsAt: "2026-09-19T13:00:00.000Z", endsAt: "2026-09-19T22:30:00.000Z",
    decisionAt: "2026-09-21T11:00:00.000Z", ownerUserId: "00000000-0000-4000-8000-000000009192",
    ownerName: "Elaine Gray", clientName: "Fiona and Ross MacLeod", guestCount: 140,
    notes: "Ceremony in the Saloon, dinner in the Grand Hall.",
  }),
  entry("00000000-0000-4000-8000-000000009203", {
    spaceId: SALOON, title: "Robertson ceilidh", rank: 2,
    startsAt: "2026-09-18T18:00:00.000Z", endsAt: "2026-09-18T22:00:00.000Z",
  }),
  entry("00000000-0000-4000-8000-000000009204", {
    kind: "internal_block", spaceId: ROBERT_ADAM, title: "Floor polish",
    startsAt: "2026-09-14T07:00:00.000Z", endsAt: "2026-09-14T11:00:00.000Z",
  }),
];

const DECISIONS: readonly CalendarBookingEntry[] = [
  entry("00000000-0000-4000-8000-000000009301", {
    spaceId: SALOON, title: "Hartley wedding", rank: 2,
    startsAt: "2027-03-20T15:00:00.000Z", endsAt: "2027-03-20T23:00:00.000Z",
    decisionAt: "2026-09-15T11:00:00.000Z",
  }),
  entry("00000000-0000-4000-8000-000000009302", {
    title: "Guild dinner", jointFlag: true, ownerUserId: null, ownerName: null,
    startsAt: "2026-11-14T18:00:00.000Z", endsAt: "2026-11-14T23:00:00.000Z",
    decisionAt: "2026-09-18T11:00:00.000Z",
  }),
];

function enquiry(n: number, name: string, state: string): Enquiry {
  const created = new Date(Date.parse("2026-09-15T09:00:00.000Z") - n * 3_600_000).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(900_000_000_400 + n)}`,
    venueId: VENUE_ID, spaceId: GRAND_HALL, configurationId: null, userId: null,
    guestEmail: null, guestPhone: null, guestName: null, state, name,
    email: `enquiry${String(n)}@diary.test`, preferredDate: "2026-12-05",
    eventType: "Wedding", estimatedGuests: 120, message: null, createdAt: created, updatedAt: created,
  };
}

const ENQUIRIES: readonly Enquiry[] = [
  enquiry(1, "Aisha and Tom Baird", "submitted"),
  enquiry(2, "Glasgow Law Society", "under_review"),
];

/** One demo changeover time for every room, as a seeded venue has it:
 *  nobody has confirmed it (T-637). */
const CHANGEOVER = {
  id: "00000000-0000-4000-8000-000000009501", venueId: VENUE_ID, spaceId: null, eventType: null, name: "All rooms",
  minutes: 120, isActive: true, confirmedAt: null, updatedByName: null,
  createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z",
} as const;

function calendar(): CalendarResponse {
  return {
    venueId: VENUE_ID,
    range: { from: "2026-09-13T23:00:00.000Z", to: "2026-09-20T23:00:00.000Z" },
    rooms: [
      { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
      { id: ROBERT_ADAM, name: "Robert Adam Room", slug: "robert-adam-room", sortOrder: 2 },
    ],
    entries: [...WEEK],
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Every gap is covered by a turnaround rule." },
      },
    },
    turnaroundRules: [{ spaceId: null, eventType: null, name: CHANGEOVER.name, minutes: CHANGEOVER.minutes, isActive: true }],
    decisionsDue: { holds: [...DECISIONS, ...WEEK.filter((row) => row.id === MACLEOD)], total: 3 },
  };
}

function asBooking(row: CalendarBookingEntry, patch: Record<string, unknown>): Booking {
  return {
    id: row.id, venueId: VENUE_ID, spaceId: row.spaceId, eventId: row.eventId, kind: row.kind,
    status: row.status, state: row.state, title: row.title, eventType: row.eventType,
    startsAt: row.startsAt, endsAt: row.endsAt, rank: row.rank, jointFlag: row.jointFlag,
    decisionAt: row.decisionAt, ownerUserId: row.ownerUserId, nextAction: row.nextAction,
    nextActionDueAt: row.nextActionDueAt, seriesId: row.seriesId, notes: row.notes ?? null,
    createdBy: STAFF.id, enquiryId: null, createdAt: "2026-09-01T09:00:00.000Z", updatedAt: NOW,
    ...patch,
  };
}

export interface Emulated {
  /** Query strings of every GET /enquiries. */
  readonly enquiryRequests: string[];
  /** booking.update payloads, as the hub received them. */
  readonly updates: { readonly bookingId: string; readonly payload: Record<string, unknown> }[];
}

export async function emulate(page: Page): Promise<Emulated> {
  const emulated: Emulated = { enquiryRequests: [], updates: [] };
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript((user) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: user, writable: false });
    // Returning coordinator: the first-run welcome is not what this covers.
    window.localStorage.setItem(`venviewer:diary-welcome-seen:${user.id}`, "1");
  }, STAFF);
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/calendar") {
      // As the API does: the range's entries only (half-open overlap), and
      // the venue-wide decisions list whatever the range.
      const from = Date.parse(url.searchParams.get("from") ?? "");
      const to = Date.parse(url.searchParams.get("to") ?? "");
      const data = calendar();
      void route.fulfill({ json: { data: {
        ...data,
        range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
        entries: data.entries.filter((row) => Date.parse(row.startsAt) < to && Date.parse(row.endsAt) > from),
      } } });
    } else if (url.pathname === "/enquiries") {
      emulated.enquiryRequests.push(url.search);
      void route.fulfill({ json: { data: ENQUIRIES } });
    } else if (url.pathname === `/venues/${VENUE_ID}`) {
      void route.fulfill({ json: { data: { id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall",
        address: "85 Glassford Street", logoUrl: null, brandColour: null, spaces: [] } } });
    } else if (url.pathname === `/venues/${VENUE_ID}/turnaround-rules` && route.request().method() === "GET") {
      void route.fulfill({ json: { data: {
        rules: [CHANGEOVER],
        rooms: [{ id: GRAND_HALL, name: "Grand Hall" }, { id: SALOON, name: "Saloon" }, { id: ROBERT_ADAM, name: "Robert Adam Room" }],
        eventTypes: ["wedding", "dinner"],
      } } });
    } else if (url.pathname.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
    } else {
      void route.fulfill({ status: 404, json: { error: `Not emulated: ${url.pathname}` } });
    }
  });
  await page.routeWebSocket(`${API.replace(/^http/u, "ws")}/ws/diary`, (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string; command?: { kind: string; commandId: string; bookingId?: string; payload?: Record<string, unknown> } };
      if (message.type === "auth") {
        ws.send(JSON.stringify({ type: "hello", venueId: VENUE_ID, presence: [
          { userId: STAFF.id, name: STAFF.name, role: "staff" },
          { userId: "00000000-0000-4000-8000-000000009192", name: "Elaine Gray", role: "staff" },
        ] }));
      } else if (message.type === "diary.command" && message.command?.kind === "booking.update") {
        const { commandId, bookingId = "", payload = {} } = message.command;
        emulated.updates.push({ bookingId, payload });
        const row = [...WEEK, ...DECISIONS].find((candidate) => candidate.id === bookingId);
        ws.send(JSON.stringify(row === undefined
          ? { type: "diary.ack", commandId, outcome: "rejected", replay: false, status: 404, code: "NOT_FOUND", error: "Booking not found" }
          : { type: "diary.ack", commandId, outcome: "applied", replay: false, status: 200, booking: asBooking(row, payload) }));
      }
    });
  });
  return emulated;
}

export async function openDiary(page: Page, path = "/diary"): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "The Diary" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Live · 1")).toBeVisible({ timeout: 15_000 });
}

export async function cancels(page: Page): Promise<number> {
  return page.evaluate(() => window.__diaryPointerCounts?.cancel ?? -1);
}

export async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", point: { x: number; y: number } | null): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point === null ? [] : [{ x: point.x, y: point.y }] });
}
