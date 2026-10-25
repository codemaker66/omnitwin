import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItem } from "../catalogue.js";
import { resetEditingMemoryForTesting, selectionKeyBindings, usePlannerToolKeys } from "../planner-keymap.js";
import { registerKeyBindings } from "../planner-keys.js";
import { resetPlacedIdCounter, type PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { cardParamsFor, stampSetup } from "../setup-cards.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";

// ---------------------------------------------------------------------------
// Duplicate, copy, paste and select all (card-dock Q-11; editingKeys) over
// the real stores, pressed as a browser sends the keys.
// ---------------------------------------------------------------------------

/** A press with Ctrl held, as a browser sends it: a letter key carries its character, capital with Shift. */
function ctrl(code: string, init: KeyboardEventInit = {}): void {
  const letter = code.slice(3);
  const key = init.shiftKey === true ? letter : letter.toLowerCase();
  window.dispatchEvent(new KeyboardEvent("keydown", { code, key, ctrlKey: true, bubbles: true, cancelable: true, ...init }));
}

function ToolKeys(): null {
  usePlannerToolKeys();
  return null;
}

const cleanups: (() => void)[] = [];
let pointer: { x: number; z: number } | null = null;

function round(x: number, z: number): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  return stampSetup(params, { x, z }, 0);
}

function placed(): readonly PlacedItem[] {
  return usePlacementStore.getState().placedItems;
}

function tables(): readonly PlacedItem[] {
  return placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
}

beforeEach(() => {
  resetPlacedIdCounter();
  resetEditingMemoryForTesting();
  pointer = null;
  render(<ToolKeys />);
  cleanups.push(registerKeyBindings(selectionKeyBindings({
    invalidate: () => undefined,
    cancelGesture: () => undefined,
    screenUp: () => ({ x: 0, z: -1 }),
    pointerFloor: () => pointer,
  })));
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().clearSelection();
  usePlacementNoticeStore.getState().dismiss();
  setPlannerFeaturesForTesting({ editingKeys: true, tableNumbers: true });
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  cleanup();
  setPlannerFeaturesForTesting(null);
});

describe("Ctrl D", () => {
  it("duplicates a Round of 10 one pitch away as one write: 11 new ids, a new group, the next table number, selected", () => {
    usePlacementStore.getState().placeSetup(round(-6, 0));
    const original = placed();
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    let writes = 0;
    const unsubscribe = usePlacementStore.subscribe((state, previous) => { if (state.placedItems !== previous.placedItems) writes += 1; });
    ctrl("KeyD");
    unsubscribe();
    expect(writes).toBe(1);
    const copies = placed().filter((piece) => !original.some((old) => old.id === piece.id));
    expect(copies).toHaveLength(11);
    expect(new Set(copies.map((piece) => piece.groupId)).size).toBe(1);
    expect(copies[0]?.groupId).not.toBe(original[0]?.groupId);
    expect(tables().map((table) => table.label)).toEqual(["Table 1", "Table 2"]);
    expect(useSelectionStore.getState().selectedIds).toEqual(new Set(copies.map((piece) => piece.id)));
  });

  it("goes the same way again on a repeat, copying the copies a pitch further on", () => {
    usePlacementStore.getState().placeSetup(round(-6, 0));
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyD");
    ctrl("KeyD");
    const xs = tables().map((table) => table.x);
    const zs = tables().map((table) => table.z);
    expect(xs).toHaveLength(3);
    expect((xs[2] ?? 0) - (xs[1] ?? 0)).toBeCloseTo((xs[1] ?? 0) - (xs[0] ?? 0), 9);
    expect((zs[2] ?? 0) - (zs[1] ?? 0)).toBeCloseTo((zs[1] ?? 0) - (zs[0] ?? 0), 9);
  });

  it("is refused with the reason when no pitch fits, and places nothing", () => {
    useRoomDimensionsStore.setState({ dimensions: { width: 4, length: 4, height: 4 } });
    usePlacementStore.getState().placeSetup(round(0, 0));
    const before = placed();
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyD");
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/^Won't fit/u);
  });

  it("does nothing without the switch", () => {
    setPlannerFeaturesForTesting({ editingKeys: false });
    usePlacementStore.getState().placeSetup(round(-6, 0));
    const before = placed();
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyD");
    expect(placed()).toBe(before);
  });
});

describe("Ctrl C and Ctrl V", () => {
  it("pastes the copy centred on the floor point under the pointer", () => {
    usePlacementStore.getState().placeSetup(round(-6, 0));
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyC");
    pointer = { x: 5, z: 2 };
    ctrl("KeyV");
    expect(tables()).toHaveLength(2);
    expect(tables()[1]).toMatchObject({ x: 5, z: 2, label: "Table 2" });
  });

  it("pastes nothing with the pointer off the floor", () => {
    usePlacementStore.getState().placeSetup(round(-6, 0));
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyC");
    ctrl("KeyV");
    expect(tables()).toHaveLength(1);
  });
});

describe("Ctrl A and Ctrl Shift A", () => {
  it("selects every piece, then every piece of the selected kind", () => {
    usePlacementStore.getState().placeSetup([...round(-6, 0), ...round(0, 0)]);
    ctrl("KeyA");
    expect(useSelectionStore.getState().selectedIds.size).toBe(22);
    const chair = placed().find((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "chair");
    useSelectionStore.getState().select(chair?.id ?? "");
    ctrl("KeyA", { shiftKey: true });
    expect(useSelectionStore.getState().selectedIds.size).toBe(20);
  });
});
