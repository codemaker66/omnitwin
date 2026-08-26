import type { TwinScanNode } from "@omnitwin/types";
import { e57PointToThree } from "./twin-basis.js";

// -----------------------------------------------------------------------------
// glide-route — the pure geometry under the continuous glide.
//
// A glide travels a POLYLINE of scan centres, never free space: the pano
// crossfade is only optically honest on the straight line between the two
// scan positions being blended, so the route is the one curve the camera is
// allowed to ride. Everything here is arc-length parameterised — the walker
// owns a single scalar `s` (metres along the route) and derives segment,
// position and tangent from it each frame. Corners are therefore square in
// POSITION (by optical necessity) and get their rounding from the camera's
// yaw smoothing instead, which is where the eye actually reads it.
//
// Pure and allocation-light so useTwinGlide's rAF tick can call these every
// frame; tested with hand-computed geometry in __tests__/glide-route.test.ts.
// -----------------------------------------------------------------------------

/** Releasing within this arc distance past a node stops there rather than
 *  carrying on to the next — a release at a doorway lands in the doorway. */
export const GLIDE_STOP_SNAP_M = 0.35;

export interface GlideRoute {
  /** Node ids along the polyline, de-duplicated of zero-length steps. */
  readonly nodeIds: readonly string[];
  /** Node positions in three space (y-up), index-aligned with nodeIds. */
  readonly points: readonly (readonly [number, number, number])[];
  /** Cumulative arc length at each node; cums[0] = 0. */
  readonly cums: readonly number[];
  /** Total arc length — cums at the final node. */
  readonly total: number;
}

export interface GlideSegment {
  /** Index of the active segment (between nodeIds[index] and [index+1]). */
  readonly index: number;
  readonly fromId: string;
  readonly toId: string;
  /** 0→1 fraction through the active segment. */
  readonly frac: number;
}

const MIN_STEP_M = 1e-6;

/**
 * Build a route through the named nodes, or null when it cannot carry a
 * glide: fewer than two distinct positions, or an unknown id (an unknown id
 * is a caller bug, and gliding "most of" a route would hide it).
 */
export function buildGlideRoute(
  nodeIds: readonly string[],
  nodesById: ReadonlyMap<string, TwinScanNode>,
): GlideRoute | null {
  const ids: string[] = [];
  const points: [number, number, number][] = [];
  const cums: number[] = [];
  let total = 0;
  for (const id of nodeIds) {
    const scanNode = nodesById.get(id);
    if (scanNode === undefined) {
      return null;
    }
    const point = e57PointToThree(scanNode.pose.t);
    const previous = points[points.length - 1];
    if (previous !== undefined) {
      const step = Math.hypot(
        point[0] - previous[0],
        point[1] - previous[1],
        point[2] - previous[2],
      );
      if (step < MIN_STEP_M) {
        continue; // a duplicate position cannot host a segment
      }
      total += step;
    }
    ids.push(id);
    points.push(point);
    cums.push(total);
  }
  if (ids.length < 2) {
    return null;
  }
  return { nodeIds: ids, points, cums, total };
}

/**
 * Extend a route by one node — the hold-to-walk case, where the next segment
 * is only known once the walker nears the current route's end. Returns a NEW
 * route (the walker holds routes in refs across frames; mutation would let a
 * mid-frame reader see a half-updated arc table), or null when the node is
 * unknown, repeats the tail, or adds no distance.
 */
export function appendToGlideRoute(
  route: GlideRoute,
  nodeId: string,
  nodesById: ReadonlyMap<string, TwinScanNode>,
): GlideRoute | null {
  const scanNode = nodesById.get(nodeId);
  const tail = route.points[route.points.length - 1];
  if (scanNode === undefined || tail === undefined) {
    return null;
  }
  if (route.nodeIds[route.nodeIds.length - 1] === nodeId) {
    return null;
  }
  const point = e57PointToThree(scanNode.pose.t);
  const step = Math.hypot(point[0] - tail[0], point[1] - tail[1], point[2] - tail[2]);
  if (step < MIN_STEP_M) {
    return null;
  }
  return {
    nodeIds: [...route.nodeIds, nodeId],
    points: [...route.points, point],
    cums: [...route.cums, route.total + step],
    total: route.total + step,
  };
}

/** The active segment at arc distance `s` (clamped to the route). A distance
 *  exactly on an interior node belongs to the FOLLOWING segment at frac 0 —
 *  the walk stands on that node about to depart it — while the route's end
 *  stays on the final segment at frac 1. */
export function segmentAlongRoute(route: GlideRoute, s: number): GlideSegment {
  const clamped = Math.min(Math.max(s, 0), route.total);
  const lastSegment = route.nodeIds.length - 2;
  let index = lastSegment;
  for (let i = 0; i < route.cums.length - 1; i += 1) {
    const end = route.cums[i + 1];
    if (end !== undefined && clamped < end) {
      index = i;
      break;
    }
  }
  const start = route.cums[index] ?? 0;
  const end = route.cums[index + 1] ?? route.total;
  const length = end - start;
  return {
    index,
    fromId: route.nodeIds[index] ?? "",
    toId: route.nodeIds[index + 1] ?? "",
    frac: length < MIN_STEP_M ? 1 : Math.min((clamped - start) / length, 1),
  };
}

/** World position (three space) at arc distance `s`. */
export function positionAlongRoute(
  route: GlideRoute,
  s: number,
): [number, number, number] {
  const { index, frac } = segmentAlongRoute(route, s);
  const a = route.points[index];
  const b = route.points[index + 1];
  if (a === undefined || b === undefined) {
    return [0, 0, 0];
  }
  return [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  ];
}

/** Horizontal unit tangent [x, z] of the active segment at `s` — the heading
 *  the camera's yaw eases toward. Vertical travel (a stair) keeps whatever
 *  horizontal component exists; a perfectly vertical segment yields [0, 0]
 *  and the caller holds its previous heading. */
export function tangentAlongRoute(route: GlideRoute, s: number): [number, number] {
  const { index } = segmentAlongRoute(route, s);
  const a = route.points[index];
  const b = route.points[index + 1];
  if (a === undefined || b === undefined) {
    return [0, 0];
  }
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const flat = Math.hypot(dx, dz);
  if (flat < MIN_STEP_M) {
    return [0, 0];
  }
  return [dx / flat, dz / flat];
}

/**
 * Where a released glide should come to rest: the next node AHEAD, so easing
 * out always reads as completing the step in motion — never as sliding
 * backward — except within GLIDE_STOP_SNAP_M past a PASSED node, where "just
 * here" is the honest answer. The route's origin (index 0) is never eligible:
 * a tap that releases centimetres into its first segment must still complete
 * that step, exactly as a discrete hop always completed.
 */
export function stopArcForRelease(route: GlideRoute, s: number): number {
  const clamped = Math.min(Math.max(s, 0), route.total);
  for (let i = 1; i < route.cums.length; i += 1) {
    const arc = route.cums[i];
    if (arc === undefined) {
      continue;
    }
    if (clamped <= arc + GLIDE_STOP_SNAP_M) {
      return arc;
    }
  }
  return route.total;
}
