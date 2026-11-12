import { describe, expect, it } from "vitest";
import type { EventAwaitingAcknowledgement } from "@omnitwin/types";
import { floorChangesBySlot } from "../use-floor-changes.js";

// ---------------------------------------------------------------------------
// Which slot a change belongs to. A wedding across three rooms is one event;
// its dinner's move belongs on the dinner, its phase on the room that holds
// it, and an edit to the wedding itself (its guests) on every room of it.
// ---------------------------------------------------------------------------

const WEDDING = "00000000-0000-4000-8000-0000000000e1";
const CEREMONY = "00000000-0000-4000-8000-0000000000b1";
const DINNER = "00000000-0000-4000-8000-0000000000b2";
const SPEECHES = "00000000-0000-4000-8000-0000000000f1";

type Change = EventAwaitingAcknowledgement["changes"][number];

function change(id: string, sourceId: string): Change {
  return {
    id, eventId: WEDDING, venueId: "00000000-0000-4000-8000-000000000001", configurationId: null, proposalId: null,
    handoffPackId: null, actorUserId: null, actorRole: "staff", actorLabel: "Events desk", sourceKind: "event", sourceId,
    title: "Changed", summary: "Something changed.", beforeSummary: null, afterSummary: null, affectedSurfaces: ["timings"],
    audienceRoles: ["staff", "hallkeeper"], riskLevel: "attention", requiresHallkeeperAcknowledgement: true,
    createdAt: "2026-11-14T13:00:00.000Z",
  };
}

const lanes = [
  { slots: [{ bookingId: CEREMONY, eventId: WEDDING, phases: [] }] },
  { slots: [
    { bookingId: DINNER, eventId: WEDDING, phases: [{ id: SPEECHES }] },
    { bookingId: "00000000-0000-4000-8000-0000000000b3", eventId: null, phases: [] },
  ] },
];

describe("floorChangesBySlot", () => {
  it("puts a moved booking's change on its own slot, and an edit to the event on every slot of it", () => {
    const byEvent = new Map([[WEDDING, {
      eventId: WEDDING,
      changes: [change("c1", DINNER), change("c2", WEDDING), change("c3", SPEECHES)],
      lastAcknowledgement: null,
    }]]);
    const bySlot = floorChangesBySlot(lanes, byEvent);
    expect(bySlot.get(CEREMONY)?.map((item) => item.id)).toEqual(["c2"]);
    expect(bySlot.get(DINNER)?.map((item) => item.id)).toEqual(["c1", "c2", "c3"]);
    // A booking with no event has nothing to read.
    expect(bySlot.has("00000000-0000-4000-8000-0000000000b3")).toBe(false);
  });

  it("reads a change from a booking not on the board as the event's, so it is never lost", () => {
    const byEvent = new Map([[WEDDING, {
      eventId: WEDDING, changes: [change("c4", "00000000-0000-4000-8000-0000000000b9")], lastAcknowledgement: null,
    }]]);
    const bySlot = floorChangesBySlot(lanes, byEvent);
    expect(bySlot.get(CEREMONY)?.map((item) => item.id)).toEqual(["c4"]);
    expect(bySlot.get(DINNER)?.map((item) => item.id)).toEqual(["c4"]);
  });
});
