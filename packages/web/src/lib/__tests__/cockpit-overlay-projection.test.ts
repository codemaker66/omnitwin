import { describe, expect, it } from "vitest";
import type { SpaceDimensions } from "@omnitwin/types";
import {
  DEFAULT_OVERLAY_FLOOR_Y,
  densityPatchExtent,
  normaliseReplayPoint,
  projectReplayPointToFloor,
  sampleTrajectoryAtProgress,
  sceneFootprint,
  trajectoryFloorPolyline,
  type ReplayRoomBounds,
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
