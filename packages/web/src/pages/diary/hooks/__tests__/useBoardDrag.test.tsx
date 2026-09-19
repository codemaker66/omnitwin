import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useBoardDrag } from "../useBoardDrag.js";

const block = { id: "booking", title: "Briefing", spaceId: "room", startMs: Date.parse("2026-09-07T08:00Z"), endMs: Date.parse("2026-09-07T08:15Z"), isInk: false };
function Harness({ writable = true, onOpen = vi.fn(), onCommit = vi.fn() }) {
  const drag = useBoardDrag({ laneOrder: ["room"], inksByLane: new Map(), pxPerHour: 96, writable, onCommit, onRejected: vi.fn(), onOpenBlock: onOpen });
  return <><button type="button" {...drag.handlersFor(block)}>Booking</button><button type="button" onClick={drag.cancel}>Cancel movement</button></>;
}
beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    // pointerType is what tells a finger from a mouse, and the whole T-619
    // touch rule turns on it — the stub has to carry it, or every case here
    // silently exercises the mouse path.
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "";
    }
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

// ---------------------------------------------------------------------------
// Touch (T-619, §2 line 18: "a finger scrolls; a long-press lifts"). A block
// used to lift after 5px of travel regardless of pointer type, which is the
// same 5px a finger covers starting a scroll — so the lane could not be
// panned on a phone. A finger must now rest before it lifts.
// ---------------------------------------------------------------------------
describe("touch: a finger scrolls, a long press lifts", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not lift a block from a finger that moves straight away", () => {
    const onCommit = vi.fn(); const onOpen = vi.fn();
    render(<Harness onCommit={onCommit} onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    // A scroll: the finger travels well past the old 5px activation.
    fireEvent.pointerMove(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 60 });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 60 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("lifts a block once the finger has rested, then commits the move", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerMove(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 20 });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 20 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      patch: { startsAt: "2026-09-07T08:15:00.000Z", endsAt: "2026-09-07T08:30:00.000Z" },
    });
  });

  it("abandons a ripening press the finger walks away from, and never lifts late", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    act(() => { vi.advanceTimersByTime(150); });
    fireEvent.pointerMove(button, { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 70 });
    // The press must be dead, not merely deferred: letting the timer run on
    // would tear a block out of the lane mid-scroll.
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.pointerMove(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 70 });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 70 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Review fix 1. happy-dom has no scroll arbitration, so no test here can
  // prove a finger keeps the block — that evidence is the Chromium probe in
  // D:/claude/ship-friday-plan/sdd/lane5-touch-probe/. What IS pinnable, and
  // what the old code got wrong, is the contract: a non-passive listener
  // registered at pointerdown that decides per event.
  it("registers a non-passive touchmove listener at pointerdown, not at the lift", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    const registration = addSpy.mock.calls.find(([type]) => type === "touchmove");
    expect(registration, "touchmove must be registered before the press ripens").toBeDefined();
    // `passive: false` is the whole point: a passive listener's
    // preventDefault() is ignored with only a console warning.
    expect(registration?.[2]).toMatchObject({ passive: false });
  });

  it("lets the page scroll before the lift and holds it only after", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    // A real cancelable event through the real listener: `defaultPrevented`
    // is exactly what the browser consults to decide whether to pan.
    const touchMove = (): boolean => {
      const event = new Event("touchmove", { cancelable: true, bubbles: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // Still ripening: the finger is allowed to scroll.
    expect(touchMove()).toBe(false);
    act(() => { vi.advanceTimersByTime(400); });
    // Lifted: the browser's permission to pan is withdrawn, per event.
    expect(touchMove()).toBe(true);
  });

  it("gives the scroll back when the finger leaves", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 20 });
    expect(removeSpy.mock.calls.some(([type]) => type === "touchmove")).toBe(true);
  });

  it("takes no scroll listener for a mouse, which has no scroll to take", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "mouse", clientX: 20, clientY: 20 });
    expect(addSpy.mock.calls.some(([type]) => type === "touchmove")).toBe(false);
  });

  it("still opens the block from a plain tap", () => {
    const onOpen = vi.fn(); const onCommit = vi.fn();
    render(<Harness onOpen={onOpen} onCommit={onCommit} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    act(() => { vi.advanceTimersByTime(120); });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("booking");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
