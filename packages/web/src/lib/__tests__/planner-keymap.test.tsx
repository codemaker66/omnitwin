import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NUDGE_METRES,
  arrowFloorDirection,
  nudgeMetres,
  placingKeyBindings,
  selectionKeyBindings,
  turnForKey,
  usePlannerToolKeys,
} from "../planner-keymap.js";
import { registerKeyBindings } from "../planner-keys.js";
import { ROTATION_SNAP_RAD } from "../selection.js";
import { createTableGroup } from "../table-group.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useMeasurementStore } from "../../stores/measurement-store.js";
import { useMarkupStore } from "../../stores/markup-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";

// ---------------------------------------------------------------------------
// The planner's keymap (T-671 slice 5; spec 11 and 4.5) over the real stores.
// ---------------------------------------------------------------------------

/** A press as a browser sends it: a letter key carries its character, capital with Shift. */
function press(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const letter = code.startsWith("Key") ? code.slice(3) : null;
  const key = letter === null ? code : init.shiftKey === true ? letter : letter.toLowerCase();
  const event = new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function ToolKeys(): null {
  usePlannerToolKeys();
  return null;
}

const SCREEN_UP_NORTH = (): { x: number; z: number } => ({ x: 0, z: -1 });
const cleanups: (() => void)[] = [];
let tableId = "";

function tableRotation(): number {
  return usePlacementStore.getState().placedItems.find((item) => item.id === tableId)?.rotationY ?? Number.NaN;
}

beforeEach(() => {
  render(<ToolKeys />);
  const table = getCatalogueItemBySlug("round-table-6ft");
  if (table === undefined) throw new Error("Missing canonical table");
  const group = createTableGroup(table.id, 0, 0, 0, 8);
  tableId = group.find((item) => item.catalogueItemId === table.id)?.id ?? "";
  usePlacementStore.setState({ placedItems: group, ghostRotation: 0 });
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().clearSelection();
  useToolStore.getState().setTool("select");
  useMeasurementStore.setState({ pendingPoint: null });
  useMarkupStore.setState({ draftStroke: null, strokes: [] });
  useCockpitStore.getState().setWalkMode(false);
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  cleanup();
});

describe("turning", () => {
  it("Q and E turn opposite ways by 15°, and R a quarter turn with Shift R back", () => {
    expect(turnForKey({ code: "KeyQ", key: "q", shiftKey: false })).toBeCloseTo(ROTATION_SNAP_RAD);
    expect(turnForKey({ code: "KeyE", key: "e", shiftKey: false })).toBeCloseTo(-ROTATION_SNAP_RAD);
    expect(turnForKey({ code: "KeyR", key: "r", shiftKey: false })).toBeCloseTo(-Math.PI / 2);
    expect(turnForKey({ code: "KeyR", key: "R", shiftKey: true })).toBeCloseTo(Math.PI / 2);
    expect(turnForKey({ code: "KeyW", key: "w", shiftKey: false })).toBeNull();
  });

  it("turns the piece in hand, not a selection held at the same time, the same way a selection turns", () => {
    let frames = 0;
    const deps = { invalidate: () => { frames += 1; }, cancelGesture: () => undefined, screenUp: SCREEN_UP_NORTH };
    cleanups.push(registerKeyBindings(selectionKeyBindings(deps)));
    cleanups.push(registerKeyBindings(placingKeyBindings(deps)));
    useSelectionStore.getState().select(tableId);
    const before = tableRotation();

    act(() => { useCatalogueStore.getState().selectItem("round-table-6ft"); });
    press("KeyQ");
    expect(usePlacementStore.getState().ghostRotation).toBeCloseTo(ROTATION_SNAP_RAD);
    expect(tableRotation()).toBeCloseTo(before);

    act(() => { useCatalogueStore.getState().clearSelection(); });
    press("KeyQ");
    expect(tableRotation()).toBeCloseTo(before + ROTATION_SNAP_RAD);
    press("KeyE");
    press("KeyE");
    expect(tableRotation()).toBeCloseTo(before - ROTATION_SNAP_RAD);
    expect(frames).toBeGreaterThan(0);
  });
});

describe("nudging", () => {
  it("moves 10 cm, 1 m with Shift and 1 cm with Alt", () => {
    expect(nudgeMetres({ shiftKey: false, altKey: false })).toBe(NUDGE_METRES.step);
    expect(nudgeMetres({ shiftKey: true, altKey: false })).toBe(1);
    expect(nudgeMetres({ shiftKey: false, altKey: true })).toBe(0.01);
    expect(NUDGE_METRES.step).toBe(0.1);
  });

  it("moves along the room axis nearest the view: Up away from the viewer, Right square to it", () => {
    // Looking north (-z), as the Room view's default does.
    expect(arrowFloorDirection("ArrowUp", { x: 0.2, z: -0.9 })).toEqual({ x: 0, z: -1 });
    expect(arrowFloorDirection("ArrowRight", { x: 0.2, z: -0.9 })).toEqual({ x: 1, z: 0 });
    expect(arrowFloorDirection("ArrowDown", { x: 0.2, z: -0.9 })).toEqual({ x: 0, z: 1 });
    expect(arrowFloorDirection("ArrowLeft", { x: 0.2, z: -0.9 })).toEqual({ x: -1, z: 0 });
    // Turned to look east (+x): Up moves east, Right moves south.
    expect(arrowFloorDirection("ArrowUp", { x: 0.95, z: 0.1 })).toEqual({ x: 1, z: 0 });
    expect(arrowFloorDirection("ArrowRight", { x: 0.95, z: 0.1 })).toEqual({ x: 0, z: 1 });
    expect(arrowFloorDirection("KeyW", { x: 0, z: -1 })).toBeNull();
  });

  it("nudges the selected table with its chairs, and only with something selected", () => {
    let frames = 0;
    cleanups.push(registerKeyBindings(selectionKeyBindings({
      invalidate: () => { frames += 1; }, cancelGesture: () => undefined, screenUp: SCREEN_UP_NORTH,
    })));
    const start = usePlacementStore.getState().placedItems.map((item) => ({ id: item.id, x: item.x, z: item.z }));

    const unclaimed = press("ArrowUp");
    expect(unclaimed.defaultPrevented).toBe(false);
    expect(frames).toBe(0);

    useSelectionStore.getState().select(tableId);
    press("ArrowUp");
    press("ArrowRight", { shiftKey: true });
    press("ArrowRight", { altKey: true });
    for (const item of usePlacementStore.getState().placedItems) {
      const was = start.find((entry) => entry.id === item.id);
      expect(item.z).toBeCloseTo((was?.z ?? 0) - 0.1);
      expect(item.x).toBeCloseTo((was?.x ?? 0) + 1.01);
    }
  });
});

describe("seats", () => {
  it("+ and − add and take away one chair at the selected table", () => {
    cleanups.push(registerKeyBindings(selectionKeyBindings({
      invalidate: () => undefined, cancelGesture: () => undefined, screenUp: SCREEN_UP_NORTH,
    })));
    const chairs = (): number => usePlacementStore.getState().placedItems.filter((item) => item.id !== tableId).length;
    useSelectionStore.getState().select(tableId);
    expect(chairs()).toBe(8);
    press("Equal", { key: "+", shiftKey: true });
    expect(chairs()).toBe(9);
    press("Minus", { key: "-" });
    press("Minus", { key: "-" });
    expect(chairs()).toBe(7);
  });
});

describe("the tools", () => {
  it("D picks up the pen; Esc lets go of a stroke, then puts the pen down", () => {
    press("KeyD");
    expect(useToolStore.getState().activeTool).toBe("draw");
    useMarkupStore.getState().beginStroke({ x: 0, z: 0 });
    press("Escape");
    expect(useMarkupStore.getState().draftStroke).toBeNull();
    expect(useToolStore.getState().activeTool).toBe("draw");
    press("Escape");
    expect(useToolStore.getState().activeTool).toBe("select");
    press("KeyD");
    press("KeyD");
    expect(useToolStore.getState().activeTool).toBe("select");
  });

  it("M toggles Measure, and Shift M does not (it is the sound's)", () => {
    press("KeyM", { shiftKey: true });
    expect(useToolStore.getState().activeTool).toBe("select");
    press("KeyM");
    expect(useToolStore.getState().activeTool).toBe("measure");
    useMeasurementStore.getState().placePoint([1, 0, 1]);
    press("Escape");
    expect(useMeasurementStore.getState().pendingPoint).toBeNull();
    expect(useToolStore.getState().activeTool).toBe("measure");
    press("Escape");
    expect(useToolStore.getState().activeTool).toBe("select");
  });

  it("A and F take up Add and put it down; V puts the piece in hand down and goes back to selecting", () => {
    press("KeyA");
    expect(useToolStore.getState().activeTool).toBe("add");
    press("KeyF");
    expect(useToolStore.getState().activeTool).toBe("select");
    press("KeyA");
    press("KeyV");
    expect(useToolStore.getState().activeTool).toBe("select");
    press("KeyF");
    expect(useToolStore.getState().activeTool).toBe("add");
    useCatalogueStore.getState().selectItem("round-table-6ft");
    press("KeyV");
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
    expect(useToolStore.getState().activeTool).toBe("select");
  });

  it("in Walk, D and A walk: the tool keys stand aside", () => {
    useCockpitStore.getState().setWalkMode(true);
    press("KeyD");
    press("KeyA");
    expect(useToolStore.getState().activeTool).toBe("select");
  });

  it("Ctrl Z takes back the last stroke while drawing, not the last change to the layout", () => {
    press("KeyD");
    useMarkupStore.getState().beginStroke({ x: 0, z: 0 });
    useMarkupStore.getState().appendPoint({ x: 1, z: 1 });
    useMarkupStore.getState().commitStroke();
    const strokes = useMarkupStore.getState().strokes.length;
    expect(strokes).toBeGreaterThan(0);
    press("KeyZ", { ctrlKey: true });
    expect(useMarkupStore.getState().strokes.length).toBe(strokes - 1);
  });
});

describe("Escape, one layer at a time", () => {
  it("puts down the piece in hand, then clears the selection", () => {
    useSelectionStore.getState().select(tableId);
    useCatalogueStore.getState().selectItem("round-table-6ft");
    press("Escape");
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
    expect(useSelectionStore.getState().selectedIds.size).toBe(1);
    press("Escape");
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("never leaves Walk", () => {
    useCockpitStore.getState().setWalkMode(true);
    press("Escape");
    expect(useCockpitStore.getState().walkMode).toBe(true);
  });
});
