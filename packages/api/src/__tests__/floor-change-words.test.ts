import { describe, expect, it } from "vitest";
import {
  describeBookingMove,
  describeFoldedMove,
  describeMoveBack,
  isRepeatedWallTime,
  samePlace,
  shiftAmount,
  shiftWords,
  wallRange,
} from "../services/booking-move-feed.js";
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

  it("names the zone for a time the clocks show twice, the night they go back", () => {
    // Sun 25 Oct 2026: 01:30 comes first in summer time, then again in winter time.
    expect(wallRange({ startsAt: at("2026-10-24T22:00:00Z"), endsAt: at("2026-10-25T00:30:00Z") }, LONDON))
      .toBe("Sat 24 Oct, 23:00 – Sun 25 Oct, 01:30 BST");
    expect(wallRange({ startsAt: at("2026-10-24T22:00:00Z"), endsAt: at("2026-10-25T01:30:00Z") }, LONDON))
      .toBe("Sat 24 Oct, 23:00 – Sun 25 Oct, 01:30 GMT");
    // 02:00 comes once that night, and every hour of the night the clocks go forward comes at most once.
    expect(wallRange({ startsAt: at("2026-10-24T22:00:00Z"), endsAt: at("2026-10-25T02:00:00Z") }, LONDON))
      .toBe("Sat 24 Oct, 23:00 – Sun 25 Oct, 02:00");
    expect(wallRange({ startsAt: at("2027-03-27T23:00:00Z"), endsAt: at("2027-03-28T01:30:00Z") }, LONDON))
      .toBe("Sat 27 Mar, 23:00 – Sun 28 Mar, 02:30");
  });
});

describe("isRepeatedWallTime", () => {
  it("is true only in the hour the clocks repeat", () => {
    expect(isRepeatedWallTime(at("2026-10-25T00:00:00Z"), LONDON)).toBe(true); // 01:00 BST
    expect(isRepeatedWallTime(at("2026-10-25T01:59:00Z"), LONDON)).toBe(true); // 01:59 GMT
    expect(isRepeatedWallTime(at("2026-10-24T23:59:00Z"), LONDON)).toBe(false); // 00:59 BST
    expect(isRepeatedWallTime(at("2026-10-25T02:00:00Z"), LONDON)).toBe(false); // 02:00 GMT
    expect(isRepeatedWallTime(at("2027-03-28T00:30:00Z"), LONDON)).toBe(false); // 00:30 GMT, the clocks then skip an hour
    expect(isRepeatedWallTime(at("2026-11-14T18:00:00Z"), LONDON)).toBe(false);
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
    expect(shiftAmount(30)).toBe("30 min");
    expect(shiftAmount(60)).toBe("1 h");
    expect(shiftAmount(90)).toBe("1 h 30");
    expect(shiftAmount(-(24 * 60 + 60))).toBe("1 day 1 h");
    expect(shiftAmount(0.3)).toBe("less than a minute");
  });

  it("says which end moved, and which way", () => {
    const at18 = { startsAt: at("2026-11-14T18:00:00Z"), endsAt: at("2026-11-14T23:00:00Z") };
    expect(shiftWords(at18, { startsAt: at("2026-11-14T18:30:00Z"), endsAt: at("2026-11-14T23:30:00Z") }, LONDON)).toBe("30 min later");
    expect(shiftWords(at18, { startsAt: at("2026-11-14T17:00:00Z"), endsAt: at("2026-11-14T23:00:00Z") }, LONDON)).toBe("starts 1 h earlier");
    expect(shiftWords(at18, { startsAt: at("2026-11-14T18:00:00Z"), endsAt: at("2026-11-15T00:15:00Z") }, LONDON)).toBe("ends 1 h 15 later");
  });

  it("counts the real time when the clock shows the same hour twice", () => {
    // 01:00 BST to 01:00 GMT: the same on the wall, an hour later in fact.
    expect(shiftWords(
      { startsAt: at("2026-10-25T00:00:00Z"), endsAt: at("2026-10-25T02:30:00Z") },
      { startsAt: at("2026-10-25T01:00:00Z"), endsAt: at("2026-10-25T03:30:00Z") }, LONDON)).toBe("1 h later");
    // 01:30 GMT back to 01:00 BST reads 30 min earlier on the wall; it is 1 h 30.
    expect(shiftWords(
      { startsAt: at("2026-10-25T01:30:00Z"), endsAt: at("2026-10-25T04:00:00Z") },
      { startsAt: at("2026-10-25T00:00:00Z"), endsAt: at("2026-10-25T04:00:00Z") }, LONDON)).toBe("starts 1 h 30 earlier");
  });

  it("measures both ends of one move the same way, so a length kept reads as kept", () => {
    // A party Sat 24 Oct 23:00 BST – Sun 25 Oct 01:30 BST (the first 01:30),
    // moved to Sun 25 Oct 23:00 – Mon 26 Oct 01:30 GMT: two and a half hours
    // before and after. Its end is a time the clocks show twice, so the whole
    // move is counted in real time, start and end alike.
    const before = { spaceId: HALL, startsAt: at("2026-10-24T22:00:00Z"), endsAt: at("2026-10-25T00:30:00Z") };
    const after = { spaceId: HALL, startsAt: at("2026-10-25T23:00:00Z"), endsAt: at("2026-10-26T01:30:00Z") };
    expect(shiftWords(before, after, LONDON)).toBe("1 day 1 h later");
    expect(describeBookingMove({ before, after, roomBefore: "Grand Hall", roomAfter: "Grand Hall", timeZone: LONDON }).summary)
      .toBe("Grand Hall: 1 day 1 h later.");
  });

  it("counts on the venue's clock across the clocks changing", () => {
    // Sat 24 Oct 18:00 BST to Sun 25 Oct 18:00 GMT: the same time on the wall, a day on.
    expect(shiftWords(
      { startsAt: at("2026-10-24T17:00:00Z"), endsAt: at("2026-10-24T22:00:00Z") },
      { startsAt: at("2026-10-25T18:00:00Z"), endsAt: at("2026-10-25T23:00:00Z") }, LONDON)).toBe("1 day later");
    // Sat 27 Mar 2027 18:00 GMT to Sun 28 Mar 18:00 BST.
    expect(shiftWords(
      { startsAt: at("2027-03-27T18:00:00Z"), endsAt: at("2027-03-27T23:00:00Z") },
      { startsAt: at("2027-03-28T17:00:00Z"), endsAt: at("2027-03-28T22:00:00Z") }, LONDON)).toBe("1 day later");
    // A week on, across 25 October.
    expect(shiftWords(
      { startsAt: at("2026-10-21T17:00:00Z"), endsAt: at("2026-10-21T22:00:00Z") },
      { startsAt: at("2026-10-28T18:00:00Z"), endsAt: at("2026-10-28T23:00:00Z") }, LONDON)).toBe("7 days later");
  });
});

