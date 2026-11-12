// ---------------------------------------------------------------------------
// The cloth drape (PQ-7, Blake's decision 3: how a cloth goes on).
//
// Behind two keys in lib/planner-features.ts: `clothDrape` (the drape in the
// planner, while Present and the showcase keep the 3.2 s spiral) and
// `clothDrapeOnly` (the drape everywhere; it wins). With both off the planner
// keeps today's spiral (components/meshes/AnimatedTableCloth.tsx).
//
// A cloth starts 8 cm above where it rests and comes down on the shared
// spring core (lib/springs.ts) at stiffness 300 and damping 35 with unit
// mass: ζ = 35 / (2√300) ≈ 1.01, a hair over critical, so it never dips
// below its rest. It fades in over its first 120 ms and is at rest by 450 ms.
// Cloths that go on together (a dress-all, a laid-out room) ripple: each
// starts 20 ms after the one before, none later than 300 ms. Under reduced
// motion a cloth is simply there.
//
// The pose is a pure function of the time since the cloth went on. The spring
// is run from its start on every call, in the core's own 1/240 s substep, so a
// slow or dropped frame never changes where a cloth is drawn and a
// frame-stepped capture draws exactly what a live screen does. At 450 ms the
// core's spring is still 0.45 mm short of rest, so its curve is rescaled to
// arrive there exactly: the static cloth takes over without a jump.
// ---------------------------------------------------------------------------

import { stepSpring, type SpringConfig, type SpringState } from "./springs.js";

/** How far above its rest a cloth starts, metres. */
export const CLOTH_DRAPE_LIFT = 0.08;

/** The drape's spring: unit mass, ζ ≈ 1.01, so no overshoot. */
export const CLOTH_DRAPE_SPRING: SpringConfig = { stiffness: 300, damping: 35 };

/** From a cloth's own start to its rest, seconds. */
export const CLOTH_DRAPE_SECONDS = 0.45;

/** The fade from nothing to the cloth's full opacity, seconds from its own start. */
export const CLOTH_DRAPE_FADE_SECONDS = 0.12;

/** Each cloth of a set starts this long after the one before, seconds. */
export const CLOTH_DRAPE_STAGGER_SECONDS = 0.02;

/** No cloth of a set waits longer than this to start, seconds. */
export const CLOTH_DRAPE_LATEST_START_SECONDS = 0.3;

export type ClothAnimation =
  /** Today's 3.2 s spiral from 2 m (AnimatedTableCloth). */
  | "spiral"
  /** The 450 ms drape. */
  | "drape"
  /** Reduced motion: the cloth is there at once, no motion and no fade. */
  | "still";

export interface ClothAnimationFacts {
  /** The `clothDrape` key. */
  readonly clothDrape: boolean;
  /** The `clothDrapeOnly` key. */
  readonly clothDrapeOnly: boolean;
  /** Present or the showcase is playing as the cloth goes on. */
  readonly presenting: boolean;
  /** The device asks for reduced motion. */
  readonly reducedMotion: boolean;
}

/** Which animation a cloth goes on with. */
export function clothAnimationFor(facts: ClothAnimationFacts): ClothAnimation {
  // Both keys off: today's spiral exactly, reduced motion included.
  if (!facts.clothDrape && !facts.clothDrapeOnly) return "spiral";
  if (facts.reducedMotion) return "still";
  if (facts.clothDrapeOnly) return "drape";
  return facts.presenting ? "spiral" : "drape";
}

export interface ClothDrapePose {
  /** Height above its rest, metres, in the table's own frame. */
  lift: number;
  /** How far it has faded in: 0 (unseen) to 1 (the cloth's resting opacity). */
  opacity: number;
  /** At rest: the static cloth can take over. */
  done: boolean;
}

/** A pose for a cloth that has not started yet, to be written by clothDrapePose. */
export function createClothDrapePose(): ClothDrapePose {
  return { lift: CLOTH_DRAPE_LIFT, opacity: 0, done: false };
}

/** The core's own substeps per second (lib/springs.ts). */
const SUBSTEPS_PER_SECOND = 240;
const SUBSTEP_SECONDS = 1 / SUBSTEPS_PER_SECOND;
const springScratch: SpringState = { value: 0, velocity: 0 };

/** The core's spring, run from its start for `seconds`: its height above rest, metres. */
function springLift(seconds: number): number {
  springScratch.value = CLOTH_DRAPE_LIFT;
  springScratch.velocity = 0;
  const whole = Math.floor(seconds * SUBSTEPS_PER_SECOND);
  for (let step = 0; step < whole; step++) {
    stepSpring(springScratch, 0, SUBSTEP_SECONDS, CLOTH_DRAPE_SPRING);
  }
  const rest = seconds - whole * SUBSTEP_SECONDS;
  if (rest > 0) stepSpring(springScratch, 0, rest, CLOTH_DRAPE_SPRING);
  return springScratch.value;
}

/** What the core's spring has still to fall at 450 ms (about 0.45 mm). */
const LANDING_RESIDUAL = springLift(CLOTH_DRAPE_SECONDS);

/**
 * Where a cloth is drawn `elapsedSeconds` after it went on, when its own
 * start waits `delaySeconds` (its place in a ripple). Writes `out` and
 * returns it, so a frame loop allocates nothing.
 */
export function clothDrapePose(
  out: ClothDrapePose,
  elapsedSeconds: number,
  delaySeconds: number,
  reducedMotion = false,
): ClothDrapePose {
  const time = elapsedSeconds - delaySeconds;
  if (reducedMotion || time >= CLOTH_DRAPE_SECONDS) {
    out.lift = 0;
    out.opacity = 1;
    out.done = true;
    return out;
  }
  if (time <= 0) {
    out.lift = CLOTH_DRAPE_LIFT;
    out.opacity = 0;
    out.done = false;
    return out;
  }
  out.lift = (CLOTH_DRAPE_LIFT * (springLift(time) - LANDING_RESIDUAL)) / (CLOTH_DRAPE_LIFT - LANDING_RESIDUAL);
  out.opacity = time >= CLOTH_DRAPE_FADE_SECONDS ? 1 : time / CLOTH_DRAPE_FADE_SECONDS;
  out.done = false;
  return out;
}

/** How long the cloth in place `slot` of a set waits to start, seconds: 20 ms a place, 300 ms at most. */
export function clothDrapeDelaySeconds(slot: number): number {
  return Math.min(Math.max(0, slot) * CLOTH_DRAPE_STAGGER_SECONDS, CLOTH_DRAPE_LATEST_START_SECONDS);
}

let claimedThisPass = 0;

/**
 * The next cloth's place in its set. Cloths that go on in one synchronous
 * pass (one React commit: a dress-all, a laid-out room) take 0, 1, 2… in the
 * order they mount; the count starts again once that pass is over.
 */
export function claimClothDrapeSlot(): number {
  if (claimedThisPass === 0) queueMicrotask(() => { claimedThisPass = 0; });
  const slot = claimedThisPass;
  claimedThisPass += 1;
  return slot;
}
