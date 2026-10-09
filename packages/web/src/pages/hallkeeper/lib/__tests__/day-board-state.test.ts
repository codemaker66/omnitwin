import { describe, expect, it } from "vitest";
import type { CalendarResponse } from "@omnitwin/types";
import {
  DAY_BOARD_LEGEND,
  deriveDayBoard,
  deriveSlotAttention,
  deriveSlotRequestSignal,
  formatMinutes,
  resolveTurnaroundMinutes,
  type DayBoardSlot,
  type DayBoardSlotRequest,
} from "../day-board-state.js";

// ---------------------------------------------------------------------------
// The Day Board state machine (Day Board S1; goal 19 S3) — tests written
// FIRST.
//
// One pure function turns GET /calendar + requests + a clock instant into
// per-slot states, verbs, tones, motion, the slab's segments, the gap before
// it, the attention ring, the rooms an event spans, the next boundary, the
// UNOWNED rail and the next action. Everything the board shows is decided
// here, deterministically, so every boundary is unit-testable without a DOM:
// the 60/30/10-minute thresholds, the LIVE window, clear-down from the
// venue's turnaround rules, the priority of exception over everything else,
// and the exact words the slots read aloud (D3).
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const BOOKING_2 = "00000000-0000-4000-8000-0000000000b2";
const EVENT = "00000000-0000-4000-8000-0000000000e1";

/** A fixed clock: 12:00 UTC on a summer Wednesday (13:00 venue wall time). */
const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const MIN = 60_000;

function baseResponse(): CalendarResponse {
  return {
    venueId: VENUE,
    range: {
      from: "2026-09-15T23:00:00.000Z",
      to: "2026-09-16T23:00:00.000Z",
    },
    rooms: [
      { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
    ],
    entries: [],
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      },
    },
  };
}

function booking(
  startOffsetMin: number,
  endOffsetMin: number,
  overrides: Record<string, unknown> = {},
): CalendarResponse["entries"][number] {
  return {
    entryType: "booking",
    id: BOOKING,
    spaceId: GRAND_HALL,
    kind: "ink",
    status: "active",
    state: "ink",
    title: "Chamber dinner",
    eventType: "dinner",
    startsAt: new Date(NOW + startOffsetMin * MIN).toISOString(),
    endsAt: new Date(NOW + endOffsetMin * MIN).toISOString(),
    rank: null,
    jointFlag: false,
    decisionAt: null,
    ownerUserId: null,
    nextAction: null,
    nextActionDueAt: null,
    eventId: EVENT,
    seriesId: null,
    ...overrides,
  } as CalendarResponse["entries"][number];
}

function phase(
  startOffsetMin: number,
  endOffsetMin: number,
  name = "Setup",
): CalendarResponse["entries"][number] {
  return {
    entryType: "phase",
    id: "00000000-0000-4000-8000-0000000000f1",
    spaceId: GRAND_HALL,
    eventId: EVENT,
    eventName: "Chamber dinner",
    name,
    startsAt: new Date(NOW + startOffsetMin * MIN).toISOString(),
    endsAt: new Date(NOW + endOffsetMin * MIN).toISOString(),
    sortOrder: 0,
  } as CalendarResponse["entries"][number];
}

function soleSlot(response: CalendarResponse, nowMs = NOW): DayBoardSlot {
  const board = deriveDayBoard(response, nowMs);
  const lane = board.lanes.find((candidate) => candidate.room.id === GRAND_HALL);
  if (lane === undefined || lane.slots[0] === undefined) throw new Error("no slot derived");
  return lane.slots[0];
}

const RULES = [{ spaceId: null, eventType: null, name: "House", minutes: 90, isActive: true }];

