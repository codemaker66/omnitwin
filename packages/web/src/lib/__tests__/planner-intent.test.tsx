import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { PLANNER_INTENT_REST_MS, usePlannerIntent } from "../planner-intent.js";

// ---------------------------------------------------------------------------
// Reaching for a Plan link fetches the planner's code for the next page
// (T-685): a pointer at rest for 100 ms, focus or a press; never a pointer the
// link merely scrolled under, and never a touch sliding past.
// ---------------------------------------------------------------------------

function PlanLink(): ReactElement {
  const intent = usePlannerIntent();
  return <a href="/plan" {...intent}>Plan</a>;
}

const prefetch = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  prefetch.mockClear();
  Object.defineProperty(window, "__vvPlannerPrefetch", { configurable: true, value: prefetch });
});

// globals: false in vitest.config, so auto-cleanup is not installed.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "__vvPlannerPrefetch");
});

function link(): HTMLElement {
  render(<PlanLink />);
  return screen.getByRole("link", { name: "Plan" });
}

describe("planner intent", () => {
  it("fetches once a pointer has rested on the link for 100 ms", () => {
    const plan = link();
    fireEvent.pointerMove(plan, { pointerType: "mouse" });
    vi.advanceTimersByTime(PLANNER_INTENT_REST_MS - 1);
    expect(prefetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("waits again while the pointer keeps moving, and not at all once it leaves", () => {
    const plan = link();
    fireEvent.pointerMove(plan, { pointerType: "mouse" });
    vi.advanceTimersByTime(60);
    fireEvent.pointerMove(plan, { pointerType: "mouse" });
    vi.advanceTimersByTime(60);
    expect(prefetch).not.toHaveBeenCalled();
    fireEvent.pointerLeave(plan);
    vi.advanceTimersByTime(500);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("fetches at once on a press or keyboard focus", () => {
    const plan = link();
    fireEvent.pointerDown(plan, { pointerType: "touch" });
    expect(prefetch).toHaveBeenCalledTimes(1);
    fireEvent.focus(plan);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("ignores a touch sliding over the link", () => {
    fireEvent.pointerMove(link(), { pointerType: "touch" });
    vi.advanceTimersByTime(500);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("drops a pending wait when the link goes away", () => {
    const plan = link();
    fireEvent.pointerMove(plan, { pointerType: "mouse" });
    cleanup();
    vi.advanceTimersByTime(500);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("does nothing where index.html defined no fetch, as in development", () => {
    Reflect.deleteProperty(window, "__vvPlannerPrefetch");
    const plan = link();
    expect(() => { fireEvent.focus(plan); }).not.toThrow();
  });
});
