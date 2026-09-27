import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CalendarBookingEntry, CalendarRoom, ConflictSeverity } from "@omnitwin/types";
import { BoardGrid } from "../BoardGrid.js";
import type { BlockDragHandlers, BoardDrag, DragBlockDescriptor } from "../../hooks/useBoardDrag.js";
import type { DragState, Ghost } from "../../lib/board-drag.js";
import { boardRange } from "../../lib/board-time.js";

// ---------------------------------------------------------------------------
// BoardGrid render scope: a drag move re-renders the lanes the ghost leaves
// or enters, never every block on the board. Renders are observed through the
// grid's own reads — each lane render reads its blocks' conflict severity, and
// each block render asks the drag for that block's handlers.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const ROOM_A = "00000000-0000-4000-8000-0000000000a1";
const ROOM_B = "00000000-0000-4000-8000-0000000000b2";
const ROOM_C = "00000000-0000-4000-8000-0000000000c3";
const WEEK = boardRange(Date.parse("2026-09-09T12:00:00Z"), "week");
const ROOMS: readonly CalendarRoom[] = [
  { id: ROOM_A, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
  { id: ROOM_B, name: "Saloon", slug: "saloon", sortOrder: 1 },
  { id: ROOM_C, name: "Unmapped room", slug: "unmapped-room", sortOrder: 2 },
];

function booking(id: string, spaceId: string, startsAt: string, endsAt: string, overrides: Partial<CalendarBookingEntry> = {}): CalendarBookingEntry {
  return {
    entryType: "booking", id, spaceId, kind: "ink", status: "active", state: "ink", title: `Booking ${id}`,
    eventType: null, startsAt, endsAt, rank: null, jointFlag: false, decisionAt: null, ownerUserId: null,
    nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null, ...overrides,
  };
}

const ENTRIES: readonly CalendarBookingEntry[] = [
  booking("a1", ROOM_A, "2026-09-07T09:00:00Z", "2026-09-07T13:00:00Z", { kind: "hold", state: "hold", rank: 1 }),
  booking("a2", ROOM_A, "2026-09-08T17:00:00Z", "2026-09-08T22:00:00Z"),
  booking("b1", ROOM_B, "2026-09-09T09:00:00Z", "2026-09-09T12:00:00Z"),
  booking("b2", ROOM_B, "2026-09-10T09:00:00Z", "2026-09-10T12:00:00Z", { kind: "hold", state: "hold" }),
  booking("b3", ROOM_B, "2026-09-10T13:00:00Z", "2026-09-10T15:00:00Z", { kind: "hold", state: "hold", rank: 2 }),
  booking("c1", ROOM_C, "2026-09-11T09:00:00Z", "2026-09-11T12:00:00Z"),
  booking("c2", ROOM_C, "2026-09-11T13:00:00Z", "2026-09-11T15:00:00Z", { kind: "hold", status: "released", state: "released" }),
];
const ACTIVE_BLOCKS = ENTRIES.filter((entry) => entry.status === "active").length;

class CountingSeverity extends Map<string, ConflictSeverity> {
  reads = 0;
  override get(key: string): ConflictSeverity | undefined {
    this.reads += 1;
    return super.get(key);
  }
}

const noop = (): void => undefined;
const HANDLERS: BlockDragHandlers = {
  onClick: noop, onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop, onKeyDown: noop,
};

function dragOf(handlersFor: BoardDrag["handlersFor"], ghost: Ghost | null, activeBlockId: string | null): BoardDrag {
  const state: DragState = ghost === null || activeBlockId === null
    ? { phase: "idle" }
    : {
        phase: "dragging",
        ghost,
        context: { blockId: activeBlockId, title: activeBlockId, mode: "pointer", originSpaceId: ROOM_A,
          originStartMs: ghost.startMs, originEndMs: ghost.endMs, isInk: false },
      };
  return { state, ghost, activeBlockId, confirming: false, announcement: "", handlersFor, confirmDrop: noop, cancel: noop, liftedBlockId: null };
}

function ghostAt(spaceId: string, startsAt: string, hours: number): Ghost {
  const startMs = Date.parse(startsAt);
  return { spaceId, startMs, endMs: startMs + hours * HOUR, validity: { kind: "ok" } };
}

function ghostIn(spaceId: string): Element | null {
  return document.querySelector(`[data-diary-lane="${spaceId}"] .diary-ghost`);
}

afterEach(cleanup);

describe("BoardGrid render scope", () => {
  it("re-renders only the lanes a ghost leaves or enters, and only the lifted block", () => {
    const handlersFor = vi.fn((_block: DragBlockDescriptor): BlockDragHandlers => HANDLERS);
    const conflictSeverity = new CountingSeverity([["b1", "warning"]]);
    const props = { rooms: ROOMS, entries: ENTRIES, range: WEEK, pxPerHour: 18, conflictSeverity, writable: true, nowMs: WEEK.fromMs };
    const view = render(<BoardGrid {...props} drag={dragOf(handlersFor, null, null)} />);
    expect(handlersFor).toHaveBeenCalledTimes(ACTIVE_BLOCKS);
    expect(conflictSeverity.reads).toBe(ENTRIES.length);

    // Lift: every lane learns which block is lifted; only that block re-renders.
    handlersFor.mockClear();
    view.rerender(<BoardGrid {...props} drag={dragOf(handlersFor, ghostAt(ROOM_A, "2026-09-07T09:00:00Z", 4), "a1")} />);
    expect(handlersFor.mock.calls.map(([block]) => block.id)).toEqual(["a1"]);
    expect(document.getElementById("diary-block-a1")?.classList.contains("is-dragging")).toBe(true);
    expect(ghostIn(ROOM_A)?.textContent).toBe("10:00–14:00");

    // A move within the lane: that lane alone, and no block.
    handlersFor.mockClear();
    conflictSeverity.reads = 0;
    const within = dragOf(handlersFor, ghostAt(ROOM_A, "2026-09-07T10:00:00Z", 4), "a1");
    view.rerender(<BoardGrid {...props} drag={within} />);
    expect(handlersFor).not.toHaveBeenCalled();
    expect(conflictSeverity.reads).toBe(2);
    expect(ghostIn(ROOM_A)?.textContent).toBe("11:00–15:00");

    // The same drag again: the memoised grid does no work at all.
    conflictSeverity.reads = 0;
    view.rerender(<BoardGrid {...props} drag={within} />);
    expect(conflictSeverity.reads).toBe(0);

    // Across lanes: the lane it left and the lane it entered.
    view.rerender(<BoardGrid {...props} drag={dragOf(handlersFor, ghostAt(ROOM_B, "2026-09-07T10:00:00Z", 4), "a1")} />);
    expect(handlersFor).not.toHaveBeenCalled();
    expect(conflictSeverity.reads).toBe(2 + 3);
    expect(ghostIn(ROOM_A)).toBeNull();
    expect(ghostIn(ROOM_B)?.textContent).toBe("11:00–15:00");

    // Drop: the lifted block settles back.
    view.rerender(<BoardGrid {...props} drag={dragOf(handlersFor, null, null)} />);
    expect(handlersFor.mock.calls.map(([block]) => block.id)).toEqual(["a1"]);
    expect(document.getElementById("diary-block-a1")?.classList.contains("is-dragging")).toBe(false);
    expect(document.querySelector(".diary-ghost")).toBeNull();
  });

  it("keeps doors countdowns current as the clock moves, re-rendering only the blocks whose text changes", () => {
    const handlersFor = vi.fn((_block: DragBlockDescriptor): BlockDragHandlers => HANDLERS);
    const props = { rooms: ROOMS, entries: ENTRIES, range: WEEK, pxPerHour: 18, conflictSeverity: new Map<string, ConflictSeverity>(),
      writable: true, drag: dragOf(handlersFor, null, null) };
    const view = render(<BoardGrid {...props} nowMs={Date.parse("2026-09-08T14:00:00Z")} />);
    const inked = (): HTMLElement | null => document.getElementById("diary-block-a2");
    expect(inked()?.querySelector(".diary-block-countdown")?.textContent).toBe("Doors in 3h 00m");
    expect(inked()?.getAttribute("aria-label")).toContain(", Doors in 3h 00m");
    handlersFor.mockClear();
    view.rerender(<BoardGrid {...props} nowMs={Date.parse("2026-09-08T15:30:00Z")} />);
    expect(inked()?.querySelector(".diary-block-countdown")?.textContent).toBe("Doors in 1h 30m");
    expect(handlersFor.mock.calls.map(([block]) => block.id)).toEqual(["a2"]);
    view.rerender(<BoardGrid {...props} nowMs={Date.parse("2026-09-08T17:00:00Z")} />);
    expect(inked()?.querySelector(".diary-block-countdown")).toBeNull();
    expect(inked()?.getAttribute("aria-label")).not.toContain("Doors in");
  });
});

// ---------------------------------------------------------------------------
// A gap's time opens its changeover sheet (T-637). The chip says the gap in
// Venue settings' words and, beside a gap shorter than the room's time, what
// the room needs; only the chip takes the pointer, so the rest of the gap
// still books where it is clicked.
// ---------------------------------------------------------------------------

describe("BoardGrid gaps", () => {
  const DAY = boardRange(Date.parse("2026-09-08T12:00:00Z"), "day");
  const TWO: readonly CalendarBookingEntry[] = [
    booking("d1", ROOM_A, "2026-09-08T08:00:00Z", "2026-09-08T12:00:00Z", { title: "Chamber lunch", eventType: "lunch" }),
    booking("d2", ROOM_A, "2026-09-08T13:30:00Z", "2026-09-08T16:00:00Z", { title: "MacLeod wedding", eventType: "wedding" }),
  ];
  const RULES = [{ spaceId: ROOM_A, eventType: null, name: "Grand Hall", minutes: 120, isActive: true }];
  const props = {
    rooms: ROOMS, entries: TWO, range: DAY, pxPerHour: 96, conflictSeverity: new Map<string, ConflictSeverity>(),
    writable: true, nowMs: Date.parse("2026-09-01T00:00:00Z"), turnaroundRules: RULES,
  };

  it("names the gap and what the room needs, and opens the sheet with the room and the gap", () => {
    const onOpenGap = vi.fn();
    render(<BoardGrid {...props} drag={dragOf(() => HANDLERS, null, null)} onOpenGap={onOpenGap} />);
    const chip = screen.getByRole("button", {
      name: "Changeover in Grand Hall: 1 hour 30 minutes between Chamber lunch and MacLeod wedding, needs 2 hours",
    });
    expect(chip.textContent).toBe("1 h 30needs 2 h");
    fireEvent.click(chip);
    expect(onOpenGap).toHaveBeenCalledWith(
      { id: ROOM_A, name: "Grand Hall" },
      expect.objectContaining({
        minutes: 90, checked: true, tight: true,
        before: { id: "d1", title: "Chamber lunch", eventType: "lunch" },
        after: { id: "d2", title: "MacLeod wedding", eventType: "wedding" },
      }),
      chip,
    );
  });

  it("leaves the time a plain label, hidden from a screen reader, where no sheet is offered", () => {
    render(<BoardGrid {...props} drag={dragOf(() => HANDLERS, null, null)} />);
    expect(screen.queryByRole("button", { name: /^Changeover in/u })).toBeNull();
    const chip = document.querySelector(".diary-gap-chip");
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.getAttribute("aria-hidden")).toBe("true");
    expect(chip?.textContent).toBe("1 h 30needs 2 h");
  });
});

