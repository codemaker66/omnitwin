import { describe, expect, it } from "vitest";
import type { TwinScanNode } from "@omnitwin/types";
import {
  PLAN_CUT_ABOVE_FLOOR_M,
  planCutY,
  planFitZoom,
  planFrame,
  planRoomLabels,
  SCAN_EYE_HEIGHT_M,
  scaleBarSpec,
  storeysFromNodes,
} from "../plan-mode.js";

// -----------------------------------------------------------------------------
// plan-mode — the pure maths under the orthographic plan.
//
// Storeys derive from the manifest's floor buckets; the walking-floor height
// of each is the median scanner pose height minus eye height (medians, not
// means: one mis-bucketed pose must not tilt a storey). Labels are
// deliberately RELATIONAL plus validated room names only — the storey
// switcher must never print scanner vocabulary ("Floor -1") or invent a
// building claim no human validated (see twin-rooms.ts's philosophy).
// -----------------------------------------------------------------------------

function node(
  id: string,
  floor: number,
  t: readonly [number, number, number],
): TwinScanNode {
  return {
    id,
    index: 0,
    pose: { q: [0, 0, 0, 1], t: [...t] },
    floor,
    roomSlug: null,
  };
}

/** Two storeys shaped like the real bundle: upper poses at E57 z≈1.5 (three
 *  y≈1.5), lower at z≈-1.6. scan_028 (validated Grand Hall) sits upstairs;
 *  scan_126 (validated Reception Room) downstairs. */
const twoStoreys: readonly TwinScanNode[] = [
  node("scan_028", 0, [0, 0, 1.5]),
  node("scan_001", 0, [4, 0, 1.52]),
  node("scan_002", 0, [8, 2, 1.48]),
  node("scan_126", -1, [2, 1, -1.6]),
  node("scan_101", -1, [6, 3, -1.7]),
];

describe("storeysFromNodes", () => {
  it("buckets by manifest floor, upper storey first", () => {
    const storeys = storeysFromNodes(twoStoreys);
    expect(storeys.map((s) => s.floor)).toEqual([0, -1]);
    expect(storeys.map((s) => s.nodeCount)).toEqual([3, 2]);
  });

  it("derives each storey's walking floor from the median pose height", () => {
    const [upper, lower] = storeysFromNodes(twoStoreys);
    expect(upper?.floorY).toBeCloseTo(1.5 - SCAN_EYE_HEIGHT_M, 6);
    expect(lower?.floorY).toBeCloseTo(-1.65 - SCAN_EYE_HEIGHT_M, 6);
  });

  it("labels storeys relationally and names only validated rooms", () => {
    const [upper, lower] = storeysFromNodes(twoStoreys);
    expect(upper?.label).toBe("Upper level");
    expect(lower?.label).toBe("Lower level");
    expect(upper?.roomNames).toEqual(["Grand Hall"]);
    expect(lower?.roomNames).toEqual(["Reception Room"]);
  });

  it("a single storey is simply 'Level' — nothing relational to say", () => {
    const storeys = storeysFromNodes(twoStoreys.filter((n) => n.floor === 0));
    expect(storeys).toHaveLength(1);
    expect(storeys[0]?.label).toBe("Level");
  });
});

describe("planCutY", () => {
  it("cuts a storey open at head height above its walking floor", () => {
    const [upper] = storeysFromNodes(twoStoreys);
    if (upper === undefined) {
      throw new Error("fixture storey missing");
    }
    expect(planCutY(upper)).toBeCloseTo(upper.floorY + PLAN_CUT_ABOVE_FLOOR_M, 6);
  });
});

describe("planFrame", () => {
  it("frames the storey's nodes with a margin, in three space", () => {
    const frame = planFrame(twoStoreys, 0);
    // Upper nodes span x 0..8, z 0..-2 (E57 y → three -z).
    expect(frame.centerX).toBeCloseTo(4, 6);
    expect(frame.centerZ).toBeCloseTo(-1, 6);
    expect(frame.halfW).toBeGreaterThan(4); // margin applied
    expect(frame.halfD).toBeGreaterThan(1);
  });

  it("frames every storey when no floor is named", () => {
    const all = planFrame(twoStoreys);
    const upperOnly = planFrame(twoStoreys, 0);
    expect(all.halfD).toBeGreaterThanOrEqual(upperOnly.halfD);
  });

  it("never collapses below a readable minimum for degenerate inputs", () => {
    const frame = planFrame([node("scan_000", 0, [3, 3, 1.5])], 0);
    expect(frame.halfW).toBeGreaterThanOrEqual(4);
    expect(frame.halfD).toBeGreaterThanOrEqual(4);
  });
});

