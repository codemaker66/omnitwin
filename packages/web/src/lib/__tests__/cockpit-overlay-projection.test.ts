import { describe, expect, it } from "vitest";
import type { SpaceDimensions } from "@omnitwin/types";
import {
  DEFAULT_OVERLAY_FLOOR_Y,
  buildFlowRibbonGeometry,
  densityPatchExtent,
  normaliseReplayPoint,
  projectReplayPointToFloor,
  sampleTrajectoryAtProgress,
  sceneFootprint,
  trajectoryFloorPolyline,
  type ReplayRoomBounds,
  type WorldPoint,
} from "../cockpit-overlay-projection.js";

// Render-space room: 40 (X) × 60 (Z) × 7 (height). Replay metre-frame bounds:
// 10 m × 20 m. These are deliberate, round numbers so the projected
// coordinates are exact and the affine mapping is easy to reason about.
const DIMS: SpaceDimensions = { width: 40, length: 60, height: 7 };
const BOUNDS: ReplayRoomBounds = { minX: 0, minY: 0, maxX: 10, maxY: 20 };

describe("sceneFootprint", () => {
  it("returns half-extents centred on the origin", () => {
    expect(sceneFootprint(DIMS)).toEqual({ halfWidth: 20, halfLength: 30 });
  });
});

describe("normaliseReplayPoint", () => {
  it("maps the room centre to (0.5, 0.5)", () => {
    expect(normaliseReplayPoint({ x: 5, y: 10 }, BOUNDS)).toEqual({ nx: 0.5, ny: 0.5 });
  });

  it("maps the corners to the unit square", () => {
    expect(normaliseReplayPoint({ x: 0, y: 0 }, BOUNDS)).toEqual({ nx: 0, ny: 0 });
    expect(normaliseReplayPoint({ x: 10, y: 20 }, BOUNDS)).toEqual({ nx: 1, ny: 1 });
  });

  it("clamps points outside the replay bounds into the unit square", () => {
    expect(normaliseReplayPoint({ x: 20, y: -5 }, BOUNDS)).toEqual({ nx: 1, ny: 0 });
  });

  it("falls back to the centre when a bounds span is degenerate", () => {
    const degenerate: ReplayRoomBounds = { minX: 4, minY: 0, maxX: 4, maxY: 20 };
    expect(normaliseReplayPoint({ x: 9, y: 10 }, degenerate)).toEqual({ nx: 0.5, ny: 0.5 });
  });
});

describe("projectReplayPointToFloor", () => {
  it("projects the room centre to the scene origin at floor height", () => {
    expect(projectReplayPointToFloor({ x: 5, y: 10 }, BOUNDS, DIMS)).toEqual([
      0,
      DEFAULT_OVERLAY_FLOOR_Y,
      0,
    ]);
  });

  it("flips the replay Y axis onto scene Z (plan 'up' is into the screen)", () => {
    // (0,0) is the near-left replay corner → far-left scene corner (+Z).
    expect(projectReplayPointToFloor({ x: 0, y: 0 }, BOUNDS, DIMS, 0)).toEqual([-20, 0, 30]);
    expect(projectReplayPointToFloor({ x: 10, y: 20 }, BOUNDS, DIMS, 0)).toEqual([20, 0, -30]);
  });
});

describe("trajectoryFloorPolyline", () => {
  it("projects every trajectory point and preserves order", () => {
    const polyline = trajectoryFloorPolyline(
      [
        { x: 5, y: 10 },
        { x: 0, y: 0 },
      ],
      BOUNDS,
      DIMS,
      0,
    );
    expect(polyline).toEqual([
      [0, 0, 0],
      [-20, 0, 30],
    ]);
  });
});