describe("BoardGrid — the day view opens where the day is (roadmap N3)", () => {
  // Thursday 10 September; the Grand Hall's first hold starts at 09:00 UTC (10:00 BST).
  const THURSDAY = boardRange(Date.parse("2026-09-10T12:00:00Z"), "day");
  const DAY_PX = 96;
  const scroller = (): HTMLElement => document.querySelector(".diary-scroll") as HTMLElement;
  const props = {
    rooms: ROOMS, entries: ENTRIES, range: THURSDAY, pxPerHour: DAY_PX, conflictSeverity: new Map<string, ConflictSeverity>(),
    writable: true, nowMs: Date.parse("2026-09-07T08:00:00Z"),
  };

  it("opens another day an hour before its first booking, once, leaving the booker's scrolling alone", () => {
    const handlersFor = vi.fn((_block: DragBlockDescriptor): BlockDragHandlers => HANDLERS);
    const view = render(<BoardGrid {...props} drag={dragOf(handlersFor, null, null)} />);
    // 08:00 UTC is 9 hours after the venue's midnight (23:00 UTC).
    expect(scroller().scrollLeft).toBe(9 * DAY_PX);
    scroller().scrollLeft = 40;
    view.rerender(<BoardGrid {...props} entries={ENTRIES.slice(0, 4)} drag={dragOf(handlersFor, null, null)} />);
    expect(scroller().scrollLeft).toBe(40);
  });

  it("waits for the day's bookings, and opens today at the current time", () => {
    const handlersFor = vi.fn((_block: DragBlockDescriptor): BlockDragHandlers => HANDLERS);
    const now = Date.parse("2026-09-10T15:30:00Z");
    const view = render(<BoardGrid {...props} nowMs={now} pending drag={dragOf(handlersFor, null, null)} />);
    expect(scroller().scrollLeft).toBe(0);
    view.rerender(<BoardGrid {...props} nowMs={now} drag={dragOf(handlersFor, null, null)} />);
    // 14:30 UTC, an hour before now, is 15.5 hours after the venue's midnight.
    expect(scroller().scrollLeft).toBe(15.5 * DAY_PX);
  });
});

