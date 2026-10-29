import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { placedItemToEditor } from "../../../components/editor/EditorBridge.js";
import { currentFurniturePresentation } from "../../presentation-channel.js";
import {
  EMPTY_ROOM,
  HOLD_CAP_MS,
  HOLD_LIMIT_MS,
  REPLAY_SETTLE_MS,
  hasSeenLayout,
  hurryAssembly,
  markLayoutSeen,
  requestAssemblyReplay,
  resetAssemblyRecallForTests,
  skipAssemblyToEnd,
  speedUpAssembly,
  takeHold,
  useAssemblyRecall,
  useAssemblyRecallStore,
} from "../recall.js";
import { grandHallDinner180 } from "../fixture.js";

const objects = grandHallDinner180().slice(0, 11).map((item) => placedItemToEditor(item, undefined));

/** A saved layout finishing its load, as loadConfiguration sets the store. */
function openLayout(configId: string): void {
  act(() => {
    useEditorStore.setState({ isLoading: true });
    useEditorStore.setState({ configId, objects, isLoading: false, error: null });
  });
}

function request(): ReturnType<typeof useAssemblyRecallStore.getState>["request"] {
  return useAssemblyRecallStore.getState().request;
}

beforeEach(() => {
  resetAssemblyRecallForTests();
  useEditorStore.setState({ configId: null, objects: [], isLoading: false, isDirty: false, error: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAssemblyRecallForTests();
  usePlacementStore.setState({ placedItems: [] });
});

/** The Assembly on its stage over furniture, as GrandAssembly's mount leaves it: a replay asked for now is taken up. */
function onStageOverFurniture(): void {
  usePlacementStore.setState({ placedItems: grandHallDinner180().slice(0, 11) });
  act(() => { useAssemblyRecallStore.setState({ onStage: true }); });
}

describe("Layout Recall: a saved layout that opens assembles itself", () => {
  it("changes nothing where the device has not asked for the Assembly", () => {
    renderHook(() => { useAssemblyRecall(false, false, false); });
    openLayout("config-a");
    expect(request()).toBeNull();
    expect(currentFurniturePresentation()).toBeNull();
  });

  it("asks for the Assembly and holds the room empty the moment a layout opens", () => {
    renderHook(() => { useAssemblyRecall(true, true, false); });
    openLayout("config-a");
    expect(request()).toMatchObject({ configId: "config-a", reason: "open" });
    expect(currentFurniturePresentation()).toBe(EMPTY_ROOM);
  });

  it("plays a layout that finished loading before the planner was told", () => {
    openLayout("config-b");
    expect(request()).toBeNull();
    renderHook(() => { useAssemblyRecall(true, true, false); });
    expect(request()).toMatchObject({ configId: "config-b", reason: "open" });
  });

  it("plays a layout that was open before the planner's code had even loaded", () => {
    // The load finished while nothing was listening.
    useEditorStore.setState({ configId: "config-early", objects, isLoading: false, error: null });
    resetAssemblyRecallForTests();
    renderHook(() => { useAssemblyRecall(true, true, false); });
    expect(request()).toMatchObject({ configId: "config-early", reason: "open" });
    expect(currentFurniturePresentation()).toBe(EMPTY_ROOM);
  });

  it("does not replay a reload of the same layout (a save conflict)", () => {
    renderHook(() => { useAssemblyRecall(true, true, false); });
    openLayout("config-a");
    act(() => { useAssemblyRecallStore.setState({ request: null }); });
    openLayout("config-a");
    expect(request()).toBeNull();
    openLayout("config-c");
    expect(request()).toMatchObject({ configId: "config-c" });
  });

  it("lets the layout be seen as placed when the room is not one the Assembly plays in", () => {
    const { rerender } = renderHook(({ stage, elsewhere }) => { useAssemblyRecall(true, stage, elsewhere); }, {
      initialProps: { stage: false, elsewhere: false },
    });
    openLayout("config-a");
    expect(currentFurniturePresentation()).toBe(EMPTY_ROOM);
    rerender({ stage: false, elsewhere: true });
    expect(currentFurniturePresentation()).toBeNull();
    expect(request()).toBeNull();
  });

  it("never hides a layout for good: an untaken hold lapses, a taken one stays", () => {
    vi.useFakeTimers();
    renderHook(() => { useAssemblyRecall(true, false, false); });
    openLayout("config-a");
    act(() => { vi.advanceTimersByTime(HOLD_LIMIT_MS + 1); });
    expect(currentFurniturePresentation()).toBeNull();
    expect(request()).toBeNull();
    openLayout("config-d");
    takeHold();
    act(() => { vi.advanceTimersByTime(HOLD_LIMIT_MS * 3); });
    expect(currentFurniturePresentation()).toBe(EMPTY_ROOM);
  });

  it("keeps the hold while the Assembly's stage or code is still on its way, however slow the first load", () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ stage, coming }) => { useAssemblyRecall(true, stage, false, coming); }, {
      initialProps: { stage: false, coming: true },
    });
    openLayout("config-a");
    act(() => { vi.advanceTimersByTime(HOLD_LIMIT_MS * 3); });
    expect(currentFurniturePresentation()).toBe(EMPTY_ROOM);
    expect(request()).toMatchObject({ configId: "config-a", reason: "open" });
    rerender({ stage: true, coming: false });
    expect(request()).toMatchObject({ configId: "config-a", reason: "open" });
  });

  it("gives the Assembly the whole limit to take the hold once its stage is there", () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ stage, coming }) => { useAssemblyRecall(true, stage, false, coming); }, {
      initialProps: { stage: false, coming: true },
    });
    openLayout("config-a");
    act(() => { vi.advanceTimersByTime(HOLD_LIMIT_MS - 100); });
    rerender({ stage: true, coming: false });
    act(() => { vi.advanceTimersByTime(HOLD_LIMIT_MS - 1); });
    expect(request()).toMatchObject({ configId: "config-a" });
    expect(currentFurniturePresentation()).toBe(EMPTY_ROOM);
    act(() => { vi.advanceTimersByTime(2); });
    expect(request()).toBeNull();
    expect(currentFurniturePresentation()).toBeNull();
  });

  it("still never hides a layout for good: a stage that never arrives lets it go at the cap", () => {
    vi.useFakeTimers();
    renderHook(() => { useAssemblyRecall(true, false, false, true); });
    openLayout("config-a");
    act(() => { vi.advanceTimersByTime(HOLD_CAP_MS - 1); });
    expect(currentFurniturePresentation()).toBe(EMPTY_ROOM);
    act(() => { vi.advanceTimersByTime(2); });
    expect(currentFurniturePresentation()).toBeNull();
    expect(request()).toBeNull();
  });

  it("opens a layout this device has already seen as placed (the first-open rule)", () => {
    markLayoutSeen("config-seen");
    renderHook(() => { useAssemblyRecall(true, true, false); });
    openLayout("config-seen");
    expect(request()).toBeNull();
    expect(currentFurniturePresentation()).toBeNull();
  });

  it("plays a seen layout again where the device plays on every open (?assembly=accio)", () => {
    markLayoutSeen("config-seen");
    renderHook(() => { useAssemblyRecall(true, true, false, false, true); });
    openLayout("config-seen");
    expect(request()).toMatchObject({ configId: "config-seen", reason: "open" });
    expect(currentFurniturePresentation()).toBe(EMPTY_ROOM);
  });

  it("replays a seen layout when Present asks", () => {
    markLayoutSeen("config-a");
    useEditorStore.setState({ configId: "config-a" });
    onStageOverFurniture();
    expect(requestAssemblyReplay()).toBe(true);
    expect(request()).toMatchObject({ configId: "config-a", reason: "replay" });
  });

  it("counts a layout this device furnished and saved as seen", () => {
    act(() => { useEditorStore.setState({ configId: "config-mine", objects, isLoading: false, isDirty: true }); });
    expect(hasSeenLayout("config-mine")).toBe(false);
    act(() => { useEditorStore.setState({ isDirty: false }); });
    expect(hasSeenLayout("config-mine")).toBe(true);
  });

  it("does not count a layout that merely loaded after another was edited", () => {
    act(() => { useEditorStore.setState({ configId: "config-a", objects, isLoading: false, isDirty: true }); });
    act(() => { useEditorStore.setState({ configId: "config-b", objects, isLoading: false, isDirty: false }); });
    expect(hasSeenLayout("config-b")).toBe(false);
  });

  it("remembers the latest 200 layouts and shrugs off a damaged list", () => {
    for (let i = 0; i < 205; i += 1) markLayoutSeen(`config-${String(i)}`);
    expect(hasSeenLayout("config-0")).toBe(false);
    expect(hasSeenLayout("config-204")).toBe(true);
    window.localStorage.setItem("venviewer.assembly.seen", "{not json");
    expect(hasSeenLayout("config-204")).toBe(false);
    markLayoutSeen("config-1");
    expect(hasSeenLayout("config-1")).toBe(true);
  });

  it("speeds the show up only while it plays, and sends it to its end on the second press", () => {
    speedUpAssembly();
    expect(useAssemblyRecallStore.getState().fast).toBe(false);
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    speedUpAssembly();
    expect(useAssemblyRecallStore.getState().fast).toBe(true);
    const before = useAssemblyRecallStore.getState().skipNonce;
    skipAssemblyToEnd();
    expect(useAssemblyRecallStore.getState().skipNonce).toBe(before + 1);
  });

  it("replays the open layout on request", () => {
    useEditorStore.setState({ configId: "config-a" });
    onStageOverFurniture();
    expect(requestAssemblyReplay()).toBe(true);
    expect(request()).toMatchObject({ configId: "config-a", reason: "replay" });
  });

  it("asks for a replay only where the Assembly can take it up: on its stage, at rest, over furniture", () => {
    useEditorStore.setState({ configId: "config-a" });
    usePlacementStore.setState({ placedItems: grandHallDinner180().slice(0, 11) });
    // Nothing on its stage: a request would sit until the Assembly next mounted, and play then.
    expect(requestAssemblyReplay()).toBe(false);
    act(() => { useAssemblyRecallStore.setState({ onStage: true, active: true }); });
    // Mid-show: a request would start the show over.
    expect(requestAssemblyReplay()).toBe(false);
    act(() => { useAssemblyRecallStore.setState({ active: false, request: { nonce: 99, configId: "config-a", reason: "open" } }); });
    // An opening not yet taken up stays the one the Assembly plays (and marks seen).
    expect(requestAssemblyReplay()).toBe(false);
    expect(request()).toMatchObject({ nonce: 99, reason: "open" });
    act(() => { useAssemblyRecallStore.setState({ request: null }); });
    usePlacementStore.setState({ placedItems: [] });
    // An empty floor: the hold would wait for furniture that is not coming.
    expect(requestAssemblyReplay()).toBe(false);
    expect(request()).toBeNull();
    expect(currentFurniturePresentation()).toBeNull();
  });

  it("asks for no replay in the moment the show gives the room back: that press was meant for the show", () => {
    useEditorStore.setState({ configId: "config-a" });
    onStageOverFurniture();
    const now = vi.spyOn(performance, "now").mockReturnValue(10_000);
    act(() => { useAssemblyRecallStore.setState({ restedAt: 10_000 - REPLAY_SETTLE_MS + 1 }); });
    expect(requestAssemblyReplay()).toBe(false);
    expect(request()).toBeNull();
    now.mockReturnValue(10_001);
    expect(requestAssemblyReplay()).toBe(true);
    expect(request()).toMatchObject({ reason: "replay" });
  });

  it("hurries the show only while it plays: at speed on the first press, to its end on the second", () => {
    const before = useAssemblyRecallStore.getState().skipNonce;
    hurryAssembly();
    expect(useAssemblyRecallStore.getState()).toMatchObject({ fast: false, skipNonce: before });
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    hurryAssembly();
    expect(useAssemblyRecallStore.getState()).toMatchObject({ fast: true, skipNonce: before });
    hurryAssembly();
    expect(useAssemblyRecallStore.getState().skipNonce).toBe(before + 1);
  });

  it("lets the furniture go when the planner closes", () => {
    const { unmount } = renderHook(() => { useAssemblyRecall(true, true, false); });
    openLayout("config-a");
    unmount();
    expect(currentFurniturePresentation()).toBeNull();
    expect(useAssemblyRecallStore.getState()).toMatchObject({ request: null, active: false });
  });
});
