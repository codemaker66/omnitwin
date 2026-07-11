import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry, CalendarEntry, CalendarPhaseEntry } from "@omnitwin/types";
import {
  filterBoardEntries,
  layoutLane,
  needsAction,
} from "../board-layout.js";

// ---------------------------------------------------------------------------
// Board lane layout (T-493; Canon §8/§18) — pure interval packing, footprint
// grouping (phases render inside their booking's block), and the
// needs-action tray selection.
// ---------------------------------------------------------------------------

const SPACE = "00000000-0000-4000-8000-0000000000b1";

let counter = 0;

function bookingEntry(overrides: Partial<CalendarBookingEntry>): CalendarBookingEntry {
  counter += 1;
  return {
    entryType: "booking",
    id: `00000000-0000-4000-8000-0000000000${String(counter).padStart(2, "0")}`,
    spaceId: SPACE,
    kind: "ink",
    status: "active",
    state: "ink",
    title: `Booking ${String(counter)}`,
    eventType: null,
    startsAt: "2026-09-18T18:00:00.000Z",
    endsAt: "2026-09-18T23:00:00.000Z",
    rank: null,
    jointFlag: false,
    decisionAt: null,
    ownerUserId: null,
    nextAction: null,
    nextActionDueAt: null,
    eventId: null,
    seriesId: null,
    ...overrides,
  };
}

function phaseEntry(overrides: Partial<CalendarPhaseEntry>): CalendarPhaseEntry {
  counter += 1;
  return {
    entryType: "phase",
    id: `00000000-0000-4000-8000-0000000001${String(counter).padStart(2, "0")}`,
    spaceId: SPACE,
    eventId: "00000000-0000-4000-8000-0000000000ee",
    eventName: "Mackenzie–Ross wedding",
    name: "Setup",
    startsAt: "2026-09-19T08:00:00.000Z",
    endsAt: "2026-09-19T12:00:00.000Z",
    sortOrder: 0,
    ...overrides,
  };
}

describe("layoutLane packing", () => {
  it("keeps non-overlapping blocks on one sub-row (touching edges share)", () => {
    const entries: CalendarEntry[] = [
      bookingEntry({ id: "a".repeat(36), startsAt: "2026-09-18T08:00:00.000Z", endsAt: "2026-09-18T12:00:00.000Z" }),
      bookingEntry({ id: "b".repeat(36), startsAt: "2026-09-18T12:00:00.000Z", endsAt: "2026-09-18T17:00:00.000Z" }),
    ];
    const lane = layoutLane(entries, SPACE);
    expect(lane.subRowCount).toBe(1);
    expect(lane.blocks.map((block) => block.subRow)).toEqual([0, 0]);
  });

  it("stacks overlapping holds onto separate sub-rows deterministically", () => {
    const first = bookingEntry({
      id: "c".repeat(36),
      kind: "hold",
      state: "hold",
      rank: 1,
      startsAt: "2026-09-18T17:00:00.000Z",
      endsAt: "2026-09-18T23:30:00.000Z",
    });
    const second = bookingEntry({
      id: "d".repeat(36),
      kind: "hold",
      state: "hold",
      rank: 2,
      startsAt: "2026-09-18T18:00:00.000Z",
      endsAt: "2026-09-18T23:00:00.000Z",
    });
    const forward = layoutLane([first, second], SPACE);
    const reversed = layoutLane([second, first], SPACE);
    expect(forward.subRowCount).toBe(2);
    expect(forward).toEqual(reversed);
    expect(forward.blocks[0]?.entry.id).toBe("c".repeat(36));
    expect(forward.blocks[0]?.subRow).toBe(0);
    expect(forward.blocks[1]?.subRow).toBe(1);
  });

  it("ignores entries from other lanes", () => {
    const other = bookingEntry({ spaceId: "00000000-0000-4000-8000-0000000000b2" });
    const lane = layoutLane([other], SPACE);
    expect(lane.blocks).toHaveLength(0);
    expect(lane.subRowCount).toBe(1);
  });

  it("attaches phases to their booking as footprint segments", () => {
    const eventId = "00000000-0000-4000-8000-0000000000ee";
    const wedding = bookingEntry({
      id: "e".repeat(36),
      eventId,
      startsAt: "2026-09-19T08:00:00.000Z",
      endsAt: "2026-09-20T01:00:00.000Z",
    });
    const setup = phaseEntry({ eventId, name: "Setup", startsAt: "2026-09-19T08:00:00.000Z", endsAt: "2026-09-19T12:00:00.000Z", sortOrder: 0 });
    const live = phaseEntry({ eventId, name: "Ceremony", startsAt: "2026-09-19T12:00:00.000Z", endsAt: "2026-09-19T22:30:00.000Z", sortOrder: 1 });
    const lane = layoutLane([wedding, setup, live], SPACE);
    expect(lane.blocks).toHaveLength(1);
    expect(lane.blocks[0]?.segments.map((segment) => segment.name)).toEqual(["Setup", "Ceremony"]);
    expect(lane.orphanPhases).toHaveLength(0);
  });

  it("renders phases with no booking in the lane as standalone footprint strips", () => {
    const orphan = phaseEntry({ eventId: "00000000-0000-4000-8000-0000000000ff" });
    const lane = layoutLane([orphan], SPACE);
    expect(lane.blocks).toHaveLength(0);
    expect(lane.orphanPhases).toHaveLength(1);
  });
});

