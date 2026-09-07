import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useBoardDrag } from "../useBoardDrag.js";

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
