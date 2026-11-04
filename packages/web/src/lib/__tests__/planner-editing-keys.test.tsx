import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { PASTE_OTHER_VENUE, resetEditingMemoryForTesting, selectionKeyBindings, usePlannerToolKeys } from "../planner-keymap.js";
import { cardNeeds, registerStoreStock } from "../card-stock.js";
import type { Space } from "../../api/spaces.js";
import { useEditorStore } from "../../stores/editor-store.js";
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

/** A press with Ctrl held, as a browser sends it: a letter key carries its character, capital with Shift. The event, to ask whether the planner took it. */
function ctrl(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const letter = code.slice(3);
  const key = init.shiftKey === true ? letter : letter.toLowerCase();
  const event = new KeyboardEvent("keydown", { code, key, ctrlKey: true, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
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
    // Taken all the same, so the browser does not bookmark the page instead.
    expect(ctrl("KeyD").defaultPrevented).toBe(true);
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/^Won't fit/u);
  });

  it("copies a lectern on a riser with the riser, standing on the copy", () => {
    const deck = getCatalogueItemBySlug("staging-deck-6x4");
    const lectern = getCatalogueItemBySlug("lectern");
    if (deck === undefined || lectern === undefined) throw new Error("no deck or lectern");
    usePlacementStore.getState().placeItem(deck.id, -4, 0, 0);
    usePlacementStore.getState().placeItem(lectern.id, -4, 0, 0);
    const original = placed();
    const standing = original.find((piece) => piece.catalogueItemId === lectern.id);
    expect(standing?.y).toBeGreaterThan(0);
    useSelectionStore.getState().selectMultiple(original.map((piece) => piece.id));
    ctrl("KeyD");
    const copies = placed().filter((piece) => !original.some((old) => old.id === piece.id));
    expect(copies).toHaveLength(2);
    expect(copies.find((piece) => piece.catalogueItemId === deck.id)?.y).toBe(0);
    expect(copies.find((piece) => piece.catalogueItemId === lectern.id)?.y).toBeCloseTo(standing?.y ?? 0, 9);
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

  it("pastes nothing with the pointer off the floor, and leaves the key to the page", () => {
    usePlacementStore.getState().placeSetup(round(-6, 0));
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyC");
    expect(ctrl("KeyV").defaultPrevented).toBe(false);
    expect(tables()).toHaveLength(1);
  });

  it("leaves Ctrl C to the page while it has text selected", () => {
    const text = document.createElement("p");
    text.textContent = "Grand Hall, 21 m by 10.5 m";
    document.body.appendChild(text);
    try {
      usePlacementStore.getState().placeSetup(round(-6, 0));
      useSelectionStore.getState().select(tables()[0]?.id ?? "");
      const range = document.createRange();
      range.selectNodeContents(text);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      expect(ctrl("KeyC").defaultPrevented).toBe(false);
      pointer = { x: 5, z: 2 };
      ctrl("KeyV");
      expect(tables()).toHaveLength(1);
      window.getSelection()?.removeAllRanges();
      expect(ctrl("KeyC").defaultPrevented).toBe(true);
    } finally {
      window.getSelection()?.removeAllRanges();
      text.remove();
    }
  });
});

describe("the store's stock (B2 hard; QoL B-X1)", () => {
  let unregister: () => void = () => undefined;
  afterEach(() => { unregister(); });

  /** Stock where every piece a Round of 10 needs has exactly what one round takes. */
  function stockForOneRound(): Map<string, number> {
    const params = cardParamsFor("round");
    if (params === null) throw new Error("no round");
    return new Map(cardNeeds(params));
  }

  it("changes nothing on Ctrl D once the store holds no more, and says why", () => {
    unregister = registerStoreStock(stockForOneRound);
    usePlacementStore.getState().placeSetup(round(-6, 0));
    const before = placed();
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyD");
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/: 1 in store, this needs 2$/u);
  });

  it("changes nothing on + once the store's chairs are all at tables, and says why", () => {
    unregister = registerStoreStock(stockForOneRound);
    usePlacementStore.getState().placeSetup(round(-6, 0));
    const before = placed();
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Equal", key: "+", shiftKey: true, bubbles: true, cancelable: true }));
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/: 10 in store, this needs 11$/u);
  });
});

describe("the clipboard remembers where it was copied (QoL B-X10)", () => {
  function room(id: string, name: string, venueId: string): Space {
    return { id, venueId, name, slug: id, widthM: "21", lengthM: "10.5", heightM: "7",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }] };
  }

  it("says where a paste in another room came from", () => {
    useEditorStore.setState({ configId: "layout-hall", space: room("space-hall", "Grand Hall", "venue-1") });
    usePlacementStore.getState().placeSetup(round(-6, 0));
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyC");
    useEditorStore.setState({ configId: "layout-saloon", space: room("space-saloon", "Saloon", "venue-1") });
    pointer = { x: 4, z: 0 };
    ctrl("KeyV");
    expect(tables()).toHaveLength(2);
    expect(usePlacementNoticeStore.getState().notice).toMatchObject({ text: "Pasted 1 table from the Grand Hall", undo: true });
  });

  it("refuses a paste into another venue's layout, and takes the key", () => {
    useEditorStore.setState({ configId: "layout-hall", space: room("space-hall", "Grand Hall", "venue-1") });
    usePlacementStore.getState().placeSetup(round(-6, 0));
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyC");
    useEditorStore.setState({ configId: "layout-elsewhere", space: room("space-other", "Ballroom", "venue-2") });
    pointer = { x: 4, z: 0 };
    expect(ctrl("KeyV").defaultPrevented).toBe(true);
    expect(tables()).toHaveLength(1);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe(PASTE_OTHER_VENUE);
  });

  it("keeps Ctrl D's last way for its own layout: another layout starts afresh", () => {
    useEditorStore.setState({ configId: "layout-one", space: room("space-hall", "Grand Hall", "venue-1") });
    // Hard by the end wall, the first copy can only go the other way.
    const halfWidth = GRAND_HALL_RENDER_DIMENSIONS.width / 2;
    usePlacementStore.getState().placeSetup(round(halfWidth - 1.7, 0));
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyD");
    const [first, copy] = tables();
    expect((copy?.x ?? 0) < (first?.x ?? 0)).toBe(true);
    // A new layout: the copy goes the first way again (along the room, onwards), not the last.
    useEditorStore.setState({ configId: "layout-two" });
    usePlacementStore.setState({ placedItems: [] });
    usePlacementStore.getState().placeSetup(round(0, 0));
    useSelectionStore.getState().select(tables()[0]?.id ?? "");
    ctrl("KeyD");
    const [origin, onward] = tables();
    expect((onward?.x ?? 0) > (origin?.x ?? 0)).toBe(true);
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
