// ---------------------------------------------------------------------------
// The maths behind an interior camera.
//
// Kept apart from the React component so the feel of the thing can be tested
// without a canvas: how fast it settles, and whether it can ever leave the room.
//
// The controlling idea is that ROTATION MUST NOT MOVE THE CAMERA. An orbit
// control rotates the camera around a target point, so looking left swings you
// bodily through the wall — which is why the first attempt let people out of
// the room. Here yaw and pitch turn the head and nothing else; position changes
// only when you ask to move, and only within the region the scanner walked.
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

/**
 * Frame-rate independent smoothing.
 *
 * `x += (target - x) * (1 - exp(-dt / tau))` rather than `x += (target - x) * k`.
 * The naive form is a different filter at 30 fps than at 144 fps — it feels
 * sluggish on a slow machine and twitchy on a fast one, and that inconsistency
 * reads as "laggy" even when the frame rate is fine. This form settles in the
 * same wall-clock time on any machine.
 *
 * `tau` is the time constant: roughly the time to cover 63% of the distance.
 */
export function smoothTowards(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 0) return target;
  const alpha = 1 - Math.exp(-dt / tau);
  return current + (target - current) * alpha;
}

/** Shortest signed angular distance from `a` to `b`, in radians. */
export function shortestAngleTo(a: number, b: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Angles wrap, so they cannot be smoothed as plain numbers. */
export function smoothAngleTowards(current: number, target: number, tau: number, dt: number): number {
  return current + shortestAngleTo(current, target) * (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
}

/** Absolute ceiling on how far the view may tilt, in either direction. */
export const MAX_PITCH = Math.PI * 0.42;
/** Below this a room is too low to look up in at all without hitting plaster. */
const MIN_PITCH_UP = 0.3;
/** How far ahead the viewer is assumed to be looking when tilting up. */
const PITCH_REFERENCE_M = 1.5;

/**
 * How steeply the viewer may look up in a room of this height.
 *
 * A single constant is wrong because rooms are not the same height. The Robert
 * Adam Room's ceiling is 2.18 m, so from eye level there is barely 40 cm of
 * headroom — tilting up 75 degrees there fills the screen with plaster, which is
 * as useless a view as standing outside the building. The Grand Hall's dome
 * deserves the opposite treatment.
 *
 * Derived from the geometry rather than tuned: how far up you can look before a
 * ceiling `headroom` above you fills the view at `PITCH_REFERENCE_M` ahead.
 */
export function maxPitchUpFor(headroomM: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH_UP, Math.atan(headroomM / PITCH_REFERENCE_M)));
}

/** Looking down is bounded by the floor, which every capture has. */
export const MAX_PITCH_DOWN = 0.95;

export function clampPitch(pitch: number, maxUp: number = MAX_PITCH): number {
  return Math.min(maxUp, Math.max(-MAX_PITCH_DOWN, pitch));
}

/**
 * Radians of turn per pixel dragged, from the field of view.
 *
 * A fixed sensitivity is a different gesture on every screen. Deriving it from
 * the horizontal field of view means the point under the finger stays under the
 * finger, which is what makes grab-to-look feel correct rather than tuned.
 */
