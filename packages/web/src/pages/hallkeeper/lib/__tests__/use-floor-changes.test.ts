import { describe, expect, it } from "vitest";
import type { EventAwaitingAcknowledgement, FloorChange } from "@omnitwin/types";
import { changesForDay, floorChangesBySlot, movedOffDay, seenWith } from "../use-floor-changes.js";

// ---------------------------------------------------------------------------
// Which slot a change belongs to. A wedding across three rooms is one event;
// its dinner's move belongs on the dinner, its phase on the room that holds
// it, and an edit to the wedding itself (its guests) on every room of it. A
// two-day conference is one event too: Saturday's booking moved is Saturday's
// to show, never Friday's.
// ---------------------------------------------------------------------------

const WEDDING = "00000000-0000-4000-8000-0000000000e1";
const CEREMONY = "00000000-0000-4000-8000-0000000000b1";
const DINNER = "00000000-0000-4000-8000-0000000000b2";
const SPEECHES = "00000000-0000-4000-8000-0000000000f1";
const SATURDAY = "00000000-0000-4000-8000-0000000000b9";
const HALL = "00000000-0000-4000-8000-0000000000a1";

function change(id: string, sourceId: string, movedTo: FloorChange["movedTo"] = null): FloorChange {
  return {
    id, eventId: WEDDING, venueId: "00000000-0000-4000-8000-000000000001", configurationId: null, proposalId: null,
    handoffPackId: null, actorUserId: null, actorRole: "staff", actorLabel: "Events desk", sourceKind: "event", sourceId,
    title: "Changed", summary: "Something changed.", beforeSummary: null, afterSummary: null, affectedSurfaces: ["timings"],
    audienceRoles: ["staff", "hallkeeper"], riskLevel: "attention", requiresHallkeeperAcknowledgement: true,
    createdAt: "2026-11-14T13:00:00.000Z", movedTo,
  };
}

function waiting(...changes: FloorChange[]): ReadonlyMap<string, EventAwaitingAcknowledgement> {
  return new Map([[WEDDING, { eventId: WEDDING, changes, lastAcknowledgement: null }]]);
}

const friday = [
  { slots: [{ bookingId: CEREMONY, eventId: WEDDING, title: "Wedding ceremony", phases: [] }] },
  { slots: [
    { bookingId: DINNER, eventId: WEDDING, title: "Wedding dinner", phases: [{ id: SPEECHES }] },
    { bookingId: "00000000-0000-4000-8000-0000000000b3", eventId: null, title: "House block", phases: [] },
  ] },
];

describe("floorChangesBySlot", () => {
  it("puts a moved booking's change on its own slot, and an edit to the event on every slot of it", () => {
    const bySlot = floorChangesBySlot(friday, waiting(change("c1", DINNER), change("c2", WEDDING), change("c3", SPEECHES)), seenWith(undefined, friday));
    expect(bySlot.get(CEREMONY)?.map((item) => item.id)).toEqual(["c2"]);
    expect(bySlot.get(DINNER)?.map((item) => item.id)).toEqual(["c1", "c2", "c3"]);
    // A booking with no event has nothing to read.
    expect(bySlot.has("00000000-0000-4000-8000-0000000000b3")).toBe(false);
  });

  it("keeps another day's booking move off this day's slots, so this day's Got it cannot take it", () => {
    const moved = waiting(change("c4", SATURDAY));
    const bySlot = floorChangesBySlot(friday, moved, seenWith(undefined, friday));
    expect(bySlot.get(CEREMONY)).toEqual([]);
    expect(bySlot.get(DINNER)).toEqual([]);
    // Saturday's board, which shows that booking, carries it on its slot.
    const saturday = [{ slots: [{ bookingId: SATURDAY, eventId: WEDDING, title: "Conference day two", phases: [] }] }];
    expect(floorChangesBySlot(saturday, moved, seenWith(undefined, saturday)).get(SATURDAY)?.map((item) => item.id)).toEqual(["c4"]);
  });

  it("keeps another day's phase off this day's slots", () => {
    const bySlot = floorChangesBySlot(friday, waiting(change("c5", "00000000-0000-4000-8000-0000000000f9")), seenWith(undefined, friday));
    expect([...bySlot.values()].flat()).toEqual([]);
  });

  it("tells the slots that remain of a booking seen on this day that has moved away", () => {
    const seen = seenWith(undefined, friday);
    const afterwards = [{ slots: [{ bookingId: CEREMONY, eventId: WEDDING, title: "Wedding ceremony", phases: [] }] }];
    const bySlot = floorChangesBySlot(afterwards, waiting(change("c6", DINNER)), seenWith(seen, afterwards));
    expect(bySlot.get(CEREMONY)?.map((item) => item.id)).toEqual(["c6"]);
  });
});

describe("a function that has left the day", () => {
  const day = { fromMs: Date.parse("2026-11-13T00:00:00Z"), toMs: Date.parse("2026-11-14T04:00:00Z") };

  it("keeps the changes that concern the day: the event's own, and its bookings and phases seen here", () => {
    const seen = seenWith(undefined, friday);
    const kept = changesForDay(WEDDING, waiting(change("c1", DINNER), change("c2", WEDDING), change("c3", SATURDAY)).get(WEDDING), seen);
    expect(kept.map((item) => item.id)).toEqual(["c1", "c2"]);
  });

  it("knows a move off the day by where it put the booking, never by its words", () => {
    const at = (startsAt: string, endsAt: string): FloorChange => change("c7", DINNER, { spaceId: HALL, startsAt, endsAt });
    expect(movedOffDay(at("2026-11-14T18:00:00Z", "2026-11-14T23:00:00Z"), day)).toBe(true);
    expect(movedOffDay(at("2026-11-12T18:00:00Z", "2026-11-12T23:00:00Z"), day)).toBe(true);
    // Late into the night is still the day, up to its boundary hour.
    expect(movedOffDay(at("2026-11-13T22:00:00Z", "2026-11-14T02:00:00Z"), day)).toBe(false);
    expect(movedOffDay(change("c8", WEDDING), day)).toBe(false);
  });
});
