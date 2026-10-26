import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EveningSource } from "../evening-state.js";

// ---------------------------------------------------------------------------
// The hour chip (T-674, v2 slice 10; spec 4.1, 6.2, 11; frames 01 and 03):
// the sun by day, the moon in its phase by night (in line until it rises);
// click or T opens the evening, even with v1's hidden tape measure still
// bound to T; a sideways drag scrubs (1 px = 2 min, Shift 10 s) and Esc puts
// the hour back; the wheel turns it 15 minutes a notch (Shift 1 minute); the
// hour kept is the one the layout opens at; the hour sets the hall's light.
// ---------------------------------------------------------------------------

const { HourChip, EVENING_KEY_PRIORITY } = await import("../HourChip.js");
const { useEveningStore } = await import("../evening-state.js");
const { useLayoutOpeningHour } = await import("../evening-hour.js");
const { useHallTimeStore } = await import("../../../stores/hall-time-store.js");
const { useHallViewStore } = await import("../../../stores/hall-view-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");
const { KEY_PRIORITY, letter, registerKeyBindings } = await import("../../../lib/planner-keys.js");
const { readRememberedHour, rememberHour } = await import("../../../lib/evening-memory.js");

const t = (iso: string): number => Date.parse(iso);
const AT_1930 = t("2026-11-28T19:30:00Z");
const NO_EVENT: EveningSource = { acts: [], eventStart: null, eventLinked: false };

beforeEach(() => {
  window.localStorage.clear();
  useEditorStore.setState({ configId: null });
  useHallTimeStore.setState({ mode: "set", at: AT_1930, scrubbing: false, openedFor: null, chosen: false });
  useEveningStore.setState({ open: false, from: null, wholeDay: false, source: NO_EVENT });
  useHallViewStore.setState({ mood: "daylight" });
});
afterEach(cleanup);

function renderChip(): HTMLElement {
  render(<MemoryRouter><div className="pc-dock"><HourChip /></div></MemoryRouter>);
  return screen.getByTestId("planner-hour-chip");
}

describe("the chip's face", () => {
  it("draws the moon in line before it rises, and says so (frame 01, 19:30)", () => {
    const chip = renderChip();
    expect(chip.getAttribute("aria-label")).toBe("Time of day 19:30, the moon not yet risen, T");
    expect(chip.textContent).toBe("19:30");
    expect(chip.querySelector(".pc-moon--down")).not.toBeNull();
  });

  it("draws the moon in its phase once it is up (frame 03, 21:41)", () => {
    useHallTimeStore.setState({ at: t("2026-11-28T21:41:00Z") });
    const chip = renderChip();
    expect(chip.getAttribute("aria-label")).toBe("Time of day 21:41, T");
    expect(chip.querySelector(".pc-moon")).not.toBeNull();
    expect(chip.querySelector(".pc-moon--down")).toBeNull();
    // Waning: the lit limb is on the left, the arc sweeping anticlockwise from the top.
    expect(chip.querySelector(".pc-moon__lit")?.getAttribute("d")).toMatch(/^M 0 -10 A 10 10 0 0 0 0 10/u);
  });

  it("shows the sun by day", () => {
    useHallTimeStore.setState({ at: t("2026-11-28T12:00:00Z") });
    const chip = renderChip();
    expect(chip.querySelector(".pc-hourchip__sun")).not.toBeNull();
    expect(chip.querySelector(".pc-moon")).toBeNull();
  });
});

describe("opening the evening", () => {
  it("opens on a click, and a click again keeps the hour and closes it", () => {
    const chip = renderChip();
    fireEvent.click(chip);
    expect(useEveningStore.getState().open).toBe(true);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(chip);
    expect(useEveningStore.getState().open).toBe(false);
  });

  it("opens on T under v2 even with v1's hidden tape measure bound to T at the planner's tier", () => {
    const tape = vi.fn();
    renderChip();
    // Registered after the chip, so a tie would go to the tape: the evening must outrank it.
    const off = registerKeyBindings([{ keys: letter("t"), priority: KEY_PRIORITY.planner, run: tape }]);
    expect(EVENING_KEY_PRIORITY).toBeGreaterThan(KEY_PRIORITY.planner);
    fireEvent.keyDown(window, { key: "t", code: "KeyT" });
    expect(useEveningStore.getState().open).toBe(true);
    expect(tape).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "T", code: "KeyT" });
    expect(useEveningStore.getState().open).toBe(false);
    off();
  });
});

