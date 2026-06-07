import { describe, it, expect } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createPlacedItem } from "../placement.js";
import { RENDER_SCALE } from "../../constants/scale.js";
import { computeCirculation, type CirculationReport, type FurnitureFootprint } from "../circulation.js";
import {
  placedTableFootprints,
  placedItemsCirculation,
  circulationBandColor,
  circulationOverlaySegment,
  circulationOverlaySegments,
  CIRCULATION_OVERLAY_Y,
} from "../circulation-scene.js";

function box(id: string, cx: number, cz: number, width = 1, depth = 1): FurnitureFootprint {
  return { id, label: id, cx, cz, width, depth, rotation: 0 };
}

const roundTable = getCatalogueItemBySlug("round-table-6ft");
const chair = getCatalogueItemBySlug("banquet-chair");

describe("placedTableFootprints", () => {
  it("keeps only tables and converts render units back to metres", () => {
    if (roundTable === undefined || chair === undefined) {
      throw new Error("fixture catalogue items missing");
    }
    const footprints = placedTableFootprints([
      createPlacedItem(roundTable.id, 8, 0, 0), // render x=8 → 4 m
      createPlacedItem(chair.id, 1, 1, 0), // dropped: not a table
    ]);
    expect(footprints).toHaveLength(1);
    const f = footprints[0];
    expect(f?.cx).toBeCloseTo(8 / RENDER_SCALE, 6);
    expect(f?.cz).toBeCloseTo(0, 6);
    expect(f?.width).toBe(roundTable.width);
    expect(f?.depth).toBe(roundTable.depth);
  });

  it("returns an empty list when no tables are placed", () => {
    if (chair === undefined) throw new Error("fixture chair missing");
    expect(placedTableFootprints([createPlacedItem(chair.id, 0, 0, 0)])).toHaveLength(0);
  });
});

describe("placedItemsCirculation", () => {
  it("reports a non-open band once two tables share the floor", () => {
    if (roundTable === undefined) throw new Error("fixture round table missing");
    const report = placedItemsCirculation([
      createPlacedItem(roundTable.id, 0, 0, 0),
      createPlacedItem(roundTable.id, 8, 0, 0),
    ]);
    expect(report.pairCount).toBe(1);
    expect(report.band).not.toBe("open");
    expect(report.tightestPair).not.toBeNull();
  });

  it("is open with a single table", () => {
    if (roundTable === undefined) throw new Error("fixture round table missing");
    expect(placedItemsCirculation([createPlacedItem(roundTable.id, 0, 0, 0)]).band).toBe("open");
  });
});

describe("circulationBandColor", () => {
  it("returns a distinct hex colour for every band", () => {
    const colors = (["open", "generous", "comfortable", "tight", "blocked"] as const).map(
      circulationBandColor,
    );
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("circulationOverlaySegment", () => {
  function reportWith(
    band: CirculationReport["band"],
    pointA: { x: number; z: number },
    pointB: { x: number; z: number },
    gapM: number,
  ): CirculationReport {
    return {
      pairCount: 1,
      tightestGapM: gapM,
      tightestPair: { aId: "a", bId: "b", aLabel: "A", bLabel: "B", gapM, pointA, pointB },
      problemGaps: [],
      tightCount: band === "tight" ? 1 : 0,
      blockedCount: band === "blocked" ? 1 : 0,
      band,
    };
  }

  it("returns null when there is nothing to draw (open band)", () => {
    const open: CirculationReport = {
      pairCount: 0,
      tightestGapM: null,
      tightestPair: null,
      problemGaps: [],
      tightCount: 0,
      blockedCount: 0,
      band: "open",
    };
    expect(circulationOverlaySegment(open)).toBeNull();
  });

  it("scales metre witnesses into render units and sits the line just above the floor", () => {
    const seg = circulationOverlaySegment(
      reportWith("comfortable", { x: 1, z: 0 }, { x: 2, z: 0 }, 1),
      2,
      CIRCULATION_OVERLAY_Y,
    );
    expect(seg).not.toBeNull();
    if (seg === null) return;
    expect(seg.from).toEqual([2, CIRCULATION_OVERLAY_Y, 0]); // 1 m × 2 = 2 render units
    expect(seg.to).toEqual([4, CIRCULATION_OVERLAY_Y, 0]); // 2 m × 2 = 4
    expect(seg.mid).toEqual([3, CIRCULATION_OVERLAY_Y, 0]);
    expect(seg.gapM).toBe(1);
    expect(seg.emphasis).toBe(false);
    expect(seg.color).toBe(circulationBandColor("comfortable"));
  });

  it("flags emphasis for tight and blocked bands", () => {
    const tight = circulationOverlaySegment(reportWith("tight", { x: 0, z: 0 }, { x: 0.3, z: 0 }, 0.6), 2);
    const blocked = circulationOverlaySegment(reportWith("blocked", { x: 0, z: 0 }, { x: 0.1, z: 0 }, 0), 2);
    expect(tight?.emphasis).toBe(true);
    expect(blocked?.emphasis).toBe(true);
  });

  it("defaults to RENDER_SCALE when no scale is supplied", () => {
    const seg = circulationOverlaySegment(reportWith("generous", { x: 1, z: 1 }, { x: 2, z: 1 }, 1.5));
    expect(seg?.from[0]).toBeCloseTo(1 * RENDER_SCALE, 6);
    expect(seg?.to[0]).toBeCloseTo(2 * RENDER_SCALE, 6);
  });
});

describe("circulationOverlaySegments", () => {
  it("draws nothing with fewer than two tables", () => {
    expect(circulationOverlaySegments(computeCirculation([box("a", 0, 0)]))).toEqual([]);
  });

  it("draws only the primary when the tightest aisle is already comfortable", () => {
    const segs = circulationOverlaySegments(computeCirculation([box("a", 0, 0), box("b", 2, 0)])); // gap 1.0
    expect(segs).toHaveLength(1);
    expect(segs[0]?.primary).toBe(true);
    expect(segs[0]?.band).toBe("comfortable");
  });

  it("surfaces every sub-comfortable aisle: one primary, the rest secondary", () => {
    // a—b gap 0.6 (tight); b—c overlap → 0 (blocked); a—c gap 1.0 (comfortable, not a problem).
    const segs = circulationOverlaySegments(
      computeCirculation([box("a", 0, 0), box("b", 1.6, 0), box("c", 2.0, 0)]),
    );
    expect(segs).toHaveLength(2);
    // Exactly one primary, tightest-first.
    expect(segs.filter((s) => s.primary)).toHaveLength(1);
    expect(segs[0]?.primary).toBe(true);
    expect(segs[0]?.band).toBe("blocked"); // the 0 gap leads
    expect(segs[1]?.primary).toBe(false);
    expect(segs[1]?.band).toBe("tight"); // the 0.6 gap follows
    expect(segs[0]?.gapM).toBeLessThanOrEqual(segs[1]?.gapM ?? Infinity);
  });

  it("bands each secondary by its own gap, not the headline band", () => {
    const segs = circulationOverlaySegments(
      computeCirculation([box("a", 0, 0), box("b", 1.6, 0), box("c", 2.0, 0)]),
    );
    // The secondary is tight even though the primary is blocked.
    const secondary = segs.find((s) => !s.primary);
    expect(secondary?.band).toBe("tight");
    expect(secondary?.color).toBe(circulationBandColor("tight"));
  });
});
