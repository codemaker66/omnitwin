import { describe, expect, it } from "vitest";
import { describeBookingMove, shiftAmount, shiftWords, wallRange } from "../services/booking-move-feed.js";
import { describeEventEdit } from "../services/event-mutations.js";
import type * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// The words the floor reads on the Day Board for a change it has not yet
// acknowledged: a booking moved in the Diary, or an event edited. Hours are in
// the venue's own clock, and written details are named, never quoted.
// ---------------------------------------------------------------------------

const LONDON = "Europe/London";
const HALL = "00000000-0000-4000-8000-0000000000b1";
const SALOON = "00000000-0000-4000-8000-0000000000b2";
const at = (iso: string): Date => new Date(iso);

describe("wallRange", () => {
  it("reads a function in the venue's clock, naming the end's day only when it is another", () => {
    expect(wallRange({ startsAt: at("2026-11-14T18:00:00Z"), endsAt: at("2026-11-14T23:00:00Z") }, LONDON))
      .toBe("Sat 14 Nov, 18:00 – 23:00");
    expect(wallRange({ startsAt: at("2026-11-14T19:00:00Z"), endsAt: at("2026-11-15T00:30:00Z") }, LONDON))
      .toBe("Sat 14 Nov, 19:00 – Sun 15 Nov, 00:30");
  });

  it("keeps summer hours in British Summer Time", () => {
    expect(wallRange({ startsAt: at("2027-06-12T17:00:00Z"), endsAt: at("2027-06-12T22:00:00Z") }, LONDON))
      .toBe("Sat 12 Jun, 18:00 – 23:00");
  });
});

describe("describeBookingMove", () => {
  const evening = { spaceId: HALL, startsAt: at("2026-11-14T18:00:00Z"), endsAt: at("2026-11-14T23:00:00Z") };

  it("says the hours moved, where the function stands now", () => {
    const words = describeBookingMove({
      before: evening,
      after: { ...evening, startsAt: at("2026-11-14T19:00:00Z"), endsAt: at("2026-11-15T00:00:00Z") },
      roomBefore: "Grand Hall", roomAfter: "Grand Hall", timeZone: LONDON,
    });
    expect(words).toEqual({
      title: "Times moved",
      summary: "Grand Hall: 1 h later.",
      beforeSummary: "Grand Hall, Sat 14 Nov, 18:00 – 23:00",
      afterSummary: "Grand Hall, Sat 14 Nov, 19:00 – Sun 15 Nov, 00:00",
      surfaces: ["timings"],
    });
  });

  it("says the room changed, with the hours it keeps", () => {
    const words = describeBookingMove({
      before: evening, after: { ...evening, spaceId: SALOON },
      roomBefore: "Grand Hall", roomAfter: "Saloon", timeZone: LONDON,
    });
    expect(words.title).toBe("Room changed");
    expect(words.summary).toBe("Grand Hall to Saloon.");
    expect(words.afterSummary).toBe("Saloon, Sat 14 Nov, 18:00 – 23:00");
    expect(words.surfaces).toEqual(["layout"]);
  });

  it("says both when the room and the hours changed", () => {
    const words = describeBookingMove({
      before: evening,
      after: { spaceId: SALOON, startsAt: at("2026-11-15T12:00:00Z"), endsAt: at("2026-11-15T15:00:00Z") },
      roomBefore: "Grand Hall", roomAfter: "Saloon", timeZone: LONDON,
    });
    expect(words.title).toBe("Room and times changed");
    expect(words.summary).toBe("Grand Hall to Saloon, starts 18 h later, ends 16 h later.");
    expect(words.surfaces).toEqual(["timings", "layout"]);
  });
});

describe("how far the hours moved", () => {
  it("says it in the floor's units", () => {
    expect(shiftAmount(30 * 60_000)).toBe("30 min");
    expect(shiftAmount(60 * 60_000)).toBe("1 h");
    expect(shiftAmount(90 * 60_000)).toBe("1 h 30");
    expect(shiftAmount(-(24 * 60 + 60) * 60_000)).toBe("1 day 1 h");
    expect(shiftAmount(20_000)).toBe("less than a minute");
  });

  it("says which end moved, and which way", () => {
    const at18 = { startsAt: at("2026-11-14T18:00:00Z"), endsAt: at("2026-11-14T23:00:00Z") };
    expect(shiftWords(at18, { startsAt: at("2026-11-14T18:30:00Z"), endsAt: at("2026-11-14T23:30:00Z") })).toBe("30 min later");
    expect(shiftWords(at18, { startsAt: at("2026-11-14T17:00:00Z"), endsAt: at("2026-11-14T23:00:00Z") })).toBe("starts 1 h earlier");
    expect(shiftWords(at18, { startsAt: at("2026-11-14T18:00:00Z"), endsAt: at("2026-11-15T00:15:00Z") })).toBe("ends 1 h 15 later");
  });
});

type EventRow = typeof schema.events.$inferSelect;

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "00000000-0000-4000-8000-0000000000e1",
    venueId: "00000000-0000-4000-8000-0000000000f1",
    name: "Anderson wedding",
    eventType: "wedding",
    status: "confirmed",
    startsAt: at("2026-11-14T18:00:00Z"),
    endsAt: at("2026-11-14T23:00:00Z"),
    guestCount: 150,
    clientName: "Anderson",
    notes: "Top table by the windows",
    ...overrides,
  } as EventRow;
}

describe("describeEventEdit", () => {
  it("keeps the guests' words as they were: 150 guests to 180 guests", () => {
    expect(describeEventEdit(event(), event({ guestCount: 180 }), LONDON)).toEqual({
      summary: "Anderson wedding: guests 150 to 180.",
      beforeSummary: "150 guests",
      afterSummary: "180 guests",
    });
  });

  it("gives the new hours in the venue's clock", () => {
    expect(describeEventEdit(event(), event({ startsAt: at("2026-11-14T19:00:00Z") }), LONDON)).toEqual({
      summary: "Anderson wedding: hours now Sat 14 Nov, 19:00 – 23:00.",
      beforeSummary: "Sat 14 Nov, 18:00 – 23:00",
      afterSummary: "Sat 14 Nov, 19:00 – 23:00",
    });
  });

  it("names the written details that changed, never their words", () => {
    const words = describeEventEdit(event(), event({ notes: "Nut allergy at table 3", clientName: "Anderson-Reid" }), LONDON);
    expect(words).toEqual({ summary: "Anderson wedding: client, notes changed.", beforeSummary: null, afterSummary: null });
    expect(words.summary).not.toMatch(/allergy/u);
  });

  it("says when an event has no hours set any more", () => {
    expect(describeEventEdit(event(), event({ startsAt: null, endsAt: null }), LONDON).afterSummary).toBe("no hours set");
  });
});