describe("planFitZoom", () => {
  it("fits the tighter axis — the whole frame is always on screen", () => {
    const frame = { centerX: 0, centerZ: 0, halfW: 10, halfD: 5 };
    // 1000 px across 20 m = 50 px/m; 600 px across 10 m = 60 px/m — width binds.
    expect(planFitZoom(1000, 600, frame)).toBeCloseTo(50, 6);
  });

  it("guards degenerate viewports", () => {
    const frame = { centerX: 0, centerZ: 0, halfW: 10, halfD: 5 };
    expect(planFitZoom(0, 600, frame)).toBeGreaterThan(0);
  });
});

describe("planRoomLabels", () => {
  it("annotates only VALIDATED rooms, at the centroid of their viewpoints", () => {
    // A second validated Grand Hall viewpoint, as the real bundle has
    // (scan_028 and scan_046 are the hall's opposite ends).
    const withBothEnds: readonly TwinScanNode[] = [
      ...twoStoreys,
      node("scan_046", 0, [10, 0, 1.5]),
    ];
    const [upper] = storeysFromNodes(withBothEnds);
    if (upper === undefined) {
      throw new Error("fixture storey missing");
    }
    const labels = planRoomLabels(withBothEnds, upper);
    expect(labels).toHaveLength(1);
    const [hall] = labels;
    expect(hall?.name).toBe("Grand Hall");
    // scan_028 at x=0 and scan_046 at x=10 → the label centres the room.
    expect(hall?.position[0]).toBeCloseTo(5, 6);
    expect(hall?.position[2]).toBeCloseTo(0, 6);
  });

  it("floats labels just above the storey's walking floor", () => {
    const [upper] = storeysFromNodes(twoStoreys);
    if (upper === undefined) {
      throw new Error("fixture storey missing");
    }
    const [hall] = planRoomLabels(twoStoreys, upper);
    expect(hall?.position[1]).toBeGreaterThan(upper.floorY);
    expect(hall?.position[1]).toBeLessThan(upper.floorY + 1);
  });

  it("never annotates a room from another storey", () => {
    const [, lower] = storeysFromNodes(twoStoreys);
    if (lower === undefined) {
      throw new Error("fixture storey missing");
    }
    const labels = planRoomLabels(twoStoreys, lower);
    expect(labels.map((label) => label.name)).toEqual(["Reception Room"]);
  });

  it("says nothing when a storey holds no validated room", () => {
    const unvalidated: readonly TwinScanNode[] = [node("scan_777", 0, [0, 0, 1.5])];
    const [only] = storeysFromNodes(unvalidated);
    if (only === undefined) {
      throw new Error("fixture storey missing");
    }
    expect(planRoomLabels(unvalidated, only)).toEqual([]);
  });
});

describe("scaleBarSpec", () => {
  it("picks a 1-2-5 ladder length that renders near the target width", () => {
    // 50 px per metre: 2 m → 100 px fits under the ceiling; 5 m → 250 px over.
    expect(scaleBarSpec(50)).toEqual({ metres: 2, px: 100, label: "2 m" });
    // 12 px per metre: 10 m → 120 px.
    expect(scaleBarSpec(12)).toEqual({ metres: 10, px: 120, label: "10 m" });
  });

  it("drops below a metre for tight zooms with honest labelling", () => {
    // 400 px per metre: 0.5 m → 200 px is over the ceiling; 0.2 m → 80 px.
    const spec = scaleBarSpec(400);
    expect(spec).not.toBeNull();
    expect(spec?.metres).toBeLessThan(1);
    expect(spec?.label).toMatch(/cm$/);
    expect(spec?.px).toBeLessThanOrEqual(180);
  });

  it("guards non-finite input", () => {
    expect(scaleBarSpec(0)).toBeNull();
    expect(scaleBarSpec(Number.NaN)).toBeNull();
  });
});
