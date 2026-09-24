import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
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
  return { state, ghost, activeBlockId, confirming: false, announcement: "", handlersFor, confirmDrop: noop, cancel: noop };
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
