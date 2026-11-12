import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarBookingEntry, CalendarResponse } from "@omnitwin/types";
import { getCalendar } from "../diary.js";
import { _resetTokenGetterForTests } from "../auth-bridge.js";

// ---------------------------------------------------------------------------
// API-9: the Diary reads its range through the shared calendar schema. A
// booking stored with an empty title (written before #350) refused that
// schema, so one such row blanked the venue's whole range. It now reads with
// the rest, title and all, for the drawer to put right.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";

function booking(id: string, title: string, startsAt: string, endsAt: string): CalendarBookingEntry {
  return {
    entryType: "booking", id, spaceId: GRAND_HALL, kind: "prospect", status: "active", state: "prospect",
    title, eventType: null, startsAt, endsAt, rank: null, jointFlag: false, decisionAt: null,
    ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
  };
}

function range(entries: CalendarBookingEntry[]): CalendarResponse {
  return {
    venueId: VENUE,
    range: { from: "2026-09-13T23:00:00.000Z", to: "2026-09-20T23:00:00.000Z" },
    rooms: [{ id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries,
    conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Checked" } } },
  };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  _resetTokenGetterForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCalendar", () => {
  it("reads a range holding a booking stored with an empty title, with every other booking beside it", async () => {
    const untitled = booking("00000000-0000-4000-8000-0000000000c1", "", "2026-09-16T17:00:00.000Z", "2026-09-16T22:00:00.000Z");
    const dinner = booking("00000000-0000-4000-8000-0000000000c2", "Hammermen annual dinner", "2026-09-17T18:00:00.000Z", "2026-09-17T23:00:00.000Z");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: range([untitled, dinner]) })));

    const read = await getCalendar(VENUE, "2026-09-13T23:00:00.000Z", "2026-09-20T23:00:00.000Z");
    expect(read.entries.map((entry) => [entry.id, entry.entryType === "booking" ? entry.title : null])).toEqual([
      [untitled.id, ""],
      [dinner.id, "Hammermen annual dinner"],
    ]);
  });
});
