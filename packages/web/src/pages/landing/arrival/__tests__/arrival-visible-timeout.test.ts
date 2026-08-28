import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisibleTimeout } from "../arrival-visible-timeout.js";

// -----------------------------------------------------------------------------
// startVisibleTimeout — the clock the tiles stall watchdog runs on.
//
// The behaviour under test is arithmetic on a budget, so everything here is
// driven through the REAL Page Visibility API surface (an own-property shadow
// of `document.visibilityState` plus a genuine `visibilitychange` event, which
// is exactly the pair a browser produces on a tab switch) and Vitest's fake
// clock. Nothing reaches into the module's internals: if the accounting is
// wrong by a millisecond in either direction, the boundary cases below say so.
//
// happy-dom implements `visibilityState` as a prototype getter fixed at
// "visible", hence the shadow-and-delete pair rather than a global stub.
// -----------------------------------------------------------------------------

function setPageVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function restorePageVisibility(): void {
  Reflect.deleteProperty(document, "visibilityState");
}

const BUDGET_MS = 10_000;

describe("startVisibleTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    restorePageVisibility();
    vi.useRealTimers();
  });

  it("fires after the budget when the page is visible throughout", () => {
    const onElapsed = vi.fn();
    startVisibleTimeout(BUDGET_MS, onElapsed);

    vi.advanceTimersByTime(BUDGET_MS - 1);
    expect(onElapsed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("never starts counting for a page that is hidden from the first moment", () => {
    // The tab-opened-in-the-background case, which is the whole reason this
    // module exists: a middle-click loads the page with visibilityState
    // already "hidden", and requestAnimationFrame — the only thing that can
    // produce the evidence this budget is waiting for — never runs.
    setPageVisibility("hidden");
    const onElapsed = vi.fn();
    startVisibleTimeout(BUDGET_MS, onElapsed);

    vi.advanceTimersByTime(BUDGET_MS * 100);
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("spends the whole budget from the moment such a page is first shown", () => {
    setPageVisibility("hidden");
    const onElapsed = vi.fn();
    startVisibleTimeout(BUDGET_MS, onElapsed);
    vi.advanceTimersByTime(BUDGET_MS * 100);

    setPageVisibility("visible");
    vi.advanceTimersByTime(BUDGET_MS - 1);
    expect(onElapsed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("banks visible time across any number of hide/show cycles", () => {
    // Four watched quarters with long absences between them still add up to
    // exactly one budget — the accounting must neither leak nor double-count.
    const quarter = BUDGET_MS / 4;
    const onElapsed = vi.fn();
    startVisibleTimeout(BUDGET_MS, onElapsed);

    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(quarter);
      setPageVisibility("hidden");
      vi.advanceTimersByTime(BUDGET_MS * 10);
      setPageVisibility("visible");
    }
    expect(onElapsed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(quarter - 1);
    expect(onElapsed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("does not fire while hidden, however long the page stays away", () => {
    const onElapsed = vi.fn();
    startVisibleTimeout(BUDGET_MS, onElapsed);
    vi.advanceTimersByTime(BUDGET_MS - 1);

    setPageVisibility("hidden");
    vi.advanceTimersByTime(BUDGET_MS * 1000);
    expect(onElapsed).not.toHaveBeenCalled();

    // …and the single remaining millisecond is still owed on return.
    setPageVisibility("visible");
    vi.advanceTimersByTime(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("fires at most once", () => {
    const onElapsed = vi.fn();
    startVisibleTimeout(BUDGET_MS, onElapsed);
    vi.advanceTimersByTime(BUDGET_MS * 10);
    setPageVisibility("hidden");
    setPageVisibility("visible");
    vi.advanceTimersByTime(BUDGET_MS * 10);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("cancel() stops it, and leaves no timer and no listener behind", () => {
    const onElapsed = vi.fn();
    const handle = startVisibleTimeout(BUDGET_MS, onElapsed);
    handle.cancel();

    expect(vi.getTimerCount()).toBe(0);
    // A leaked visibilitychange listener would re-arm a timeout nobody is
    // waiting on any more — the exact shape the watchdog's `terminal` flag
    // exists to prevent, so it must not be reintroduced underneath it.
    setPageVisibility("hidden");
    setPageVisibility("visible");
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(BUDGET_MS * 10);
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("cancel() is idempotent, and a no-op after it has fired", () => {
    const onElapsed = vi.fn();
    const handle = startVisibleTimeout(BUDGET_MS, onElapsed);
    vi.advanceTimersByTime(BUDGET_MS);
    expect(onElapsed).toHaveBeenCalledTimes(1);

    handle.cancel();
    handle.cancel();
    vi.advanceTimersByTime(BUDGET_MS * 10);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("cancelling while hidden also detaches — nothing revives on return", () => {
    setPageVisibility("hidden");
    const onElapsed = vi.fn();
    const handle = startVisibleTimeout(BUDGET_MS, onElapsed);
    handle.cancel();

    setPageVisibility("visible");
    vi.advanceTimersByTime(BUDGET_MS * 10);
    expect(onElapsed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
