import { describe, it, expect } from "vitest";
import {
  planBanquetLayout,
  rectsOverlap,
  centreOutOrder,
  type BanquetLayoutOptions,
  type LayoutRect,
} from "../auto-layout.js";
import {
  computeCirculation,
  bandForGap,
  CIRCULATION_AISLE,
  type FurnitureFootprint,
} from "../circulation.js";

// A roomy banquet hall: 20 m × 10 m, 1.5 m round tables, comfortable 1.2 m aisle.
function opts(overrides: Partial<BanquetLayoutOptions> = {}): BanquetLayoutOptions {
  return {
    roomWidthM: 20,
    roomLengthM: 10,
    tableWidthM: 1.5,
    tableDepthM: 1.5,
    seatsPerTable: 8,
    ...overrides,
  };
}

describe("rectsOverlap", () => {
  it("detects overlapping rects", () => {
    expect(rectsOverlap({ cx: 0, cz: 0, width: 2, depth: 2 }, { cx: 1, cz: 0, width: 2, depth: 2 })).toBe(true);
  });
  it("treats edge-touching rects as non-overlapping", () => {
    expect(rectsOverlap({ cx: 0, cz: 0, width: 2, depth: 2 }, { cx: 2, cz: 0, width: 2, depth: 2 })).toBe(false);
  });
  it("detects separated rects", () => {
    expect(rectsOverlap({ cx: 0, cz: 0, width: 2, depth: 2 }, { cx: 3, cz: 0, width: 2, depth: 2 })).toBe(false);
  });
});

describe("centreOutOrder", () => {
  it("orders odd counts centre-first", () => {
    expect(centreOutOrder(5)).toEqual([2, 1, 3, 0, 4]);
  });
  it("orders even counts centre-pair-first, lower index first", () => {
    expect(centreOutOrder(4)).toEqual([1, 2, 0, 3]);
  });
  it("handles trivial counts", () => {
    expect(centreOutOrder(0)).toEqual([]);
    expect(centreOutOrder(1)).toEqual([0]);
  });
});

describe("planBanquetLayout — grid", () => {
  it("computes the column/row count from usable span and aisle", () => {
    const plan = planBanquetLayout(opts({ aisleM: 1.2, wallClearanceM: 0.9 }));
    // usableW = 20 − 1.8 = 18.2 → cols = floor((18.2+1.2)/(1.5+1.2)) = 7
    // usableD = 10 − 1.8 = 8.2  → rows = floor((8.2+1.2)/2.7) = 3
    expect(plan.cols).toBe(7);
    expect(plan.rows).toBe(3);
    expect(plan.tableCount).toBe(21);
    expect(plan.seatsPlanned).toBe(21 * 8);
    expect(plan.meetsTarget).toBe(true);
  });

  it("centres the grid on the origin", () => {
    const plan = planBanquetLayout(opts({ aisleM: 1.2, wallClearanceM: 0.9 }));
    const xs = plan.tables.map((t) => t.xM);
    const zs = plan.tables.map((t) => t.zM);
    // Symmetric about 0 on both axes.
    expect(Math.min(...xs)).toBeCloseTo(-Math.max(...xs), 6);
    expect(Math.min(...zs)).toBeCloseTo(-Math.max(...zs), 6);
  });

  it("keeps every table inside the walls", () => {
    const plan = planBanquetLayout(opts());
    for (const t of plan.tables) {
      expect(Math.abs(t.xM)).toBeLessThanOrEqual(20 / 2 - 1.5 / 2 + 1e-9);
      expect(Math.abs(t.zM)).toBeLessThanOrEqual(10 / 2 - 1.5 / 2 + 1e-9);
    }
  });

  it("returns an empty plan when the room cannot hold a single table", () => {
    const plan = planBanquetLayout(opts({ roomWidthM: 1, roomLengthM: 1 }));
    expect(plan.cols).toBe(0);
    expect(plan.rows).toBe(0);
    expect(plan.tables).toHaveLength(0);
    expect(plan.seatsPlanned).toBe(0);
  });
});

describe("planBanquetLayout — target & caps", () => {
  it("stops once the target guest count is met, balanced from the centre", () => {
    const plan = planBanquetLayout(opts({ targetGuests: 40 })); // 40 / 8 = 5 tables
    expect(plan.tableCount).toBe(5);
    expect(plan.seatsPlanned).toBe(40);
    expect(plan.meetsTarget).toBe(true);
  });

  it("rounds the target up to whole tables", () => {
    const plan = planBanquetLayout(opts({ targetGuests: 33 })); // ceil(33/8) = 5
    expect(plan.tableCount).toBe(5);
    expect(plan.seatsPlanned).toBe(40);
  });

  it("reports meetsTarget=false when the room cannot reach the target", () => {
    const plan = planBanquetLayout(opts({ targetGuests: 1000 }));
    expect(plan.tableCount).toBe(21); // whole grid
    expect(plan.meetsTarget).toBe(false);
  });

  it("honours maxTables", () => {
    const plan = planBanquetLayout(opts({ maxTables: 4 }));
    expect(plan.tableCount).toBe(4);
  });
});

describe("planBanquetLayout — keep-outs", () => {
  it("places no table overlapping a keep-out region", () => {
    const stage: LayoutRect = { cx: 0, cz: -3.5, width: 6, depth: 2 };
    const plan = planBanquetLayout(opts({ keepOuts: [stage] }));
    for (const t of plan.tables) {
      const footprint: LayoutRect = { cx: t.xM, cz: t.zM, width: 1.5, depth: 1.5 };
      expect(rectsOverlap(footprint, stage)).toBe(false);
    }
    // The keep-out removed at least one table from the full 21-grid.
    expect(plan.tableCount).toBeLessThan(21);
  });
});

describe("planBanquetLayout — circulation cross-validation (closed loop)", () => {
  it("never emits a layout the circulation engine would flag below the aisle", () => {
    const aisleM = CIRCULATION_AISLE.comfortableM; // 1.2
    const plan = planBanquetLayout(opts({ aisleM }));
    const footprints: FurnitureFootprint[] = plan.tables.map((t, i) => ({
      id: `t${String(i)}`,
      label: "round table",
      cx: t.xM,
      cz: t.zM,
      width: 1.5,
      depth: 1.5,
      rotation: t.rotationY,
    }));
    const report = computeCirculation(footprints);
    expect(report.tightestGapM).not.toBeNull();
    // Axis-aligned neighbours are exactly `aisle` apart; nothing is tighter.
    expect(report.tightestGapM ?? 0).toBeGreaterThanOrEqual(aisleM - 1e-6);
    // Therefore the generated layout has zero tight/blocked pinch points.
    expect(report.problemGaps).toHaveLength(0);
    expect(bandForGap(report.tightestGapM)).not.toBe("tight");
    expect(bandForGap(report.tightestGapM)).not.toBe("blocked");
  });

  it("widening the aisle target widens the measured gap in lock-step", () => {
    const wide = planBanquetLayout(opts({ aisleM: 2.0 }));
    const footprints: FurnitureFootprint[] = wide.tables.map((t, i) => ({
      id: `t${String(i)}`,
      label: "round table",
      cx: t.xM,
      cz: t.zM,
      width: 1.5,
      depth: 1.5,
      rotation: 0,
    }));
    const report = computeCirculation(footprints);
    expect(report.tightestGapM ?? 0).toBeGreaterThanOrEqual(2.0 - 1e-6);
  });
});
