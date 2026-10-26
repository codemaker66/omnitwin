import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EveningSource } from "../evening-state.js";

// ---------------------------------------------------------------------------
// The evening (T-674, v2 slice 10; spec 6.2, 8, 11, 12; frames 03 and 11).
// ---------------------------------------------------------------------------

const { Evening } = await import("../Evening.js");
const { useEveningStore } = await import("../evening-state.js");
const { useHallTimeStore } = await import("../../../stores/hall-time-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");
const { useSelectionStore } = await import("../../../stores/selection-store.js");
const { usePlannerChromeStore } = await import("../../../stores/planner-chrome-store.js");
const { timedActs } = await import("../../../lib/evening-acts.js");
const { readRememberedHour } = await import("../../../lib/evening-memory.js");
const { venueDayOf, xAtTime } = await import("../../../lib/evening-window.js");
const { subscribeSoundAttempts } = await import("../../../lib/sound-registry.js");
const { LIDAR_CREDIT } = await import("../../editor/cockpit/HallSunDial.js");

const t = (iso: string): number => Date.parse(iso);
const AT_1930 = t("2026-11-28T19:30:00Z");
const AT_2141 = t("2026-11-28T21:41:00Z");
const EVENING_SPAN = { start: t("2026-11-28T17:00:00Z"), end: t("2026-11-29T01:15:00Z") };
const ACTS = timedActs([
  { id: "a", name: "Arrival", startsAt: "2026-11-28T18:30:00.000Z", durationMinutes: 45, sortOrder: 1 },
  { id: "b", name: "Dinner", startsAt: "2026-11-28T19:15:00.000Z", durationMinutes: 90, sortOrder: 2 },
  { id: "c", name: "Speeches", startsAt: "2026-11-28T20:45:00.000Z", durationMinutes: 30, sortOrder: 3 },
  { id: "d", name: "Ceilidh", startsAt: "2026-11-28T21:15:00.000Z", durationMinutes: 195, sortOrder: 4 },
  { id: "e", name: "Carriages", startsAt: "2026-11-29T00:30:00.000Z", durationMinutes: 45, sortOrder: 5 },
], null);
const EVENT: EveningSource = { acts: ACTS, eventStart: AT_1930, eventLinked: true };
const NO_EVENT: EveningSource = { acts: [], eventStart: null, eventLinked: false };

function mediaList(query: string, matches: boolean): MediaQueryList {
  const list: MediaQueryList = {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  };
  return list;
}

function media({ phone = false, reduced = false }: { readonly phone?: boolean; readonly reduced?: boolean }): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => mediaList(
    query,
    (query.includes("max-width: 767px") && phone) || (query.includes("prefers-reduced-motion") && reduced),
  ));
}

/** Opens the evening from 19:30 and holds the hour at `at`, as frame 03 shows it. */
function openAt(at: number, source: EveningSource = EVENT): void {
  useEveningStore.setState({ source });
  act(() => {
    useEveningStore.getState().openEvening();
    useHallTimeStore.getState().setTime(at);
  });
}

function renderEvening(): HTMLElement {
  render(<><button type="button" data-pc-hourchip="">chip</button><Evening /></>);
  return screen.getByTestId("planner-evening");
}

function slider(): HTMLElement {
  return screen.getByRole("slider", { name: "The hour" });
}

/** The slider as wide as frame 03's line, 868 px from the left edge. */
function lineBox(element: HTMLElement): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 868, bottom: 180, width: 868, height: 180, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

