import type { SpaceDimensions } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CameraBookmark {
  readonly id: string;
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly kind?: CameraBookmarkKind;
  readonly reference?: CameraReferenceMetadata;
}

export interface CameraTransition {
  readonly fromPosition: readonly [number, number, number];
  readonly fromTarget: readonly [number, number, number];
  readonly toPosition: readonly [number, number, number];
  readonly toTarget: readonly [number, number, number];
  readonly duration: number;
  /** Elapsed time in seconds. */
  readonly elapsed: number;
}

export type CameraBookmarkKind = "default" | "custom" | "reference";

export type CameraReferenceSource = "floor" | "furniture";

export type CameraEyeHeightMode = "sitting" | "standing" | "custom";

export interface CameraReferenceMetadata {
  readonly source: CameraReferenceSource;
  readonly sourceLabel: string;
  /** Render-space X/Z point for the camera reference. */
  readonly point: readonly [number, number];
  /** Floor or platform Y coordinate. Heights are real metres and not render-scaled. */
  readonly baseY: number;
  /** Item yaw in radians. Null means face the room centre from the chosen point. */
  readonly yaw: number | null;
  readonly eyeHeightM: number;
  readonly heightMode: CameraEyeHeightMode;
}

export interface CameraReferenceBookmarkInput {
  readonly id: string;
  readonly name: string;
  readonly source: CameraReferenceSource;
  readonly sourceLabel: string;
  readonly point: readonly [number, number];
  readonly baseY?: number;
  readonly yaw: number | null;
  readonly heightMode: CameraEyeHeightMode;
  readonly customEyeHeightM?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum transition duration in seconds (very short hops). */
export const MIN_TRANSITION_DURATION = 0.3;

/** Maximum transition duration in seconds (long traversals). */
export const MAX_TRANSITION_DURATION = 1.5;

/**
 * Distance in meters that maps to MAX_TRANSITION_DURATION.
 * Movements longer than this still cap at MAX_TRANSITION_DURATION.
 */
export const REFERENCE_DISTANCE = 30;

export const SITTING_EYE_HEIGHT_M = 1.18;

export const STANDING_EYE_HEIGHT_M = 1.65;

export const DEFAULT_CUSTOM_EYE_HEIGHT_M = 1.5;

export const MIN_CUSTOM_EYE_HEIGHT_M = 0.7;

export const MAX_CUSTOM_EYE_HEIGHT_M = 2.2;

const REFERENCE_TARGET_DISTANCE = 6;

const ROOM_CENTRE_EPSILON = 0.25;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Smooth ease-in-out cubic: accelerates then decelerates.
 * At t=0 returns 0, at t=1 returns 1.
 * Used for camera bookmark transitions — feels natural and professional.
 */
export function easeInOutCubic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5
    ? 4 * t * t * t
    : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Linearly interpolates between two 3D positions.
 * At t=0 returns `from`, at t=1 returns `to`.
 */
export function lerpPosition(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): readonly [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    from[0] + (to[0] - from[0]) * clamped,
    from[1] + (to[1] - from[1]) * clamped,
    from[2] + (to[2] - from[2]) * clamped,
  ];
}

/**
 * Euclidean distance between two 3D points.
 */
