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

// ---------------------------------------------------------------------------
// Flow ribbon geometry — turn a floor polyline into a smooth glowing band.
//
// A guest-flow trajectory is a thin polyline; a single 1px line reads as a
// hairline and disappears under the photoreal render. To match the reference
// look (a luminous cyan ribbon flowing along the floor) we extrude the polyline
// into a flat triangle strip of constant half-width, carrying:
//   • a `uv` per vertex (u = normalised progress along the path 0→1, v = across
//     the band 0=left edge, 1=right edge) so the shader can soften the edges
//     and fade the ends, and
//   • an `aDist` per vertex (arc length in scene units) so a travelling glow
//     pulse keeps a constant wavelength regardless of how the replay sampled
//     the path.
// Pure data only — the caller uploads it to a BufferGeometry. The mapping is
// proportional planning evidence, never a surveyed route.
// ---------------------------------------------------------------------------

export interface FlowRibbonGeometry {
  /** xyz per vertex; two vertices (left, right) per polyline point. */
  readonly positions: Float32Array;
  /** uv per vertex: u = progress 0→1 along the path, v = 0 (left) / 1 (right). */
  readonly uv: Float32Array;
  /** Arc length in scene units per vertex, for a constant-wavelength flow pulse. */
  readonly dist: Float32Array;
  /** Triangle indices, two triangles per segment. */
  readonly index: Uint16Array;
  /** Total arc length of the centreline, in scene units. */
  readonly length: number;
}

const EMPTY_RIBBON: FlowRibbonGeometry = {
  positions: new Float32Array(0),
  uv: new Float32Array(0),
  dist: new Float32Array(0),
  index: new Uint16Array(0),
  length: 0,
};

const RIBBON_EPSILON = 1e-6;

/** Extrude a projected floor polyline into a constant-width ribbon strip. The
 *  ribbon lies in the XZ plane at each point's Y; the band is offset along the
 *  XZ perpendicular of the (averaged) path tangent so corners mitre cleanly. */
export function buildFlowRibbonGeometry(
  points: readonly WorldPoint[],
  halfWidth: number,
): FlowRibbonGeometry {
  const n = points.length;
  if (n < 2) return EMPTY_RIBBON;

  // Cumulative arc length (XZ) per point.
  const cum = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const prev = cum[i - 1] ?? 0;
    if (a === undefined || b === undefined) {
      cum[i] = prev;
      continue;
    }
    cum[i] = prev + Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  const total = cum[n - 1] ?? 0;
  const invTotal = total > RIBBON_EPSILON ? 1 / total : 0;

  const positions: number[] = [];
  const uv: number[] = [];
  const dist: number[] = [];

  // Last valid perpendicular, reused across degenerate (zero-length) segments.
  let lastPerpX = 0;
  let lastPerpZ = 1;

  for (let i = 0; i < n; i += 1) {
    const p = points[i];
    if (p === undefined) continue;

    // Tangent = normalised sum of adjacent segment directions (XZ only).
    let tx = 0;
    let tz = 0;
    const prev = points[i - 1];
    const next = points[i + 1];
    if (prev !== undefined) {
      const dx = p[0] - prev[0];
      const dz = p[2] - prev[2];
      const l = Math.hypot(dx, dz);
      if (l > RIBBON_EPSILON) {
        tx += dx / l;
        tz += dz / l;
      }
    }
    if (next !== undefined) {
      const dx = next[0] - p[0];
      const dz = next[2] - p[2];
      const l = Math.hypot(dx, dz);
      if (l > RIBBON_EPSILON) {
        tx += dx / l;
        tz += dz / l;
      }
    }

    // Perpendicular in XZ: rotate the tangent 90°; reuse last when degenerate.
    let perpX = -tz;
    let perpZ = tx;
    const pl = Math.hypot(perpX, perpZ);
    if (pl > RIBBON_EPSILON) {
      perpX /= pl;
      perpZ /= pl;
      lastPerpX = perpX;
      lastPerpZ = perpZ;
    } else {
      perpX = lastPerpX;
      perpZ = lastPerpZ;
    }

    const arc = cum[i] ?? 0;
    const u = arc * invTotal;
    // Left vertex (+perp) then right vertex (−perp).
    positions.push(p[0] + perpX * halfWidth, p[1], p[2] + perpZ * halfWidth);
    positions.push(p[0] - perpX * halfWidth, p[1], p[2] - perpZ * halfWidth);
    uv.push(u, 0, u, 1);
    dist.push(arc, arc);
  }

  const index: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const left = i * 2;
    const right = i * 2 + 1;
    const nextLeft = i * 2 + 2;
    const nextRight = i * 2 + 3;
    index.push(left, right, nextRight, left, nextRight, nextLeft);
  }

  return {
    positions: new Float32Array(positions),
    uv: new Float32Array(uv),
    dist: new Float32Array(dist),
    index: new Uint16Array(index),
    length: total,
  };
}