beforeEach(() => {
  window.localStorage.clear();
  media({});
  useEditorStore.setState({ configId: "layout-a" });
  useHallTimeStore.setState({ mode: "set", at: AT_1930, scrubbing: false, openedFor: null, chosen: false });
  useEveningStore.setState({ open: false, from: null, wholeDay: false, source: NO_EVENT });
  usePlannerChromeStore.getState().closeAll();
  useSelectionStore.getState().clearSelection();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the evening at 21:41 (frame 03)", () => {
  it("rises with the hour, the act and one plain sentence about the sky", () => {
    openAt(AT_2141);
    const evening = renderEvening();
    expect(evening.getAttribute("role")).toBe("dialog");
    expect(evening.getAttribute("aria-label")).toBe("The evening");
    expect(within(evening).getByText("21:41", { selector: "time" })).toBeTruthy();
    expect(within(evening).getByText("Ceilidh", { selector: ".pc-evening__act span" })).toBeTruthy();
    expect(within(evening).getByText("Moon 75% lit, 10° up in the east-north-east")).toBeTruthy();
    expect(evening.dataset.pcWindow).toBe("acts");
  });

  it("is one slider that says the hour, the act and the moon", () => {
    openAt(AT_2141);
    renderEvening();
    expect(slider().getAttribute("aria-valuetext")).toBe("21:41, Ceilidh, moon 75% lit, 10 degrees up");
    expect(slider().getAttribute("aria-valuemax")).toBe(String(8 * 60 + 15));
    expect(slider().getAttribute("aria-valuenow")).toBe(String(4 * 60 + 41));
    // Opening hands the keyboard to the hour.
    expect(document.activeElement).toBe(slider());
  });

  it("labels each act at its start, and Speeches takes the second row so 21:15 sits under Ceilidh", () => {
    openAt(AT_2141);
    const evening = renderEvening();
    const drawing = within(evening).getByTestId("planner-evening-drawing");
    const label = (name: string): Element | null => [...drawing.querySelectorAll(".pc-evening__label")]
      .find((group) => group.querySelector(".pc-evening__act-name")?.textContent === name) ?? null;
    expect(["Arrival", "Dinner", "Speeches", "Ceilidh", "Carriages"].map((name) => label(name)?.getAttribute("data-row"))).toEqual(["0", "0", "1", "0", "0"]);
    expect(label("Ceilidh")?.classList.contains("is-current")).toBe(true);
    expect(label("Ceilidh")?.querySelector(".pc-evening__act-time")?.textContent).toBe("21:15");
    expect(drawing.querySelectorAll("[data-testid='planner-evening-bar-past']")).toHaveLength(3);
    expect(drawing.querySelectorAll("[data-testid='planner-evening-bar-current']")).toHaveLength(1);
    expect(within(evening).getByTestId("planner-evening-moon")).toBeTruthy();
    expect(drawing.textContent).toContain("Moonrise 20:09");
  });

  it("says what Enter keeps and where Esc returns, and carries the LiDAR credit", () => {
    openAt(AT_2141);
    const evening = renderEvening();
    const foot = evening.querySelector(".pc-evening__foot");
    expect(foot?.querySelector(".pc-evening__keys")?.textContent).toBe("[]the actsEnterkeeps 21:41Escreturns to 19:30");
    expect(foot?.querySelector(".pc-evening__credit")?.textContent).toBe(`${LIDAR_CREDIT}, OGL v3.0`);
    expect(within(evening).getByRole("link", { name: "OGL v3.0" }).getAttribute("href")).toContain("open-government-licence");
  });
});

describe("the evening's keys", () => {
  it("moves 5 minutes, an hour with Shift, steps through the acts and finds now, sunrise and sunset", () => {
    openAt(AT_2141);
    renderEvening();
    const hour = (): number => useHallTimeStore.getState().at;
    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(hour()).toBe(t("2026-11-28T21:46:00Z"));
    fireEvent.keyDown(slider(), { key: "ArrowRight", shiftKey: true });
    expect(hour()).toBe(t("2026-11-28T22:46:00Z"));
    fireEvent.keyDown(slider(), { key: "[" });
    expect(hour()).toBe(t("2026-11-28T21:15:00Z"));
    fireEvent.keyDown(slider(), { key: "[" });
    expect(hour()).toBe(t("2026-11-28T20:45:00Z"));
    fireEvent.keyDown(slider(), { key: "]" });
    fireEvent.keyDown(slider(), { key: "]" });
    expect(hour()).toBe(t("2026-11-29T00:30:00Z"));
    fireEvent.keyDown(slider(), { key: "Home" });
    expect(hour()).toBe(t("2026-11-28T08:18:00Z"));
    fireEvent.keyDown(slider(), { key: "End" });
    expect(hour()).toBe(t("2026-11-28T15:51:00Z"));
    fireEvent.keyDown(slider(), { key: "n" });
    expect(useHallTimeStore.getState().mode).toBe("now");
  });

  it("keeps the hour on Enter, remembers it for this layout and hands focus back to the chip", () => {
    openAt(AT_2141);
    renderEvening();
    fireEvent.keyDown(slider(), { key: "Enter", code: "Enter" });
    expect(useEveningStore.getState().open).toBe(false);
    expect(useHallTimeStore.getState().at).toBe(AT_2141);
    expect(readRememberedHour("layout-a")).toEqual({ mode: "set", at: AT_2141 });
    expect(document.activeElement?.hasAttribute("data-pc-hourchip")).toBe(true);
  });

  it("returns to the hour from before it opened on Esc, and hands focus back to the chip", () => {
    openAt(AT_2141);
    renderEvening();
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(useEveningStore.getState().open).toBe(false);
    expect(useHallTimeStore.getState().at).toBe(AT_1930);
    expect(readRememberedHour("layout-a")).toBeNull();
    expect(document.activeElement?.hasAttribute("data-pc-hourchip")).toBe(true);
  });

  it("makes no sound for keys", () => {
    openAt(AT_2141);
    renderEvening();
    const heard: string[] = [];
    const off = subscribeSoundAttempts((attempt) => { heard.push(attempt.id); });
    fireEvent.keyDown(slider(), { key: "[" });
    fireEvent.keyDown(slider(), { key: "ArrowRight", shiftKey: true });
    off();
    expect(heard).toEqual([]);
  });
});

