import type { SpaceDimensions } from "@omnitwin/types";
import {
  computeCameraTarget,
  computeDistanceLimits,
  computeFramingDistance,
} from "./camera-rig.js";

// ---------------------------------------------------------------------------
// Cockpit planning camera — the pose the Flow lens eases to on entry.
//
// Flow overlays live flat on the floor; from an eye-level angle they read as
// edge-on slivers. So when the planner switches into the Flow lens we lift the
// camera to a gentle, elevated planning pitch and frame the whole floor, so the
// guest-flow ribbons present themselves the moment you switch in. The viewer's
// current azimuth is preserved so the move feels like a gentle lift rather than
// a disorienting spin to a new side of the room.
//
// Pure spherical math — the component just eases toward this pose.
// ---------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
}

/** Elevated planning pitch, radians from straight-down (the OrbitControls polar
 *  angle). ~0.7 rad ≈ 40° keeps the floor clearly readable while preserving the
 *  room's depth and wall context — a "gentle" top-down, not a flat plan. */
export const PLANNING_POLAR_ANGLE = 0.7;

/** Margin applied when framing the room so it sits comfortably inside the view. */
const PLANNING_FRAMING_MARGIN = 1.25;

/** A slight default azimuth (radians) used only when the current camera sits
 *  directly above the target and its azimuth is undefined. */
const AZIMUTH_FALLBACK = -0.2;

const DEGENERATE_RADIUS = 1e-3;

/** Azimuth (radians) of a camera position about its target, in the XZ plane;
 *  azimuth 0 looks from +Z toward −Z. A camera directly overhead has no defined
 *  azimuth, so it falls back to a slight angle that keeps the framed view from
 *  collapsing to a flat plan. */
export function azimuthOf(position: Vec3, target: Vec3): number {
  const dx = position[0] - target[0];
  const dz = position[2] - target[2];
  if (Math.hypot(dx, dz) < DEGENERATE_RADIUS) return AZIMUTH_FALLBACK;
  return Math.atan2(dx, dz);
}

/** Spherical → world position about a target (OrbitControls convention:
 *  polarAngle measured from +Y, azimuth measured in the XZ plane from +Z). */
export function sphericalPosition(
  target: Vec3,
  distance: number,
  polarAngle: number,
  azimuth: number,
): Vec3 {
  const sinP = Math.sin(polarAngle);
  return [
    target[0] + distance * sinP * Math.sin(azimuth),
    target[1] + distance * Math.cos(polarAngle),
    target[2] + distance * sinP * Math.cos(azimuth),
  ];
}

/** The Flow-lens planning pose: recentre on the room, lift to the planning
 *  pitch, frame the whole floor, and preserve the viewer's current azimuth. */
export function planningCameraGoal(
  dimensions: SpaceDimensions,
  currentPosition: Vec3,
  currentTarget: Vec3,
  aspect: number,
  verticalFovDeg: number,
): CameraPose {
  const target = computeCameraTarget(dimensions, aspect);
  const limits = computeDistanceLimits(dimensions);
  const framing = computeFramingDistance(dimensions, aspect, verticalFovDeg, PLANNING_FRAMING_MARGIN);
  const distance = Math.min(limits.maxDistance, Math.max(limits.minDistance, framing));
  const azimuth = azimuthOf(currentPosition, currentTarget);
  const position = sphericalPosition(target, distance, PLANNING_POLAR_ANGLE, azimuth);
  return { position, target };
}
