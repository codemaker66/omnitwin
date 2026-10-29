import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildShowcaseTour } from "../../../lib/camera-tour.js";
import { resetAssemblyRecallForTests, useAssemblyRecallStore } from "../../../floor/assembly/recall.js";
import { grandHallDinner180 } from "../../../floor/assembly/fixture.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import {
  PRESENT_KEPT_STILL,
  PRESENT_NEEDS_A_LAYOUT,
  PRESENT_NOT_READY,
  plannerPresent,
  presentLine,
  presentName,
  pressPlannerPresent,
  usePlannerPresent,
  type PlannerPresent,
  type PlannerPresentFacts,
} from "../planner-present.js";

const TOUR = buildShowcaseTour({ width: 21, length: 10.5, height: 7 });
const AT_REST: PlannerPresentFacts = {
  reducedMotion: false, assemblyOnStage: false, assemblyActive: false, assemblyFast: false, furnished: false, tour: null,
};

/** A media query answer, for a device that does or does not ask for reduced motion. */
function mediaList(query: string, matches: boolean): MediaQueryList {
  return {
    matches, media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    dispatchEvent: () => false,
  };
}

function asksForReducedMotion(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => mediaList(query, query.includes("reduce")));
}

/** The Assembly on its stage, as GrandAssembly's mount leaves it, over the open layout's furniture. */
function assemblyOnStageOverFurniture(): void {
  act(() => {
    usePlacementStore.setState({ placedItems: grandHallDinner180().slice(0, 11) });
    useAssemblyRecallStore.setState({ onStage: true });
  });
}

beforeEach(() => {
  resetAssemblyRecallForTests();
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: "config-a" });
  useCockpitStore.getState().reset();
  useBookmarkStore.setState({ tour: null, transition: null, activeReferenceId: null, pendingNavigationId: null });
  usePlacementStore.setState({ placedItems: [] });
  useRoomDimensionsStore.setState({ dimensions: { width: 21, length: 10.5, height: 7 } });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAssemblyRecallForTests();
  usePlacementStore.setState({ placedItems: [] });
  useBookmarkStore.setState({ tour: null });
});

describe("what Present plays", () => {
  it("replays the Assembly over the drawn hall with furniture on the floor, before any tour", () => {
    expect(plannerPresent({ ...AT_REST, assemblyOnStage: true, furnished: true, tour: TOUR })).toEqual({ kind: "assembly" });
  });

  it("plays the tour where the Assembly is off its stage (a cut drawn in Capture, walking, another room)", () => {
    expect(plannerPresent({ ...AT_REST, furnished: true, tour: TOUR })).toEqual({ kind: "tour", tour: TOUR });
  });

  it("says why when nothing can play: an empty drawn hall asks for a layout, anywhere else is not ready", () => {
    expect(plannerPresent({ ...AT_REST, assemblyOnStage: true })).toEqual({ kind: "unavailable", reason: PRESENT_NEEDS_A_LAYOUT });
    expect(plannerPresent(AT_REST)).toEqual({ kind: "unavailable", reason: PRESENT_NOT_READY });
  });

  it("plays neither the Assembly nor a tour on a device that asks for reduced motion", () => {
    const still = plannerPresent({ ...AT_REST, reducedMotion: true, assemblyOnStage: true, furnished: true, tour: TOUR });
    expect(still).toEqual({ kind: "unavailable", reason: PRESENT_KEPT_STILL });
  });

  it("is the show under way while the Assembly holds the room or plays", () => {
    expect(plannerPresent({ ...AT_REST, assemblyOnStage: true, assemblyActive: true, furnished: true })).toEqual({ kind: "playing", fast: false });
    expect(plannerPresent({ ...AT_REST, assemblyOnStage: true, assemblyActive: true, assemblyFast: true, furnished: true }))
      .toEqual({ kind: "playing", fast: true });
  });

  it("names what a press does, always with the word on the button, and writes a line where there is no tooltip", () => {
    const every: readonly PlannerPresent[] = [
      { kind: "assembly" },
      { kind: "playing", fast: false },
      { kind: "playing", fast: true },
      { kind: "tour", tour: TOUR },
      { kind: "unavailable", reason: PRESENT_NOT_READY },
    ];
    expect(every.map(presentName)).toEqual([
      "Present: watch the room set itself",
      "Present is playing: press to hurry it",
      "Present is hurrying: press to go to the end",
      "Present: play the room as your guests will see it",
      PRESENT_NOT_READY,
    ]);
    for (const reason of [PRESENT_KEPT_STILL, PRESENT_NEEDS_A_LAYOUT, PRESENT_NOT_READY]) expect(reason).toMatch(/^Present /u);
    expect(every.map(presentLine)).toEqual([
      "Watch the room set itself",
      "The room is setting itself",
      "The room is setting itself",
      "Play the room as your guests will see it",
      PRESENT_NOT_READY,
    ]);
  });
});

