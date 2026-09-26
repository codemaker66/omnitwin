import { afterEach, describe, expect, it, vi } from "vitest";
import { holdScrollWhileLifted, keepTouchesHoldable } from "../touch-scroll.js";

// ---------------------------------------------------------------------------
// The scroll hold a lifted block or slip takes from the browser (T-619): a
// non-passive document listener that cancels touchmove only while lifted,
// and the browser's word, from the press's touchstart, on whether it can.
// ---------------------------------------------------------------------------

function touchEvent(type: "touchstart" | "touchmove", cancelable = true): Event {
  const event = new Event(type, { cancelable, bubbles: true });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("holdScrollWhileLifted", () => {
  it("asks on every event, so the page scrolls until the lift and is held after", () => {
    let lifted = false;
    const hold = holdScrollWhileLifted(() => lifted);
    expect(touchEvent("touchmove").defaultPrevented).toBe(false);
    lifted = true;
    expect(touchEvent("touchmove").defaultPrevented).toBe(true);
    hold.release();
  });

  it("registers as non-passive, and releases once however often it is called", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const hold = holdScrollWhileLifted(() => true);
    expect(add.mock.calls.find(([type]) => type === "touchmove")?.[2]).toMatchObject({ passive: false });
    hold.release();
    hold.release();
    expect(remove.mock.calls.filter(([type]) => type === "touchmove")).toHaveLength(1);
    expect(remove.mock.calls.filter(([type]) => type === "touchstart")).toHaveLength(1);
    expect(touchEvent("touchmove").defaultPrevented).toBe(false);
  });

  it("leaves an uncancelable event alone rather than calling preventDefault into the void", () => {
    const hold = holdScrollWhileLifted(() => true);
    const event = touchEvent("touchmove", false);
    expect(event.defaultPrevented).toBe(false);
    hold.release();
  });

  it("is holdable until the press's touchstart says otherwise, and for a pen, which sends none", () => {
    const hold = holdScrollWhileLifted(() => false);
    expect(hold.holdable()).toBe(true);
    touchEvent("touchstart", true);
    expect(hold.holdable()).toBe(true);
    hold.release();
  });

  it("is not holdable when the press's touchstart came uncancelable: a touch that stopped a glide", () => {
    const hold = holdScrollWhileLifted(() => false);
    touchEvent("touchstart", false);
    expect(hold.holdable()).toBe(false);
    hold.release();
  });

  it("takes the first touchstart as the press's own; a second finger does not change the answer", () => {
    const glide = holdScrollWhileLifted(() => false);
    touchEvent("touchstart", false);
    touchEvent("touchstart", true);
    expect(glide.holdable()).toBe(false);
    glide.release();

    const rest = holdScrollWhileLifted(() => false);
    touchEvent("touchstart", true);
    touchEvent("touchstart", false);
    expect(rest.holdable()).toBe(true);
    rest.release();
  });

  it("stops listening for the touchstart once released", () => {
    const hold = holdScrollWhileLifted(() => false);
    hold.release();
    touchEvent("touchstart", false);
    expect(hold.holdable()).toBe(true);
  });
});

describe("keepTouchesHoldable", () => {
  it("keeps a non-passive touchmove listener that cancels nothing, and releases once", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const release = keepTouchesHoldable();
    expect(add.mock.calls.find(([type]) => type === "touchmove")?.[2]).toMatchObject({ passive: false });
    expect(touchEvent("touchmove").defaultPrevented).toBe(false);
    release();
    release();
    expect(remove.mock.calls.filter(([type]) => type === "touchmove")).toHaveLength(1);
  });

  it("gives each caller its own listener, so one release cannot remove another's", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const first = keepTouchesHoldable();
    const second = keepTouchesHoldable();
    const listeners = add.mock.calls.filter(([type]) => type === "touchmove").map(([, listener]) => listener);
    expect(listeners).toHaveLength(2);
    expect(listeners[0]).not.toBe(listeners[1]);
    first();
    expect(remove.mock.calls.map(([, listener]) => listener)).toEqual([listeners[0]]);
    second();
  });
});
