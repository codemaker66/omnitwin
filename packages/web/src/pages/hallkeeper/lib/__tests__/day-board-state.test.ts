import { describe, expect, it } from "vitest";
import type { CalendarResponse } from "@omnitwin/types";
import { deriveDayBoard, type DayBoardSlot } from "../day-board-state.js";

// ---------------------------------------------------------------------------
// The Day Board state machine (Day Board S1) — tests written FIRST.
//
// One pure function turns GET /calendar + a clock instant into per-slot
// states, tones, cadences and countdown labels. Everything the board
// animates is decided here, deterministically, so every boundary is
// unit-testable without a DOM: the 60/30/10-minute thresholds, the LIVE
// window, the priority of exception over everything else, and the exact
// label copy the chips display.
//
// Motion is CSS's job; this module only names the cadence. Reduced motion
// swaps CSS behaviour, never these derivations — the label text IS the
// reduced-motion experience, so labels are load-bearing, not decoration.
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

function soleSlot(response: CalendarResponse): DayBoardSlot {
  const board = deriveDayBoard(response, NOW);
  const lane = board.lanes.find((candidate) => candidate.room.id === GRAND_HALL);
  if (lane === undefined || lane.slots[0] === undefined) throw new Error("no slot derived");
  return lane.slots[0];
}

describe("deriveDayBoard — the countdown ramp", () => {
  it("far out is quiet: no motion, a scheduled state, a wall-clock label", () => {
    const response = baseResponse();
    response.entries = [booking(200, 400)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("scheduled");
    expect(slot.motion).toBe("none");
    // The label speaks venue wall time, not offsets.
    expect(slot.countdown).toMatch(/\d{1,2}:\d{2}/u);
  });

  it("organisers due: inside 60m of the SETUP opening, green, 4s pulse", () => {
    const response = baseResponse();
    // Doors at +120m, but setup opens at +45m — the state keys off setup.
    response.entries = [booking(120, 300), phase(45, 120)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("organisers-due");
    expect(slot.tone).toBe("green");
    expect(slot.motion).toBe("pulse-4s");
    expect(slot.countdown).toBe("Organisers · 45m");
  });

  it("without phases, setup falls back to doors — 59m out is organisers-due, 61m is not", () => {
    const near = baseResponse();
    near.entries = [booking(59, 200)];
    expect(soleSlot(near).state).toBe("organisers-due");

    const far = baseResponse();
    far.entries = [booking(61, 200)];
    expect(soleSlot(far).state).toBe("scheduled");
  });

  it("guests due: inside 30m of doors, amber, 3s pulse, guest-facing label", () => {
    const response = baseResponse();
    response.entries = [booking(28, 200)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("guests-due");
    expect(slot.tone).toBe("amber");
    expect(slot.motion).toBe("pulse-3s");
    expect(slot.countdown).toBe("Guests · 28m");
  });

  it("imminent: inside 10m of doors the amber deepens and quickens", () => {
    const response = baseResponse();
    response.entries = [booking(9, 200)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("imminent");
    expect(slot.tone).toBe("amber-deep");
    expect(slot.motion).toBe("pulse-2s");
    expect(slot.countdown).toBe("Guests · 9m");
  });

  it("in progress: a calm LIVE breathe — never a red pulse — with time remaining", () => {
    const response = baseResponse();
    response.entries = [booking(-30, 90)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("in-progress");
    expect(slot.tone).toBe("live");
    expect(slot.motion).toBe("breathe-4s");
    expect(slot.countdown).toBe("Live · 1h 30m left");
  });

  it("ended: faded, still, and labelled done", () => {
    const response = baseResponse();
    response.entries = [booking(-300, -60)];
    const slot = soleSlot(response);
    expect(slot.state).toBe("done");
    expect(slot.tone).toBe("faded");
    expect(slot.motion).toBe("none");
  });
});

describe("deriveDayBoard — exceptions own red", () => {
  it("a turnaround-at-risk pair pulses red at 1.5s and says why", () => {
    const response = baseResponse();
    response.entries = [booking(-30, 90), booking(100, 200, { id: BOOKING_2 })];
    response.conflicts.conflicts = [
      {
        id: "conflict-1",
        type: "insufficient_turnaround",
        severity: "blocking",
        spaceId: GRAND_HALL,
        entryIds: [BOOKING, BOOKING_2],
        explanation: "45 minutes between events; this changeover needs 90.",
      },
    ];
    const board = deriveDayBoard(response, NOW);
    const lane = board.lanes.find((candidate) => candidate.room.id === GRAND_HALL);
    const flagged = (lane?.slots ?? []).filter((slot) => slot.state === "exception");
    expect(flagged).toHaveLength(2);
    for (const slot of flagged) {
      expect(slot.tone).toBe("red");
      expect(slot.motion).toBe("pulse-fast");
      expect(slot.exception).toBe("turnaround-at-risk");
      expect(slot.exceptionDetail).toContain("changeover");
    }
  });

  it("warning-grade turnaround conflicts mark the slot without stealing the red", () => {
    const response = baseResponse();
    response.entries = [booking(-30, 90), booking(100, 200, { id: BOOKING_2 })];
    response.conflicts.conflicts = [
      {
        id: "conflict-2",
        type: "insufficient_turnaround",
        severity: "warning",
        spaceId: GRAND_HALL,
        entryIds: [BOOKING, BOOKING_2],
        explanation: "Tight but possible.",
      },
    ];
    const board = deriveDayBoard(response, NOW);
    const lane = board.lanes.find((candidate) => candidate.room.id === GRAND_HALL);
    // The live slot stays live; the warning rides as detail, not as state.
    expect(lane?.slots[0]?.state).toBe("in-progress");
    expect(lane?.slots[0]?.turnaroundWarning).toContain("Tight");
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
    const grandHall = board.lanes[0]?.slots ?? [];
    expect(grandHall.map((slot) => slot.bookingId)).toEqual([BOOKING, BOOKING_2]);
  });

  it("prospects and released bookings do not reach the hallkeeper board", () => {
    const response = baseResponse();
    response.entries = [
      booking(30, 90, { kind: "prospect", state: "prospect" }),
      booking(100, 200, { id: BOOKING_2, status: "released", state: "released" }),
    ];
    const board = deriveDayBoard(response, NOW);
    const lane = board.lanes.find((candidate) => candidate.room.id === GRAND_HALL);
    // A hallkeeper preps rooms for things that are HAPPENING: ink, live
    // holds, house blocks — not the sales pipeline, not the departed.
    expect(lane?.slots ?? []).toHaveLength(0);
  });

  it("phases attach to their booking; a lone phase never fabricates a slot", () => {
    const response = baseResponse();
    response.entries = [phase(45, 120)];
    const board = deriveDayBoard(response, NOW);
    const lane = board.lanes.find((candidate) => candidate.room.id === GRAND_HALL);
    expect(lane?.slots ?? []).toHaveLength(0);
  });

  it("every state is legible without colour: state, label and time text always present", () => {
    const response = baseResponse();
    response.entries = [booking(-30, 90)];
    const slot = soleSlot(response);
    expect(slot.stateLabel.length).toBeGreaterThan(0);
    expect(slot.countdown.length).toBeGreaterThan(0);
    expect(slot.timeRange).toMatch(/\d{1,2}:\d{2}/u);
  });
});