describe("dragging the hour", () => {
  const x = (time: number): number => xAtTime(EVENING_SPAN, 868, time);

  it("follows the pointer one to one, and never snaps back when let go away from a stop", () => {
    openAt(AT_2141);
    renderEvening();
    lineBox(slider());
    fireEvent.pointerDown(slider(), { pointerId: 1, pointerType: "mouse", button: 0, clientX: x(t("2026-11-28T22:00:00Z")) });
    expect(useHallTimeStore.getState()).toMatchObject({ at: t("2026-11-28T22:00:00Z"), scrubbing: true });
    fireEvent.pointerMove(slider(), { pointerId: 1, pointerType: "mouse", clientX: x(t("2026-11-28T21:30:00Z")) });
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T21:30:00Z"));
    fireEvent.pointerUp(slider(), { pointerId: 1, pointerType: "mouse" });
    expect(useHallTimeStore.getState()).toMatchObject({ at: t("2026-11-28T21:30:00Z"), scrubbing: false });
  });

  it("glides to an act on dialGlide when let go within 6 minutes of it", async () => {
    openAt(AT_2141);
    renderEvening();
    lineBox(slider());
    fireEvent.pointerDown(slider(), { pointerId: 2, pointerType: "mouse", button: 0, clientX: x(t("2026-11-28T21:20:00Z")) });
    fireEvent.pointerUp(slider(), { pointerId: 2, pointerType: "mouse" });
    // Still on its way: the room follows, its reflections wait.
    expect(useHallTimeStore.getState().scrubbing).toBe(true);
    await vi.waitFor(() => {
      expect(useHallTimeStore.getState()).toMatchObject({ at: t("2026-11-28T21:15:00Z"), scrubbing: false });
    }, { timeout: 4000 });
  });

  it("sets the stop at once under reduced motion", () => {
    media({ reduced: true });
    openAt(AT_2141);
    renderEvening();
    lineBox(slider());
    fireEvent.pointerDown(slider(), { pointerId: 3, pointerType: "mouse", button: 0, clientX: x(t("2026-11-28T21:19:00Z")) });
    fireEvent.pointerUp(slider(), { pointerId: 3, pointerType: "mouse" });
    expect(useHallTimeStore.getState()).toMatchObject({ at: t("2026-11-28T21:15:00Z"), scrubbing: false });
  });

  it("clicks as it crosses an act's start", () => {
    openAt(AT_2141);
    renderEvening();
    lineBox(slider());
    const heard: string[] = [];
    const off = subscribeSoundAttempts((attempt) => { heard.push(attempt.id); });
    fireEvent.pointerDown(slider(), { pointerId: 4, pointerType: "mouse", button: 0, clientX: x(t("2026-11-28T21:00:00Z")) });
    fireEvent.pointerMove(slider(), { pointerId: 4, pointerType: "mouse", clientX: x(t("2026-11-28T21:30:00Z")) });
    fireEvent.pointerUp(slider(), { pointerId: 4, pointerType: "mouse" });
    off();
    expect(heard).toContain("planner-cue");
  });

  it("puts the hour back where the hand took it on Esc, and the evening stays open", () => {
    openAt(AT_2141);
    renderEvening();
    lineBox(slider());
    fireEvent.pointerDown(slider(), { pointerId: 5, pointerType: "mouse", button: 0, clientX: x(t("2026-11-28T23:00:00Z")) });
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(useHallTimeStore.getState()).toMatchObject({ at: AT_2141, scrubbing: false });
    expect(useEveningStore.getState().open).toBe(true);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(useEveningStore.getState().open).toBe(false);
    expect(useHallTimeStore.getState().at).toBe(AT_1930);
  });
});

describe("moving on", () => {
  it("keeps the hour and closes when a piece is selected", () => {
    openAt(AT_2141);
    renderEvening();
    act(() => { useSelectionStore.getState().select("table-8"); });
    expect(useEveningStore.getState().open).toBe(false);
    expect(useHallTimeStore.getState().at).toBe(AT_2141);
  });
});

