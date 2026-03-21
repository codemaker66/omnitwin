import { describe, it, expect, beforeEach } from "vitest";
import {
  GRID_SPACING_M,
  GRID_SPACING_RENDER,
  PLACEMENT_COLOR_VALID,
  PLACEMENT_COLOR_INVALID,
  snapToGrid,
  snapPositionToGrid,
  isWithinRoomBounds,
  computeRotatedFootprint,
  generatePlacedId,
  resetPlacedIdCounter,
  createPlacedItem,
  placedItemRealPosition,
  checkCollision,
  getGroupMemberIds,
  computeSurfaceHeight,
  snapToPlatformEdge,
} from "../placement.js";
import type { PlacedItem } from "../placement.js";
import { toRenderSpace, toRealWorld, RENDER_SCALE } from "../../constants/scale.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import type { CatalogueItem } from "../catalogue.js";

// A small test item: 1m × 0.5m × 1m real-world
const smallItem: CatalogueItem = {
  id: "test-small",
  name: "Small Table",
  category: "table",
  width: 1,
  height: 0.5,
  depth: 1,
  color: "#aaaaaa",
  tableShape: "rectangular",
  maxCount: null,
};

// A large item: 3m × 0.75m × 3m real-world
const largeItem: CatalogueItem = {
  id: "test-large",
  name: "Large Dance Floor",
  category: "other",
  width: 3,
  height: 0.05,
  depth: 3,
  color: "#222222",
  tableShape: null,
  maxCount: null,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("placement constants", () => {
  it("GRID_SPACING_M is 1", () => {
    expect(GRID_SPACING_M).toBe(1);
  });

  it("GRID_SPACING_RENDER is GRID_SPACING_M * RENDER_SCALE", () => {
    expect(GRID_SPACING_RENDER).toBe(GRID_SPACING_M * RENDER_SCALE);
  });

  it("colours are hex strings", () => {
    expect(PLACEMENT_COLOR_VALID).toMatch(/^#/);
    expect(PLACEMENT_COLOR_INVALID).toMatch(/^#/);
  });
});

// ---------------------------------------------------------------------------
// snapToGrid
// ---------------------------------------------------------------------------

describe("snapToGrid", () => {
  it("snaps to nearest grid line", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(GRID_SPACING_RENDER)).toBe(GRID_SPACING_RENDER);
  });

  it("rounds to nearest grid line", () => {
    const half = GRID_SPACING_RENDER / 2;
    // Just above midpoint → rounds up
    expect(snapToGrid(half + 0.01)).toBe(GRID_SPACING_RENDER);
    // Just below midpoint → rounds down
    expect(snapToGrid(half - 0.01)).toBe(0);
  });

  it("works with negative values", () => {
    expect(snapToGrid(-GRID_SPACING_RENDER)).toBe(-GRID_SPACING_RENDER);
  });

  it("snaps zero correctly", () => {
    expect(snapToGrid(0.1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// snapPositionToGrid
// ---------------------------------------------------------------------------

describe("snapPositionToGrid", () => {
  it("returns [snapped x, 0, snapped z]", () => {
    const result = snapPositionToGrid(0.1, 0.1);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it("Y is always 0", () => {
    const result = snapPositionToGrid(10, -5);
    expect(result[1]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeRotatedFootprint
// ---------------------------------------------------------------------------

describe("computeRotatedFootprint", () => {
  it("no rotation: halfW = renderWidth/2, halfD = renderDepth/2", () => {
    const { halfW, halfD } = computeRotatedFootprint(smallItem, 0);
    expect(halfW).toBeCloseTo(toRenderSpace(smallItem.width) / 2);
    expect(halfD).toBeCloseTo(toRenderSpace(smallItem.depth) / 2);
  });

  it("90° rotation swaps width and depth", () => {
    const rectItem: CatalogueItem = { ...smallItem, width: 2, depth: 1 };
    const { halfW, halfD } = computeRotatedFootprint(rectItem, Math.PI / 2);
    expect(halfW).toBeCloseTo(toRenderSpace(1) / 2);
    expect(halfD).toBeCloseTo(toRenderSpace(2) / 2);
  });

  it("180° rotation gives same result as 0°", () => {
    const a = computeRotatedFootprint(smallItem, 0);
    const b = computeRotatedFootprint(smallItem, Math.PI);
    expect(b.halfW).toBeCloseTo(a.halfW);
    expect(b.halfD).toBeCloseTo(a.halfD);
  });
});

// ---------------------------------------------------------------------------
// isWithinRoomBounds
// ---------------------------------------------------------------------------

describe("isWithinRoomBounds", () => {
  it("center of room is valid", () => {
    expect(isWithinRoomBounds(0, 0, smallItem)).toBe(true);
  });

  it("item at room edge is valid if it fits", () => {
    const { width } = GRAND_HALL_RENDER_DIMENSIONS;
    const halfItemW = toRenderSpace(smallItem.width) / 2;
    const maxX = width / 2 - halfItemW;
    expect(isWithinRoomBounds(maxX, 0, smallItem)).toBe(true);
  });

  it("item past room edge is invalid", () => {
    const { width } = GRAND_HALL_RENDER_DIMENSIONS;
    // Place way past the right wall
    expect(isWithinRoomBounds(width, 0, smallItem)).toBe(false);
  });

  it("item past left wall is invalid", () => {
    const { width } = GRAND_HALL_RENDER_DIMENSIONS;
    expect(isWithinRoomBounds(-width, 0, smallItem)).toBe(false);
  });

  it("item past front wall is invalid", () => {
    const { length } = GRAND_HALL_RENDER_DIMENSIONS;
    expect(isWithinRoomBounds(0, length, smallItem)).toBe(false);
  });

  it("large item at center is valid", () => {
    expect(isWithinRoomBounds(0, 0, largeItem)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generatePlacedId / createPlacedItem
// ---------------------------------------------------------------------------

describe("generatePlacedId", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("generates sequential IDs", () => {
    expect(generatePlacedId()).toBe("placed-1");
    expect(generatePlacedId()).toBe("placed-2");
    expect(generatePlacedId()).toBe("placed-3");
  });

  it("resetPlacedIdCounter resets to 1", () => {
    generatePlacedId();
    generatePlacedId();
    resetPlacedIdCounter();
    expect(generatePlacedId()).toBe("placed-1");
  });
});

describe("createPlacedItem", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("creates a placed item with correct fields", () => {
    const item = createPlacedItem("round-table-6ft", 5, -3, Math.PI / 4);
    expect(item.id).toBe("placed-1");
    expect(item.catalogueItemId).toBe("round-table-6ft");
    expect(item.x).toBe(5);
    expect(item.z).toBe(-3);
    expect(item.rotationY).toBe(Math.PI / 4);
  });

  it("defaults rotation to 0", () => {
    const item = createPlacedItem("banquet-chair", 0, 0);
    expect(item.rotationY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// placedItemRealPosition
// ---------------------------------------------------------------------------

describe("placedItemRealPosition", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("converts render-space position to real-world metres", () => {
    const item = createPlacedItem("test", 10, -6);
    const real = placedItemRealPosition(item);
    expect(real.x).toBeCloseTo(toRealWorld(10));
    expect(real.z).toBeCloseTo(toRealWorld(-6));
  });

  it("origin stays at origin", () => {
    const item = createPlacedItem("test", 0, 0);
    const real = placedItemRealPosition(item);
    expect(real.x).toBe(0);
    expect(real.z).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkCollision
// ---------------------------------------------------------------------------

describe("checkCollision", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("returns false when no other items exist", () => {
    expect(checkCollision(0, 0, smallItem, 0, [], new Set())).toBe(false);
  });

  it("returns true when items overlap", () => {
    const placed: PlacedItem[] = [createPlacedItem("round-table-6ft", 0, 0)];
    // Place another item at the same position — they overlap
    expect(checkCollision(0, 0, smallItem, 0, placed, new Set())).toBe(true);
  });

  it("returns false when items are far apart", () => {
    const placed: PlacedItem[] = [createPlacedItem("round-table-6ft", 0, 0)];
    // Place far away
    expect(checkCollision(20, 20, smallItem, 0, placed, new Set())).toBe(false);
  });

  it("excludes items in excludeIds set", () => {
    const item = createPlacedItem("round-table-6ft", 0, 0);
    const placed: PlacedItem[] = [item];
    // Same position but excluded — no collision
    expect(checkCollision(0, 0, smallItem, 0, placed, new Set([item.id]))).toBe(false);
  });

  it("detects overlap with nearby items", () => {
    // Round table at origin (1.83m diameter, render radius = 1.83)
    const placed: PlacedItem[] = [createPlacedItem("round-table-6ft", 0, 0)];
    // Place small item (1m = 2 render units, halfW = 1) close to table
    // Table halfW ~ 1.83, smallItem halfW = 1. Overlap if centers < 2.83
    expect(checkCollision(toRenderSpace(1), 0, smallItem, 0, placed, new Set())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getGroupMemberIds
// ---------------------------------------------------------------------------

describe("getGroupMemberIds", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("returns single ID for ungrouped item", () => {
    const item = createPlacedItem("round-table-6ft", 0, 0);
    const ids = getGroupMemberIds(item.id, [item]);
    expect(ids.size).toBe(1);
    expect(ids.has(item.id)).toBe(true);
  });

  it("returns all group members", () => {
    const items: PlacedItem[] = [
      { ...createPlacedItem("round-table-6ft", 0, 0), groupId: "g1" },
      { ...createPlacedItem("banquet-chair", 1, 0), groupId: "g1" },
      { ...createPlacedItem("banquet-chair", -1, 0), groupId: "g1" },
      createPlacedItem("banquet-chair", 5, 5), // ungrouped
    ];

    const first = items[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const ids = getGroupMemberIds(first.id, items);
    expect(ids.size).toBe(3);
  });

  it("returns just the item for nonexistent ID", () => {
    const ids = getGroupMemberIds("nonexistent", []);
    expect(ids.size).toBe(1);
    expect(ids.has("nonexistent")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createPlacedItem with groupId
// ---------------------------------------------------------------------------

describe("createPlacedItem groupId", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("defaults groupId to null", () => {
    const item = createPlacedItem("round-table-6ft", 0, 0);
    expect(item.groupId).toBeNull();
  });

  it("accepts a groupId", () => {
    const item = createPlacedItem("round-table-6ft", 0, 0, 0, "my-group");
    expect(item.groupId).toBe("my-group");
  });
});

// ---------------------------------------------------------------------------
// createPlacedItem with y
// ---------------------------------------------------------------------------

describe("createPlacedItem y position", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("defaults y to 0", () => {
    const item = createPlacedItem("round-table-6ft", 0, 0);
    expect(item.y).toBe(0);
  });

  it("accepts a y position", () => {
    const item = createPlacedItem("platform", 0, 0, 0, null, 0.4);
    expect(item.y).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// Platform / stage item for stacking tests
// ---------------------------------------------------------------------------

const platformItem: CatalogueItem = {
  id: "platform",
  name: "Platform",
  category: "stage",
  width: 2.44,
  height: 0.40,
  depth: 1.22,
  color: "#4a4a4a",
  tableShape: null,
  maxCount: null,
};

// ---------------------------------------------------------------------------
// computeSurfaceHeight
// ---------------------------------------------------------------------------

describe("computeSurfaceHeight", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("returns 0 when no platforms exist", () => {
    expect(computeSurfaceHeight(0, 0, [], new Set())).toBe(0);
  });

  it("returns 0 when point is outside all platforms", () => {
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0)];
    // Far from the platform
    expect(computeSurfaceHeight(20, 20, placed, new Set())).toBe(0);
  });

  it("returns platform height when point is on a platform", () => {
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0)];
    expect(computeSurfaceHeight(0, 0, placed, new Set())).toBe(0.4);
  });

  it("returns stacked height for platforms on top of each other", () => {
    const bottom = createPlacedItem("platform", 0, 0, 0, null, 0);
    const top = createPlacedItem("platform", 0, 0, 0, null, 0.4);
    expect(computeSurfaceHeight(0, 0, [bottom, top], new Set())).toBe(0.8);
  });

  it("returns highest surface when multiple platforms overlap", () => {
    const low = createPlacedItem("platform", 0, 0, 0, null, 0);
    const high = createPlacedItem("platform", 0, 0, 0, null, 0.8);
    expect(computeSurfaceHeight(0, 0, [low, high], new Set())).toBeCloseTo(1.2);
  });

  it("excludes items in excludeIds", () => {
    const p = createPlacedItem("platform", 0, 0);
    expect(computeSurfaceHeight(0, 0, [p], new Set([p.id]))).toBe(0);
  });

  it("only considers stage items", () => {
    const table = createPlacedItem("round-table-6ft", 0, 0);
    expect(computeSurfaceHeight(0, 0, [table], new Set())).toBe(0);
  });

  it("respects platform footprint boundaries", () => {
    const p = createPlacedItem("platform", 0, 0);
    // Platform is 2.44m wide → render width = 4.88. Half = 2.44
    // A point just inside the edge should hit
    expect(computeSurfaceHeight(toRenderSpace(2.44 / 2) - 0.01, 0, [p], new Set())).toBe(0.4);
    // A point just outside should miss
    expect(computeSurfaceHeight(toRenderSpace(2.44 / 2) + 0.01, 0, [p], new Set())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkCollision — 3D (height-aware)
// ---------------------------------------------------------------------------

describe("checkCollision 3D", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("items at different heights do not collide", () => {
    // Platform on floor at (0,0)
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0, 0, null, 0)];
    // Another platform at same XZ but on top (y = 0.4, which is platform height)
    // Since aBottom (0.4) >= bTop (0.4) - 0.001 → should NOT collide
    expect(checkCollision(0, 0, platformItem, 0, placed, new Set(), 0, 0.4)).toBe(false);
  });

  it("items at same height do collide", () => {
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0, 0, null, 0)];
    expect(checkCollision(0, 0, platformItem, 0, placed, new Set(), 0, 0)).toBe(true);
  });

  it("overlapping Y ranges collide", () => {
    // Platform from y=0 to y=0.4
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0, 0, null, 0)];
    // Item from y=0.2 to y=0.6 — overlaps in Y
    expect(checkCollision(0, 0, platformItem, 0, placed, new Set(), 0, 0.2)).toBe(true);
  });

  it("table on platform does not collide with platform", () => {
    // Platform height is 0.4. Table on top starts at y=0.4
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0, 0, null, 0)];
    // Table at same XZ but sitting on top
    expect(checkCollision(0, 0, smallItem, 0, placed, new Set(), 0.01, 0.4)).toBe(false);
  });

  it("stage items at same height can touch edges (negative padding tolerance)", () => {
    // Place platform at origin
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0, 0, null, 0)];
    // Place another platform edge-to-edge on X axis
    const halfW = toRenderSpace(platformItem.width);
    // Distance = halfW1 + halfW2, negative padding means slight overlap allowed
    expect(checkCollision(halfW, 0, platformItem, 0, placed, new Set(), 0, 0)).toBe(false);
  });

  it("stage items allow slight overlap (floating point tolerance)", () => {
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0, 0, null, 0)];
    const halfW = toRenderSpace(platformItem.width);
    // Tiny overlap (0.02 render units = 1cm) should still be allowed
    expect(checkCollision(halfW - 0.02, 0, platformItem, 0, placed, new Set(), 0, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// snapToPlatformEdge
// ---------------------------------------------------------------------------

describe("snapToPlatformEdge", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("does nothing for non-stage items", () => {
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0)];
    const result = snapToPlatformEdge(5, 0, smallItem, 0, placed, new Set());
    expect(result.x).toBe(5);
  });

  it("snaps stage item to nearby platform edge", () => {
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0)];
    const halfW = toRenderSpace(platformItem.width) / 2;
    // Place new platform just slightly off from perfect edge alignment
    const nearX = halfW * 2 + 0.3; // Close to flush but 0.3 render-units off
    const result = snapToPlatformEdge(nearX, 0, platformItem, 0, placed, new Set());
    // Should snap to exact edge: other.x + bHalfW + aHalfW
    expect(result.x).toBeCloseTo(halfW * 2, 1);
  });

  it("snaps to platforms at any Y level (XZ alignment only)", () => {
    // Platform on floor
    const placed: PlacedItem[] = [createPlacedItem("platform", 0, 0, 0, null, 0)];
    const halfW = toRenderSpace(platformItem.width) / 2;
    const nearX = halfW * 2 + 0.3;
    // Edge snap is purely XZ — it snaps regardless of Y level
    const result = snapToPlatformEdge(nearX, 0, platformItem, 0, placed, new Set());
    expect(result.x).toBeCloseTo(halfW * 2, 1); // Snap occurred
  });
});
