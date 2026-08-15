import { describe, it, expect, beforeEach } from "vitest";
import {
  findNearestDiningTable,
  findNearestTable,
  CLOTH_SNAP_DISTANCE_M,
  CLOTH_SNAP_DISTANCE_RENDER,
} from "../cloth-snap.js";
import { toRealWorld } from "../../constants/scale.js";
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

  // The product decision is "a cloth snaps to a table within 2 real metres".
  // Asserting the render value is merely LARGER only held while the render
  // scale exceeded 1; what must hold at any scale is that converting it back
  // yields the metre distance the rule is written in.
  it("CLOTH_SNAP_DISTANCE_RENDER is the metre distance in render space", () => {
    expect(toRealWorld(CLOTH_SNAP_DISTANCE_RENDER)).toBeCloseTo(CLOTH_SNAP_DISTANCE_M, 10);
    expect(CLOTH_SNAP_DISTANCE_RENDER).toBeGreaterThan(0);
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

describe("findNearestDiningTable", () => {
  it("skips a nearer poseur in favour of a seated dining table", () => {
    const poseur = createPlacedItem("poseur-table", 0, 0);
    const dining = createPlacedItem("round-table-6ft", 2, 0);

    expect(findNearestDiningTable(0, 0, [poseur, dining], 10)?.id).toBe(dining.id);
    expect(findNearestDiningTable(0, 0, [poseur], 10)).toBeNull();
    expect(findNearestTable(0, 0, [poseur], 10)?.id).toBe(poseur.id);
  });
});

describe("intrinsic table-linen snap exclusion", () => {
  it("skips clothed poseur variants but keeps the bare poseur eligible", () => {
    const blackPoseur = createPlacedItem("poseur-table-black", 0, 0);
    const whitePoseur = createPlacedItem("poseur-table-white", 0.5, 0);
    const barePoseur = createPlacedItem("poseur-table", 2, 0);

    expect(findNearestTable(0, 0, [blackPoseur, whitePoseur], 10)).toBeNull();
    expect(findNearestTable(0, 0, [blackPoseur, whitePoseur, barePoseur], 10)?.id)
      .toBe(barePoseur.id);
  });
});
