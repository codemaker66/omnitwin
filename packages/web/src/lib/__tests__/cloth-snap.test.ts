import { describe, it, expect, beforeEach } from "vitest";
import {
  findNearestTable,
  CLOTH_SNAP_DISTANCE_M,
  CLOTH_SNAP_DISTANCE_RENDER,
} from "../cloth-snap.js";
import { resetPlacedIdCounter, createPlacedItem } from "../placement.js";
import type { PlacedItem } from "../placement.js";

beforeEach(() => { resetPlacedIdCounter(); });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("cloth-snap constants", () => {
  it("CLOTH_SNAP_DISTANCE_M is positive", () => {
    expect(CLOTH_SNAP_DISTANCE_M).toBeGreaterThan(0);
  });

  it("CLOTH_SNAP_DISTANCE_RENDER is scaled", () => {
    expect(CLOTH_SNAP_DISTANCE_RENDER).toBeGreaterThan(CLOTH_SNAP_DISTANCE_M);
  });
});

// ---------------------------------------------------------------------------
// findNearestTable
// ---------------------------------------------------------------------------

describe("findNearestTable", () => {
  it("returns null when no items placed", () => {
    expect(findNearestTable(0, 0, [], 10)).toBeNull();
  });

  it("returns null when no tables are near", () => {
    const chair = createPlacedItem("banquet-chair", 1, 1);
    expect(findNearestTable(1, 1, [chair], 10)).toBeNull();
  });

  it("finds a table at the same position", () => {
    const table = createPlacedItem("round-table-6ft", 5, 3);
    const result = findNearestTable(5, 3, [table], 10);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(table.id);
  });

  it("finds nearest table when multiple exist", () => {
    const far = createPlacedItem("round-table-6ft", 10, 10);
    const near = createPlacedItem("trestle-6ft", 2, 2);
    const result = findNearestTable(1, 1, [far, near], 10);
    expect(result?.id).toBe(near.id);
  });

  it("returns null when table is beyond maxDistance", () => {
    const table = createPlacedItem("round-table-6ft", 100, 100);
    expect(findNearestTable(0, 0, [table], 5)).toBeNull();
  });

  it("ignores non-table items", () => {
    const items: PlacedItem[] = [
      createPlacedItem("banquet-chair", 1, 1),
      createPlacedItem("platform", 2, 2),
    ];
    expect(findNearestTable(1, 1, items, 10)).toBeNull();
  });
});
