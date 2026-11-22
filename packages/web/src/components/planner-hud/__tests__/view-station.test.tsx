import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HALL_MOOD_NAMES } from "../../grand-hall/hall-mood.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useHallViewStore } from "../../../stores/hall-view-store.js";
import { usePlannerHudStore } from "../../../stores/planner-hud-store.js";
import { ViewStation } from "../ViewStation.js";

// ---------------------------------------------------------------------------
// The view, at the right of the top bar: the light's one key.
//
// The key goes round the hall's lights by a map of its own, because importing
// the hall's list would add it to what every planner downloads while this
// screen is behind its flag (see ViewStation.tsx). This holds the map to the
// list by pressing the key: one press each, in the hall's order, and round to
// the first again.
// ---------------------------------------------------------------------------

// The Grand Hall's venue reads as Trades Hall without a network request.
vi.mock("../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));

const GRAND_HALL = {
  id: "space-grand-hall", venueId: "venue-trades-hall", name: "Grand Hall", slug: "grand-hall",
  widthM: "21", lengthM: "10.5", heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
};

const FIRST_LIGHT = HALL_MOOD_NAMES[0] ?? "daylight";

function lightKey(): HTMLElement {
  return screen.getByRole("button", { name: /^The light: / });
}

beforeEach(() => {
  act(() => {
    useEditorStore.setState({ space: GRAND_HALL });
    useHallViewStore.getState().setMood(FIRST_LIGHT);
  });
});

afterEach(() => {
  cleanup();
  act(() => {
    useEditorStore.getState().reset();
    useHallViewStore.getState().setMood("daylight");
    usePlannerHudStore.setState({ sheet: null });
  });
});

describe("the light's key", () => {
  it("goes round the hall's lights in the hall's own order, one press each, and back to the first", () => {
    render(<ViewStation />);
    const lit: string[] = [];
    for (let press = 0; press < HALL_MOOD_NAMES.length; press += 1) {
      fireEvent.click(lightKey());
      lit.push(useHallViewStore.getState().mood);
    }
    expect(lit).toEqual([...HALL_MOOD_NAMES.slice(1), FIRST_LIGHT]);
    // Every light there is was reached, each once.
    expect(new Set(lit).size).toBe(HALL_MOOD_NAMES.length);
  });

  it("says the light the room is in and the one a press brings", () => {
    render(<ViewStation />);
    expect(lightKey().getAttribute("aria-label")).toBe("The light: Daylight. Press for Evening");
    expect(lightKey().textContent).toBe("Daylight");
    fireEvent.click(lightKey());
    expect(lightKey().getAttribute("aria-label")).toBe("The light: Evening. Press for Candlelight");
    fireEvent.click(lightKey());
    expect(lightKey().getAttribute("aria-label")).toBe("The light: Candlelight. Press for Daylight");
  });

  it("is the drawn Grand Hall's: another room has the tools alone", () => {
    act(() => { useEditorStore.setState({ space: { ...GRAND_HALL, id: "space-saloon", name: "Saloon", slug: "saloon" } }); });
    render(<ViewStation />);
    expect(screen.queryByRole("button", { name: /^The light: / })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "How to look at the room" })).toBeNull();
    expect(screen.getByRole("button", { name: "More tools" })).toBeTruthy();
  });
});

// Plan, Room and Walk say they are a radio group, so they work as one: a single stop in the Tab order, and the
// arrow keys go to the next view and take it (radio-keys.ts; review of 189d0c52, HB8).
describe("the three views and the keyboard", () => {
  function views(): readonly HTMLElement[] {
    return within(screen.getByRole("radiogroup", { name: "How to look at the room" })).getAllByRole("radio");
  }
  const stops = (): readonly (string | null)[] => views().map((view) => view.getAttribute("tabindex"));

  beforeEach(() => {
    act(() => { useHallViewStore.getState().setActivePreset("room"); });
  });

  it("are one stop in the Tab order: the view the room is in", () => {
    render(<ViewStation />);
    expect(views().map((view) => view.textContent)).toEqual(["Plan", "Room", "Walk"]);
    expect(stops()).toEqual(["-1", "0", "-1"]);
  });

  it("keep one stop, the first, when the camera has been moved by hand and is in none of them", () => {
    act(() => { useHallViewStore.getState().setActivePreset(null); });
    render(<ViewStation />);
    expect(views().every((view) => view.getAttribute("aria-checked") === "false")).toBe(true);
    expect(stops()).toEqual(["0", "-1", "-1"]);
  });

  it("go to the next view and take it on an arrow key, round the ends", () => {
    render(<ViewStation />);
    const [plan, room, walk] = views();
    if (plan === undefined || room === undefined || walk === undefined) throw new Error("three views");
    room.focus();
    // The key is the group's own: nothing else takes it.
    expect(fireEvent.keyDown(room, { key: "ArrowRight" })).toBe(false);
    expect(document.activeElement).toBe(walk);
    expect(useHallViewStore.getState().activePreset).toBe("walk");
    expect(useHallViewStore.getState().viewRequest?.preset).toBe("walk");
    fireEvent.keyDown(walk, { key: "ArrowRight" });
    expect(document.activeElement).toBe(plan);
    expect(useHallViewStore.getState().activePreset).toBe("plan");
    fireEvent.keyDown(plan, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(walk);
    expect(stops()).toEqual(["-1", "-1", "0"]);
  });

  it("ask for a view once for each key that lands on a new one", () => {
    render(<ViewStation />);
    const [, room] = views();
    if (room === undefined) throw new Error("three views");
    room.focus();
    const before = useHallViewStore.getState().viewRequest?.nonce ?? 0;
    // Home takes Plan (one request); the arrow comes back to Room (a second).
    fireEvent.keyDown(room, { key: "Home" });
    fireEvent.keyDown(document.activeElement ?? room, { key: "ArrowRight" });
    expect(useHallViewStore.getState().activePreset).toBe("room");
    expect((useHallViewStore.getState().viewRequest?.nonce ?? 0) - before).toBe(2);
  });
});
