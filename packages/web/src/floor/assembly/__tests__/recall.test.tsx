import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "../../../stores/editor-store.js";
import { placedItemToEditor } from "../../../components/editor/EditorBridge.js";
import { currentFurniturePresentation } from "../../presentation-channel.js";
import {
  EMPTY_ROOM,
  HOLD_LIMIT_MS,
  requestAssemblyReplay,
  resetAssemblyRecallForTests,
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
  useEditorStore.setState({ configId: null, objects: [], isLoading: false, error: null });
});

afterEach(() => {
  vi.useRealTimers();
  resetAssemblyRecallForTests();
});

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

  it("replays the open layout on request", () => {
    useEditorStore.setState({ configId: "config-a" });
    requestAssemblyReplay();
    expect(request()).toMatchObject({ configId: "config-a", reason: "replay" });
  });

  it("lets the furniture go when the planner closes", () => {
    const { unmount } = renderHook(() => { useAssemblyRecall(true, true, false); });
    openLayout("config-a");
    unmount();
    expect(currentFurniturePresentation()).toBeNull();
    expect(useAssemblyRecallStore.getState()).toMatchObject({ request: null, active: false });
  });
});
