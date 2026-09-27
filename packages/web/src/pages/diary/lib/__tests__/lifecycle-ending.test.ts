import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry, CalendarEntry } from "@omnitwin/types";
import { contestedHolds, isEndingTransition, ladderAfterExit } from "../lifecycle-ending.js";

// ---------------------------------------------------------------------------
// Who stands first on a date once a booking leaves it: the same answer the
// API's resequence gives afterwards (api/services/hold-hygiene.ts), read off
// the board so the confirmation can say it first (roadmap N3).
// ---------------------------------------------------------------------------

const HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
let next = 0;

function entry(overrides: Partial<CalendarBookingEntry>): CalendarBookingEntry {
  next += 1;
  return {
    entryType: "booking", id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`, spaceId: HALL,
    kind: "hold", status: "active", state: "hold", title: `Booking ${String(next)}`, eventType: null,
    startsAt: "2026-09-19T13:00:00.000Z", endsAt: "2026-09-19T22:00:00.000Z",
    rank: 1, jointFlag: false, decisionAt: "2026-09-10T11:00:00.000Z", ownerUserId: null,
    nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
    ...overrides,
  };
}

describe("isEndingTransition", () => {
  it("asks first only for the changes that end a booking's claim on its date", () => {
    expect(["released", "expired", "lost", "cancelled"].every((state) => isEndingTransition(state as never))).toBe(true);
    expect(["hold", "ink", "prospect", "internal_block"].some((state) => isEndingTransition(state as never))).toBe(false);
  });
});

describe("contestedHolds", () => {
  it("keeps the other active holds in the same room whose times cross the booking", () => {
    const booking = entry({ kind: "ink", state: "ink", rank: null, decisionAt: null });
    const crossing = entry({ rank: 2, startsAt: "2026-09-19T20:00:00.000Z", endsAt: "2026-09-19T23:00:00.000Z" });
    const touching = entry({ startsAt: "2026-09-19T22:00:00.000Z", endsAt: "2026-09-19T23:30:00.000Z" });
    const otherRoom = entry({ spaceId: SALOON });
    const released = entry({ status: "released", state: "released" });
    const confirmed = entry({ kind: "ink", state: "ink", rank: null });
    const phase: CalendarEntry = { entryType: "phase", id: "phase-1", spaceId: HALL, eventId: "event-1", eventName: "Dinner",
      name: "Setup", startsAt: "2026-09-19T12:00:00.000Z", endsAt: "2026-09-19T14:00:00.000Z", sortOrder: 0 };
    expect(contestedHolds([booking, crossing, touching, otherRoom, released, confirmed, phase], booking)).toEqual([crossing]);
  });
});

describe("ladderAfterExit", () => {
  it("names the 2nd option when the 1st option leaves", () => {
    const second = entry({ rank: 2, title: "Robertson ceilidh" });
    const third = entry({ rank: 3 });
    expect(ladderAfterExit(entry({ rank: 1 }), [third, second])).toEqual({ kind: "promoted", titles: ["Robertson ceilidh"] });
  });

  it("names both of a joint 2nd, which the API promotes together", () => {
    const a = entry({ rank: 2, jointFlag: true, title: "Fraser wedding" });
    const b = entry({ rank: 2, jointFlag: true, title: "Guild dinner" });
    expect(ladderAfterExit(entry({ rank: 1 }), [a, b])).toEqual({ kind: "promoted", titles: ["Fraser wedding", "Guild dinner"] });
  });

  it("promotes no one when a joint 1st leaves, or a hold behind the 1st option", () => {
    const partner = entry({ rank: 1, jointFlag: true });
    expect(ladderAfterExit(entry({ rank: 1, jointFlag: true }), [partner, entry({ rank: 2 })])).toEqual({ kind: "none" });
    expect(ladderAfterExit(entry({ rank: 2 }), [entry({ rank: 1 }), entry({ rank: 3 })])).toEqual({ kind: "none" });
  });

  it("names nobody it cannot place: unranked holds join by when they were made", () => {
    expect(ladderAfterExit(entry({ rank: 1 }), [entry({ rank: null })])).toEqual({ kind: "none" });
  });

  it("names the 1st option that can be confirmed once a confirmed booking leaves", () => {
    const ink = entry({ kind: "ink", state: "ink", rank: null, decisionAt: null });
    expect(ladderAfterExit(ink, [entry({ rank: 2 }), entry({ rank: 1, title: "MacLeod wedding" })])).toEqual({ kind: "free", titles: ["MacLeod wedding"] });
    expect(ladderAfterExit(ink, [])).toEqual({ kind: "none" });
  });

  it("says nothing of the ladder for interest only or a house block", () => {
    expect(ladderAfterExit(entry({ kind: "prospect", state: "prospect", rank: null }), [entry({ rank: 1 })])).toEqual({ kind: "none" });
    expect(ladderAfterExit(entry({ kind: "internal_block", state: "internal_block", rank: null }), [entry({ rank: 1 })])).toEqual({ kind: "none" });
  });
});
