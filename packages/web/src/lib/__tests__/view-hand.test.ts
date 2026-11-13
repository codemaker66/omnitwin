// A hand on the planner's view (lib/view-hand.ts): pressed pointers, a wheel turned a moment
// ago, the camera's own gesture and a piece dragged in from the catalogue all count, and the
// watcher says when the last of them leaves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { WHEEL_HOLD_MS, watchViewHand, type ViewHand } from "../view-hand.js";

function pointer(type: string, pointerId: number, buttons = 1): PointerEvent {
  return new PointerEvent(type, { pointerId, buttons, bubbles: true });
}

describe("watchViewHand", () => {
  let canvas: HTMLCanvasElement;
  let hand: ViewHand;
  let left: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    left = vi.fn<() => void>();
    hand = watchViewHand(canvas, left);
  });

  afterEach(() => {
    hand.dispose();
    canvas.remove();
    useCockpitStore.setState({ cameraInteractionActive: false });
    useCatalogueStore.setState({ dragActive: false });
    vi.useRealTimers();
  });

  it("is off until a pointer presses the canvas, and on until every pressed pointer lifts", () => {
    expect(hand.isOn(performance.now())).toBe(false);
    canvas.dispatchEvent(pointer("pointerdown", 1));
    canvas.dispatchEvent(pointer("pointerdown", 2));
    expect(hand.isOn(performance.now())).toBe(true);
    window.dispatchEvent(pointer("pointerup", 1, 0));
    expect(hand.isOn(performance.now())).toBe(true);
    expect(left).not.toHaveBeenCalled();
    window.dispatchEvent(pointer("pointercancel", 2, 0));
    expect(hand.isOn(performance.now())).toBe(false);
    expect(left).toHaveBeenCalledTimes(1);
  });

  it("forgets a pointer whose release it never heard once it moves with no button held", () => {
    canvas.dispatchEvent(pointer("pointerdown", 7));
    window.dispatchEvent(pointer("pointermove", 7, 0));
    expect(hand.isOn(performance.now())).toBe(false);
    expect(left).toHaveBeenCalledTimes(1);
  });

  it("holds the view a moment after a wheel turn, then lets it go", () => {
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    expect(hand.isOn(performance.now())).toBe(true);
    vi.advanceTimersByTime(WHEEL_HOLD_MS - 10);
    expect(left).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(hand.isOn(performance.now())).toBe(false);
    expect(left).toHaveBeenCalledTimes(1);
  });

  it("counts the camera's own gesture and a catalogue drag, and says when each ends", () => {
    useCockpitStore.setState({ cameraInteractionActive: true });
    expect(hand.isOn(performance.now())).toBe(true);
    useCockpitStore.setState({ cameraInteractionActive: false });
    expect(left).toHaveBeenCalledTimes(1);
    useCatalogueStore.setState({ dragActive: true });
    expect(hand.isOn(performance.now())).toBe(true);
    useCatalogueStore.setState({ dragActive: false });
    expect(hand.isOn(performance.now())).toBe(false);
    expect(left).toHaveBeenCalledTimes(2);
  });

  it("does not say the hand left while another part of it is still on the view", () => {
    canvas.dispatchEvent(pointer("pointerdown", 1));
    useCockpitStore.setState({ cameraInteractionActive: true });
    window.dispatchEvent(pointer("pointerup", 1, 0));
    expect(left).not.toHaveBeenCalled();
    useCockpitStore.setState({ cameraInteractionActive: false });
    expect(left).toHaveBeenCalledTimes(1);
  });

  it("stops listening once disposed", () => {
    hand.dispose();
    canvas.dispatchEvent(pointer("pointerdown", 1));
    useCockpitStore.setState({ cameraInteractionActive: true });
    expect(hand.isOn(performance.now())).toBe(false);
  });
});