// ---------------------------------------------------------------------------
// Commitment by luminance (roadmap N3), on the timeline: a live hold names its
// option and, a week or less out, its decision in the countdown's place; every
// conflict edge comes with its word.
// ---------------------------------------------------------------------------

describe("BoardGrid holds and conflicts", () => {
  const DAY = boardRange(Date.parse("2026-09-10T12:00:00Z"), "day");
  // Tuesday 8 September 2026, 09:00 BST.
  const props = {
    rooms: ROOMS, range: DAY, pxPerHour: 96, writable: true, nowMs: Date.parse("2026-09-08T08:00:00Z"),
    drag: dragOf(() => HANDLERS, null, null),
  };
  const at = (id: string, spaceId: string, overrides: Partial<CalendarBookingEntry> = {}): CalendarBookingEntry =>
    booking(id, spaceId, "2026-09-10T09:00:00Z", "2026-09-10T12:00:00Z", overrides);

  it("shows a live hold's decision a week or less out, in the client's place, and nothing further off", () => {
    const client = { clientName: "Fiona and Ross MacLeod" };
    render(<BoardGrid {...props} conflictSeverity={new Map()} entries={[
      at("near", ROOM_A, { kind: "hold", state: "hold", rank: 1, decisionAt: "2026-09-09T11:00:00Z", ...client }),
      at("far", ROOM_B, { kind: "hold", state: "hold", rank: 2, decisionAt: "2026-09-20T11:00:00Z", ...client }),
      at("gone", ROOM_C, { kind: "hold", status: "released", state: "released", rank: 1, decisionAt: "2026-09-09T11:00:00Z" }),
    ]} />);
    const near = document.getElementById("diary-block-near");
    expect(near?.querySelector(".diary-block-decision")?.textContent).toBe("Decides tomorrow");
    expect(near?.querySelector(".diary-block-chip")?.textContent).toBe("1st option");
    expect(near?.querySelector(".diary-block-client")).toBeNull();
    expect(near?.getAttribute("aria-label")).toContain("Fiona and Ross MacLeod");
    expect(near?.getAttribute("aria-label")).toContain(", Decides tomorrow");
    expect(document.querySelector("#diary-block-far .diary-block-chip")?.textContent).toBe("2nd option");
    expect(document.querySelector("#diary-block-far .diary-block-decision")).toBeNull();
    expect(document.querySelector("#diary-block-far .diary-block-client")?.textContent).toBe("Fiona and Ross MacLeod");
    expect(document.querySelector("#diary-block-gone .diary-block-decision")).toBeNull();
  });

  it("names the option by its numeral on a block too narrow for the words, and in full to a screen reader", () => {
    const holds = [
      at("second", ROOM_A, { kind: "hold", state: "hold", rank: 2 }),
      at("joint", ROOM_B, { kind: "hold", state: "hold", rank: 1, jointFlag: true }),
      at("open", ROOM_C, { kind: "hold", state: "hold", rank: null }),
    ];
    const chip = (id: string): string | null | undefined => document.querySelector(`#diary-block-${id} .diary-block-chip`)?.textContent;
    const label = (id: string): string | null | undefined => document.getElementById(`diary-block-${id}`)?.getAttribute("aria-label");
    // Three hours at 30 px an hour: 90 px, room for the time but not the words.
    const view = render(<BoardGrid {...props} pxPerHour={30} conflictSeverity={new Map()} entries={holds} />);
    // A joint 1st says so even here: "=1st", not a sole "1st".
    expect([chip("second"), chip("joint"), chip("open")]).toEqual(["2nd", "=1st", undefined]);
    expect(label("second")).toContain(", 2nd option");
    expect(label("joint")).toContain(", Joint 1st");
    expect(label("open")).toContain(", Provisional, no option yet");
    // Three hours at 110 px an hour: the words in full.
    view.rerender(<BoardGrid {...props} pxPerHour={110} conflictSeverity={new Map()} entries={holds} />);
    expect([chip("second"), chip("joint"), chip("open")]).toEqual(["2nd option", "Joint 1st", "Provisional, no option yet"]);
  });

  it("gives every conflict edge its word", () => {
    render(<BoardGrid {...props} entries={[at("clash", ROOM_A), at("review", ROOM_B), at("clear", ROOM_C)]}
      conflictSeverity={new Map<string, ConflictSeverity>([["clash", "blocking"], ["review", "warning"]])} />);
    expect(document.querySelector("#diary-block-clash.has-conflict-blocking .diary-block-stamp")?.textContent).toBe("Conflict");
    expect(document.querySelector("#diary-block-review.has-conflict-warning .diary-block-stamp.is-warning")?.textContent).toBe("Review");
    expect(document.querySelector("#diary-block-clear .diary-block-stamp")).toBeNull();
  });
});
