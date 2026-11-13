import { describe, expect, it } from "vitest";
import { DECISION_APPROVER_ROLES } from "@omnitwin/types";
import { DIARY_WRITE_ROLES, type BookingRow } from "../services/booking-mutations.js";
import { detectCalendarConflicts, type ConflictPhaseInput } from "../services/calendar-conflicts.js";
import { clip, moveConsequences, type Neighbourhood } from "../services/decisions.js";
import { phaseMovesWithBooking } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// The prepared decision's pure parts (goal 09 M1). Its behaviour on the
// Diary's real tables is in decisions-postgres.test.ts.
// ---------------------------------------------------------------------------

describe("who approves a time move", () => {
  // Release review, 27 October 2026: an approver the Diary will not let write
  // would see every approval end as a failure for good (FORBIDDEN).
  it("is exactly who may write the Diary", () => {
    expect([...DECISION_APPROVER_ROLES.booking_time_move].sort()).toEqual([...DIARY_WRITE_ROLES].sort());
  });
});

describe("a decision's sentence, cut to length", () => {
  it("keeps a short sentence as it is, and cuts a long one with an ellipsis", () => {
    expect(clip("Move the booking.")).toBe("Move the booking.");
    expect(clip("a".repeat(600))).toBe(`${"a".repeat(499)}\u2026`);
    expect(clip("a".repeat(600))).toHaveLength(500);
  });

  // Release review: a sentence cut through a character outside the basic
  // plane left half of it, which PostgreSQL refused as JSON.
  it("never cuts a character in half", () => {
    const cut = clip(`${"a".repeat(498)}\u{1F37E}tail`);
    expect(cut).toBe(`${"a".repeat(498)}\u2026`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(cut)).toBe(false);
  });
});

describe("the event phases a booking's move carries", () => {
  // Release review: the decision moved only the phases inside the booking,
  // while the Diary moves the event's phases in that room from a day before
  // the booking until it ends, set-up included.
  const room = "room";
  const at = (hours: number): Date => new Date(Date.UTC(2030, 2, 10, hours));
  const move = { bookingId: "wedding", eventId: "event", from: { spaceId: room, startsAt: at(14), endsAt: at(18) } };
  const phase = (startsAt: Date | null, spaceId: string | null = room, eventId = "event") => ({ eventId, spaceId, startsAt });

  it("carries a set-up before the booking and a phase running past its end", () => {
    expect(phaseMovesWithBooking(phase(at(12)), move, [])).toBe(true);
    expect(phaseMovesWithBooking(phase(at(17)), move, [])).toBe(true);
    expect(phaseMovesWithBooking(phase(new Date(Date.UTC(2030, 2, 9, 15))), move, [])).toBe(true);
  });

  it("leaves a phase from more than a day before, from the booking's end on, in another room, of another event, or untimed", () => {
    expect(phaseMovesWithBooking(phase(new Date(Date.UTC(2030, 2, 9, 13))), move, [])).toBe(false);
    expect(phaseMovesWithBooking(phase(at(18)), move, [])).toBe(false);
    expect(phaseMovesWithBooking(phase(at(15), "other room"), move, [])).toBe(false);
    expect(phaseMovesWithBooking(phase(at(15), room, "other event"), move, [])).toBe(false);
    expect(phaseMovesWithBooking(phase(null), move, [])).toBe(false);
  });

  it("leaves a phase inside another live booking of the same event in the room, which it belongs to", () => {
    const dayBefore = { id: "rehearsal", eventId: "event", spaceId: room, startsAt: new Date(Date.UTC(2030, 2, 9, 16)), endsAt: new Date(Date.UTC(2030, 2, 9, 19)) };
    expect(phaseMovesWithBooking(phase(new Date(Date.UTC(2030, 2, 9, 17))), move, [dayBefore])).toBe(false);
    expect(phaseMovesWithBooking(phase(new Date(Date.UTC(2030, 2, 9, 17))), move, [{ ...dayBefore, eventId: "other event" }])).toBe(true);
  });
});

// A move's consequences, from the Diary's own conflict engine, on rooms built
// here. Their PostgreSQL reading is in decisions-postgres.test.ts.
const ROOM = "room";
const day = (date: number, hours: number, minutes = 0): Date => new Date(Date.UTC(2030, 2, date, hours, minutes));

function bookingRow(id: string, eventId: string | null, startsAt: Date, endsAt: Date): BookingRow {
  return {
    id, venueId: "venue", spaceId: ROOM, eventId, kind: "ink", status: "active", title: id, eventType: null, startsAt, endsAt,
    rank: null, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null, seriesId: null,
    notes: null, createdBy: null, createdAt: startsAt, updatedAt: startsAt, deletedAt: null, enquiryId: null, fixtureSource: null,
    lostReason: null,
  };
}

function timedPhase(id: string, eventId: string, startsAt: Date, endsAt: Date): ConflictPhaseInput {
  return { id, spaceId: ROOM, eventId, eventName: eventId, name: "Set-up", eventType: null, startsAt, endsAt };
}

