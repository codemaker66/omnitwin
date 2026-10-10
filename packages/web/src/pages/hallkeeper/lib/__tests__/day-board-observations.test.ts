import { describe, expect, it } from "vitest";
import type { CalendarResponse } from "@omnitwin/types";
import { deriveDayBoard, type DayBoardSlotObservation } from "../day-board-state.js";

// ---------------------------------------------------------------------------
// Observations on the board (goal 19 S5; D1, D3) — tests written FIRST.
//
// Facts beside the schedule. The latest fact by the hallkeeper's own time
// decides what the room was last seen doing; done and cleaned fade the slab;
// a room seen in use past its end with no done signal is an overrun after a
// short grace; a room seen and not cleared puts the next slot's changeover
// at risk once the turnaround no longer fits; an unseen room raises nothing.
// Every boundary is an instant, so the clock ticks to it exactly.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const BOOKING_2 = "00000000-0000-4000-8000-0000000000b2";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const EVENT_2 = "00000000-0000-4000-8000-0000000000e2";
const ZONE = "Europe/London";

/** 12:00 UTC on a summer Wednesday: 13:00 on the Glasgow wall. */
const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const MIN = 60_000;

type Entry = CalendarResponse["entries"][number];

function booking(id: string, eventId: string, title: string, startOffsetMin: number, endOffsetMin: number): Entry {
  return {
    entryType: "booking",
    id,
    spaceId: GRAND_HALL,
    kind: "ink",
    status: "active",
    state: "ink",
    title,
    eventType: "dinner",
    startsAt: new Date(NOW + startOffsetMin * MIN).toISOString(),
    endsAt: new Date(NOW + endOffsetMin * MIN).toISOString(),
    rank: null,
    jointFlag: false,
    decisionAt: null,
    ownerUserId: null,
    nextAction: null,
    nextActionDueAt: null,
    eventId,
    seriesId: null,
  } as Entry;
}

function response(entries: readonly Entry[], turnaroundMinutes: number | null = null): CalendarResponse {
  const base: CalendarResponse = {
    venueId: VENUE,
    range: { from: "2026-09-15T23:00:00.000Z", to: "2026-09-16T23:00:00.000Z" },
    rooms: [{ id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries: [...entries],
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      },
    },
  };
  if (turnaroundMinutes === null) return base;
  return {
    ...base,
    turnaroundRules: [{ spaceId: GRAND_HALL, eventType: null, name: "Grand Hall turnaround", minutes: turnaroundMinutes, isActive: true }],
  };
}

function fact(
  bookingId: string,
  kind: DayBoardSlotObservation["kind"],
  offsetMin: number,
  recordedOffsetMin = offsetMin,
  spaceId: string = GRAND_HALL,
): DayBoardSlotObservation {
  return {
    bookingId,
    spaceId,
    kind,
    observedAt: new Date(NOW + offsetMin * MIN).toISOString(),
    recordedAt: new Date(NOW + recordedOffsetMin * MIN).toISOString(),
    actorName: "Elaine",
  };
}

/** The dinner that ended at 12:55 on the wall, five minutes before NOW. */
const dinner = booking(BOOKING, EVENT, "Chamber dinner", -300, -5);

function dinnerAt(observations: readonly DayBoardSlotObservation[], nowMs = NOW) {
  const board = deriveDayBoard(response([dinner]), nowMs, ZONE, [], observations);
  const slot = board.lanes[0]?.slots[0];
  if (slot === undefined) throw new Error("expected the dinner's slot");
  return { board, slot };
}

describe("a room nobody has recorded", () => {
  it("is the board that existed before observations: no observed line, no overrun", () => {
    const { slot } = dinnerAt([]);
    expect(slot.observed).toBeNull();
    expect(slot.exception).toBeNull();
    expect(slot.state).toBe("done");
    expect(slot.countdown).toBe("Ended 12:55");
  });
});

describe("the latest fact decides", () => {
  it("reads the latest by the hallkeeper's time, not by arrival", () => {
    // doors-open was recorded half an hour after live (an offline phone
    // replaying) but seen ten minutes before it: the room is live.
    const { slot } = dinnerAt([fact(BOOKING, "live", -60, -60), fact(BOOKING, "doors-open", -70, -30)]);
    expect(slot.observed?.kind).toBe("live");
    expect(slot.observed?.line).toBe("Live 12:00");
    expect(slot.observed?.actorName).toBe("Elaine");
  });

  it("leaves a fact seen in another room to that room's slot", () => {
    const { slot } = dinnerAt([fact(BOOKING, "live", -60, -60, SALOON)]);
    expect(slot.observed).toBeNull();
  });
});

