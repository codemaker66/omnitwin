import { describe, it, expect, beforeEach } from "vitest";
import { usePlacementStore } from "../placement-store.js";
import { resetPlacedIdCounter, GRID_SPACING_RENDER, createPlacedItem } from "../../lib/placement.js";

const tableId = "round-table-6ft";
const chairId = "banquet-chair";
const platformId = "platform";

function resetStore(): void {
  resetPlacedIdCounter();
  usePlacementStore.setState({
    placedItems: [],
    undoStack: [],
    ghostPosition: null,
    ghostValid: false,
    snapEnabled: true,
  });
}

beforeEach(resetStore);

// ---------------------------------------------------------------------------
// Place items
// ---------------------------------------------------------------------------

describe("placeItem", () => {
  it("adds an item to placedItems", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);
  });

  it("placed item has correct catalogueItemId", () => {
    usePlacementStore.getState().placeItem(tableId, 5, -3);
    const item = usePlacementStore.getState().placedItems[0];
    expect(item?.catalogueItemId).toBe(tableId);
  });

  it("snaps to grid when snapEnabled", () => {
    usePlacementStore.getState().placeItem(tableId, 0.1, 0.1);
    const item = usePlacementStore.getState().placedItems[0];
    expect(item?.x).toBe(0);
    expect(item?.z).toBe(0);
  });

  it("does not snap when snapEnabled is false", () => {
    usePlacementStore.getState().toggleSnap();
    usePlacementStore.getState().placeItem(tableId, 0.1, 0.1);
    const item = usePlacementStore.getState().placedItems[0];
    expect(item?.x).toBe(0.1);
    expect(item?.z).toBe(0.1);
  });

  it("multiple items have unique IDs", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(chairId, 4, 4);
    const items = usePlacementStore.getState().placedItems;
    expect(items).toHaveLength(2);
    expect(items[0]?.id).not.toBe(items[1]?.id);
  });
});

// ---------------------------------------------------------------------------
// Remove items
// ---------------------------------------------------------------------------

