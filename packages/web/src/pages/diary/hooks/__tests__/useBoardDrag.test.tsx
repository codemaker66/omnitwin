import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useBoardDrag } from "../useBoardDrag.js";
import type { CommitPayload } from "../../lib/board-drag.js";

const block = { id: "booking", title: "Briefing", spaceId: "room", startMs: Date.parse("2026-09-07T08:00Z"), endMs: Date.parse("2026-09-07T08:15Z"), isInk: false };
function Harness({ writable = true, onOpen = vi.fn(), onCommit = vi.fn() }) {
  const drag = useBoardDrag({ laneOrder: ["room"], inksByLane: new Map(), pxPerHour: 96, writable, onCommit, onRejected: vi.fn(), onOpenBlock: onOpen });
  return <><button type="button" {...drag.handlersFor(block)}>Booking</button><button type="button" onClick={drag.cancel}>Cancel movement</button></>;
}
beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: vi.fn(() => []) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("precise timeline pointer activation", () => {
  it.each([true, false])("opens a genuine plain click when writable is %s", (writable) => {
    const onOpen = vi.fn(); const onCommit = vi.fn();
    render(<Harness writable={writable} onOpen={onOpen} onCommit={onCommit} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(button, { pointerId: 1 }); fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("booking");expect(onCommit).not.toHaveBeenCalled();
  });
  it("does not open a drawer from the click following an actual duration-preserving drag", () => {
    const onOpen = vi.fn(); const onCommit = vi.fn();
    render(<Harness onOpen={onOpen} onCommit={onCommit} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 44, clientY: 20 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 44, clientY: 20 });fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({ patch: { startsAt: "2026-09-07T08:15:00.000Z", endsAt: "2026-09-07T08:30:00.000Z" } });
  });
  it("clears a pointer session when the presentation is cancelled, allowing the next drag", () => {
    const onCommit = vi.fn();render(<Harness onCommit={onCommit} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 44, clientY: 20 });
    fireEvent.click(screen.getByRole("button", { name: "Cancel movement" }));
    fireEvent.pointerDown(button, { pointerId: 2, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(button, { pointerId: 2, clientX: 44, clientY: 20 });
    fireEvent.pointerUp(button, { pointerId: 2 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe("render cost of a drag", () => {
  it("keeps handler identities across renders with fresh args, yet acts on the latest committed args", () => {
    const identities = new Set<unknown>();
    function Probe({ writable, onCommit }: { readonly writable: boolean; readonly onCommit: (payload: CommitPayload) => void }) {
      // A fresh args object with fresh collections every render, as the page builds it.
      const drag = useBoardDrag({ laneOrder: ["room"], inksByLane: new Map(), pxPerHour: 96, writable, onCommit, onRejected: () => undefined });
      identities.add(drag.handlersFor);
      identities.add(drag.cancel);
      return <button type="button" {...drag.handlersFor(block)}>Booking</button>;
    }
    const first = vi.fn(); const second = vi.fn();
    const view = render(<Probe writable onCommit={first} />);
    view.rerender(<Probe writable onCommit={second} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 44, clientY: 20 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 44, clientY: 20 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    view.rerender(<Probe writable={false} onCommit={second} />);
    fireEvent.pointerDown(button, { pointerId: 2, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(button, { pointerId: 2, clientX: 44, clientY: 20 });
    fireEvent.pointerUp(button, { pointerId: 2, clientX: 44, clientY: 20 });
    expect(second).toHaveBeenCalledTimes(1);
    // One handlersFor and one cancel for the life of the hook.
    expect(identities.size).toBe(2);
  });

  it("settles pointermoves inside one quarter-hour without rendering the board", () => {
    let hookRenders = 0;
    let boardRenders = 0;
    function Board({ ghostStartMs }: { readonly ghostStartMs: number | null }) {
      boardRenders += 1;
      return <output>{ghostStartMs === null ? "idle" : new Date(ghostStartMs).toISOString()}</output>;
    }
    function Probe() {
      hookRenders += 1;
      const drag = useBoardDrag({ laneOrder: ["room"], inksByLane: new Map(), pxPerHour: 96, writable: true, onCommit: vi.fn(), onRejected: vi.fn() });
      return <><button type="button" {...drag.handlersFor(block)}>Booking</button><Board ghostStartMs={drag.ghost?.startMs ?? null} /></>;
    }
    render(<Probe />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 44, clientY: 20 }); // lift: +24 px = +15 min at 96 px/h
    expect(screen.getByRole("status").textContent).toBe("2026-09-07T08:15:00.000Z");
    const [hookAfterLift, boardAfterLift] = [hookRenders, boardRenders];
    for (const clientX of [45, 46, 47, 48, 49, 50, 51, 52, 45]) {
      fireEvent.pointerMove(button, { pointerId: 1, clientX, clientY: 20 }); // +15.6…+20 min: still the +15 slot
    }
    // React may probe the hook's owner once before bailing out; the board
    // beneath it never renders for a move that stays in the slot.
    expect(hookRenders - hookAfterLift).toBeLessThanOrEqual(1);
    expect(boardRenders).toBe(boardAfterLift);
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 60, clientY: 20 }); // +25 min → the +30 slot
    expect(boardRenders).toBe(boardAfterLift + 1);
    expect(screen.getByRole("status").textContent).toBe("2026-09-07T08:30:00.000Z");
  });
});
