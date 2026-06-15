import type { SpaceDimensions } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Cockpit overlay projection — replay metre-frame → scene render-space.
//
// The guest-flow replay artifact lives in its own 2D metre frame (navmesh
// roomBounds). The editable scene room is centred on the origin and spans
// dims.width on X and dims.length on Z (render units = metres × RENDER_SCALE).
// These pure helpers map replay coordinates onto the *current* room footprint
// so the in-canvas overlays pin to the floor and track the camera under
// orbit / pan / zoom.
//
// The mapping is a proportional fit onto the loaded room footprint, not a
// survey-grade registration — it is honest "simulated guest flow" planning
// evidence, never a measured route. The replay Y axis is flipped onto scene Z
// so plan "up" reads as into the screen (matching the dev page's 2D overlay).
// ---------------------------------------------------------------------------

export interface ReplayRoomBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface ReplayPoint2D {
  readonly x: number;
  readonly y: number;
}

export interface SceneFootprint {
  /** Half-extent on the scene X axis, render units. */
  readonly halfWidth: number;
  /** Half-extent on the scene Z axis, render units. */
  readonly halfLength: number;
}

export type WorldPoint = readonly [number, number, number];

/** Small lift off the floor so overlay geometry never z-fights the floor mesh. */
export const DEFAULT_OVERLAY_FLOOR_Y = 0.05;

/** Fraction of a room dimension used as a fallback patch size when a replay
 *  bounds span is degenerate (a single-cell or empty replay). */
const DEGENERATE_PATCH_FRACTION = 0.05;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function sceneFootprint(dimensions: SpaceDimensions): SceneFootprint {
  return { halfWidth: dimensions.width / 2, halfLength: dimensions.length / 2 };
}

/** Normalise a replay metre-frame point into the unit square of its room
 *  bounds. Degenerate spans collapse to the centre; out-of-range values clamp. */
export function normaliseReplayPoint(
  point: ReplayPoint2D,
  bounds: ReplayRoomBounds,
): { readonly nx: number; readonly ny: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const nx = spanX > 0 ? clamp01((point.x - bounds.minX) / spanX) : 0.5;
  const ny = spanY > 0 ? clamp01((point.y - bounds.minY) / spanY) : 0.5;
  return { nx, ny };
}

/** Project a replay metre-frame point onto the scene floor, returning a
 *  render-space [x, y, z] triple. Replay Y maps onto scene Z (flipped). */
export function projectReplayPointToFloor(
  point: ReplayPoint2D,
  bounds: ReplayRoomBounds,
  dimensions: SpaceDimensions,
  floorY: number = DEFAULT_OVERLAY_FLOOR_Y,
): WorldPoint {
  const { nx, ny } = normaliseReplayPoint(point, bounds);
  const worldX = (nx - 0.5) * dimensions.width;
  const worldZ = (0.5 - ny) * dimensions.length;
  return [worldX, floorY, worldZ];
}

/** Project every point of a trajectory, preserving order — a floor polyline. */
export function trajectoryFloorPolyline(
  points: readonly ReplayPoint2D[],
  bounds: ReplayRoomBounds,
  dimensions: SpaceDimensions,
  floorY: number = DEFAULT_OVERLAY_FLOOR_Y,
): WorldPoint[] {
  return points.map((point) => projectReplayPointToFloor(point, bounds, dimensions, floorY));
}

function lerpWorld(a: WorldPoint, b: WorldPoint, frac: number): WorldPoint {
  return [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  ];
}

/** Sample a trajectory's world position at progress t ∈ [0, 1], interpolating
 *  between adjacent projected points for smooth mote motion. */
export function sampleTrajectoryAtProgress(
  points: readonly ReplayPoint2D[],
  t: number,
  bounds: ReplayRoomBounds,
  dimensions: SpaceDimensions,
  floorY: number = DEFAULT_OVERLAY_FLOOR_Y,
): WorldPoint {
  if (points.length === 0) return [0, floorY, 0];
  const first = points[0];
  if (points.length === 1 || first === undefined) {
    return projectReplayPointToFloor(first ?? { x: 0, y: 0 }, bounds, dimensions, floorY);
  }
  const clampedT = clamp01(t);
  const lastIndex = points.length - 1;
  const scaled = lastIndex * clampedT;
  const i = Math.min(lastIndex, Math.floor(scaled));
  const nextIndex = Math.min(lastIndex, i + 1);
  const frac = scaled - i;
  const a = points[i] ?? first;
  const b = points[nextIndex] ?? first;
  return lerpWorld(
    projectReplayPointToFloor(a, bounds, dimensions, floorY),
    projectReplayPointToFloor(b, bounds, dimensions, floorY),
    frac,
  );
}

/** Render-space size of a density cell, scaled per axis onto the footprint. */
export function densityPatchExtent(
  cellSizeM: number,
  bounds: ReplayRoomBounds,
  dimensions: SpaceDimensions,
): { readonly sizeX: number; readonly sizeZ: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const sizeX = spanX > 0
    ? (cellSizeM / spanX) * dimensions.width
    : dimensions.width * DEGENERATE_PATCH_FRACTION;
  const sizeZ = spanY > 0
    ? (cellSizeM / spanY) * dimensions.length
    : dimensions.length * DEGENERATE_PATCH_FRACTION;
  return { sizeX, sizeZ };
}
