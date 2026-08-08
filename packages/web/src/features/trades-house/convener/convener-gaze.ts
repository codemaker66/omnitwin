// ---------------------------------------------------------------------------
// The Convener — gaze mathematics
//
// Pure. The component owns the rAF loop and the SVG refs; this owns every
// number the loop writes. The magic of the original portrait was never the
// tracking — it was the LAG and the SMALLNESS: eyes that drift four pixels,
// half a beat behind you. Track 1:1 with no easing and he dies instantly.
// ---------------------------------------------------------------------------

/** Horizontal pupil travel, in SVG user units. Tiny on purpose. */
export const GAZE_MAX_DX = 4;
/** Vertical pupil travel. Eyes move less vertically than horizontally. */
export const GAZE_MAX_DY = 2.5;

/** Pointer-follow softness divisors, straight from the proven original. */
const GAZE_DX_DIVISOR = 60;
const GAZE_DY_DIVISOR = 80;
/** He watches from just above centre — portraits look down at you. */
const GAZE_EYELINE_RATIO = 0.45;

export interface GazeTarget {
  readonly dx: number;
  readonly dy: number;
}

export interface GazeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** Where the pupils should sit for a pointer at (clientX, clientY). */
export function gazeTargetForPointer(
  rect: GazeRect,
  clientX: number,
  clientY: number,
): GazeTarget {
  return {
    dx: clamp((clientX - (rect.left + rect.width / 2)) / GAZE_DX_DIVISOR, GAZE_MAX_DX),
    dy: clamp((clientY - (rect.top + rect.height * GAZE_EYELINE_RATIO)) / GAZE_DY_DIVISOR, GAZE_MAX_DY),
  };
}

// ---------------------------------------------------------------------------
// Critically damped spring — per project feedback, object motion is spring
// physics, not tweens. Critically damped because eyes must never overshoot:
// a pupil that wobbles past its target reads as drunk, not alive.
//
// Closed-form solution, so it is exact and unconditionally stable — a tab
// switch that hands us a two-second dt settles instead of exploding.
// ---------------------------------------------------------------------------

export interface SpringState {
  readonly value: number;
  readonly velocity: number;
}

/**
 * Advances one axis. `omega` is the natural frequency in 1/s: settle time is
 * roughly 4/omega. Gaze follow uses GAZE_FOLLOW_OMEGA; the sharper hover
 * glance uses GAZE_GLANCE_OMEGA.
 */
export function stepCriticallyDampedSpring(
  state: SpringState,
  target: number,
  dtSeconds: number,
  omega: number,
): SpringState {
  if (dtSeconds <= 0) return state;
  const displacement = state.value - target;
  const boost = state.velocity + omega * displacement;
  const decay = Math.exp(-omega * dtSeconds);
  return {
    value: target + (displacement + boost * dtSeconds) * decay,
    velocity: (state.velocity - omega * boost * dtSeconds) * decay,
  };
}

/** Lazy follow — noticing you, not surveilling you. ~0.45s settle. */
export const GAZE_FOLLOW_OMEGA = 9;
/** The glance at an option you hover — interest is quicker than idling. */
export const GAZE_GLANCE_OMEGA = 16;

/** Below this, the loop stops writing the transform attribute. */
export const GAZE_SETTLED_EPSILON = 0.005;

export function isSpringSettled(state: SpringState, target: number): boolean {
  return Math.abs(state.value - target) < GAZE_SETTLED_EPSILON
    && Math.abs(state.velocity) < GAZE_SETTLED_EPSILON;
}

// ---------------------------------------------------------------------------
// Idle behaviour schedules. RNG is a parameter so tests can pin it.
// ---------------------------------------------------------------------------

export type RandomFn = () => number;

function inRange(rng: RandomFn, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Time until the next blink. He blinks like a man, not a metronome. */
export function nextBlinkDelayMs(rng: RandomFn): number {
  return inRange(rng, 1_900, 5_200);
}

/** Time until he next lets his eyes drift on their own. */
export function nextWanderDelayMs(rng: RandomFn): number {
  return inRange(rng, 2_400, 6_400);
}

/** Half his wander impulses come to nothing. Old men are like that. */
export function wanderTarget(rng: RandomFn): GazeTarget | null {
  if (rng() < 0.5) return null;
  return {
    dx: inRange(rng, -3, 3),
    dy: inRange(rng, -2, 2),
  };
}