describe("moves folded into one, and a move back", () => {
  // Sat 11 Sept 2027, 18:00 – 23:00 in London: en-GB writes the month "Sept".
  const september = { spaceId: HALL, startsAt: at("2027-09-11T17:00:00Z"), endsAt: at("2027-09-11T22:00:00Z") };
  const later = (hours: number) => ({
    spaceId: HALL,
    startsAt: new Date(september.startsAt.getTime() + hours * 3_600_000),
    endsAt: new Date(september.endsAt.getTime() + hours * 3_600_000),
  });

  it("folds a September function's moves as 'Times moved': the room is compared by id, not read from the words", () => {
    const words = describeFoldedMove({ known: september, after: later(2), roomKnown: "Grand Hall", roomAfter: "Grand Hall", timeZone: LONDON });
    expect(words).toEqual({
      title: "Times moved",
      summary: "Grand Hall: now Sat 11 Sept, 20:00 – Sun 12 Sept, 01:00.",
      beforeSummary: "Grand Hall, Sat 11 Sept, 18:00 – 23:00",
      afterSummary: "Grand Hall, Sat 11 Sept, 20:00 – Sun 12 Sept, 01:00",
      surfaces: ["timings"],
    });
  });

  it("names a room renamed between two moves as it is called now, and keeps it the same room", () => {
    const words = describeFoldedMove({ known: september, after: later(1), roomKnown: "The Grand Hall", roomAfter: "The Grand Hall", timeZone: LONDON });
    expect([words.title, words.surfaces, words.beforeSummary]).toEqual(["Times moved", ["timings"], "The Grand Hall, Sat 11 Sept, 18:00 – 23:00"]);
  });

  it("says the room changed only when its id did", () => {
    const words = describeFoldedMove({ known: september, after: { ...september, spaceId: SALOON }, roomKnown: "Grand Hall", roomAfter: "Saloon", timeZone: LONDON });
    expect([words.title, words.surfaces]).toEqual(["Room changed", ["layout"]]);
  });

  it("says a move back is back, from the place given up to the original", () => {
    expect(describeMoveBack({ before: later(1), after: september, roomBefore: "Grand Hall", roomAfter: "Grand Hall", timeZone: LONDON })).toEqual({
      title: "Back to the original hours",
      summary: "Grand Hall: back to Sat 11 Sept, 18:00 – 23:00.",
      beforeSummary: "Grand Hall, Sat 11 Sept, 19:00 – Sun 12 Sept, 00:00",
      afterSummary: "Grand Hall, Sat 11 Sept, 18:00 – 23:00",
      surfaces: ["timings"],
    });
    expect(describeMoveBack({ before: { ...later(1), spaceId: SALOON }, after: september, roomBefore: "Saloon", roomAfter: "Grand Hall", timeZone: LONDON }).title)
      .toBe("Back to the original room and hours");
    expect(describeMoveBack({ before: { ...september, spaceId: SALOON }, after: september, roomBefore: "Saloon", roomAfter: "Grand Hall", timeZone: LONDON }).title)
      .toBe("Back to the original room");
  });

  it("knows a place by its room's id and its instants", () => {
    expect(samePlace(september, { ...september, startsAt: new Date(september.startsAt.getTime()) })).toBe(true);
    expect(samePlace(september, later(0.5))).toBe(false);
    expect(samePlace(september, { ...september, spaceId: SALOON })).toBe(false);
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