export function lookSensitivity(fovDegrees: number, aspect: number, widthPx: number): number {
  if (widthPx <= 0) return 0;
  const fovV = (fovDegrees * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
  return fovH / widthPx;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * How far inside its own bounds the camera is held.
 *
 * The walked region is where the scanner's body went, so its very edge still
 * has good data, but standing exactly on the boundary puts the near plane in
 * the wall. Half a metre of inset keeps a person's width off the plaster.
 */
export const WALL_INSET_M = 0.5;

function insetBounds(bounds: Bounds): Bounds {
  const inset = (min: number, max: number): [number, number] => {
    const room = max - min;
    // A room narrower than the inset would invert; keep a sliver at the centre.
    if (room <= WALL_INSET_M * 2) {
      const middle = (min + max) / 2;
      return [middle - 0.05, middle + 0.05];
    }
    return [min + WALL_INSET_M, max - WALL_INSET_M];
  };
  const [x0, x1] = inset(bounds.min[0], bounds.max[0]);
  const [y0, y1] = inset(bounds.min[1], bounds.max[1]);
  const [z0, z1] = inset(bounds.min[2], bounds.max[2]);
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

/**
 * Holds a position inside the room.
 *
 * A hard clamp is what makes a camera feel like it is hitting a wall: the
 * motion stops dead while the input continues. This clamps the *target* instead,
 * so the camera eases into the boundary and rests against it, the way a AAA
 * character controller slides along a collision surface rather than halting.
 */
export function containPosition(position: Vec3, bounds: Bounds): Vec3 {
  const room = insetBounds(bounds);
  return [
    Math.min(room.max[0], Math.max(room.min[0], position[0])),
    Math.min(room.max[1], Math.max(room.min[1], position[1])),
    Math.min(room.max[2], Math.max(room.min[2], position[2])),
  ];
}

/** Whether a point is already inside the room, inset included. */
export function isContained(position: Vec3, bounds: Bounds): boolean {
  const contained = containPosition(position, bounds);
  return contained[0] === position[0]
    && contained[1] === position[1]
    && contained[2] === position[2];
}

/**
 * Moves along the view direction, on the floor plane.
 *
 * Walking forward while looking up should carry you across the room, not into
 * the ceiling, so pitch is deliberately dropped from the movement basis. This
 * is what every first-person game does, and its absence is immediately felt as
 * the camera "swimming".
 */
export function moveOnFloorPlane(
  position: Vec3,
  yaw: number,
  forward: number,
  strafe: number,
): Vec3 {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return [
    position[0] - forward * sin + strafe * cos,
    position[1],
    position[2] - forward * cos - strafe * sin,
  ];
}

/**
 * Settled once every channel is within these of its target.
 *
 * The angular figure is half a pixel of turn at the field of view this camera
 * uses: 48 degrees over 1080 px is 7.75e-4 rad per pixel, so half of that is
 * where further smoothing stops being visible. Tighter only burns frames on
 * motion nobody can see; looser stops visibly short of where it was going.
 */
const SETTLE_EPSILON_M = 0.0015;
const SETTLE_EPSILON_RAD = 0.00039;

export interface CameraState {
  position: Vec3;
  yaw: number;
  pitch: number;
}

/**
 * Whether the camera still has somewhere to go.
 *
 * Under `frameloop="demand"` the scene only draws when something asks it to, so
 * this is what decides whether to ask for another frame. Getting it wrong in
 * one direction stutters the motion; in the other it renders forever.
 */
export function isSettled(current: CameraState, target: CameraState): boolean {
  for (const axis of [0, 1, 2] as const) {
    if (Math.abs(current.position[axis] - target.position[axis]) > SETTLE_EPSILON_M) return false;
  }
  if (Math.abs(shortestAngleTo(current.yaw, target.yaw)) > SETTLE_EPSILON_RAD) return false;
  return Math.abs(current.pitch - target.pitch) <= SETTLE_EPSILON_RAD;
}

/** Where the camera is looking, one metre ahead. */
export function lookTarget(state: CameraState): Vec3 {
  const cosPitch = Math.cos(state.pitch);
  return [
    state.position[0] - Math.sin(state.yaw) * cosPitch,
    state.position[1] + Math.sin(state.pitch),
    state.position[2] - Math.cos(state.yaw) * cosPitch,
  ];
}


/**
 * Puts the camera exactly on its target.
 *
 * Stopping at the epsilon leaves the last drawn frame a fraction short, and
 * that residual is then frozen in — the loop has gone to sleep, so nothing will
 * ever redraw it. Snapping on the frame it settles means the picture people sit
 * and look at is the one that was actually asked for.
 */
export function snapToTarget(current: CameraState, target: CameraState): void {
  current.position = [target.position[0], target.position[1], target.position[2]];
  current.yaw = target.yaw;
  current.pitch = target.pitch;
}
