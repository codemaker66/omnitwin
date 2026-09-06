// -----------------------------------------------------------------------------
// pendulum — the port chain's swing, pure over the last poke and the clock.
//
// A chain about a metre long hanging from a post swings with a period near
// two seconds and loses its energy slowly in still air; the envelope here
// keeps it visibly moving for the better part of a minute so it is still
// swinging when the reader looks back (the manifest's third row says so).
// Nothing is stored: the angle is a function of (lastPokeMs, nowMs), which
// is what lets the pokes store hold one number and the plane stay pure.
// -----------------------------------------------------------------------------

/** Degrees at the moment of the poke. */
export const CHAIN_SWING_AMPLITUDE_DEG = 16;
/** One full swing, out and back. */
export const CHAIN_SWING_PERIOD_MS = 2100;
/** Time constant of the decay; the amplitude is 1/e of the poke's after this long. */
export const CHAIN_SWING_DECAY_MS = 9000;
/** Below this fraction of the poke amplitude the chain is drawn at rest. */
export const CHAIN_SWING_PARK_FRACTION = 0.01;
/** Under reduced motion the chain rests at the angle it was left, one colour step and no swing. */
export const CHAIN_REST_TILT_DEG = 5;

/**
 * The chain's angle in degrees, positive out over the water. Pure: the same
 * inputs give the same angle, and the envelope only ever decays.
 */
export function chainSwingAngleDeg(lastPokeMs: number | null, nowMs: number, reducedMotion: boolean): number {
  if (lastPokeMs === null) return 0;
  if (reducedMotion) return CHAIN_REST_TILT_DEG;
  const elapsed = nowMs - lastPokeMs;
  if (elapsed < 0) return 0;
  const envelope = Math.exp(-elapsed / CHAIN_SWING_DECAY_MS);
  if (envelope < CHAIN_SWING_PARK_FRACTION) return 0;
  return CHAIN_SWING_AMPLITUDE_DEG * envelope * Math.cos((2 * Math.PI * elapsed) / CHAIN_SWING_PERIOD_MS);
}

/** The swing's envelope alone, for callers that want to know whether it still moves. */
export function chainSwingEnvelope(lastPokeMs: number | null, nowMs: number): number {
  if (lastPokeMs === null) return 0;
  const elapsed = nowMs - lastPokeMs;
  if (elapsed < 0) return 0;
  const envelope = Math.exp(-elapsed / CHAIN_SWING_DECAY_MS);
  return envelope < CHAIN_SWING_PARK_FRACTION ? 0 : envelope;
}
