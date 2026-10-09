import { describe, expect, it } from "vitest";
import type { CalendarEntry, CalendarRoom } from "@omnitwin/types";
import { dayAnswer } from "../day-answer.js";

// ---------------------------------------------------------------------------
// A day, room by room, in the Diary's own words: what Go to date on the board
// and the staff header's Find both say about a date. Every kind of line is
// pinned here, so the two can never drift apart unnoticed.
// ---------------------------------------------------------------------------

const ROOMS: readonly CalendarRoom[] = [
  { id: "r1", name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
  { id: "r2", name: "Saloon", slug: "saloon", sortOrder: 1 },
  { id: "r3", name: "Robert Adam Room", slug: "robert-adam-room", sortOrder: 2 },
  { id: "r4", name: "Reception Room", slug: "reception-room", sortOrder: 3 },
  { id: "r5", name: "North Gallery", slug: "north-gallery", sortOrder: 4 },
  { id: "r6", name: "South Gallery", slug: "south-gallery", sortOrder: 5 },
  { id: "r7", name: "Lady Convenors' Room", slug: "lady-convenors", sortOrder: 6 },
];

function booking(id: string, spaceId: string, kind: string, title: string, startsAt: string, endsAt: string,
  extra: { readonly rank?: number | null; readonly jointFlag?: boolean; readonly decisionAt?: string | null } = {}): CalendarEntry {
  return {
    entryType: "booking", id, spaceId, kind, status: "active", state: kind, title, eventType: "dinner",
    startsAt, endsAt, rank: extra.rank ?? null, jointFlag: extra.jointFlag ?? false, decisionAt: extra.decisionAt ?? null,
    ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
  } as CalendarEntry;
}

/** Saturday 14 November 2026, midnight to midnight in Glasgow (GMT). */
const DAY = { startMs: Date.parse("2026-11-14T00:00:00.000Z"), endMs: Date.parse("2026-11-15T00:00:00.000Z") };
/** Wednesday 7 October 2026. */
const NOW = Date.parse("2026-10-07T09:00:00.000Z");

const ENTRIES: readonly CalendarEntry[] = [
  booking("b1", "r1", "ink", "Fraser wedding", "2026-11-14T13:00:00.000Z", "2026-11-14T23:00:00.000Z"),
  booking("b2", "r2", "hold", "Burns supper", "2026-11-14T18:00:00.000Z", "2026-11-14T23:00:00.000Z",
    { rank: 2, decisionAt: "2026-11-10T12:00:00.000Z" }),
  booking("b3", "r3", "hold", "Guild dinner", "2026-11-14T18:00:00.000Z", "2026-11-14T22:00:00.000Z", { rank: 1, jointFlag: true }),
  booking("b4", "r4", "prospect", "Henderson enquiry", "2026-11-14T12:00:00.000Z", "2026-11-14T16:00:00.000Z"),
  // The night before's party runs into the small hours: the day itself is free from then.
  booking("b5", "r5", "ink", "Friday ceilidh", "2026-11-13T19:00:00.000Z", "2026-11-14T01:00:00.000Z"),
  booking("b6", "r6", "internal_block", "Floor polishing", "2026-11-14T08:00:00.000Z", "2026-11-14T10:00:00.000Z"),
  booking("b7", "r7", "hold", "Book launch", "2026-11-14T12:00:00.000Z", "2026-11-14T14:00:00.000Z", { rank: null }),
];

describe("dayAnswer", () => {
  const answer = dayAnswer(ENTRIES, ROOMS, DAY, NOW);
  const said = (id: string): readonly string[] => answer.find((room) => room.id === id)?.lines.map((line) => line.text) ?? [];
  const free = (id: string): boolean | undefined => answer.find((room) => room.id === id)?.free;

  it("names every room in the Diary's order", () => {
    expect(answer.map((room) => room.name)).toEqual(ROOMS.map((room) => room.name));
  });

  it("says a confirmed booking, a numbered option with its decision date, a joint 1st and a provisional hold", () => {
    expect(said("r1")).toEqual(["Confirmed, Fraser wedding, 13:00–23:00"]);
    expect(said("r2")).toEqual([expect.stringMatching(/^2nd option Burns supper, 18:00–23:00, decides Tue 10 Nov( 2026)?$/u)]);
    expect(said("r3")).toEqual(["Joint 1st Guild dinner, 18:00–22:00"]);
    expect(said("r7")).toEqual(["Provisional, Book launch, 12:00–14:00"]);
    expect([free("r1"), free("r2"), free("r3"), free("r7")]).toEqual([false, false, false, false]);
  });

  it("says a house block as the venue's own", () => {
    expect(said("r6")).toEqual(["House block, Floor polishing, 08:00–10:00"]);
    expect(free("r6")).toBe(false);
  });

  it("calls a room with interest only free, and says whose interest", () => {
    expect(said("r4")).toEqual(["Free, interest only from Henderson enquiry"]);
    expect(free("r4")).toBe(true);
  });

  it("calls a room free from when the night before's event ends in the small hours", () => {
    expect(said("r5")).toEqual(["Free from 01:00"]);
    expect(free("r5")).toBe(true);
  });
});