export function distance3D(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Computes an appropriate transition duration based on how far
 * the camera needs to travel (both position and target).
 *
 * Short hops (< 2m): MIN_TRANSITION_DURATION (snappy).
 * Long traversals: scales linearly up to MAX_TRANSITION_DURATION.
 */
export function computeTransitionDuration(
  fromPosition: readonly [number, number, number],
  toPosition: readonly [number, number, number],
  fromTarget: readonly [number, number, number],
  toTarget: readonly [number, number, number],
): number {
  const posDist = distance3D(fromPosition, toPosition);
  const targetDist = distance3D(fromTarget, toTarget);
  // Use the larger of the two movements to determine duration.
  const maxDist = Math.max(posDist, targetDist);

  if (maxDist < 0.01) return MIN_TRANSITION_DURATION;

  const fraction = Math.min(1, maxDist / REFERENCE_DISTANCE);
  return MIN_TRANSITION_DURATION + fraction * (MAX_TRANSITION_DURATION - MIN_TRANSITION_DURATION);
}

/**
 * Generates a unique bookmark ID from a counter.
 * Deterministic for testing — real usage increments a module-level counter.
 */
export function generateBookmarkId(counter: number): string {
  return `bookmark-${String(counter)}`;
}

export function resolveCameraEyeHeight(
  mode: CameraEyeHeightMode,
  customEyeHeightM: number = DEFAULT_CUSTOM_EYE_HEIGHT_M,
): number {
  switch (mode) {
    case "sitting":
      return SITTING_EYE_HEIGHT_M;
    case "standing":
      return STANDING_EYE_HEIGHT_M;
    case "custom":
      return Math.min(
        MAX_CUSTOM_EYE_HEIGHT_M,
        Math.max(MIN_CUSTOM_EYE_HEIGHT_M, customEyeHeightM),
      );
  }
  const exhaustive: never = mode;
  return exhaustive;
}

function computeReferenceTarget(
  point: readonly [number, number],
  baseY: number,
  eyeHeightM: number,
  yaw: number | null,
): readonly [number, number, number] {
  const y = baseY + eyeHeightM;
  if (yaw !== null) {
    return [
      point[0] - Math.sin(yaw) * REFERENCE_TARGET_DISTANCE,
      y,
      point[1] - Math.cos(yaw) * REFERENCE_TARGET_DISTANCE,
    ];
  }

  const centreDx = -point[0];
  const centreDz = -point[1];
  const dist = Math.sqrt(centreDx * centreDx + centreDz * centreDz);
  if (dist < ROOM_CENTRE_EPSILON) {
    return [point[0], y, point[1] - REFERENCE_TARGET_DISTANCE];
  }

  return [
    point[0] + (centreDx / dist) * REFERENCE_TARGET_DISTANCE,
    y,
    point[1] + (centreDz / dist) * REFERENCE_TARGET_DISTANCE,
  ];
}

export function createCameraReferenceBookmark(
  input: CameraReferenceBookmarkInput,
): CameraBookmark {
  const baseY = input.baseY ?? 0;
  const eyeHeightM = resolveCameraEyeHeight(input.heightMode, input.customEyeHeightM);
  const metadata: CameraReferenceMetadata = {
    source: input.source,
    sourceLabel: input.sourceLabel,
    point: input.point,
    baseY,
    yaw: input.yaw,
    eyeHeightM,
    heightMode: input.heightMode,
  };

  return {
    id: input.id,
    name: input.name,
    kind: "reference",
    reference: metadata,
    position: [input.point[0], baseY + eyeHeightM, input.point[1]],
    target: computeReferenceTarget(input.point, baseY, eyeHeightM, input.yaw),
  };
}

export function updateCameraReferenceHeight(
  bookmark: CameraBookmark,
  heightMode: CameraEyeHeightMode,
  customEyeHeightM?: number,
): CameraBookmark {
  if (bookmark.kind !== "reference" || bookmark.reference === undefined) return bookmark;
  return createCameraReferenceBookmark({
    id: bookmark.id,
    name: bookmark.name,
    source: bookmark.reference.source,
    sourceLabel: bookmark.reference.sourceLabel,
    point: bookmark.reference.point,
    baseY: bookmark.reference.baseY,
    yaw: bookmark.reference.yaw,
    heightMode,
    customEyeHeightM: customEyeHeightM ?? bookmark.reference.eyeHeightM,
  });
}

/**
 * Computes the three default camera bookmarks for a room:
 *
 * 1. **Entrance View** — Standing just inside the entrance, looking across the room.
 *    Camera at eye level near one end of the longest axis.
 *
 * 2. **Overhead View** — Bird's-eye view looking straight down.
 *    Camera centered above the room at ~1.5× the longest dimension.
 *
 * 3. **Stage View** — From the opposite end, looking back toward the entrance.
 *    Like standing on a stage looking out at the audience.
 */
export function computeDefaultBookmarks(
  dimensions: SpaceDimensions,
): readonly CameraBookmark[] {
  const { width, length } = dimensions;
  const maxDim = Math.max(width, length);
  const minDim = Math.min(width, length);

  // Entrance View: near one end, eye level, slight lateral offset
  const entranceAlongAxis = maxDim * 0.38;
  const entranceLateral = minDim * 0.08;
  const eyeLevel = 1.7;
  const entrancePosition: readonly [number, number, number] =
    width >= length
      ? [entranceAlongAxis, eyeLevel, entranceLateral]
      : [entranceLateral, eyeLevel, entranceAlongAxis];
  const entranceTarget: readonly [number, number, number] = [0, 1.5, 0];

  // Overhead View: looking straight down from above
  const overheadHeight = maxDim * 1.0;
  const overheadPosition: readonly [number, number, number] = [0, overheadHeight, 0.01];
  const overheadTarget: readonly [number, number, number] = [0, 0, 0];

  // Stage View: opposite end from entrance, looking back
  const stagePosition: readonly [number, number, number] =
    width >= length
      ? [-entranceAlongAxis, eyeLevel, -entranceLateral]
      : [-entranceLateral, eyeLevel, -entranceAlongAxis];
  const stageTarget: readonly [number, number, number] = [0, 1.5, 0];

  return [
    {
      id: "default-entrance",
      name: "Entrance View",
      kind: "default",
      position: entrancePosition,
      target: entranceTarget,
    },
    {
      id: "default-overhead",
      name: "Overhead View",
      kind: "default",
      position: overheadPosition,
      target: overheadTarget,
    },
    {
      id: "default-stage",
      name: "Stage View",
      kind: "default",
      position: stagePosition,
      target: stageTarget,
    },
  ] as const;
}

/**
 * Advances a camera transition by the given delta time.
 * Returns the new elapsed time, clamped to the transition duration.
 */
export function advanceTransition(transition: CameraTransition, delta: number): number {
  return Math.min(transition.duration, transition.elapsed + delta);
}

/**
 * Returns the interpolated camera position and target for a transition at a given elapsed time.
 * Uses easeInOutCubic for smooth acceleration/deceleration.
 */
export function sampleTransition(transition: CameraTransition): {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly done: boolean;
} {
  const rawT = transition.duration > 0
    ? transition.elapsed / transition.duration
    : 1;
  const t = easeInOutCubic(rawT);

  return {
    position: lerpPosition(transition.fromPosition, transition.toPosition, t),
    target: lerpPosition(transition.fromTarget, transition.toTarget, t),
    done: transition.elapsed >= transition.duration,
  };
}