describe("without the event's acts", () => {
  it("names the day's sun and moon on the line and offers to add the timings", () => {
    openAt(AT_2141, NO_EVENT);
    const evening = renderEvening();
    const names = [...evening.querySelectorAll(".pc-evening__act-name")].map((name) => name.textContent);
    expect(names).toEqual(["Sunrise", "Noon", "Sunset", "Moonrise"]);
    expect(evening.querySelector(".pc-evening__keys")?.textContent).toContain("sun and moon");
    const wholeDay = within(evening).getByRole("button", { name: "Whole day: No timings yet, so the whole day shows" });
    expect(wholeDay.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(evening).getByRole("button", { name: "Add your timings" }));
    expect(usePlannerChromeStore.getState().left).toBe("event-details");
  });

  it("offers the event's day when the hour is on another", () => {
    openAt(t("2026-10-26T12:00:00Z"));
    const evening = renderEvening();
    fireEvent.click(within(evening).getByRole("button", { name: "Go to Sat 28 Nov" }));
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T18:30:00Z"));
  });
});

describe("the head's tools", () => {
  it("widens the line to the whole day, 06:00 to 06:00", () => {
    openAt(AT_2141);
    const evening = renderEvening();
    fireEvent.click(within(evening).getByRole("button", { name: "Whole day" }));
    expect(evening.dataset.pcWindow).toBe("day");
    expect(slider().getAttribute("aria-valuemax")).toBe("1440");
  });

  it("moves the day from the date menu and keeps the time of the evening", () => {
    openAt(AT_2141);
    const evening = renderEvening();
    fireEvent.click(within(evening).getByRole("button", { name: "Date: Sat 28 Nov 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    const today = venueDayOf(Date.now()).start;
    expect(useHallTimeStore.getState().at).toBe(today + (AT_2141 - venueDayOf(AT_2141).start));
  });
});

describe("on a phone (frame 11)", () => {
  it("is a sheet: Done, the acts as chips with the current one marked, and Back to 19:30", () => {
    media({ phone: true, reduced: true });
    openAt(AT_2141);
    const sheet = renderEvening();
    expect(sheet.classList.contains("pc-evening--sheet")).toBe(true);
    expect(within(sheet).getByText("Moon 75% lit, 10° up, east-north-east")).toBeTruthy();
    const chips = within(sheet).getByRole("group", { name: "The acts" });
    expect(within(chips).getAllByRole("button").map((chip) => chip.textContent)).toEqual(["Arrival18:30", "Dinner19:15", "Speeches20:45", "Ceilidh21:15", "Carriages00:30"]);
    expect(within(chips).getByRole("button", { name: /Ceilidh/u }).getAttribute("aria-current")).toBe("true");
    expect(sheet.querySelector(".pc-evening__credit")?.textContent).toBe(`${LIDAR_CREDIT}, OGL v3.0`);
    fireEvent.click(within(chips).getByRole("button", { name: /Speeches/u }));
    expect(useHallTimeStore.getState().at).toBe(t("2026-11-28T20:45:00Z"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Back to 19:30" }));
    expect(useEveningStore.getState().open).toBe(false);
    expect(useHallTimeStore.getState().at).toBe(AT_1930);
  });

  it("scrubs with a sideways drag anywhere on the sheet, and Done keeps the hour", () => {
    media({ phone: true, reduced: true });
    openAt(AT_2141);
    const sheet = renderEvening();
    const head = sheet.querySelector(".pc-evening__sheet-head");
    if (!(head instanceof HTMLElement)) throw new Error("no head");
    fireEvent.pointerDown(head, { pointerId: 6, pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(head, { pointerId: 6, pointerType: "touch", clientX: 140, clientY: 102 });
    expect(useHallTimeStore.getState().at).toBeGreaterThan(AT_2141);
    fireEvent.pointerUp(head, { pointerId: 6, pointerType: "touch", clientX: 140, clientY: 102 });
    const held = useHallTimeStore.getState().at;
    // The click that ends a scrub is swallowed; the next press is a press of its own.
    const done = within(sheet).getByRole("button", { name: "Done" });
    fireEvent.pointerDown(done, { pointerId: 7, pointerType: "touch", clientX: 360, clientY: 120 });
    fireEvent.pointerUp(done, { pointerId: 7, pointerType: "touch", clientX: 360, clientY: 120 });
    fireEvent.click(done);
    expect(useEveningStore.getState().open).toBe(false);
    expect(readRememberedHour("layout-a")).toEqual({ mode: "set", at: held });
  });
});