describe("deriveDayBoard — the ramp, in Blake's words", () => {
  it("far out is quiet: scheduled, a wall-clock verb, no motion", () => {
    const response = baseResponse();
    response.entries = [booking(200, 400)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("scheduled");
    expect(slot.tone).toBe("quiet");
    expect(slot.motion).toBe("none");
    expect(slot.icon).toBe("clock");
    expect(slot.countdown).toBe("Scheduled 16:20");
  });

  it("organisers due: inside 60 min of the SETUP opening, green, a four-second breath", () => {
    const response = baseResponse();
    // Doors at +120m, but setup opens at +45m — the state keys off setup.
    response.entries = [booking(120, 300), phase(45, 120)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("organisers-due");
    expect(slot.tone).toBe("green");
    expect(slot.motion).toBe("breath-4s");
    expect(slot.countdown).toBe("Organisers · 45 min");
  });

  it("once setup has begun the verb says so and names the doors", () => {
    const response = baseResponse();
    response.entries = [booking(50, 300), phase(-10, 50)];
    expect(soleSlot(response).countdown).toBe("Setting up · doors 13:50");
  });

  it("without phases, setup falls back to doors — 59 min out is organisers-due, 61 is not", () => {
    const near = baseResponse();
    near.entries = [booking(59, 200)];
    expect(soleSlot(near).state).toBe("organisers-due");
    const far = baseResponse();
    far.entries = [booking(61, 200)];
    expect(soleSlot(far).state).toBe("scheduled");
  });

  it("guests due: inside 30 min of doors, amber, a three-second breath", () => {
    const response = baseResponse();
    response.entries = [booking(28, 200)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("guests-due");
    expect(slot.tone).toBe("amber");
    expect(slot.motion).toBe("breath-3s");
    expect(slot.countdown).toBe("Guests · 28 min");
  });

  it("imminent: inside 10 min of doors the amber deepens and the breath quickens", () => {
    const response = baseResponse();
    response.entries = [booking(9, 200)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("imminent");
    expect(slot.tone).toBe("amber-deep");
    expect(slot.motion).toBe("breath-2s");
    expect(slot.countdown).toBe("Doors · 9 min");
  });

  it("live: red, the room's heartbeat, with time elapsed", () => {
    const response = baseResponse();
    response.entries = [booking(-72, 90)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("live");
    expect(slot.tone).toBe("live");
    expect(slot.motion).toBe("live-breath");
    expect(slot.icon).toBe("radio");
    expect(slot.countdown).toBe("LIVE · 1 h 12 elapsed");
  });

  it("clear-down: sage and still, for the venue's turnaround after the end", () => {
    const response = baseResponse();
    response.turnaroundRules = RULES;
    response.entries = [booking(-180, -40)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("clear-down");
    expect(slot.tone).toBe("sage");
    expect(slot.motion).toBe("none");
    expect(slot.countdown).toBe("Clear-down · 50 min");
    expect(slot.segments.turnaroundMinutes).toBe(90);
    expect(slot.segments.clearDownEndsAtMs).toBe(NOW + 50 * MIN);
  });

  it("ended: faded, labelled with the end, once the clear-down has run", () => {
    const response = baseResponse();
    response.turnaroundRules = RULES;
    response.entries = [booking(-300, -100)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("done");
    expect(slot.tone).toBe("faded");
    expect(slot.countdown).toBe("Ended 11:20");
  });

  it("without a turnaround rule there is no clear-down: the end is the end", () => {
    const response = baseResponse();
    response.entries = [booking(-300, -5)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("done");
    expect(slot.segments.clearDownEndsAtMs).toBe(slot.endsAtMs);
  });

  it("the next slot's setup cuts a clear-down short", () => {
    const response = baseResponse();
    response.turnaroundRules = RULES;
    response.entries = [booking(-300, -40), booking(60, 180, { id: BOOKING_2 }), phase(10, 60)];
    // The second booking's setup phase opens at +10; the first's clear-down ends there, not at +50.
    const first = deriveDayBoard(response, NOW).lanes[0]?.slots[0];
    expect(first?.segments.clearDownEndsAtMs).toBe(NOW + 10 * MIN);
    expect(first?.countdown).toBe("Clear-down · 10 min");
  });
});

describe("the venue's turnaround rule, resolved as the engine resolves it", () => {
  it("prefers the most specific active rule and, on a tie, the largest minutes", () => {
    const rules = [
      { spaceId: null, eventType: null, name: "House", minutes: 60, isActive: true },
      { spaceId: GRAND_HALL, eventType: null, name: "Grand Hall", minutes: 90, isActive: true },
      { spaceId: GRAND_HALL, eventType: "dinner", name: "Grand Hall dinner", minutes: 120, isActive: true },
      { spaceId: GRAND_HALL, eventType: "dinner", name: "Grand Hall dinner, retired", minutes: 240, isActive: false },
      { spaceId: null, eventType: "dinner", name: "Dinners", minutes: 150, isActive: true },
    ];
    expect(resolveTurnaroundMinutes(rules, GRAND_HALL, "dinner")).toBe(120);
    expect(resolveTurnaroundMinutes(rules, GRAND_HALL, "ceilidh")).toBe(90);
    expect(resolveTurnaroundMinutes(rules, SALOON, "dinner")).toBe(150);
    expect(resolveTurnaroundMinutes(rules, SALOON, "ceilidh")).toBe(60);
    expect(resolveTurnaroundMinutes(undefined, SALOON, "ceilidh")).toBeNull();
    expect(resolveTurnaroundMinutes([], SALOON, "ceilidh")).toBeNull();
  });
});

describe("the dimensioned gap", () => {
  it("measures the gap from the previous end to this setup and says whether it is short", () => {
    const response = baseResponse();
    response.turnaroundRules = RULES;
    response.entries = [booking(-120, 0), booking(60, 180, { id: BOOKING_2 })];
    const [first, second] = deriveDayBoard(response, NOW).lanes[0]?.slots ?? [];
    expect(first?.gapBefore).toBeNull();
    expect(second?.gapBefore).toEqual({ minutes: 60, neededMinutes: 90, short: true });
  });

  it("is never short when no rule covers the pair", () => {
    const response = baseResponse();
    response.entries = [booking(-120, 0), booking(30, 180, { id: BOOKING_2 })];
    const second = deriveDayBoard(response, NOW).lanes[0]?.slots[1];
    expect(second?.gapBefore).toEqual({ minutes: 30, neededMinutes: null, short: false });
  });
});

describe("boundary-exact ticks", () => {
  it("names the next instant at which each slot changes, and the board's earliest", () => {
    const response = baseResponse();
    response.turnaroundRules = RULES;
    response.entries = [
      booking(200, 400),
      booking(25, 100, { id: BOOKING_2, spaceId: SALOON }),
    ];
    const board = deriveDayBoard(response, NOW);
    const grand = board.lanes[0]?.slots[0];
    const saloon = board.lanes[1]?.slots[0];
    // Scheduled → organisers-due at setup − 60 min.
    expect(grand?.nextBoundaryMs).toBe(NOW + 140 * MIN);
    // Guests-due → imminent at doors − 10 min.
    expect(saloon?.nextBoundaryMs).toBe(NOW + 15 * MIN);
    expect(board.nextBoundaryMs).toBe(NOW + 15 * MIN);
  });

  it("has nothing left to tick once everything has ended", () => {
    const response = baseResponse();
    response.entries = [booking(-300, -100)];
    expect(deriveDayBoard(response, NOW).nextBoundaryMs).toBeNull();
  });
});

describe("the legend (D3)", () => {
  it("names each colour exactly as a slot in that state reads, one entry a colour", () => {
    const response = baseResponse();
    response.turnaroundRules = RULES;
    const rooms = ["scheduled", "organisers", "guests", "doors", "live", "clear", "ended", "risk-a", "risk-b"]
      .map((name, index) => ({ id: `00000000-0000-4000-8000-00000000010${String(index)}`, name, slug: name, sortOrder: index }));
    response.rooms = rooms;
    const at = (room: number, start: number, end: number): CalendarResponse["entries"][number] =>
      booking(start, end, { id: `00000000-0000-4000-8000-00000000020${String(room)}`, spaceId: rooms[room]?.id });
    response.entries = [
      at(0, 200, 300), at(1, 59, 200), at(2, 28, 200), at(3, 9, 200), at(4, -30, 90),
      at(5, -200, -40), at(6, -400, -200), at(7, 100, 150), at(8, 150, 200),
    ];
    response.conflicts.conflicts = [{
      id: "risk", type: "insufficient_turnaround", severity: "blocking", spaceId: rooms[7]?.id ?? "",
      entryIds: ["00000000-0000-4000-8000-000000000207", "00000000-0000-4000-8000-000000000208"], explanation: "No time between them.",
    }];
    const emitted = new Map(deriveDayBoard(response, NOW).lanes.flatMap((lane) => lane.slots).map((slot) => [slot.stateLabel, slot.tone]));
    for (const entry of DAY_BOARD_LEGEND) expect(emitted.get(entry.label), entry.label).toBe(entry.tone);
    expect(new Set(DAY_BOARD_LEGEND.map((entry) => entry.tone)).size).toBe(DAY_BOARD_LEGEND.length);
    expect(new Set(DAY_BOARD_LEGEND.map((entry) => entry.icon)).size).toBe(DAY_BOARD_LEGEND.length);
    expect(new Set(emitted.values()).size).toBe(DAY_BOARD_LEGEND.length);
  });
});

describe("deriveDayBoard — the house's words for each booking", () => {
  function labelFor(overrides: Record<string, unknown>): string | undefined {
    const response = baseResponse();
    response.entries = [booking(120, 240, overrides)];
    return deriveDayBoard(response, NOW).lanes[0]?.slots[0]?.bookingLabel;
  }

  it.each([
    [{ kind: "hold", state: "hold", rank: 1 }, "Provisional · 1st option"],
    [{ kind: "hold", state: "hold", rank: 2 }, "Provisional · 2nd option"],
    [{ kind: "hold", state: "hold", rank: 1, jointFlag: true }, "Provisional · Joint 1st"],
    [{ kind: "hold", state: "hold", rank: null }, "Provisional"],
    [{ kind: "ink", state: "ink" }, "Confirmed booking"],
    [{ kind: "internal_block", state: "internal_block" }, "House block"],
  ])("labels %o as %s", (overrides, expected) => {
    expect(labelFor(overrides)).toBe(expected);
  });
});

describe("deriveDayBoard — exceptions own the alert red", () => {
  it("a turnaround-at-risk pair turns red, stops breathing, and says why", () => {
    const response = baseResponse();
    response.entries = [booking(-30, 90), booking(100, 200, { id: BOOKING_2 })];
    response.conflicts.conflicts = [{
      id: "conflict-1", type: "insufficient_turnaround", severity: "blocking", spaceId: GRAND_HALL,
      entryIds: [BOOKING, BOOKING_2], explanation: "45 minutes between events; this changeover needs 90.",
    }];
    const lane = deriveDayBoard(response, NOW).lanes.find((candidate) => candidate.room.id === GRAND_HALL);
    const flagged = (lane?.slots ?? []).filter((slot) => slot.state === "exception");
    expect(flagged).toHaveLength(2);
    for (const slot of flagged) {
      expect(slot.tone).toBe("red");
      expect(slot.motion).toBe("none");
      expect(slot.icon).toBe("alert-triangle");
      expect(slot.exception).toBe("turnaround-at-risk");
      expect(slot.exceptionDetail).toContain("changeover");
    }
  });

  it("warning-grade turnaround conflicts mark the slot without stealing the red", () => {
    const response = baseResponse();
    response.entries = [booking(-30, 90), booking(100, 200, { id: BOOKING_2 })];
    response.conflicts.conflicts = [{
      id: "conflict-2", type: "insufficient_turnaround", severity: "warning", spaceId: GRAND_HALL,
      entryIds: [BOOKING, BOOKING_2], explanation: "Tight but possible.",
    }];
    const lane = deriveDayBoard(response, NOW).lanes.find((candidate) => candidate.room.id === GRAND_HALL);
    expect(lane?.slots[0]?.state).toBe("live");
    expect(lane?.slots[0]?.turnaroundWarning).toContain("Tight");
  });
});

describe("an event across rooms", () => {
  it("renders one slot per lane, each naming the others", () => {
    const response = baseResponse();
    response.entries = [booking(60, 240), booking(60, 240, { id: BOOKING_2, spaceId: SALOON })];
    const board = deriveDayBoard(response, NOW);
    expect(board.lanes[0]?.slots[0]?.linkedRooms).toEqual(["Saloon"]);
    expect(board.lanes[1]?.slots[0]?.linkedRooms).toEqual(["Grand Hall"]);
  });

  it("links nothing when the event is in one room, or there is no event", () => {
    const response = baseResponse();
    response.entries = [booking(60, 240), booking(60, 240, { id: BOOKING_2, spaceId: SALOON, eventId: null })];
    const board = deriveDayBoard(response, NOW);
    expect(board.lanes[0]?.slots[0]?.linkedRooms).toEqual([]);
    expect(board.lanes[1]?.slots[0]?.linkedRooms).toEqual([]);
  });
});

describe("deriveDayBoard — shape and hygiene", () => {
  it("slots are grouped per room lane and ordered by start time", () => {
    const response = baseResponse();
    response.entries = [
      booking(100, 200, { id: BOOKING_2 }),
      booking(-30, 90),
      booking(50, 80, { id: "00000000-0000-4000-8000-0000000000b3", spaceId: SALOON }),
    ];
    const board = deriveDayBoard(response, NOW);
    expect(board.lanes.map((lane) => lane.room.id)).toEqual([GRAND_HALL, SALOON]);
    expect((board.lanes[0]?.slots ?? []).map((slot) => slot.bookingId)).toEqual([BOOKING, BOOKING_2]);
  });

  it("prospects and released bookings do not reach the hallkeeper board", () => {
    const response = baseResponse();
    response.entries = [
      booking(30, 90, { kind: "prospect", state: "prospect" }),
      booking(100, 200, { id: BOOKING_2, status: "released", state: "released" }),
    ];
    const lane = deriveDayBoard(response, NOW).lanes.find((candidate) => candidate.room.id === GRAND_HALL);
    expect(lane?.slots ?? []).toHaveLength(0);
  });

  it("phases attach to their booking; a lone phase never fabricates a slot", () => {
    const response = baseResponse();
    response.entries = [phase(45, 120)];
    const lane = deriveDayBoard(response, NOW).lanes.find((candidate) => candidate.room.id === GRAND_HALL);
    expect(lane?.slots ?? []).toHaveLength(0);
  });

  it("every state is legible without colour: icon, verb and time text always present", () => {
    const response = baseResponse();
    response.entries = [booking(-30, 90)];
    const slot = soleSlot(response);
    expect(slot.stateLabel.length).toBeGreaterThan(0);
    expect(slot.icon.length).toBeGreaterThan(0);
    expect(slot.countdown.length).toBeGreaterThan(0);
    expect(slot.timeRange).toMatch(/\d{1,2}:\d{2}/u);
  });

  it("says durations the way the house does", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(48)).toBe("48 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(72)).toBe("1 h 12");
    expect(formatMinutes(125)).toBe("2 h 05");
  });

  it("holds across the clocks going back: a booking over the October fold keeps its real length", () => {
    // 25 October 2026, Europe/London: 01:00–02:00 BST happens, then 01:00–02:00 GMT again.
    const response = baseResponse();
    const starts = Date.parse("2026-10-25T00:30:00.000Z"); // 01:30 BST
    const ends = starts + 3 * 60 * MIN;                      // 02:30 GMT, three real hours later
    response.range = { from: "2026-10-23T23:00:00.000Z", to: "2026-10-25T00:00:00.000Z" };
    response.entries = [booking(0, 0, { startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString() })];
    const slot = soleSlot(response, starts + 72 * MIN);
    expect(slot.countdown).toBe("LIVE · 1 h 12 elapsed");
    // The wall shows two hours between the ends; three passed. The verb
    // counts the real ones; the range reads the wall, as the sheet does.
    expect(slot.timeRange).toBe("01:30 – 03:30");
  });
});

// ---------------------------------------------------------------------------
// Requests on the slot (Ship Friday slice 10, widened by goal 19). The rules
// under test: ONE pulse when something arrives, then a steady dot for as long
// as it is open; the copper ring says attention, urgent or owned; nothing at
// all on a slot with nothing waiting.
// ---------------------------------------------------------------------------

function request(overrides: Partial<DayBoardSlotRequest> = {}): DayBoardSlotRequest {
  return {
    id: "req-1",
    bookingId: BOOKING,
    kind: "refreshments",
    quantity: 6,
    urgency: "now",
    state: "sent",
    ownerUserId: null,
    ownerName: null,
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("the request signal on a slot", () => {
  it("is nothing at all when nothing is open", () => {
    expect(deriveSlotRequestSignal([], NOW)).toBeNull();
    expect(deriveSlotRequestSignal([request({ state: "resolved" })], NOW)).toBeNull();
  });

  it("pulses once for a request that has just arrived, then holds a steady dot", () => {
    expect(deriveSlotRequestSignal([request()], NOW)?.motion).toBe("pulse-once");
    const later = deriveSlotRequestSignal([request()], NOW + 21_000);
    expect(later?.motion).toBe("none");
    expect(later?.dot).toBe("copper");
  });

  it("counts what is waiting and says so in words", () => {
    const signal = deriveSlotRequestSignal([request({ id: "a" }), request({ id: "b", state: "accepted" })], NOW + 60_000);
    expect(signal?.openCount).toBe(2);
    expect(signal?.waitingCount).toBe(1);
    expect(signal?.label).toBe("2 requests · 1 waiting");
    expect(deriveSlotRequestSignal([request()], NOW)?.label).toBe("One request waiting");
    expect(deriveSlotRequestSignal([request({ state: "accepted" })], NOW)?.label).toBe("One request in hand");
  });

  it("is urgent only while an urgent request is still unanswered", () => {
    expect(deriveSlotRequestSignal([request({ urgency: "now" })], NOW)?.urgent).toBe(true);
    expect(deriveSlotRequestSignal([request({ urgency: "routine" })], NOW)?.urgent).toBe(false);
    expect(deriveSlotRequestSignal([request({ urgency: "now", state: "acknowledged" })], NOW)?.urgent).toBe(false);
  });
});

describe("the copper ring", () => {
  it("is nothing when nothing is open", () => {
    expect(deriveSlotAttention([], NOW)).toBeNull();
    expect(deriveSlotAttention([request({ state: "resolved" })], NOW)).toBeNull();
  });

  it("says attention while a request has no owner, urgent while an urgent one has none", () => {
    expect(deriveSlotAttention([request({ urgency: "routine" })], NOW)?.level).toBe("attention");
    expect(deriveSlotAttention([request({ urgency: "now" })], NOW)?.level).toBe("urgent");
    // Seen is not owned.
    expect(deriveSlotAttention([request({ urgency: "now", state: "acknowledged" })], NOW)?.level).toBe("urgent");
  });

  it("says owned, by name, once every open request has a person", () => {
    const ring = deriveSlotAttention([
      request({ id: "a", state: "accepted", ownerUserId: "u1", ownerName: "Elaine", urgency: "now" }),
    ], NOW);
    expect(ring?.level).toBe("owned");
    expect(ring?.ownerName).toBe("Elaine");
    expect(ring?.unownedCount).toBe(0);
  });

  it("treats a handover in flight and a reopened request as unowned again", () => {
    expect(deriveSlotAttention([request({ state: "handed-over", ownerUserId: "u1", ownerName: "Fiona", urgency: "soon" })], NOW)?.level).toBe("attention");
    // …and an urgent one in flight is urgent again until the next person takes it.
    expect(deriveSlotAttention([request({ state: "handed-over", ownerUserId: "u1", ownerName: "Fiona", urgency: "now" })], NOW)?.level).toBe("urgent");
    expect(deriveSlotAttention([request({ state: "reopened", urgency: "routine" })], NOW)?.level).toBe("attention");
  });

  it("stamps once on arrival and knows how long the oldest has waited", () => {
    const ring = deriveSlotAttention([
      request({ id: "old", createdAt: new Date(NOW - 3 * MIN).toISOString() }),
      request({ id: "new", createdAt: new Date(NOW - 5_000).toISOString() }),
    ], NOW);
    expect(ring?.arrived).toBe(true);
    expect(ring?.waitingSinceMs).toBe(NOW - 3 * MIN);
    expect(deriveSlotAttention([request({ createdAt: new Date(NOW - 60_000).toISOString() })], NOW)?.arrived).toBe(false);
  });
});

describe("the UNOWNED rail and the next action", () => {
  it("lists every request nobody owns, urgent first then oldest, with its room", () => {
    const response = baseResponse();
    response.entries = [booking(60, 240), booking(60, 240, { id: BOOKING_2, spaceId: SALOON })];
    const board = deriveDayBoard(response, NOW, "Europe/London", [
      request({ id: "routine-old", urgency: "routine", createdAt: new Date(NOW - 10 * MIN).toISOString() }),
      request({ id: "now-new", urgency: "now", bookingId: BOOKING_2, kind: "chairs", quantity: 10, createdAt: new Date(NOW - 3 * MIN).toISOString() }),
      request({ id: "owned", state: "accepted", ownerUserId: "u1", ownerName: "Elaine" }),
    ]);
    expect(board.unowned.map((item) => item.id)).toEqual(["now-new", "routine-old"]);
    expect(board.unowned[0]?.line).toBe("Chairs × 10 · Saloon · waiting 3 min");
    expect(board.nextAction).toEqual({
      kind: "request", line: "Take now: Chairs × 10 · Saloon · waiting 3 min", bookingId: BOOKING_2, requestId: "now-new",
    });
  });

  it("names the nearest moment when nothing is waiting, and quiet when nothing is on", () => {
    const response = baseResponse();
    response.entries = [booking(200, 400), booking(9, 100, { id: BOOKING_2, spaceId: SALOON })];
    expect(deriveDayBoard(response, NOW).nextAction).toEqual({
      kind: "slot", line: "Saloon · Doors · 9 min", bookingId: BOOKING_2, requestId: null,
    });
    const onlyLater = baseResponse();
    onlyLater.entries = [booking(200, 400)];
    expect(deriveDayBoard(onlyLater, NOW).nextAction.line).toBe("Next: Grand Hall · Chamber dinner · setup 16:20 (3 h 20)");
    expect(deriveDayBoard(baseResponse(), NOW).nextAction).toEqual({ kind: "quiet", line: "Nothing scheduled.", bookingId: null, requestId: null });
  });
});

describe("requests reaching the board", () => {
  it("attaches a booking's own requests to its slot and nobody else's", () => {
    const response = baseResponse();
    response.entries = [booking(60, 240), booking(60, 240, { id: BOOKING_2, spaceId: SALOON, title: "Saloon drinks" })];
    const board = deriveDayBoard(response, NOW, "Europe/London", [
      request({ id: "a", bookingId: BOOKING }),
      request({ id: "b", bookingId: BOOKING_2 }),
      request({ id: "c", bookingId: BOOKING }),
    ]);
    const grand = board.lanes.find((lane) => lane.room.id === GRAND_HALL)?.slots[0];
    const saloon = board.lanes.find((lane) => lane.room.id === SALOON)?.slots[0];
    expect(grand?.requests.map((item) => item.id)).toEqual(["a", "c"]);
    expect(grand?.requestSignal?.openCount).toBe(2);
    expect(grand?.attention?.count).toBe(2);
    expect(saloon?.requests.map((item) => item.id)).toEqual(["b"]);
  });

  it("drops finished requests before they reach a slot, and ignores a request with no booking", () => {
    const response = baseResponse();
    response.entries = [booking(60, 240)];
    const board = deriveDayBoard(response, NOW, "Europe/London", [request({ id: "done", state: "resolved" }), request({ id: "loose", bookingId: null })]);
    const slot = board.lanes.find((lane) => lane.room.id === GRAND_HALL)?.slots[0];
    expect(slot?.requests).toEqual([]);
    expect(slot?.requestSignal).toBeNull();
    expect(slot?.attention).toBeNull();
    // A loose request still waits on the rail, with no room to name.
    expect(board.unowned.map((item) => item.id)).toEqual(["loose"]);
    expect(board.unowned[0]?.roomName).toBeNull();
  });

  it("still carries requests on a slot flagged as an exception", () => {
    const response = baseResponse();
    response.entries = [booking(60, 240), booking(255, 330, { id: BOOKING_2 })];
    response.conflicts.conflicts = [{
      id: "conflict-3", type: "insufficient_turnaround", severity: "blocking", spaceId: GRAND_HALL,
      entryIds: [BOOKING, BOOKING_2], explanation: "15 minutes between events; this changeover needs 90.",
    }];
    const slot = deriveDayBoard(response, NOW, "Europe/London", [request()]).lanes[0]?.slots[0];
    expect(slot?.state).toBe("exception");
    expect(slot?.requests).toHaveLength(1);
    expect(slot?.attention?.level).toBe("urgent");
  });
});
