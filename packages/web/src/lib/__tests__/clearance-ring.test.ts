import { describe, expect, it } from "vitest";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../catalogue.js";
import { CIRCULATION_AISLE } from "../circulation.js";
import {
  clearanceRingsForSelection,
  footprintHalfDiagonalM,
  worstFailingRing,
} from "../clearance-ring.js";
import { isDiningTableItem } from "../furniture-semantics.js";
import type { PlacedItem } from "../placement.js";

// ---------------------------------------------------------------------------
// The clearance ring judges a selected dining table against the
// planning-grade aisle rulebook: green when the nearest neighbour keeps the
// single-file walkway, amber with the neighbour's name and the broken rule
// when it does not. Real catalogue tables — the footprint sizes these tests
// assert against are the ones the planner ships.
// ---------------------------------------------------------------------------

function find(predicate: (c: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}

const diningTable = (): CatalogueItem =>
  find((c) => c.category === "table" && isDiningTableItem(c), "dining table");
const chair = (): CatalogueItem => find((c) => c.category === "chair", "chair");

function place(item: CatalogueItem, id: string, x: number, z: number): PlacedItem {
  return {
    id,
    catalogueItemId: item.id,
    x, y: 0, z,
    rotationY: 0,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    groupId: null,
  };
}

describe("clearanceRingsForSelection", () => {
  it("returns nothing for an empty selection", () => {
    const table = diningTable();
    expect(clearanceRingsForSelection(new Set(), [place(table, "t1", 0, 0)])).toEqual([]);
  });

  it("only dining tables earn rings — a selected chair does not", () => {
    const seat = chair();
    const rings = clearanceRingsForSelection(
      new Set(["c1"]),
      [place(seat, "c1", 0, 0)],
    );
    expect(rings).toEqual([]);
  });

  it("a lone table passes with the full comfortable ring", () => {
    const table = diningTable();
    const rings = clearanceRingsForSelection(new Set(["t1"]), [place(table, "t1", 2, 3)]);
    expect(rings).toHaveLength(1);
    const ring = rings[0];
    if (ring === undefined) throw new Error("ring missing");
    expect(ring.verdict).toBe("pass");
    expect(ring.reason).toBeNull();
    expect(ring.nearestGapM).toBeNull();
    expect(ring.centreX).toBeCloseTo(2, 10);
    expect(ring.centreZ).toBeCloseTo(3, 10);
    const halfDiagonal = Math.hypot(table.width, table.depth) / 2;
    expect(ring.radiusM).toBeCloseTo(halfDiagonal + CIRCULATION_AISLE.comfortableM, 10);
  });

  it("a comfortable neighbour keeps the verdict green and hugs the ring to the gap", () => {
    const table = diningTable();
    const gap = 1.0; // ≥ tightM (0.9) → pass, < comfortableM → ring hugs
    const centreDistance = table.width + gap; // edge-to-edge gap along X
    const rings = clearanceRingsForSelection(
      new Set(["t1"]),
      [place(table, "t1", 0, 0), place(table, "t2", centreDistance, 0)],
    );
    const ring = rings[0];
    if (ring === undefined) throw new Error("ring missing");
    expect(ring.verdict).toBe("pass");
    expect(ring.nearestGapM).toBeCloseTo(gap, 6);
    const halfDiagonal = Math.hypot(table.width, table.depth) / 2;
    expect(ring.radiusM).toBeCloseTo(halfDiagonal + gap, 6);
  });

  it("a tight neighbour fails amber with the named reason", () => {
    const table = diningTable();
    const gap = 0.6; // inside [blockedM, tightM) → tight
    const rings = clearanceRingsForSelection(
      new Set(["t1"]),
      [place(table, "t1", 0, 0), place(table, "t2", table.width + gap, 0)],
    );
    const ring = rings[0];
    if (ring === undefined) throw new Error("ring missing");
    expect(ring.verdict).toBe("fail");
    expect(ring.band).toBe("tight");
    expect(ring.nearestLabel).toBe(table.name);
    expect(ring.reason).toBe(`0.60 m to ${table.name} — needs 0.90 m single-file`);
  });

  it("a blocked neighbour names the stronger rule", () => {
    const table = diningTable();
    const gap = 0.2; // below blockedM (0.45)
    const rings = clearanceRingsForSelection(
      new Set(["t1"]),
      [place(table, "t1", 0, 0), place(table, "t2", table.width + gap, 0)],
    );
    const ring = rings[0];
    if (ring === undefined) throw new Error("ring missing");
    expect(ring.verdict).toBe("fail");
    expect(ring.band).toBe("blocked");
    expect(ring.reason).toContain("effectively impassable");
    expect(ring.reason).toContain("0.90 m");
  });

  it("chairs never count as obstructions (a table's own seating is not a wall)", () => {
    const table = diningTable();
    const seat = chair();
    const rings = clearanceRingsForSelection(
      new Set(["t1"]),
      [place(table, "t1", 0, 0), place(seat, "c1", table.width / 2 + 0.1, 0)],
    );
    const ring = rings[0];
    if (ring === undefined) throw new Error("ring missing");
    expect(ring.verdict).toBe("pass");
    expect(ring.nearestGapM).toBeNull();
  });

  it("judges every selected table, one ring each", () => {
    const table = diningTable();
    const rings = clearanceRingsForSelection(
      new Set(["t1", "t2"]),
      [place(table, "t1", 0, 0), place(table, "t2", 10, 0)],
    );
    expect(rings.map((r) => r.itemId).sort()).toEqual(["t1", "t2"]);
    expect(rings.every((r) => r.verdict === "pass")).toBe(true);
  });
});

describe("worstFailingRing", () => {
  it("picks the tightest failing ring; null when everything passes", () => {
    const table = diningTable();
    const all = clearanceRingsForSelection(
      new Set(["t1", "t3"]),
      [
        place(table, "t1", 0, 0),
        place(table, "t2", table.width + 0.6, 0), // tight against t1
        place(table, "t3", 100, 0),
        place(table, "t4", 100 + table.width + 0.3, 0), // blocked against t3
      ],
    );
    const worst = worstFailingRing(all);
    expect(worst?.itemId).toBe("t3");

    const calm = clearanceRingsForSelection(new Set(["t1"]), [place(table, "t1", 0, 0)]);
    expect(worstFailingRing(calm)).toBeNull();
  });
});

describe("footprintHalfDiagonalM", () => {
  it("is the radius of the circle containing the footprint", () => {
    expect(footprintHalfDiagonalM({
      id: "f", label: "f", cx: 0, cz: 0, width: 3, depth: 4, rotation: 0,
    })).toBeCloseTo(2.5, 10);
  });
});