describe("sampleTrajectoryAtProgress", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 20 },
  ];

  it("returns the first point at progress 0", () => {
    expect(sampleTrajectoryAtProgress(points, 0, BOUNDS, DIMS, 0)).toEqual([-20, 0, 30]);
  });

  it("returns the last point at progress 1", () => {
    expect(sampleTrajectoryAtProgress(points, 1, BOUNDS, DIMS, 0)).toEqual([20, 0, -30]);
  });

  it("interpolates between points at the midpoint", () => {
    expect(sampleTrajectoryAtProgress(points, 0.5, BOUNDS, DIMS, 0)).toEqual([0, 0, 0]);
  });

  it("clamps progress outside the unit interval", () => {
    expect(sampleTrajectoryAtProgress(points, 2, BOUNDS, DIMS, 0)).toEqual([20, 0, -30]);
    expect(sampleTrajectoryAtProgress(points, -1, BOUNDS, DIMS, 0)).toEqual([-20, 0, 30]);
  });
});

describe("densityPatchExtent", () => {
  it("scales a replay cell size onto the scene footprint per axis", () => {
    expect(densityPatchExtent(1.5, BOUNDS, DIMS)).toEqual({ sizeX: 6, sizeZ: 4.5 });
  });

  it("falls back to a small proportional patch when a span is degenerate", () => {
    const degenerate: ReplayRoomBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const extent = densityPatchExtent(1.5, degenerate, DIMS);
    expect(extent.sizeX).toBeCloseTo(2, 5);
    expect(extent.sizeZ).toBeCloseTo(3, 5);
  });
});

describe("buildFlowRibbonGeometry", () => {
  it("returns an empty ribbon for a degenerate (<2 point) path", () => {
    expect(buildFlowRibbonGeometry([], 0.5).positions).toHaveLength(0);
    const single = buildFlowRibbonGeometry([[0, 0, 0]], 0.5);
    expect(single.positions).toHaveLength(0);
    expect(single.index).toHaveLength(0);
    expect(single.length).toBe(0);
  });

  it("extrudes a straight path into a constant-width strip with exact UVs and arc length", () => {
    const path: WorldPoint[] = [
      [-2, 0, 0],
      [0, 0, 0],
      [2, 0, 0],
    ];
    const ribbon = buildFlowRibbonGeometry(path, 0.5);

    // Two vertices (left +Z, right −Z) per point.
    expect(Array.from(ribbon.positions)).toEqual([
      -2, 0, 0.5, -2, 0, -0.5,
      0, 0, 0.5, 0, 0, -0.5,
      2, 0, 0.5, 2, 0, -0.5,
    ]);
    // u runs 0 → 1 along the path; v is 0 (left) / 1 (right).
    expect(Array.from(ribbon.uv)).toEqual([0, 0, 0, 1, 0.5, 0, 0.5, 1, 1, 0, 1, 1]);
    // Arc length in scene units, per vertex.
    expect(Array.from(ribbon.dist)).toEqual([0, 0, 2, 2, 4, 4]);
    // Two triangles per segment.
    expect(Array.from(ribbon.index)).toEqual([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
    expect(ribbon.length).toBe(4);
  });

  it("keeps every edge exactly halfWidth from the centreline through a corner mitre", () => {
    const halfWidth = 0.5;
    const path: WorldPoint[] = [
      [0, 0, 0],
      [0, 0, 4],
      [4, 0, 4],
    ];
    const ribbon = buildFlowRibbonGeometry(path, halfWidth);

    // The mitred middle point (index 1) sits at the corner (0, 0, 4); both of
    // its band vertices stay exactly halfWidth from it (a unit perpendicular,
    // not a scaled one).
    const corner: WorldPoint = [0, 0, 4];
    const left: WorldPoint = [ribbon.positions[6] ?? 0, ribbon.positions[7] ?? 0, ribbon.positions[8] ?? 0];
    const right: WorldPoint = [ribbon.positions[9] ?? 0, ribbon.positions[10] ?? 0, ribbon.positions[11] ?? 0];
    const dist = (a: WorldPoint, b: WorldPoint): number =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(dist(left, corner)).toBeCloseTo(halfWidth, 5);
    expect(dist(right, corner)).toBeCloseTo(halfWidth, 5);
    expect(ribbon.length).toBeCloseTo(8, 5);
  });
});
