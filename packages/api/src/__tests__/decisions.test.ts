import { describe, expect, it } from "vitest";
import { DECISION_APPROVER_ROLES } from "@omnitwin/types";
import { DIARY_WRITE_ROLES } from "../services/booking-mutations.js";
import { clip } from "../services/decisions.js";
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
