import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry, CalendarEntry } from "@omnitwin/types";
import { ladderPlace } from "../ladder-place.js";

const HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const READ = { fromMs: Date.parse("2026-09-13T23:00:00.000Z"), toMs: Date.parse("2026-09-20T23:00:00.000Z") };
const START = Date.parse("2026-09-18T16:00:00.000Z");
const END = Date.parse("2026-09-18T22:00:00.000Z");

let next = 0;
function booking(overrides: Partial<CalendarBookingEntry>): CalendarBookingEntry {
  next += 1;
  return {
    entryType: "booking", id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`, spaceId: HALL, kind: "hold",
    status: "active", state: "hold", title: `Booking ${String(next)}`, eventType: null, startsAt: "2026-09-18T17:00:00.000Z",
    endsAt: "2026-09-18T22:00:00.000Z", rank: 1, jointFlag: false, decisionAt: null, ownerUserId: null,
    nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null, ...overrides,
  };
}

describe("ladderPlace", () => {
  it("suggests nothing for a time the board has not read whole", () => {
    expect(ladderPlace([], null, HALL, START, END)).toEqual({ kind: "unread" });
    expect(ladderPlace([], READ, HALL, READ.toMs - 3_600_000, READ.toMs + 3_600_000)).toEqual({ kind: "unread" });
  });

  it("puts a hold 1st where nothing else holds the room then", () => {
    const entries: CalendarEntry[] = [
      booking({ spaceId: SALOON, title: "Other room" }),
      booking({ title: "Earlier that day", startsAt: "2026-09-18T09:00:00.000Z", endsAt: "2026-09-18T12:00:00.000Z" }),
      booking({ title: "Released", status: "released", state: "released" }),
    ];
    expect(ladderPlace(entries, READ, HALL, START, END)).toEqual({ kind: "read", rank: 1, holds: [], confirmed: [] });
  });

  it("puts a hold one behind the lowest-placed hold, listing the ladder in order", () => {
    const second = booking({ title: "Guild dinner", rank: 2 });
    const unranked = booking({ title: "Unranked", rank: null });
    const first = booking({ title: "Fraser wedding", rank: 1 });
    const place = ladderPlace([second, unranked, first], READ, HALL, START, END);
    expect(place.kind === "read" ? place.rank : null).toBe(3);
    expect(place.kind === "read" ? place.holds.map((hold) => hold.title) : []).toEqual(["Fraser wedding", "Guild dinner", "Unranked"]);
  });

  it("puts a hold 2nd behind a joint 1st, and names a confirmed booking without counting it", () => {
    const place = ladderPlace([
      booking({ title: "Fraser wedding", rank: 1, jointFlag: true }),
      booking({ title: "Law dinner", rank: 1, jointFlag: true }),
      booking({ title: "Chamber dinner", kind: "ink", state: "ink", rank: null }),
    ], READ, HALL, START, END);
    expect(place.kind === "read" ? place.rank : null).toBe(2);
    expect(place.kind === "read" ? place.confirmed.map((ink) => ink.title) : []).toEqual(["Chamber dinner"]);
  });
});
