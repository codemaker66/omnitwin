import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPlannerSoundForTests,
  __setPlannerContextFactoryForTests,
  getPlannerSoundSettings,
} from "../../../lib/sound-registry.js";
import { PlannerSoundReceipt, SOUND_RECEIPT_MS } from "../PlannerSoundReceipt.js";

// ---------------------------------------------------------------------------
// The receipt for Shift M (T-700, Task 14b): no sound control is ever on
// screen, so a press says what it did, for 2.4 s, in a polite status line.
// Mounted in the scene for every chrome, it also arms the planner's sound at
// the first press anywhere.
// ---------------------------------------------------------------------------

let made = 0;
let reduced = false;

function pressShiftM(): void {
  fireEvent.keyDown(document.body, { key: "M", shiftKey: true });
}

function status(): HTMLElement {
  return screen.getByRole("status");
}

beforeEach(() => {
  localStorage.clear();
  __resetPlannerSoundForTests();
  made = 0;
  reduced = false;
  vi.useFakeTimers();
  __setPlannerContextFactoryForTests(() => {
    made += 1;
    return null;
  });
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: reduced && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  __setPlannerContextFactoryForTests(null);
  __resetPlannerSoundForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

describe("the Shift M receipt", () => {
  it("says nothing until a press, in a polite status that is always there to be heard", () => {
    render(<PlannerSoundReceipt />);
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(status().textContent).toBe("");
    expect(document.querySelector(".layout-live-capsule")).toBeNull();
  });

  it("shows \"Sound off · Shift M\" for 2.4 s, then \"Sound on · Shift M\" at the next press", () => {
    render(<PlannerSoundReceipt />);
    pressShiftM();
    expect(getPlannerSoundSettings().mode).toBe("off");
    expect(status().textContent).toBe("Sound off · Shift M");
    expect(status().querySelector(".layout-live-capsule")?.textContent).toBe("Sound off · Shift M");
    expect(SOUND_RECEIPT_MS).toBe(2400);
    act(() => { vi.advanceTimersByTime(SOUND_RECEIPT_MS - 1); });
    expect(status().textContent).toBe("Sound off · Shift M");
    act(() => { vi.advanceTimersByTime(1); });
    expect(status().textContent).toBe("");
    expect(document.querySelector(".layout-live-capsule")).toBeNull();
    pressShiftM();
    expect(getPlannerSoundSettings().mode).toBe("quiet");
    expect(status().textContent).toBe("Sound on · Shift M");
  });

  it("keeps a second press's receipt for its own 2.4 s", () => {
    render(<PlannerSoundReceipt />);
    pressShiftM();
    act(() => { vi.advanceTimersByTime(2_000); });
    pressShiftM();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(status().textContent).toBe("Sound on · Shift M");
    act(() => { vi.advanceTimersByTime(400); });
    expect(status().textContent).toBe("");
  });

  it("slides in, except under reduced motion, where it simply appears", () => {
    const { unmount } = render(<PlannerSoundReceipt />);
    pressShiftM();
    expect(document.querySelector(".layout-live-capsule")?.classList.contains("layout-live-notice")).toBe(true);
    unmount();
    reduced = true;
    render(<PlannerSoundReceipt />);
    pressShiftM();
    const capsule = document.querySelector(".layout-live-capsule");
    expect(capsule).not.toBeNull();
    expect(capsule?.classList.contains("layout-live-notice")).toBe(false);
  });

  it("arms the planner's sound at the first press anywhere", () => {
    render(<PlannerSoundReceipt />);
    expect(made).toBe(0);
    fireEvent.pointerDown(document.body);
    expect(made).toBe(1);
  });

  it("leaves no timer behind when it unmounts mid-receipt", () => {
    const { unmount } = render(<PlannerSoundReceipt />);
    pressShiftM();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
