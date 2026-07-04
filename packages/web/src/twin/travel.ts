import type { TwinScanNode } from "@omnitwin/types";
import { e57PointToThree } from "./twin-basis.js";

// -----------------------------------------------------------------------------
// travel — Street View travel-target selection, pure and unit-tested.
//
// Given where the visitor is pointing (a click ray, or a WASD direction in
// camera space), pick which neighbouring scan node they mean. The idiom is
// Google Street View / Matterport: click somewhere on screen and you travel
// toward it; W walks forward, A/D strafe, S backs up.
// -----------------------------------------------------------------------------

/** Travel cone half-angle: directions outside ~55° of a neighbour don't count. */
export const TRAVEL_CONE_COS = Math.cos((55 * Math.PI) / 180);

/**
 * Pick the best neighbour in the pointed direction, or null when nothing
 * walkable lies inside the travel cone.
 *
 * Alignment dominates; a mild nearness bonus breaks ties between two nodes
 * down the same corridor so travel takes the *next* step, not a leap.
 * The vertical component is damped (×0.35) — pointing slightly at the floor
 * or ceiling should still walk you forward, matching Street View.
 */
export function pickTravelTarget(
  fromThree: readonly [number, number, number],
  dirThree: readonly [number, number, number],
  neighborIds: readonly string[],
  nodesById: ReadonlyMap<string, TwinScanNode>,
): string | null {
  const dx = dirThree[0];
  const dy = dirThree[1] * 0.35;
  const dz = dirThree[2];
  const norm = Math.hypot(dx, dy, dz);
  if (norm < 1e-6) {
    return null;
  }
  const d: [number, number, number] = [dx / norm, dy / norm, dz / norm];

  let bestId: string | null = null;
  let bestScore = -Infinity;
  for (const id of neighborIds) {
    const node = nodesById.get(id);
    if (node === undefined) {
      continue;
    }
    const p = e57PointToThree(node.pose.t);
    const vx = p[0] - fromThree[0];
    const vy = (p[1] - fromThree[1]) * 0.35;
    const vz = p[2] - fromThree[2];
    const dist = Math.hypot(vx, vy, vz);
    if (dist < 1e-6) {
      continue;
    }
    const align = (vx * d[0] + vy * d[1] + vz * d[2]) / dist;
    if (align < TRAVEL_CONE_COS) {
      continue;
    }
    // Alignment first; a gentle 1/dist bonus prefers the next step over a
    // far node down the same line (0.15 ≈ beats a 3% alignment edge at 5 m).
    const score = align + 0.15 / Math.max(dist, 1);
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * WASD key → direction in camera space expressed as (forwardSign, rightSign).
 * Arrow keys mirror WASD. Returns null for any other key.
 */
export function travelKeyToDirection(
  key: string,
): { forward: number; right: number } | null {
  switch (key.toLowerCase()) {
    case "w":
    case "arrowup":
      return { forward: 1, right: 0 };
    case "s":
    case "arrowdown":
      return { forward: -1, right: 0 };
    case "a":
    case "arrowleft":
      return { forward: 0, right: -1 };
    case "d":
    case "arrowright":
      return { forward: 0, right: 1 };
    default:
      return null;
  }
}
