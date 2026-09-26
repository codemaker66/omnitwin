import { afterEach, describe, expect, it, vi } from "vitest";
import { suppressScrollWhileLifted } from "../touch-scroll.js";

// ---------------------------------------------------------------------------
// The scroll hold a lifted block or slip takes from the browser (T-619): a
// non-passive document listener that cancels touchmove only while lifted.
// ---------------------------------------------------------------------------

function touchMove(cancelable = true): Event {
  const event = new Event("touchmove", { cancelable, bubbles: true });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("suppressScrollWhileLifted", () => {
  it("asks on every event, so the page scrolls until the lift and is held after", () => {
    let lifted = false;
    const release = suppressScrollWhileLifted(() => lifted);
    expect(touchMove().defaultPrevented).toBe(false);
    lifted = true;
    expect(touchMove().defaultPrevented).toBe(true);
    release();
  });

  it("registers as non-passive, and releases once however often it is called", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const release = suppressScrollWhileLifted(() => true);
    expect(add.mock.calls.find(([type]) => type === "touchmove")?.[2]).toMatchObject({ passive: false });
    release();
    release();
    expect(remove.mock.calls.filter(([type]) => type === "touchmove")).toHaveLength(1);
    expect(touchMove().defaultPrevented).toBe(false);
  });

  it("leaves an uncancelable event alone rather than calling preventDefault into the void", () => {
    const release = suppressScrollWhileLifted(() => true);
    const event = touchMove(false);
    expect(event.defaultPrevented).toBe(false);
    release();
  });
});