describe("removeItem", () => {
  it("removes an item by ID", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";
    usePlacementStore.getState().removeItem(id);
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });

  it("does nothing for unknown ID", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().removeItem("nonexistent");
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Move items
// ---------------------------------------------------------------------------

describe("moveItem", () => {
  it("updates position of an item", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";
    usePlacementStore.getState().moveItem(id, GRID_SPACING_RENDER, GRID_SPACING_RENDER);
    const moved = usePlacementStore.getState().placedItems[0];
    expect(moved?.x).toBe(GRID_SPACING_RENDER);
    expect(moved?.z).toBe(GRID_SPACING_RENDER);
  });

  it("snaps moved position to grid", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";
    usePlacementStore.getState().moveItem(id, 0.1, 0.1);
    const moved = usePlacementStore.getState().placedItems[0];
    expect(moved?.x).toBe(0);
    expect(moved?.z).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rotate items
// ---------------------------------------------------------------------------

describe("rotateItem", () => {
  it("updates rotation of an item", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";
    usePlacementStore.getState().rotateItem(id, Math.PI / 4);
    const rotated = usePlacementStore.getState().placedItems[0];
    expect(rotated?.rotationY).toBe(Math.PI / 4);
  });
});

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------

describe("ghost", () => {
  it("starts with no ghost", () => {
    expect(usePlacementStore.getState().ghostPosition).toBeNull();
    expect(usePlacementStore.getState().ghostValid).toBe(false);
  });

  it("updateGhost sets position and validity", () => {
    usePlacementStore.getState().updateGhost(0, 0, tableId);
    expect(usePlacementStore.getState().ghostPosition).not.toBeNull();
    expect(usePlacementStore.getState().ghostValid).toBe(true);
  });

  it("updateGhost with out-of-bounds position marks invalid", () => {
    usePlacementStore.getState().updateGhost(999, 999, tableId);
    expect(usePlacementStore.getState().ghostValid).toBe(false);
  });

  it("updateGhost with unknown catalogue item marks invalid", () => {
    usePlacementStore.getState().updateGhost(0, 0, "nonexistent-id");
    expect(usePlacementStore.getState().ghostValid).toBe(false);
  });

  it("clearGhost resets ghost state", () => {
    usePlacementStore.getState().updateGhost(0, 0, tableId);
    usePlacementStore.getState().clearGhost();
    expect(usePlacementStore.getState().ghostPosition).toBeNull();
    expect(usePlacementStore.getState().ghostValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Snap toggle
// ---------------------------------------------------------------------------

describe("toggleSnap", () => {
  it("toggles snap enabled", () => {
    expect(usePlacementStore.getState().snapEnabled).toBe(true);
    usePlacementStore.getState().toggleSnap();
    expect(usePlacementStore.getState().snapEnabled).toBe(false);
    usePlacementStore.getState().toggleSnap();
    expect(usePlacementStore.getState().snapEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearAll
// ---------------------------------------------------------------------------

describe("clearAll", () => {
  it("removes all items and ghost", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(chairId, 4, 4);
    usePlacementStore.getState().updateGhost(2, 2, tableId);
    usePlacementStore.getState().clearAll();
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    expect(usePlacementStore.getState().ghostPosition).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe("undo", () => {
  it("starts with empty undo stack", () => {
    expect(usePlacementStore.getState().undoStack).toHaveLength(0);
    expect(usePlacementStore.getState().canUndo()).toBe(false);
  });

  it("placeItem pushes to undo stack", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    expect(usePlacementStore.getState().undoStack).toHaveLength(1);
    expect(usePlacementStore.getState().canUndo()).toBe(true);
  });

  it("undo restores previous state after place", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().undo();
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    expect(usePlacementStore.getState().canUndo()).toBe(false);
  });

  it("undo restores previous state after remove", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";
    usePlacementStore.getState().removeItem(id);
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    usePlacementStore.getState().undo();
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);
  });

  it("multiple undos restore in reverse order", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(chairId, 4, 4);
    expect(usePlacementStore.getState().placedItems).toHaveLength(2);
    usePlacementStore.getState().undo();
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);
    usePlacementStore.getState().undo();
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });

  it("undo does nothing when stack is empty", () => {
    usePlacementStore.getState().undo();
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });

  it("undo restores after toggleCloth", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";
    usePlacementStore.getState().toggleCloth(id);
    expect(usePlacementStore.getState().placedItems[0]?.clothed).toBe(true);
    usePlacementStore.getState().undo();
    expect(usePlacementStore.getState().placedItems[0]?.clothed).toBe(false);
  });

  it("undo restores after clearAll", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(chairId, 4, 4);
    usePlacementStore.getState().clearAll();
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    usePlacementStore.getState().undo();
    expect(usePlacementStore.getState().placedItems).toHaveLength(2);
  });

  it("undo restores after rotateItem", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";
    usePlacementStore.getState().rotateItem(id, Math.PI / 2);
    usePlacementStore.getState().undo();
    expect(usePlacementStore.getState().placedItems[0]?.rotationY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Remove multiple items
// ---------------------------------------------------------------------------

describe("removeItems", () => {
  it("removes multiple items at once", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(chairId, 4, 4);
    const ids = new Set(usePlacementStore.getState().placedItems.map((i) => i.id));
    usePlacementStore.getState().removeItems(ids);
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });

  it("only removes specified items", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(chairId, 4, 4);
    const firstId = usePlacementStore.getState().placedItems[0]?.id ?? "";
    usePlacementStore.getState().removeItems(new Set([firstId]));
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);
    expect(usePlacementStore.getState().placedItems[0]?.catalogueItemId).toBe(chairId);
  });

  it("does nothing for empty set", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().removeItems(new Set());
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);
    // No undo entry for no-op
    expect(usePlacementStore.getState().undoStack).toHaveLength(1);
  });

  it("undo restores after removeItems", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(chairId, 4, 4);
    const ids = new Set(usePlacementStore.getState().placedItems.map((i) => i.id));
    usePlacementStore.getState().removeItems(ids);
    usePlacementStore.getState().undo();
    expect(usePlacementStore.getState().placedItems).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// placeTableGroup on platforms
// ---------------------------------------------------------------------------

describe("placeTableGroup on platforms", () => {
  /** Place a platform directly into state at the given position. */
  function seedPlatform(x: number, z: number): void {
    const item = createPlacedItem(platformId, x, z, 0, null, 0);
    usePlacementStore.setState({
      placedItems: [...usePlacementStore.getState().placedItems, item],
    });
  }

  it("table placed on platform gets surface Y > 0", () => {
    // Platform at origin — table centre is within platform footprint
    seedPlatform(0, 0);
    usePlacementStore.getState().placeTableGroup(tableId, 0, 0, 0, 4);
    const items = usePlacementStore.getState().placedItems;
    // 1 platform + 1 table + 4 chairs = 6
    expect(items).toHaveLength(6);
    // Table should be at platform surface height (0.4)
    const table = items.find((i) => i.catalogueItemId === tableId);
    expect(table).toBeDefined();
    expect(table?.y).toBeCloseTo(0.4);
  });

  it("chairs off the platform edge get floor-level Y", () => {
    // Single narrow platform — some chairs will extend beyond its footprint
    seedPlatform(0, 0);
    usePlacementStore.getState().placeTableGroup(tableId, 0, 0, 0, 8);
    const items = usePlacementStore.getState().placedItems;
    const chairs = items.filter((i) => i.catalogueItemId === chairId);
    // At least some chairs should be off the platform
    const onPlatform = chairs.filter((c) => c.y > 0);
    const onFloor = chairs.filter((c) => c.y === 0);
    // With a single platform, we expect some chairs on platform, some on floor
    expect(onPlatform.length + onFloor.length).toBe(8);
    // Not all at the same height (the whole point of per-chair surface height)
    expect(onFloor.length).toBeGreaterThan(0);
  });

  it("does not remove existing platforms when adding table group", () => {
    seedPlatform(0, 0);
    seedPlatform(4.88, 0);
    const countBefore = usePlacementStore.getState().placedItems.length;
    expect(countBefore).toBe(2);
    usePlacementStore.getState().placeTableGroup(tableId, 2, 0, 0, 6);
    const items = usePlacementStore.getState().placedItems;
    // 2 platforms + 1 table + 6 chairs = 9
    expect(items).toHaveLength(9);
    const platforms = items.filter((i) => i.catalogueItemId === platformId);
    expect(platforms).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// moveItemsByDelta
// ---------------------------------------------------------------------------

describe("moveItemsByDelta", () => {
  it("moves items by a uniform delta without snapping", () => {
    usePlacementStore.getState().toggleSnap(); // disable snap
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(chairId, 1, 1);
    const ids = new Set(usePlacementStore.getState().placedItems.map((i) => i.id));
    usePlacementStore.getState().moveItemsByDelta(ids, 0.5, 0.5);
    const items = usePlacementStore.getState().placedItems;
    expect(items[0]?.x).toBeCloseTo(0.5);
    expect(items[0]?.z).toBeCloseTo(0.5);
    expect(items[1]?.x).toBeCloseTo(1.5);
    expect(items[1]?.z).toBeCloseTo(1.5);
  });

  it("does nothing for empty set", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().moveItemsByDelta(new Set(), 5, 5);
    expect(usePlacementStore.getState().placedItems[0]?.x).toBe(0);
  });
});