describe("scrubbing on the chip", () => {
  it("moves two minutes a pixel, follows the room as it goes, and keeps the hour for the layout", () => {
    useEditorStore.setState({ configId: "layout-a" });
    rememberHour("layout-a", { mode: "set", at: AT_1930 });
    const chip = renderChip();
    fireEvent.pointerDown(chip, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100 });
    fireEvent.pointerMove(chip, { pointerId: 1, pointerType: "mouse", clientX: 130 });
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T20:30:00Z"));
    expect(useHallTimeStore.getState().scrubbing).toBe(true);
    fireEvent.pointerUp(chip, { pointerId: 1, pointerType: "mouse", clientX: 130 });
    expect(useHallTimeStore.getState().scrubbing).toBe(false);
    expect(readRememberedHour("layout-a")).toEqual({ mode: "set", at: t("2026-11-28T20:30:00Z") });
    // The press was a scrub, not a click: the evening stays closed.
    fireEvent.click(chip);
    expect(useEveningStore.getState().open).toBe(false);
  });

  it("moves ten seconds a pixel with Shift", () => {
    const chip = renderChip();
    fireEvent.pointerDown(chip, { pointerId: 2, pointerType: "mouse", button: 0, clientX: 100 });
    fireEvent.pointerMove(chip, { pointerId: 2, pointerType: "mouse", clientX: 106, shiftKey: true });
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T19:31:00Z"));
    fireEvent.pointerUp(chip, { pointerId: 2, pointerType: "mouse" });
  });

  it("is a click until the pointer has moved 4 px", () => {
    const chip = renderChip();
    fireEvent.pointerDown(chip, { pointerId: 3, pointerType: "mouse", button: 0, clientX: 100 });
    fireEvent.pointerMove(chip, { pointerId: 3, pointerType: "mouse", clientX: 102 });
    fireEvent.pointerUp(chip, { pointerId: 3, pointerType: "mouse", clientX: 102 });
    expect(useHallTimeStore.getState().at).toBe(AT_1930);
    fireEvent.click(chip);
    expect(useEveningStore.getState().open).toBe(true);
  });

  it("puts the hour back on Esc mid-scrub", () => {
    const chip = renderChip();
    fireEvent.pointerDown(chip, { pointerId: 4, pointerType: "mouse", button: 0, clientX: 100 });
    fireEvent.pointerMove(chip, { pointerId: 4, pointerType: "mouse", clientX: 160 });
    expect(useHallTimeStore.getState().at).not.toBe(AT_1930);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(useHallTimeStore.getState().at).toBe(AT_1930);
    expect(useHallTimeStore.getState().scrubbing).toBe(false);
    fireEvent.pointerUp(chip, { pointerId: 4, pointerType: "mouse" });
    fireEvent.click(chip);
    expect(useEveningStore.getState().open).toBe(false);
  });
});

describe("scrolling over the chip", () => {
  it("turns 15 minutes a notch on the quarter, and a minute with Shift, without zooming the room", () => {
    useHallTimeStore.setState({ at: t("2026-11-28T19:41:00Z") });
    const chip = renderChip();
    const notch = fireEvent.wheel(chip, { deltaY: -100, deltaMode: 0 });
    expect(notch).toBe(false);
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T19:45:00Z"));
    fireEvent.wheel(chip, { deltaY: 100, deltaMode: 0 });
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T19:30:00Z"));
    // happy-dom's WheelEvent drops modifier keys from its init, so Shift is set on the event itself.
    const fine = new WheelEvent("wheel", { deltaY: -100, deltaMode: 0, bubbles: true, cancelable: true });
    Object.defineProperty(fine, "shiftKey", { value: true });
    act(() => { chip.dispatchEvent(fine); });
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T19:31:00Z"));
  });
});

describe("the light follows the hour where the real sky is off", () => {
  it("lights the hall by candlelight at 19:30 in November and by daylight at noon", () => {
    renderChip();
    expect(useHallViewStore.getState().mood).toBe("candlelight");
    act(() => { useHallTimeStore.setState({ at: t("2026-11-28T12:00:00Z") }); });
    expect(useHallViewStore.getState().mood).toBe("daylight");
  });
});

describe("the hour a layout opens at", () => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
  const SOURCE: EveningSource = {
    acts: [{ id: "a", name: "Arrival", start: t("2026-11-28T18:30:00Z"), end: t("2026-11-28T19:15:00Z") }],
    eventStart: t("2026-11-28T19:30:00Z"),
    eventLinked: true,
  };

  it("is the hour last kept for it, then the event's first act, then now", () => {
    useEditorStore.setState({ configId: "layout-b" });
    const { rerender, unmount } = renderHook(({ source }) => { useLayoutOpeningHour(source); }, { wrapper, initialProps: { source: NO_EVENT } });
    expect(useHallTimeStore.getState().mode).toBe("now");
    rerender({ source: SOURCE });
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "set", at: t("2026-11-28T18:30:00Z") });
    unmount();

    rememberHour("layout-c", { mode: "set", at: t("2026-11-28T22:00:00Z") });
    useEditorStore.setState({ configId: "layout-c" });
    renderHook(() => { useLayoutOpeningHour(SOURCE); }, { wrapper });
    expect(useHallTimeStore.getState()).toMatchObject({ mode: "set", at: t("2026-11-28T22:00:00Z") });
  });

  it("keeps each layout's own hour: A, then B, then A", () => {
    rememberHour("layout-a", { mode: "set", at: t("2026-11-28T19:30:00Z") });
    rememberHour("layout-b", { mode: "set", at: t("2026-11-28T23:00:00Z") });
    useEditorStore.setState({ configId: "layout-a" });
    renderHook(() => { useLayoutOpeningHour(NO_EVENT); }, { wrapper });
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T19:30:00Z"));
    act(() => { useEditorStore.setState({ configId: "layout-b" }); });
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T23:00:00Z"));
    act(() => { useEditorStore.setState({ configId: "layout-a" }); });
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T19:30:00Z"));
  });
});
