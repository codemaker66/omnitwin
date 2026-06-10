import { describe, it, expect, beforeEach } from "vitest";
import { usePlacementStore } from "../placement-store.js";
import {
  resetPlacedIdCounter,
  GRID_SPACING_RENDER,
  createPlacedItem,
  getGroupMemberIds,
} from "../../lib/placement.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { useRoomDimensionsStore } from "../room-dimensions-store.js";

const tableId = "round-table-6ft";
const chairId = getCatalogueItemBySlug("banquet-chair")?.id ?? "missing-chair-id";
const platformId = "platform";

function resetStore(): void {
  resetPlacedIdCounter();
  usePlacementStore.setState({
    placedItems: [],
    ghostPosition: null,
    ghostValid: false,
    ghostInvalidReason: null,
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
// Chair brush
// ---------------------------------------------------------------------------

describe("placeChairBrush", () => {
  it("places a clean row of chairs from a floor drag", () => {
    const ids = usePlacementStore.getState().placeChairBrush(
      chairId,
      0,
      0,
      GRID_SPACING_RENDER * 5,
      0,
      0,
    );

    expect(ids.length).toBeGreaterThan(4);
    const items = usePlacementStore.getState().placedItems;
    expect(items.map((item) => item.id)).toEqual(ids);
    expect(items.every((item) => item.catalogueItemId === chairId)).toBe(true);
    expect(new Set(items.map((item) => item.z)).size).toBe(1);
  });

  it("places a block of chairs from a diagonal area drag", () => {
    const ids = usePlacementStore.getState().placeChairBrush(
      chairId,
      0,
      0,
      GRID_SPACING_RENDER * 4,
      GRID_SPACING_RENDER * 4,
      0,
    );

    expect(ids.length).toBeGreaterThan(9);
    const items = usePlacementStore.getState().placedItems;
    expect(new Set(items.map((item) => item.x)).size).toBeGreaterThan(2);
    expect(new Set(items.map((item) => item.z)).size).toBeGreaterThan(2);
  });

  it("ignores non-chair catalogue items", () => {
    const ids = usePlacementStore.getState().placeChairBrush(
      tableId,
      0,
      0,
      GRID_SPACING_RENDER * 4,
      0,
      0,
    );

    expect(ids).toHaveLength(0);
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
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
// Label items
// ---------------------------------------------------------------------------

describe("setItemLabel", () => {
  it("sets and trims a hallkeeper-visible item label", () => {
    usePlacementStore.getState().placeItem(chairId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";

    usePlacementStore.getState().setItemLabel(id, "  Bride  ");

    expect(usePlacementStore.getState().placedItems[0]?.label).toBe("Bride");
  });

  it("clears a label", () => {
    usePlacementStore.getState().placeItem(chairId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";

    usePlacementStore.getState().setItemLabel(id, "Bride");
    usePlacementStore.getState().setItemLabel(id, "");

    expect(usePlacementStore.getState().placedItems[0]?.label).toBe("");
  });

  it("leaves state untouched for an unchanged label", () => {
    usePlacementStore.getState().placeItem(chairId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";
    const itemsBefore = usePlacementStore.getState().placedItems;

    usePlacementStore.getState().setItemLabel(id, "");

    // Must not mint a new array — EditorBridge mirrors placedItems into the
    // undo timeline, so a no-op label set must not create a history entry.
    expect(usePlacementStore.getState().placedItems).toBe(itemsBefore);
  });
});

// ---------------------------------------------------------------------------
// Table dressing
// ---------------------------------------------------------------------------

describe("table dressing", () => {
  it("applies a white cloth to multiple selected tables", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(tableId, GRID_SPACING_RENDER * 2, 0);
    usePlacementStore.getState().placeItem(chairId, GRID_SPACING_RENDER * 4, 0);
    const items = usePlacementStore.getState().placedItems;
    const ids = new Set(items.map((item) => item.id));

    usePlacementStore.getState().applyTableCloth(ids, "white");

    const after = usePlacementStore.getState().placedItems;
    const tables = after.filter((item) => item.catalogueItemId === tableId);
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table.clothed).toBe(true);
      expect(table.clothStyle).toBe("white");
    }
    const chair = after.find((item) => item.catalogueItemId === chairId);
    expect(chair?.clothed).toBe(false);
    expect(chair?.clothStyle).toBeNull();
  });

  it("applies dinner table settings to selected tables only", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    usePlacementStore.getState().placeItem(chairId, GRID_SPACING_RENDER * 2, 0);
    const ids = new Set(usePlacementStore.getState().placedItems.map((item) => item.id));

    usePlacementStore.getState().applyTableSetting(ids, "dinner");

    const table = usePlacementStore.getState().placedItems.find((item) => item.catalogueItemId === tableId);
    const chair = usePlacementStore.getState().placedItems.find((item) => item.catalogueItemId === chairId);
    expect(table?.tableSetting).toBe("dinner");
    expect(chair?.tableSetting).toBeNull();
  });

  it("toggleCloth preserves legacy keyboard behavior with a black cloth", () => {
    usePlacementStore.getState().placeItem(tableId, 0, 0);
    const id = usePlacementStore.getState().placedItems[0]?.id ?? "";

    usePlacementStore.getState().toggleCloth(id);
    expect(usePlacementStore.getState().placedItems[0]?.clothed).toBe(true);
    expect(usePlacementStore.getState().placedItems[0]?.clothStyle).toBe("black");

    usePlacementStore.getState().toggleCloth(id);
    expect(usePlacementStore.getState().placedItems[0]?.clothed).toBe(false);
    expect(usePlacementStore.getState().placedItems[0]?.clothStyle).toBeNull();
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

// ---------------------------------------------------------------------------
// Table/chair group integrity
// ---------------------------------------------------------------------------

describe("table group integrity", () => {
  it("moves every labelled chair with a dragged table", () => {
    const store = usePlacementStore.getState();
    store.placeTableGroup(tableId, 0, 0, 0, 10);
    const initialItems = usePlacementStore.getState().placedItems;
    const table = initialItems.find((item) => item.catalogueItemId === tableId);
    expect(table).toBeDefined();
    if (table === undefined) throw new Error("Expected table group to include a table");

    const groupIds = getGroupMemberIds(table.id, initialItems);
    expect(groupIds.size).toBe(11);

    let labelIndex = 1;
    for (const id of groupIds) {
      usePlacementStore.getState().setItemLabel(id, id === table.id ? "Presidents" : `Seat ${String(labelIndex)}`);
      if (id !== table.id) labelIndex += 1;
    }

    const labelledItems = usePlacementStore.getState().placedItems;
    const before = new Map<string, { readonly x: number; readonly z: number; readonly label: string }>();
    for (const item of labelledItems) {
      if (groupIds.has(item.id)) {
        before.set(item.id, { x: item.x, z: item.z, label: item.label ?? "" });
      }
    }

    const primaryBefore = labelledItems.find((item) => item.id === table.id);
    expect(primaryBefore).toBeDefined();
    if (primaryBefore === undefined) throw new Error("Expected labelled table to still exist");

    usePlacementStore.getState().moveItem(
      table.id,
      primaryBefore.x + GRID_SPACING_RENDER * 2,
      primaryBefore.z + GRID_SPACING_RENDER,
    );
    const primaryAfterSnap = usePlacementStore.getState().placedItems.find((item) => item.id === table.id);
    expect(primaryAfterSnap).toBeDefined();
    if (primaryAfterSnap === undefined) throw new Error("Expected moved table to still exist");

    const effectiveDx = primaryAfterSnap.x - primaryBefore.x;
    const effectiveDz = primaryAfterSnap.z - primaryBefore.z;
    const otherIds = new Set<string>();
    for (const id of groupIds) {
      if (id !== table.id) otherIds.add(id);
    }
    usePlacementStore.getState().moveItemsByDelta(otherIds, effectiveDx, effectiveDz);

    const movedItems = usePlacementStore.getState().placedItems;
    for (const id of groupIds) {
      const itemBefore = before.get(id);
      const itemAfter = movedItems.find((item) => item.id === id);
      expect(itemBefore).toBeDefined();
      expect(itemAfter).toBeDefined();
      if (itemBefore === undefined || itemAfter === undefined) {
        throw new Error("Expected every original table-group member after move");
      }
      expect(itemAfter.x).toBeCloseTo(itemBefore.x + effectiveDx);
      expect(itemAfter.z).toBeCloseTo(itemBefore.z + effectiveDz);
      expect(itemAfter.label).toBe(itemBefore.label);
    }
  });

  it("ungroups a partially selected table ring as a whole group", () => {
    const store = usePlacementStore.getState();
    store.placeTableGroup(tableId, 0, 0, 0, 6);
    const initialItems = usePlacementStore.getState().placedItems;
    const firstChair = initialItems.find((item) => item.catalogueItemId === chairId);
    expect(firstChair).toBeDefined();
    if (firstChair === undefined) throw new Error("Expected table group to include chairs");

    const groupIds = getGroupMemberIds(firstChair.id, initialItems);
    expect(groupIds.size).toBe(7);

    usePlacementStore.getState().ungroupItems(new Set([firstChair.id]));

    const after = usePlacementStore.getState().placedItems;
    for (const id of groupIds) {
      const item = after.find((candidate) => candidate.id === id);
      expect(item?.groupId).toBeNull();
    }
  });

  it("regroups an existing table ring without leaving chairs behind", () => {
    const store = usePlacementStore.getState();
    store.placeTableGroup(tableId, 0, 0, 0, 4);
    store.placeItem(chairId, GRID_SPACING_RENDER * 6, GRID_SPACING_RENDER * 6);
    const initialItems = usePlacementStore.getState().placedItems;
    const table = initialItems.find((item) => item.catalogueItemId === tableId);
    const standaloneChair = initialItems.find((item) => item.groupId === null && item.catalogueItemId === chairId);
    expect(table).toBeDefined();
    expect(standaloneChair).toBeDefined();
    if (table === undefined || standaloneChair === undefined) {
      throw new Error("Expected table group and standalone chair");
    }

    const originalGroupIds = getGroupMemberIds(table.id, initialItems);
    usePlacementStore.getState().groupItems(new Set([table.id, standaloneChair.id]));

    const after = usePlacementStore.getState().placedItems;
    const regroupedTable = after.find((item) => item.id === table.id);
    expect(regroupedTable?.groupId).not.toBeNull();
    const newGroupId = regroupedTable?.groupId ?? null;
    expect(newGroupId).not.toBeNull();

    for (const id of originalGroupIds) {
      const item = after.find((candidate) => candidate.id === id);
      expect(item?.groupId).toBe(newGroupId);
    }
    const regroupedStandalone = after.find((item) => item.id === standaloneChair.id);
    expect(regroupedStandalone?.groupId).toBe(newGroupId);
  });
});

// ---------------------------------------------------------------------------
// Auto-arrange a banquet
// ---------------------------------------------------------------------------

describe("autoArrangeBanquet", () => {
  beforeEach(() => {
    // A deterministic 20 m × 10 m room (render units = metres × 2).
    useRoomDimensionsStore.setState({ dimensions: { width: 40, length: 20, height: 7 } });
  });

  it("fills the room with table groups for a target guest count", () => {
    usePlacementStore.getState().autoArrangeBanquet(tableId, 40, 8); // 40 / 8 = 5 tables
    const items = usePlacementStore.getState().placedItems;
    const tables = items.filter((i) => i.catalogueItemId === tableId);
    const chairs = items.filter((i) => i.catalogueItemId === chairId);
    expect(tables).toHaveLength(5);
    expect(chairs.length).toBeGreaterThan(0);
    // Each table sits in its own group.
    expect(new Set(tables.map((t) => t.groupId)).size).toBe(5);
  });

  it("replaces the existing layout", () => {
    usePlacementStore.getState().placeItem(platformId, 0, 0);
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);

    usePlacementStore.getState().autoArrangeBanquet(tableId, 16, 8); // 2 tables
    const after = usePlacementStore.getState().placedItems;
    expect(after.some((i) => i.catalogueItemId === platformId)).toBe(false);
    expect(after.filter((i) => i.catalogueItemId === tableId)).toHaveLength(2);
  });

  it("ignores a non-table catalogue id", () => {
    usePlacementStore.getState().autoArrangeBanquet(chairId, 40, 8);
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });

  it("does nothing in a room too small for any table", () => {
    useRoomDimensionsStore.setState({ dimensions: { width: 2, length: 2, height: 7 } });
    usePlacementStore.getState().autoArrangeBanquet(tableId, 40, 8);
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });
});