describe("overrun", () => {
  it("is not yet an overrun four minutes past the end, and ticks to the fifth minute", () => {
    const { slot } = dinnerAt([fact(BOOKING, "live", -60)], NOW - MIN);
    expect(slot.exception).toBeNull();
    expect(slot.nextBoundaryMs).toBe(NOW);
  });

  it("is an overrun five minutes past the end with no done signal, and leads the next action", () => {
    const { board, slot } = dinnerAt([fact(BOOKING, "live", -60)]);
    expect(slot.state).toBe("exception");
    expect(slot.exception).toBe("overrun");
    expect(slot.stateLabel).toBe("Overrun");
    expect(slot.tone).toBe("red");
    expect(slot.icon).toBe("alert-triangle");
    expect(slot.motion).toBe("none");
    expect(slot.countdown).toBe("Overrun · 5 min past 12:55");
    expect(slot.exceptionDetail).toBe("Live 12:00 · not marked done");
    expect(slot.nextBoundaryMs).toBeNull();
    expect(board.nextAction).toMatchObject({ kind: "slot", bookingId: BOOKING, line: "Grand Hall · Overrun · 5 min past 12:55" });
  });

  it("needs the room to have been seen in use: a room only set is not overrunning", () => {
    const { slot } = dinnerAt([fact(BOOKING, "set", -120)]);
    expect(slot.exception).toBeNull();
    expect(slot.observed?.line).toBe("Room set 11:00");
  });

  it("ends the instant a done tap lands, whenever the live tap arrived", () => {
    const { slot } = dinnerAt([fact(BOOKING, "done", -2), fact(BOOKING, "live", -60, -1)]);
    expect(slot.state).toBe("done");
    expect(slot.stateLabel).toBe("Done");
    expect(slot.tone).toBe("faded");
    expect(slot.icon).toBe("check");
    expect(slot.countdown).toBe("Done 12:58");
    expect(slot.exception).toBeNull();
    expect(slot.nextBoundaryMs).toBeNull();
  });

  it("reads cleaned as cleaned", () => {
    const { slot } = dinnerAt([fact(BOOKING, "cleaned", -1)]);
    expect(slot.state).toBe("done");
    expect(slot.stateLabel).toBe("Cleaned");
    expect(slot.countdown).toBe("Cleaned 12:59");
  });
});

describe("changeover at risk from what was seen", () => {
  /** Ended at 12:50 on the wall. */
  const earlier = booking(BOOKING, EVENT, "Chamber dinner", -300, -10);
  /** Doors at 13:15, so twenty-five minutes after the dinner. */
  const next = booking(BOOKING_2, EVENT_2, "Board lunch", 15, 120);

  function nextSlotAt(observations: readonly DayBoardSlotObservation[], nowMs = NOW, turnaround = 30) {
    const board = deriveDayBoard(response([earlier, next], turnaround), nowMs, ZONE, [], observations);
    const slot = board.lanes[0]?.slots[1];
    if (slot === undefined) throw new Error("expected the lunch's slot");
    return { board, slot };
  }

  it("flags the next slot once the turnaround no longer fits and the room before it is not cleared", () => {
    const { slot } = nextSlotAt([fact(BOOKING, "done", -10)]);
    expect(slot.state).toBe("exception");
    expect(slot.exception).toBe("turnaround-at-risk");
    expect(slot.exceptionDetail).toBe("Chamber dinner not yet cleared · 15 min until setup, 30 min needed");
    expect(slot.countdown).toBe("Changeover at risk · Guests · 15 min");
    expect(slot.gapBefore).toEqual({ minutes: 25, neededMinutes: 30, short: true });
  });

  it("clears the moment the room before is cleaned", () => {
    const { slot } = nextSlotAt([fact(BOOKING, "cleaned", -3)]);
    expect(slot.exception).toBeNull();
    expect(slot.state).toBe("guests-due");
  });

  it("raises nothing for a room nobody has recorded", () => {
    const { slot } = nextSlotAt([]);
    expect(slot.exception).toBeNull();
    expect(slot.state).toBe("guests-due");
  });

  it("raises nothing once the next slot's own doors have passed", () => {
    const { slot } = nextSlotAt([fact(BOOKING, "done", -10)], NOW + 20 * MIN);
    expect(slot.exception).toBeNull();
    expect(slot.state).toBe("live");
  });

  it("ticks to the instant the risk begins", () => {
    // Doors at 13:50 needing 40 minutes: at risk from 13:10, before the
    // schedule's own next boundary at 13:20.
    const later = booking(BOOKING_2, EVENT_2, "Board lunch", 50, 170);
    const board = deriveDayBoard(response([earlier, later], 40), NOW, ZONE, [], [fact(BOOKING, "done", -10)]);
    const slot = board.lanes[0]?.slots[1];
    expect(slot?.exception).toBeNull();
    expect(slot?.state).toBe("organisers-due");
    expect(slot?.nextBoundaryMs).toBe(NOW + 10 * MIN);
    expect(board.nextBoundaryMs).toBe(NOW + 10 * MIN);
  });
});
