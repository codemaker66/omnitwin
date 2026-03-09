import type { SpaceDimensions } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Walking speed in metres per second. */
export const MOVE_SPEED = 3.0;

/** Mouse sensitivity — radians per pixel of mouse movement. */
export const LOOK_SENSITIVITY = 0.002;

/** Maximum pitch angle in radians (±89° prevents gimbal flip). */
export const PITCH_LIMIT = (89 * Math.PI) / 180;

/** Distance from wall surface to camera to prevent clipping (metres). */
export const WALL_MARGIN = 0.3;

// ---------------------------------------------------------------------------
// Movement input
// ---------------------------------------------------------------------------

export interface MovementInput {
  readonly forward: boolean;
  readonly backward: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/**
 * Returns true if any movement key is currently active.
 */
export function isMoving(input: MovementInput): boolean {
  return input.forward || input.backward || input.left || input.right;
}

// ---------------------------------------------------------------------------
// Movement computation
// ---------------------------------------------------------------------------

export interface MovementDelta {
  readonly dx: number;
  readonly dz: number;
}

/**
 * Computes world-space XZ displacement from movement input.
 *
 * Forward/backward moves along the camera's look direction (projected to XZ).
 * Left/right strafes perpendicular to the look direction.
 *
 * @param input - Which movement keys are held
 * @param yaw - Camera Y-axis rotation in radians (0 = looking toward -Z)
 * @param speed - Movement speed in metres/second
 * @param delta - Time since last frame in seconds
 */
export function computeMovementDelta(
  input: MovementInput,
  yaw: number,
  speed: number,
  delta: number,
): MovementDelta {
  // Accumulate input direction (forward = -Z in local space)
  let inputZ = 0;
  let inputX = 0;

  if (input.forward) inputZ -= 1;
  if (input.backward) inputZ += 1;
  if (input.left) inputX -= 1;
  if (input.right) inputX += 1;

  // No movement if no input
  if (inputX === 0 && inputZ === 0) {
    return { dx: 0, dz: 0 };
  }

  // Normalize diagonal movement so it's not faster than cardinal
  const magnitude = Math.sqrt(inputX * inputX + inputZ * inputZ);
  const normalizedX = inputX / magnitude;
  const normalizedZ = inputZ / magnitude;

  // Rotate local input by yaw to get world-space direction
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);

  const distance = speed * delta;

  // R_y(yaw) applied to local [inputX, 0, inputZ]:
  //   world_dx =  cos(yaw) * inputX + sin(yaw) * inputZ
  //   world_dz = -sin(yaw) * inputX + cos(yaw) * inputZ
  return {
    dx: (normalizedX * cosYaw + normalizedZ * sinYaw) * distance,
    dz: (-normalizedX * sinYaw + normalizedZ * cosYaw) * distance,
  };
}

// ---------------------------------------------------------------------------
// Room bounds
// ---------------------------------------------------------------------------

export interface RoomBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Derives camera movement bounds from room dimensions.
 * Room is centered at origin; bounds are inset by the wall margin.
 */
export function computeRoomBounds(dimensions: SpaceDimensions, margin: number): RoomBounds {
  const halfWidth = dimensions.width / 2;
  const halfLength = dimensions.length / 2;
  return {
    minX: -halfWidth + margin,
    maxX: halfWidth - margin,
    minZ: -halfLength + margin,
    maxZ: halfLength - margin,
  };
}

/**
 * Clamps a position to stay within room bounds.
 */
export function clampToRoomBounds(
  x: number,
  z: number,
  bounds: RoomBounds,
): { x: number; z: number } {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, x)),
    z: Math.max(bounds.minZ, Math.min(bounds.maxZ, z)),
  };
}

// ---------------------------------------------------------------------------
// Pitch clamping
// ---------------------------------------------------------------------------

/**
 * Clamps pitch to prevent gimbal lock. Returns clamped value.
 */
export function clampPitch(pitch: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, pitch));
}

// ---------------------------------------------------------------------------
// Key mapping
// ---------------------------------------------------------------------------

const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
const BACKWARD_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);

export type MovementDirection = "forward" | "backward" | "left" | "right";

/**
 * Maps a keyboard event code to a movement direction, or null if not a movement key.
 */
export function keyToDirection(code: string): MovementDirection | null {
  if (FORWARD_KEYS.has(code)) return "forward";
  if (BACKWARD_KEYS.has(code)) return "backward";
  if (LEFT_KEYS.has(code)) return "left";
  if (RIGHT_KEYS.has(code)) return "right";
  return null;
}
