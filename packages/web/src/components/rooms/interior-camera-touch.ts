import { containPosition, type Bounds, type CameraState, type Vec3 } from "./interior-camera.js";

// ---------------------------------------------------------------------------
// Walking a captured room with a finger.
//
// A mouse has a wheel to go forward with and a button to look with; a finger
// has neither, so the same three verbs have to come out of one contact. The
// division here is the one people already know from maps and from every
// photo-sphere:
//
//   one finger, dragged     look around          (already built — this module
//                                                 only has to stay out of it)
//   one finger, tapped      GO THERE             tap the floor and glide to it
//   one finger, held        WALK forward         the long press is the throttle
//   two fingers, pinched    move forward or back never a second look
//
// The last line has to be stated as a rule rather than left to fall out: a
// second finger arriving mid-drag would otherwise keep feeding the look, and
// the view would swing as the pair moved together. So the second contact ENDS
// the look and starts a pinch, and the pinch only ever moves the body.
//
// Everything here is arithmetic on numbers, so the feel can be tested without
// a canvas, a GPU or a real finger: what a tap resolves to, how far a pinch
// carries, when a press becomes a hold.
// ---------------------------------------------------------------------------

/**
 * How long a finger must rest before the room starts moving under it.
 *
 * Long enough that a tap is never mistaken for a hold, short enough that the
 * hold does not feel broken. 350 ms is about where a press stops reading as a
 * tap and is the same order as the platform long-press.
 */
export const HOLD_TO_WALK_MS = 350;

/**
 * Above this a press is a hold or a drag, never a tap.
 *
 * The same budget as HOLD_TO_WALK_MS by design: a contact is a tap when it
 * both ends quickly and never wandered, so one threshold decides both halves
 * and there is no window in which a gesture is neither.
 */
export const TAP_MAX_MS = HOLD_TO_WALK_MS;

/**
 * How far the room travels when a pinch spreads across the whole screen.
 *
 * Six metres is most of a small room and a third of the Grand Hall, so the
 * full gesture is a decisive move and a small one is a nudge. Containment
 * holds the end of it either way, so this sets feel, not reach.
 */
export const PINCH_TRAVEL_M = 6;

/**
 * The most one pointer event may carry, in metres.
 *
 * The same guard `wheelStepMetres` needs and for the same reason: a coarse or
 * synthetic event reporting a hundred pixels of spread in one step must not
 * teleport anyone across the room.
 */
const PINCH_MAX_STEP_M = 1;

/**
 * Where a tap lands on the floor, in world metres.
 *
 * The room has no floor mesh to raycast — the capture is Gaussians, not
 * geometry — so this intersects the mathematical plane the walk box already
 * stands on. The camera basis is rebuilt from yaw and pitch rather than read
 * off the three.js camera, so the answer can be tested against a plain
 * object, and it composes in the same YXZ order the component sets on the
 * camera (`Ry(yaw) · Rx(pitch)`): the order that makes roll structurally
 * impossible there is what makes this agree with it here.
 *
 * Null when the tap cannot reach the floor at all: on or above the horizon,
 * or behind the viewer. A tap on the ceiling is not a destination, and
 * pretending it is would fling the viewer backwards through the wall.
 */
export function floorPointFromTap(
  state: CameraState,
  ndc: { readonly x: number; readonly y: number },
  fovDegrees: number,
  aspect: number,
  floorY: number,
): Vec3 | null {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const tanHalf = Math.tan((fovDegrees * Math.PI) / 360);
  // Camera space: x right, y up, z toward the viewer, so the view is -z.
  const cx = ndc.x * aspect * tanHalf;
  const cy = ndc.y * tanHalf;
  const cz = -1;

  const cosPitch = Math.cos(state.pitch);
  const sinPitch = Math.sin(state.pitch);
  // Rx(pitch)
  const px = cx;
  const py = cy * cosPitch - cz * sinPitch;
  const pz = cy * sinPitch + cz * cosPitch;

  const cosYaw = Math.cos(state.yaw);
  const sinYaw = Math.sin(state.yaw);
  // Ry(yaw)
  const dx = px * cosYaw + pz * sinYaw;
  const dy = py;
  const dz = -px * sinYaw + pz * cosYaw;

  // Only a ray heading downward reaches the floor, and only ahead of the eye.
  if (!Number.isFinite(dy) || dy >= 0) return null;
  const distance = (floorY - state.position[1]) / dy;
  if (!Number.isFinite(distance) || distance <= 0) return null;

  return [
    state.position[0] + dx * distance,
    state.position[1],
    state.position[2] + dz * distance,
  ];
}

/**
 * Where a tap sends the viewer, held inside the room.
 *
 * Eye height is kept: the destination is a place to stand, not a place to
 * fall to, and the walk box's own vertical band is the only thing that should
 * ever move the eye. Null when the tap did not reach the floor.
 */
export function glideTargetFromTap(
  state: CameraState,
  ndc: { readonly x: number; readonly y: number },
  fovDegrees: number,
  aspect: number,
  bounds: Bounds,
  floorY = 0,
): Vec3 | null {
  const floor = floorPointFromTap(state, ndc, fovDegrees, aspect, floorY);
  if (floor === null) return null;
  return containPosition([floor[0], state.position[1], floor[2]], bounds);
}

/** A pointer position in CSS pixels, relative to the canvas. */
export interface TouchPoint {
  readonly x: number;
  readonly y: number;
}

/** Normalised device coordinates for a point on a canvas of this size. */
export function ndcForPoint(
  point: TouchPoint,
  widthPx: number,
  heightPx: number,
): { readonly x: number; readonly y: number } | null {
  if (widthPx <= 0 || heightPx <= 0) return null;
  return {
    x: (point.x / widthPx) * 2 - 1,
    // Screen y grows downward; NDC y grows upward.
    y: 1 - (point.y / heightPx) * 2,
  };
}

/** The separation of two contacts, in CSS pixels. */
export function pinchDistance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * How far a pinch carries the viewer, in metres along the heading.
 *
 * Spreading the fingers moves forward, the way spreading them enlarges a map:
 * what is being looked at gets closer. Scaled by the canvas width so the same
 * gesture means the same distance on a phone and on a tablet.
 */
export function pinchForwardMetres(
  previousDistancePx: number,
  distancePx: number,
  widthPx: number,
): number {
  if (widthPx <= 0) return 0;
  const delta = distancePx - previousDistancePx;
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const metres = (delta / widthPx) * PINCH_TRAVEL_M;
  return Math.max(-PINCH_MAX_STEP_M, Math.min(PINCH_MAX_STEP_M, metres));
}

/**
 * Whether a contact that has just ended was a tap.
 *
 * Both halves matter. A slow press that never moved is a hold, and the room
 * has already been walking under it; a quick flick that travelled is a look,
 * and it has already turned the view. Only the short, still contact is a
 * request to go somewhere.
 */
export function isTapGesture(
  elapsedMs: number,
  travelledPx: number,
  thresholdPx: number,
): boolean {
  return elapsedMs <= TAP_MAX_MS && travelledPx <= thresholdPx;
}

/** Whether a contact that is still down has become a hold-to-walk. */
export function isHoldGesture(
  elapsedMs: number,
  travelledPx: number,
  thresholdPx: number,
): boolean {
  return elapsedMs >= HOLD_TO_WALK_MS && travelledPx <= thresholdPx;
}
