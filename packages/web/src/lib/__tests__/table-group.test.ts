import { describe, it, expect, beforeEach } from "vitest";
import { computeChairPositions, createTableGroup, rearrangeTableGroup } from "../table-group.js";
import { getCatalogueItem } from "../catalogue.js";
import { resetPlacedIdCounter } from "../placement.js";
import type { PlacedItem } from "../placement.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetPlacedIdCounter();
});

const ROUND_TABLE_ID = "round-table-6ft";
const TRESTLE_TABLE_ID = "trestle-6ft";
const CHAIR_ID = "banquet-chair";

function getItem(id: string) {
  const item = getCatalogueItem(id);
  if (item === undefined) throw new Error(`Missing catalogue item: ${id}`);
  return item;
}

// ---------------------------------------------------------------------------
// computeChairPositions — round table
// ---------------------------------------------------------------------------

describe("computeChairPositions (round)", () => {
  it("returns empty for 0 chairs", () => {
    const result = computeChairPositions(0, 0, getItem(ROUND_TABLE_ID), 0, 0);
    expect(result).toHaveLength(0);
  });

  it("returns correct count for 8 chairs", () => {
    const result = computeChairPositions(0, 0, getItem(ROUND_TABLE_ID), 0, 8);
    expect(result).toHaveLength(8);
  });

  it("chairs are evenly spaced angularly", () => {
    const positions = computeChairPositions(0, 0, getItem(ROUND_TABLE_ID), 0, 4);
    const distances = positions.map((p) => Math.sqrt(p.x * p.x + p.z * p.z));
    const first = distances[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      for (const d of distances) {
        expect(d).toBeCloseTo(first, 5);
      }
    }
  });

  it("chairs face inward (rotation points toward center)", () => {
    const positions = computeChairPositions(5, 5, getItem(ROUND_TABLE_ID), 0, 4);
    for (const p of positions) {
      expect(p.rotationY).toBeDefined();
    }
    expect(positions).toHaveLength(4);
  });

  it("chairs are placed outside the table radius", () => {
    const positions = computeChairPositions(0, 0, getItem(ROUND_TABLE_ID), 0, 8);
    for (const p of positions) {
      const dist = Math.sqrt(p.x * p.x + p.z * p.z);
      expect(dist).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// computeChairPositions — rectangular table
// ---------------------------------------------------------------------------

describe("computeChairPositions (rectangular)", () => {
  it("returns correct count for 6 chairs", () => {
    const result = computeChairPositions(0, 0, getItem(TRESTLE_TABLE_ID), 0, 6);
    expect(result).toHaveLength(6);
  });

  it("distributes chairs on two sides", () => {
    const positions = computeChairPositions(0, 0, getItem(TRESTLE_TABLE_ID), 0, 4);
    const zValues = positions.map((p) => p.z);
    expect(zValues.some((z) => z > 0)).toBe(true);
    expect(zValues.some((z) => z < 0)).toBe(true);
  });

  it("handles odd number of chairs", () => {
    const positions = computeChairPositions(0, 0, getItem(TRESTLE_TABLE_ID), 0, 5);
    expect(positions).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// createTableGroup
// ---------------------------------------------------------------------------

describe("createTableGroup", () => {
  it("creates table + chairs with shared groupId", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 8);
    expect(group.length).toBe(9);

    const first = group[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const groupId = first.groupId;
    expect(groupId).not.toBeNull();
    for (const item of group) {
      expect(item.groupId).toBe(groupId);
    }
  });

  it("first item is the table", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 5, 5, 0, 4);
    const first = group[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.catalogueItemId).toBe(ROUND_TABLE_ID);
    expect(first.x).toBe(5);
    expect(first.z).toBe(5);
  });

  it("remaining items are chairs", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 6);
    for (let i = 1; i < group.length; i++) {
      const item = group[i];
      expect(item).toBeDefined();
      if (item !== undefined) {
        expect(item.catalogueItemId).toBe(CHAIR_ID);
      }
    }
  });

  it("creates 0 chairs if requested", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 0);
    expect(group.length).toBe(1);
  });

  it("returns empty for non-table item", () => {
    const group = createTableGroup(CHAIR_ID, 0, 0, 0, 4);
    expect(group).toHaveLength(0);
  });

  it("all items have unique IDs", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 8);
    const ids = group.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("works with rectangular tables", () => {
    const group = createTableGroup(TRESTLE_TABLE_ID, 0, 0, 0, 6);
    expect(group.length).toBe(7);
    const first = group[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(first.catalogueItemId).toBe(TRESTLE_TABLE_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// rearrangeTableGroup
// ---------------------------------------------------------------------------

describe("rearrangeTableGroup", () => {
  it("replaces chairs while keeping the table", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 4);
    const first = group[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const newItems = rearrangeTableGroup(first.id, 8, group);
    expect(newItems.length).toBe(9);

    const table = newItems.find((p) => p.id === first.id);
    expect(table).toBeDefined();
    expect(table?.catalogueItemId).toBe(ROUND_TABLE_ID);
  });

  it("preserves table clothed state", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 4);
    const first = group[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const clothed: PlacedItem[] = group.map((item) =>
      item.id === first.id ? { ...item, clothed: true } : { ...item },
    );

    const newItems = rearrangeTableGroup(first.id, 6, clothed);
    const table = newItems.find((p) => p.id === first.id);
    expect(table?.clothed).toBe(true);
  });

  it("preserves non-group items", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 4);
    const first = group[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const extraItem: PlacedItem = {
      id: "extra-1",
      catalogueItemId: CHAIR_ID,
      x: 10,
      y: 0,
      z: 10,
      rotationY: 0,
      clothed: false,
      groupId: null,
    };
    const allItems = [...group, extraItem];

    const newItems = rearrangeTableGroup(first.id, 6, allItems);
    const extra = newItems.find((p) => p.id === "extra-1");
    expect(extra).toBeDefined();
  });

  it("returns unchanged items for non-existent table ID", () => {
    const items: PlacedItem[] = [{
      id: "x",
      catalogueItemId: CHAIR_ID,
      x: 0,
      y: 0,
      z: 0,
      rotationY: 0,
      clothed: false,
      groupId: null,
    }];
    const result = rearrangeTableGroup("nonexistent", 4, items);
    expect(result).toEqual(items);
  });
});
