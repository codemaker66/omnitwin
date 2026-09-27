import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry } from "@omnitwin/types";
import { contestedDates } from "../../services/contested-dates.js";

// ---------------------------------------------------------------------------
// Contested dates (roadmap N3): the rooms and times more than one live
// booking wants, grouped so each date is listed once with its ladder.
// ---------------------------------------------------------------------------

const HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";

function booking(id: string, startsAt: string, endsAt: string, overrides: Partial<CalendarBookingEntry> = {}): CalendarBookingEntry {
  return {
    entryType: "booking", id, spaceId: HALL, kind: "hold", status: "active", state: "hold",
    title: id, eventType: null, startsAt, endsAt, rank: 1, jointFlag: false, decisionAt: null,
    ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null, ...overrides,
  };
}

const ink = (id: string, startsAt: string, endsAt: string, overrides: Partial<CalendarBookingEntry> = {}): CalendarBookingEntry =>
  booking(id, startsAt, endsAt, { kind: "ink", state: "ink", rank: null, ...overrides });

function ladders(entries: readonly CalendarBookingEntry[]): { readonly spaceId: string; readonly startsAt: string; readonly endsAt: string; readonly ladder: string[] }[] {
  return contestedDates(entries).map((date) => ({
    spaceId: date.spaceId, startsAt: date.startsAt, endsAt: date.endsAt, ladder: date.bookings.map((entry) => entry.id),
  }));
}

describe("contestedDates", () => {
  it("lists two holds that cross in one room once, in ladder order", () => {
    expect(ladders([
      booking("Guild dinner", "2026-09-19T17:00:00.000Z", "2026-09-19T23:00:00.000Z", { rank: 2 }),
      booking("MacLeod wedding", "2026-09-19T12:00:00.000Z", "2026-09-19T22:30:00.000Z", { rank: 1 }),
    ])).toEqual([{
      spaceId: HALL, startsAt: "2026-09-19T12:00:00.000Z", endsAt: "2026-09-19T23:00:00.000Z",
      ladder: ["MacLeod wedding", "Guild dinner"],
    }]);
  });

  it("lists a hold behind a confirmed booking, the confirmed booking first", () => {
    expect(ladders([
      booking("Fraser wedding", "2026-10-03T11:00:00.000Z", "2026-10-03T20:00:00.000Z"),
      ink("Chamber dinner", "2026-10-03T17:00:00.000Z", "2026-10-03T23:00:00.000Z"),
    ])[0]?.ladder).toEqual(["Chamber dinner", "Fraser wedding"]);
  });

  it("keeps holds that cross in a chain together, over the whole time", () => {
    expect(ladders([
      booking("A", "2026-11-07T10:00:00.000Z", "2026-11-07T12:00:00.000Z", { rank: 1 }),
      booking("C", "2026-11-07T13:00:00.000Z", "2026-11-07T16:00:00.000Z", { rank: 3 }),
      booking("B", "2026-11-07T11:00:00.000Z", "2026-11-07T14:00:00.000Z", { rank: 2 }),
    ])).toEqual([{ spaceId: HALL, startsAt: "2026-11-07T10:00:00.000Z", endsAt: "2026-11-07T16:00:00.000Z", ladder: ["A", "B", "C"] }]);
  });

  it("puts joint 1st holds by their start, and unranked holds last", () => {
    expect(ladders([
      booking("Unranked", "2026-11-14T09:00:00.000Z", "2026-11-14T18:00:00.000Z", { rank: null }),
      booking("Law dinner", "2026-11-14T12:00:00.000Z", "2026-11-14T18:00:00.000Z", { jointFlag: true }),
      booking("Burns supper", "2026-11-14T10:00:00.000Z", "2026-11-14T18:00:00.000Z", { jointFlag: true }),
    ])[0]?.ladder).toEqual(["Burns supper", "Law dinner", "Unranked"]);
  });

  it("does not count times that only touch, other rooms, or bookings that make no claim", () => {
    expect(ladders([
      booking("Morning", "2026-12-05T08:00:00.000Z", "2026-12-05T12:00:00.000Z"),
      booking("Afternoon", "2026-12-05T12:00:00.000Z", "2026-12-05T17:00:00.000Z"),
      booking("Saloon lunch", "2026-12-05T11:00:00.000Z", "2026-12-05T14:00:00.000Z", { spaceId: SALOON }),
      booking("Interest", "2026-12-05T09:00:00.000Z", "2026-12-05T11:00:00.000Z", { kind: "prospect", state: "prospect", rank: null }),
      booking("House block", "2026-12-05T09:00:00.000Z", "2026-12-05T11:00:00.000Z", { kind: "internal_block", state: "internal_block", rank: null }),
      booking("Released", "2026-12-05T09:00:00.000Z", "2026-12-05T11:00:00.000Z", { status: "released", state: "released" }),
    ])).toEqual([]);
  });

  it("lists the soonest first across rooms", () => {
    expect(ladders([
      booking("Saloon 1st", "2027-01-09T12:00:00.000Z", "2027-01-09T18:00:00.000Z", { spaceId: SALOON }),
      booking("Saloon 2nd", "2027-01-09T13:00:00.000Z", "2027-01-09T19:00:00.000Z", { spaceId: SALOON, rank: 2 }),
      booking("Hall 1st", "2027-01-08T12:00:00.000Z", "2027-01-08T18:00:00.000Z"),
      booking("Hall 2nd", "2027-01-08T12:00:00.000Z", "2027-01-08T18:00:00.000Z", { rank: 2 }),
    ]).map((date) => date.ladder)).toEqual([["Hall 1st", "Hall 2nd"], ["Saloon 1st", "Saloon 2nd"]]);
  });
});
