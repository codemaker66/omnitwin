import { describe, it, expect } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createPlacedItem } from "../placement.js";
import { createTableGroup } from "../table-group.js";
import { RENDER_SCALE } from "../../constants/scale.js";
import { computeCirculation, convexPolygonDistance, footprintCorners, footprintOfPlacement, type CirculationReport, type FurnitureFootprint } from "../circulation.js";
import {
  placedCirculationFootprints,
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
const poseurTable = getCatalogueItemBySlug("poseur-table");
const chair = getCatalogueItemBySlug("banquet-chair");
const micStand = getCatalogueItemBySlug("mic-stand");
const projector = getCatalogueItemBySlug("projector");
const laptop = getCatalogueItemBySlug("laptop");
const microphone = getCatalogueItemBySlug("microphone");

describe("placedCirculationFootprints", () => {
  it.each(["room-divider", "servery-unit"])("includes the transformed %s footprint in clearance checks", (slug) => {
    const item = getCatalogueItemBySlug(slug);
    if (item === undefined || roundTable === undefined) throw new Error("Missing furniture fixture");
    const equipment = { ...createPlacedItem(item.id, 2, -3, Math.PI / 4), scale: 1.5 };
    const table = createPlacedItem(roundTable.id, -2, -3);
    const footprints = placedCirculationFootprints([equipment, table]);
    expect(footprints[0]).toMatchObject({
      id: equipment.id, label: item.name,
      cx: 2 / RENDER_SCALE, cz: -3 / RENDER_SCALE,
      // A footprint turns the opposite way to three.js's rotationY.
      width: item.width * 1.5, depth: item.depth * 1.5, rotation: -Math.PI / 4,
    });
    expect(placedItemsCirculation([equipment, table]).pairCount).toBe(1);
  });

  it("outlines a turned piece where the scene draws it", () => {
    const trestle = getCatalogueItemBySlug("trestle-6ft");
    if (trestle === undefined) throw new Error("Missing trestle fixture");
    const turn = Math.PI / 6;
    const [footprint] = placedCirculationFootprints([createPlacedItem(trestle.id, 1, 2, turn)]);
    if (footprint === undefined) throw new Error("No footprint");
    // Three.js turns a local point (x, z) about Y to (x cos + z sin, −x sin + z cos).
    const hw = trestle.width / 2;
    const hd = trestle.depth / 2;
    const scene = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx = 0, lz = 0]) => ({
      x: 1 / RENDER_SCALE + lx * Math.cos(turn) + lz * Math.sin(turn),
      z: 2 / RENDER_SCALE - lx * Math.sin(turn) + lz * Math.cos(turn),
    }));
    const corners = footprintCorners(footprint);
    for (const [i, corner] of corners.entries()) {
      expect(corner.x).toBeCloseTo(scene[i]?.x ?? Number.NaN, 9);
      expect(corner.z).toBeCloseTo(scene[i]?.z ?? Number.NaN, 9);
    }
  });

  it("keeps planning floor obstacles and converts render units back to metres", () => {
    if (roundTable === undefined || chair === undefined) {
      throw new Error("fixture catalogue items missing");
    }
    const footprints = placedCirculationFootprints([
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

  it("returns an empty list when no planning floor obstacles are placed", () => {
    if (chair === undefined) throw new Error("fixture chair missing");
    expect(placedCirculationFootprints([createPlacedItem(chair.id, 0, 0, 0)])).toHaveLength(0);
  });

  it("uses the same normalized scale as the rendered table", () => {
    if (roundTable === undefined) throw new Error("fixture round table missing");
    const scaled = { ...createPlacedItem(roundTable.id, 0, 0), scale: 1.5 };
    const invalid = { ...createPlacedItem(roundTable.id, 4, 0), scale: 0 };
    const [scaledFootprint, fallbackFootprint] = placedCirculationFootprints([scaled, invalid]);
    expect(scaledFootprint?.width).toBeCloseTo(roundTable.width * 1.5);
    expect(scaledFootprint?.depth).toBeCloseTo(roundTable.depth * 1.5);
    expect(fallbackFootprint?.width).toBeCloseTo(roundTable.width);
    expect(fallbackFootprint?.depth).toBeCloseTo(roundTable.depth);
  });

  it("retains a poseur table as a physical circulation obstacle", () => {
    if (poseurTable === undefined) throw new Error("fixture poseur table missing");
    const footprint = placedCirculationFootprints([
      createPlacedItem(poseurTable.id, 2, -3, 0),
    ])[0];

    expect(footprint).toMatchObject({
      label: poseurTable.name,
      width: poseurTable.width,
      depth: poseurTable.depth,
    });
  });

  it("retains the mic stand's exact floor footprint as a circulation obstacle", () => {
    if (micStand === undefined) throw new Error("fixture mic stand missing");
    const footprint = placedCirculationFootprints([
      createPlacedItem(micStand.id, 2, -3, 0),
    ])[0];

    expect(footprint).toMatchObject({
      label: "Mic Stand",
      width: 0.5,
      depth: 0.5,
    });
  });

  it("does not turn tiny tabletop AV into circulation obstacles", () => {
    if (projector === undefined || laptop === undefined || microphone === undefined) {
      throw new Error("fixture tabletop AV missing");
    }
    expect(placedCirculationFootprints([
      createPlacedItem(projector.id, 0, 0),
      createPlacedItem(laptop.id, 1, 0),
      createPlacedItem(microphone.id, 2, 0),
    ])).toEqual([]);
  });
});

describe("placedItemsCirculation", () => {
  it("measures rounds with their chairs chair back to chair back, the floor a guest walks, not table edge to table edge", () => {
    if (roundTable === undefined) throw new Error("fixture round table missing");
    // Two rounds of ten, 3.6 m centre to centre: 1.77 m between the cloths, but
    // far less between the chair backs (the L3 lead's D1 frames, 28 Oct 2026).
    const left = createTableGroup(roundTable.id, 0, 0, 0, 10);
    const right = createTableGroup(roundTable.id, 3.6, 0, 0, 10);
    const tablesAlone = placedItemsCirculation([...left, ...right].filter((piece) => piece.catalogueItemId === roundTable.id));
    expect(tablesAlone.tightestGapM).toBeCloseTo(3.6 - roundTable.width, 6);
    expect(tablesAlone.band === "comfortable" || tablesAlone.band === "generous").toBe(true);

    const seated = placedItemsCirculation([...left, ...right]);
    expect(seated.pairCount).toBe(1);
    // Bounded by the chairs themselves: never further than the nearest chair pair across the two
    // rounds, and short of it by at most each ring's sagitta, where the outline runs straight
    // between two neighbouring chairs (R(1 - cos(pi/10)) for a ring of ten): on the safe side.
    const chairsOf = (group: readonly typeof left[number][]) => group
      .filter((piece) => piece.catalogueItemId !== roundTable.id)
      .map((piece) => {
        const item = getCatalogueItemBySlug(piece.catalogueItemId) ?? chair;
        if (item === undefined) throw new Error("fixture chair missing");
        return footprintCorners(footprintOfPlacement(piece, item, RENDER_SCALE));
      });
    const nearestChairs = Math.min(...chairsOf(left).flatMap((a) => chairsOf(right).map((b) => convexPolygonDistance(a, b))));
    const gap = seated.tightestGapM ?? Number.NaN;
    const ringRadius = Math.max(...chairsOf(left).flat().map((corner) => Math.hypot(corner.x, corner.z)));
    const sagitta = ringRadius * (1 - Math.cos(Math.PI / 10));
    expect(gap).toBeLessThanOrEqual(nearestChairs + 1e-9);
    expect(gap).toBeGreaterThanOrEqual(nearestChairs - 2 * sagitta - 1e-9);
    expect(gap).toBeLessThan(tablesAlone.tightestGapM ?? 0);
    expect(seated.band === "tight" || seated.band === "blocked").toBe(true);
  });

  it("counts a round's own chairs as its outline, never as an aisle against it", () => {
    if (roundTable === undefined) throw new Error("fixture round table missing");
    const report = placedItemsCirculation(createTableGroup(roundTable.id, 0, 0, 0, 10));
    expect(report.pairCount).toBe(0);
    expect(placedCirculationFootprints(createTableGroup(roundTable.id, 0, 0, 0, 10))).toHaveLength(1);
  });

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

  it("includes a mic stand when computing table-to-equipment clear gaps", () => {
    if (roundTable === undefined || micStand === undefined) throw new Error("fixture missing");
    const report = placedItemsCirculation([
      createPlacedItem(roundTable.id, 0, 0),
      createPlacedItem(micStand.id, 3, 0),
    ]);

    expect(report.pairCount).toBe(1);
    expect(report.tightestPair?.bLabel).toBe("Mic Stand");
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
