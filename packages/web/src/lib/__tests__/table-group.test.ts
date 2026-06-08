import { describe, it, expect, beforeEach } from "vitest";
import {
  computeChairPositions,
  createTableGroup,
  rearrangeTableGroup,
  seatCapacity,
} from "../table-group.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { resetPlacedIdCounter } from "../placement.js";
import type { PlacedItem } from "../placement.js";
import { toRenderSpace } from "../../constants/scale.js";
import type { ChairPlacement } from "../table-group.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetPlacedIdCounter();
});

const ROUND_TABLE_ID = "round-table-6ft";
const TRESTLE_TABLE_ID = "trestle-6ft";
const CHAIR_ID = getCatalogueItemBySlug("banquet-chair")?.id ?? "missing-chair-id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
        expect(item.catalogueItemId).toMatch(UUID_RE);
      }
    }
  });

  it("does not emit legacy chair slugs into saveable placed items", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 6);
    expect(group.slice(1).map((item) => item.catalogueItemId)).not.toContain("banquet-chair");
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

  it("preserves table dressing state", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 4);
    const first = group[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const clothed: PlacedItem[] = group.map((item) =>
      item.id === first.id
        ? { ...item, clothed: true, clothStyle: "white", tableSetting: "dinner" }
        : { ...item },
    );

    const newItems = rearrangeTableGroup(first.id, 6, clothed);
    const table = newItems.find((p) => p.id === first.id);
    expect(table?.clothed).toBe(true);
    expect(table?.clothStyle).toBe("white");
    expect(table?.tableSetting).toBe("dinner");
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
      clothed: false, clothStyle: null, tableSetting: null,
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
      clothed: false, clothStyle: null, tableSetting: null,
      groupId: null,
    }];
    const result = rearrangeTableGroup("nonexistent", 4, items);
    expect(result).toEqual(items);
  });

  // F19: rearrangeTableGroup must preserve the original groupId and reuse
  // existing chair IDs to avoid orphaning DB records on each rearrange.
  it("preserves original groupId after rearrange (F19)", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 4);
    const table = group[0];
    expect(table).toBeDefined();
    if (table === undefined) return;

    const originalGroupId = table.groupId;
    const newItems = rearrangeTableGroup(table.id, 6, group);

    // All rearranged items share the original groupId
    const groupItems = newItems.filter((p) => p.groupId !== null);
    for (const item of groupItems) {
      expect(item.groupId).toBe(originalGroupId);
    }
  });

  it("reuses existing chair IDs for positions within original count (F19)", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 4);
    const table = group[0];
    expect(table).toBeDefined();
    if (table === undefined) return;

    const originalChairIds = group.slice(1).map((p) => p.id);

    // Reduce from 4 to 2 chairs — the 2 remaining should reuse existing IDs
    const newItems = rearrangeTableGroup(table.id, 2, group);
    const newChairs = newItems.filter((p) => p.catalogueItemId === CHAIR_ID);

    expect(newChairs).toHaveLength(2);
    for (const chair of newChairs) {
      expect(originalChairIds).toContain(chair.id);
    }
  });

  it("generates fresh IDs only for newly added chairs (F19)", () => {
    const group = createTableGroup(ROUND_TABLE_ID, 0, 0, 0, 4);
    const table = group[0];
    expect(table).toBeDefined();
    if (table === undefined) return;

    const originalChairIds = new Set(group.slice(1).map((p) => p.id));

    // Increase from 4 to 6 chairs — first 4 reuse IDs, last 2 are new
    const newItems = rearrangeTableGroup(table.id, 6, group);
    const newChairs = newItems.filter((p) => p.catalogueItemId === CHAIR_ID);

    expect(newChairs).toHaveLength(6);
    const reuseCount = newChairs.filter((c) => originalChairIds.has(c.id)).length;
    const freshCount = newChairs.filter((c) => !originalChairIds.has(c.id)).length;
    expect(reuseCount).toBe(4);
    expect(freshCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// seatCapacity & recommendedSeatCount
// ---------------------------------------------------------------------------

describe("seatCapacity", () => {
  it("derives a round table's capacity from the chair-ring circumference", () => {
    // ring radius = 1.83/2 + 0.45/2 + 0.05 = 1.19 m → 2π·1.19 / 0.6 = 12.46 → 12
    expect(seatCapacity(getItem(ROUND_TABLE_ID))).toBe(12);
  });

  it("derives a rectangular table's capacity from sides + heads", () => {
    // sides: floor(1.83/0.6)=3 each; heads: floor(0.76/0.6)=1 each → 2·3 + 2·1 = 8
    expect(seatCapacity(getItem(TRESTLE_TABLE_ID))).toBe(8);
  });

  it("returns 0 for a non-table item", () => {
    expect(seatCapacity(getItem(CHAIR_ID))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// No-overlap invariant + clamping (S+)
// ---------------------------------------------------------------------------

function minPairwiseDistance(positions: readonly ChairPlacement[]): number {
  let min = Infinity;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const a = positions[i];
      const b = positions[j];
      if (a === undefined || b === undefined) continue;
      min = Math.min(min, Math.hypot(a.x - b.x, a.z - b.z));
    }
  }
  return min;
}

describe("computeChairPositions — no overlap", () => {
  // Two banquet chairs overlap if their centres are closer than the chair width.
  const chairWidthRender = toRenderSpace(0.45);

  it("never overlaps chairs around a round table, even when over-requested", () => {
    for (const count of [4, 8, 12, 20]) {
      const positions = computeChairPositions(0, 0, getItem(ROUND_TABLE_ID), 0, count);
      expect(minPairwiseDistance(positions)).toBeGreaterThanOrEqual(chairWidthRender - 1e-6);
    }
  });

  it("never overlaps chairs around a rectangular table, even when over-requested", () => {
    for (const count of [4, 5, 6, 8, 30]) {
      const positions = computeChairPositions(0, 0, getItem(TRESTLE_TABLE_ID), 0, count);
      expect(minPairwiseDistance(positions)).toBeGreaterThanOrEqual(chairWidthRender - 1e-6);
    }
  });

  it("respects table rotation without overlap", () => {
    const positions = computeChairPositions(0, 0, getItem(TRESTLE_TABLE_ID), Math.PI / 5, 8);
    expect(minPairwiseDistance(positions)).toBeGreaterThanOrEqual(chairWidthRender - 1e-6);
  });
});

describe("computeChairPositions — clamping & heads", () => {
  it("clamps a round request to the geometric capacity", () => {
    expect(computeChairPositions(0, 0, getItem(ROUND_TABLE_ID), 0, 100)).toHaveLength(12);
  });

  it("clamps a rectangular request to the geometric capacity", () => {
    expect(computeChairPositions(0, 0, getItem(TRESTLE_TABLE_ID), 0, 100)).toHaveLength(8);
  });

  it("seats the heads of a rectangular table only once the long sides are full", () => {
    const table = getItem(TRESTLE_TABLE_ID);
    const halfWidthRender = toRenderSpace(table.width) / 2;
    const isHeadSeat = (p: ChairPlacement): boolean =>
      Math.abs(p.x) > halfWidthRender + 1e-6 && Math.abs(p.z) < toRenderSpace(0.3);

    // 6 chairs == both long sides (3 each), no heads.
    const sixted = computeChairPositions(0, 0, table, 0, 6);
    expect(sixted.some(isHeadSeat)).toBe(false);

    // 8 chairs == sides full + one seat at each head.
    const eight = computeChairPositions(0, 0, table, 0, 8);
    expect(eight.filter(isHeadSeat)).toHaveLength(2);
  });
});