describe("Present, pressed", () => {
  it("asks the Assembly on its stage to replay the layout, and starts no tour", () => {
    assemblyOnStageOverFurniture();
    expect(pressPlannerPresent(false)).toBe("assembly");
    expect(useAssemblyRecallStore.getState().request).toMatchObject({ configId: "config-a", reason: "replay" });
    expect(useBookmarkStore.getState().tour).toBeNull();
  });

  it("plays what the room allows at the press, not what the last render drew", () => {
    assemblyOnStageOverFurniture();
    const { result } = renderHook(() => usePlannerPresent());
    expect(result.current.kind).toBe("assembly");
    // The Assembly left its stage (Walk, Capture) after Present last drew: no request is left for it to find later.
    act(() => { useAssemblyRecallStore.setState({ onStage: false }); });
    let started: ReturnType<typeof pressPlannerPresent> = null;
    act(() => { started = pressPlannerPresent(false); });
    expect(started).toBe("tour");
    expect(useAssemblyRecallStore.getState().request).toBeNull();
    expect(useBookmarkStore.getState().tour).not.toBeNull();
  });

  it("starts the room's tour where the Assembly is off its stage", () => {
    usePlacementStore.setState({ placedItems: grandHallDinner180().slice(0, 11) });
    expect(pressPlannerPresent(false)).toBe("tour");
    expect(useBookmarkStore.getState().tour?.legs.length).toBeGreaterThan(0);
    expect(useAssemblyRecallStore.getState().request).toBeNull();
  });

  it("hurries a show under way on a press from the keys, and leaves a pointer's press to the director", () => {
    assemblyOnStageOverFurniture();
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    const before = useAssemblyRecallStore.getState().skipNonce;
    // A pointer's press was already the Skip (GrandAssembly's window listener): Present adds nothing.
    expect(pressPlannerPresent(false)).toBeNull();
    expect(useAssemblyRecallStore.getState()).toMatchObject({ fast: false, skipNonce: before, request: null });
    expect(pressPlannerPresent(true)).toBeNull();
    expect(useAssemblyRecallStore.getState()).toMatchObject({ fast: true, skipNonce: before, request: null });
    pressPlannerPresent(true);
    expect(useAssemblyRecallStore.getState()).toMatchObject({ skipNonce: before + 1, request: null });
    expect(useBookmarkStore.getState().tour).toBeNull();
  });

  it("plays nothing on a device that asks for reduced motion", () => {
    asksForReducedMotion();
    assemblyOnStageOverFurniture();
    expect(pressPlannerPresent(false)).toBeNull();
    expect(useAssemblyRecallStore.getState().request).toBeNull();
    expect(useBookmarkStore.getState().tour).toBeNull();
  });
});

describe("Present, kept current", () => {
  it("follows the Assembly onto its stage, through its show and off it again", () => {
    const { result } = renderHook(() => usePlannerPresent());
    expect(result.current.kind).toBe("tour");
    assemblyOnStageOverFurniture();
    expect(result.current).toEqual({ kind: "assembly" });
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    expect(result.current).toEqual({ kind: "playing", fast: false });
    act(() => { useAssemblyRecallStore.setState({ fast: true }); });
    expect(result.current).toEqual({ kind: "playing", fast: true });
    act(() => { useAssemblyRecallStore.setState({ active: false, fast: false, onStage: false }); });
    expect(result.current.kind).toBe("tour");
  });

  it("asks for a layout over an empty drawn hall that has no tour", () => {
    useEditorStore.setState({ space: {
      id: "hall", venueId: "venue", name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [],
    } });
    act(() => { useAssemblyRecallStore.setState({ onStage: true }); });
    const { result } = renderHook(() => usePlannerPresent());
    expect(result.current).toEqual({ kind: "unavailable", reason: PRESENT_NEEDS_A_LAYOUT });
  });

  it("is kept still on a device that asks for reduced motion", () => {
    asksForReducedMotion();
    assemblyOnStageOverFurniture();
    const { result } = renderHook(() => usePlannerPresent());
    expect(result.current).toEqual({ kind: "unavailable", reason: PRESENT_KEPT_STILL });
  });
});