describe("filterBoardEntries", () => {
  it("hides exited bookings by default and shows them on request", () => {
    const active = bookingEntry({ id: "f".repeat(36) });
    const released = bookingEntry({
      id: "0".repeat(36),
      kind: "hold",
      status: "released",
      state: "released",
    });
    expect(filterBoardEntries([active, released], { showExited: false })).toHaveLength(1);
    expect(filterBoardEntries([active, released], { showExited: true })).toHaveLength(2);
  });

  it("phases always pass through (the footprint is operational truth)", () => {
    const phase = phaseEntry({});
    expect(filterBoardEntries([phase], { showExited: false })).toHaveLength(1);
  });
});

describe("needsAction (the tray)", () => {
  const NOW = Date.parse("2026-09-01T09:00:00.000Z");

  it("selects overdue next actions and overdue decisions, most overdue first", () => {
    const overdueAction = bookingEntry({
      id: "1".repeat(36),
      kind: "hold",
      state: "hold",
      rank: 1,
      title: "MacLeod wedding",
      nextAction: "Call Fiona.",
      nextActionDueAt: "2026-08-25T09:00:00.000Z",
      decisionAt: "2026-09-20T09:00:00.000Z",
    });
    const overdueDecision = bookingEntry({
      id: "2".repeat(36),
      kind: "hold",
      state: "hold",
      rank: 2,
      title: "Robertson ceilidh",
      nextAction: "Chase band.",
      nextActionDueAt: "2026-09-03T09:00:00.000Z",
      decisionAt: "2026-08-30T09:00:00.000Z",
    });
    const fine = bookingEntry({
      id: "3".repeat(36),
      kind: "hold",
      state: "hold",
      rank: 1,
      nextActionDueAt: "2026-09-10T09:00:00.000Z",
      decisionAt: "2026-09-12T09:00:00.000Z",
    });
    const items = needsAction([overdueAction, overdueDecision, fine], NOW);
    expect(items.map((item) => item.entry.id)).toEqual(["1".repeat(36), "2".repeat(36)]);
    expect(items[0]?.reasons[0]).toContain("next action");
    expect(items[1]?.reasons[0]).toContain("decision");
  });

  it("flags unranked pencils as ladder hygiene work", () => {
    const unranked = bookingEntry({
      id: "4".repeat(36),
      kind: "hold",
      state: "hold",
      rank: null,
      nextActionDueAt: "2026-09-10T09:00:00.000Z",
      decisionAt: "2026-09-12T09:00:00.000Z",
    });
    const items = needsAction([unranked], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]?.reasons.join(" ")).toContain("unranked");
  });

  it("ignores inks, prospects, blocks, and exited holds", () => {
    const ink = bookingEntry({ id: "5".repeat(36) });
    const prospect = bookingEntry({ id: "6".repeat(36), kind: "prospect", state: "prospect" });
    const released = bookingEntry({
      id: "7".repeat(36),
      kind: "hold",
      status: "released",
      state: "released",
      nextActionDueAt: "2026-08-01T09:00:00.000Z",
    });
    expect(needsAction([ink, prospect, released], NOW)).toHaveLength(0);
  });
});
