import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    // pointerType tells a finger from a mouse, and the T-619 touch rule turns
    // on it: without it every case here would silently take the mouse path.
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

// ---------------------------------------------------------------------------
// Touch (T-619: "a finger scrolls; a long press lifts"). A block used to lift
// after 5px of travel whatever the pointer, which is the same 5px a finger
// covers starting a scroll — so a lane could not be panned on a phone.
// ---------------------------------------------------------------------------
describe("touch: a finger scrolls, a long press lifts", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not lift a block from a finger that moves straight away", () => {
    const onCommit = vi.fn(); const onOpen = vi.fn();
    render(<Harness onCommit={onCommit} onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
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
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.pointerMove(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 70 });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 70 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  // happy-dom has no scroll arbitration, so no unit test can prove a finger
  // keeps the block — e2e/diary-timetable.spec.ts does that in Chromium touch
  // emulation. What IS pinnable here is the contract: a non-passive listener
  // registered at pointerdown that decides per event.
  it("registers a non-passive touchmove listener at pointerdown, not at the lift", () => {
    render(<Harness />);
    const addSpy = vi.spyOn(document, "addEventListener");
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    const registration = addSpy.mock.calls.find(([type]) => type === "touchmove");
    expect(registration, "touchmove must be registered before the press ripens").toBeDefined();
    expect(registration?.[2]).toMatchObject({ passive: false });
  });

  // WebKit settles at touchstart whether it will wait for the page, so the
  // board's non-passive listener has to be there before any finger lands.
  it("keeps every touch holdable while the board can be dragged, and not when it is read-only", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<Harness />);
    const kept = addSpy.mock.calls.filter(([type]) => type === "touchmove");
    expect(kept, "one listener from mount, before any press").toHaveLength(1);
    expect(kept[0]?.[2]).toMatchObject({ passive: false });
    unmount();
    expect(removeSpy.mock.calls.some(([type, listener]) => type === "touchmove" && listener === kept[0]?.[1])).toBe(true);

    addSpy.mockClear();
    render(<Harness writable={false} />);
    expect(addSpy.mock.calls.some(([type]) => type === "touchmove")).toBe(false);
  });

  // A flick leaves the lane gliding; a finger that lands on it stops it. The
  // browser dispatches that touchstart uncancelable and will not let the page
  // hold the touch, so a lift would die on the first movement (Chromium 147,
  // which flings emulated swipes too). The press is the lane's.
  it("lifts nothing from a press that stopped a gliding lane, and gives the scroll back", () => {
    const onCommit = vi.fn();
    let lifted: string | null = "unset";
    function Probe() {
      const drag = useBoardDrag({ laneOrder: ["room"], inksByLane: new Map(), pxPerHour: 96, writable: true, onCommit, onRejected: vi.fn() });
      lifted = drag.liftedBlockId;
      return <button type="button" {...drag.handlersFor(block)}>Booking</button>;
    }
    render(<Probe />);
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    document.dispatchEvent(new Event("touchstart", { cancelable: false, bubbles: true }));
    act(() => { vi.advanceTimersByTime(400); });
    expect(lifted).toBeNull();
    expect(removeSpy.mock.calls.some(([type]) => type === "touchmove"), "the press stood down").toBe(true);
    const move = new Event("touchmove", { cancelable: true, bubbles: true });
    document.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(false);
    fireEvent.pointerMove(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 20 });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 20 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("still lifts from a press whose touchstart the page may cancel", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    document.dispatchEvent(new Event("touchstart", { cancelable: true, bubbles: true }));
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerMove(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 20 });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", clientX: 44, clientY: 20 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("lets the page scroll before the lift and holds it only after", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Booking" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    const touchMove = (): boolean => {
      const event = new Event("touchmove", { cancelable: true, bubbles: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(touchMove()).toBe(false);
    act(() => { vi.advanceTimersByTime(400); });
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
    render(<Harness />);
    const addSpy = vi.spyOn(document, "addEventListener");
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

  it("reports the carried block only while a finger carries it", () => {
    let lifted: string | null = "unset";
    function Probe() {
      const drag = useBoardDrag({ laneOrder: ["room"], inksByLane: new Map(), pxPerHour: 96, writable: true, onCommit: vi.fn(), onRejected: vi.fn() });
      lifted = drag.liftedBlockId;
      return <button type="button" {...drag.handlersFor(block)}>Booking</button>;
    }
    render(<Probe />);
    const button = screen.getByRole("button", { name: "Booking" });
    expect(lifted).toBeNull();
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "touch", clientX: 20, clientY: 20 });
    expect(lifted).toBeNull();
    act(() => { vi.advanceTimersByTime(400); });
    expect(lifted).toBe("booking");
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 20 });
    expect(lifted).toBeNull();
  });
});