function held(bookings: readonly BookingRow[], phases: readonly ConflictPhaseInput[], minutes: number): Neighbourhood {
  return { bookings, phases, endedEventPhases: [], rules: [{ spaceId: ROOM, eventType: null, name: "Room turnaround", minutes, isActive: true }], timeZone: "Europe/London" };
}

/** The turnarounds the Diary's conflict view shows for a room, as "before>after minutes". */
function diary(world: Neighbourhood): string[] {
  return detectCalendarConflicts({ bookings: world.bookings, phases: world.phases, turnaroundRules: world.rules, timeZone: world.timeZone }).conflicts
    .filter((conflict) => conflict.type === "insufficient_turnaround")
    .map((conflict) => `${conflict.entryIds.join(">")} ${/^Only (\d+) minutes/u.exec(conflict.explanation)?.[1] ?? "?"}`);
}

describe("a move beside its own event's other pieces (T-695 review of #400, Y1)", () => {
  // The decision weighs the moved booking's block apart from the rest of its
  // event. The engine's rule that an event's set stayed in the room must still
  // see those pieces as the event's, or the block is measured from a client
  // who left before the event's own piece arrived, which the Diary never does.
  it("lists no turnaround when the move lands on a later phase of its own event that the room already holds", () => {
    const lunch = bookingRow("lunch", "lunch-event", day(12, 12, 30), day(12, 13, 30));
    const ceremony = bookingRow("ceremony", "wedding", day(12, 10), day(12, 12));
    const setUp = timedPhase("set-up", "wedding", day(12, 14), day(12, 16));
    const before = held([lunch, ceremony], [setUp], 120);
    expect(moveConsequences(before, ceremony, { startsAt: day(12, 14, 30), endsAt: day(12, 16, 30) })).toEqual([]);
    // The Diary has the wedding 30 minutes after lunch before the move and after it.
    expect(diary(before)).toEqual(["ceremony>lunch 30", "lunch>set-up 30"]);
    expect(diary(held([lunch, { ...ceremony, startsAt: day(12, 14, 30), endsAt: day(12, 16, 30) }], [setUp], 120))).toEqual(["lunch>ceremony 30"]);
  });

  it("lists no turnaround when the move lands on its ceremony and the room flip that belongs to it", () => {
    const lunch = bookingRow("lunch", "lunch-event", day(10, 10), day(10, 12));
    const ceremony = bookingRow("ceremony", "wedding", day(10, 12, 30), day(10, 13, 30));
    // The flip starts inside the ceremony, so it is the ceremony's and stays with it.
    const flip = timedPhase("flip", "wedding", day(10, 13, 15), day(10, 15));
    const reception = bookingRow("reception", "wedding", day(10, 16), day(10, 20));
    const before = held([lunch, ceremony, reception], [flip], 120);
    expect(moveConsequences(before, reception, { startsAt: day(10, 13, 45), endsAt: day(10, 17, 45) })).toEqual([]);
    expect(diary(before)).toEqual(["lunch>reception 30"]);
    expect(diary(held([lunch, ceremony, { ...reception, startsAt: day(10, 13, 45), endsAt: day(10, 17, 45) }], [flip], 120))).toEqual(["lunch>reception 30"]);
  });

  it("lists no turnaround when a set-up the move carries lands inside the event's other booking", () => {
    const lunch = bookingRow("lunch", "lunch-event", day(10, 9, 30), day(10, 13, 15));
    const dinner = bookingRow("dinner", "conference", day(10, 15), day(10, 19));
    // The breakfast's set-up the evening before moves with it, into the dinner.
    const setUp = timedPhase("set-up", "conference", day(10, 19, 15), day(10, 20, 30));
    const breakfast = bookingRow("breakfast", "conference", day(11, 10), day(11, 10, 45));
    const before = held([lunch, dinner, breakfast], [setUp], 180);
    expect(moveConsequences(before, breakfast, { startsAt: day(11, 6, 45), endsAt: day(11, 7, 30) })).toEqual([]);
    const after = held([lunch, dinner, { ...breakfast, startsAt: day(11, 6, 45), endsAt: day(11, 7, 30) }],
      [{ ...setUp, startsAt: day(10, 16), endsAt: day(10, 17, 15) }], 180);
    expect([diary(before), diary(after)]).toEqual([["lunch>dinner 105"], ["lunch>dinner 105"]]);
  });

  it("lists no turnaround when the move lands on its own event's set-up that began before lunch left", () => {
    const lunch = bookingRow("lunch", "lunch-event", day(12, 10), day(12, 12));
    const ceremony = bookingRow("ceremony", "wedding", day(12, 8), day(12, 9));
    // The reception's set-up begins while lunch is still in the room, after the ceremony, so it stays where it is.
    const setUp = timedPhase("set-up", "wedding", day(12, 11), day(12, 15));
    const before = held([lunch, ceremony], [setUp], 120);
    expect(moveConsequences(before, ceremony, { startsAt: day(12, 13), endsAt: day(12, 16) })).toEqual([]);
    // The Diary holds the set-up and the moved ceremony as one stay, which lunch overlaps.
    expect(diary(before)).toEqual(["ceremony>lunch 60"]);
    expect(diary(held([lunch, { ...ceremony, startsAt: day(12, 13), endsAt: day(12, 16) }], [setUp], 120))).toEqual([]);
  });
});
