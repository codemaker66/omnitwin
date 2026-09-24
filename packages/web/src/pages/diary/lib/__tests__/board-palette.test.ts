import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry, CalendarPhaseEntry, CalendarRoom } from "@omnitwin/types";
import { findPaletteResults, type PaletteEnquiry } from "../board-palette.js";

// ---------------------------------------------------------------------------
// The finding palette's matching (C1): rooms, then the loaded range's
// bookings, then open enquiries — only what the board holds in memory.
// ---------------------------------------------------------------------------

const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000b2";
const ROOMS: readonly CalendarRoom[] = [
  { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
  { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
];

function booking(id: string, title: string, overrides: Partial<CalendarBookingEntry> = {}): CalendarBookingEntry {
  return {
    entryType: "booking", id, spaceId: GRAND_HALL, kind: "hold", status: "active", state: "hold", title,
    eventType: null, startsAt: "2026-09-18T18:00:00.000Z", endsAt: "2026-09-18T23:00:00.000Z", rank: 1,
    jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null,
    eventId: null, seriesId: null, ...overrides,
  };
}

const PHASE: CalendarPhaseEntry = {
  entryType: "phase", id: "phase", spaceId: SALOON, eventId: "event", eventName: "Grand ball",
  name: "Grand setup", startsAt: "2026-09-18T12:00:00.000Z", endsAt: "2026-09-18T14:00:00.000Z", sortOrder: 0,
};

const ENQUIRIES: readonly PaletteEnquiry[] = [
  { id: "enquiry-1", name: "Fiona MacLeod", eventType: "wedding" },
  { id: "enquiry-2", name: "Hall committee", eventType: null },
];

const DATA = {
  rooms: ROOMS,
  entries: [
    booking("wedding", "MacLeod wedding"),
    booking("dinner", "Chamber dinner", { spaceId: SALOON, startsAt: "2026-09-19T17:30:00.000Z", clientName: "Grand Lodge" }),
    booking("ball", "Graduation ball", { eventName: "Grand Graduation" }),
    PHASE,
  ],
};

describe("findPaletteResults", () => {
  it("waits for two characters and for the calendar, even when an enquiry would match", () => {
    expect(findPaletteResults("g", DATA, ENQUIRIES)).toEqual([]);
    expect(findPaletteResults("  g  ", DATA, ENQUIRIES)).toEqual([]);
    expect(findPaletteResults("fiona", null, ENQUIRIES)).toEqual([]);
  });

  it("lists rooms, then bookings matched by title, client or event, then enquiries — never phases", () => {
    expect(findPaletteResults(" GRAND ", DATA, ENQUIRIES)).toEqual([
      { kind: "room", id: GRAND_HALL, label: "Grand Hall", detail: "Jump to lane" },
      { kind: "booking", id: "dinner", label: "Chamber dinner", detail: "Saloon · 18:30" },
      { kind: "booking", id: "ball", label: "Graduation ball", detail: "Grand Hall · 19:00" },
    ]);
    expect(findPaletteResults("macleod", DATA, ENQUIRIES)).toEqual([
      { kind: "booking", id: "wedding", label: "MacLeod wedding", detail: "Grand Hall · 19:00" },
      { kind: "enquiry", id: "enquiry-1", label: "Fiona MacLeod", detail: "Open the pencil-in form" },
    ]);
    expect(findPaletteResults("wedding", DATA, ENQUIRIES).map((result) => result.id)).toEqual(["wedding", "enquiry-1"]);
  });

  it("caps the list at twelve results", () => {
    const many = { rooms: ROOMS, entries: Array.from({ length: 20 }, (_, n) => booking(`b${String(n)}`, `Board meeting ${String(n)}`)) };
    const results = findPaletteResults("board", many, []);
    expect(results).toHaveLength(12);
    expect(results[11]?.id).toBe("b11");
  });
});
