import type { SpringConfig } from "../lib/springs.js";

// -----------------------------------------------------------------------------
// first-light — the establishing reveal's pure logic (SS++ phase 1).
//
// The opening five seconds are the highest-leverage frame in the product: the
// hall opens like a property film — an exposure iris from a cool dim to full
// warmth while the camera cranes a few quiet degrees down onto the hero view.
// This module holds the parts a unit test can pin: WHEN the reveal may run,
// the once-per-session latch, and the choreography constants. The rig that
// drives the camera lives with the viewer (it needs the frame loop).
//
// Taste constraints (from the SS++ plan): it is a whisper — under 15° of
// motion, one system, fired once, and NEVER over a soft preview (the caller
// gates on the hero base tier). Any interaction dismisses it instantly; a
// visitor who arrives pointed somewhere specific (?node=, ?look=, ?mode=)
// came with intent, so the overture stays out of their way. Reduced motion
// skips it entirely — the plain 500 ms stage fade is that opening.
// -----------------------------------------------------------------------------

/** Session latch — the reveal greets each visit once, reloads included. */
const FIRST_LIGHT_SEEN_KEY = "vv-twin-first-light";

export function firstLightSeen(): boolean {
  try {
    return window.sessionStorage.getItem(FIRST_LIGHT_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markFirstLightSeen(): void {
  try {
    window.sessionStorage.setItem(FIRST_LIGHT_SEEN_KEY, "1");
  } catch {
    // Storage denied (private mode): the reveal may replay next load. Harmless.
  }
}

export interface FirstLightGate {
  /** True when the URL names a node/look/mode — an arrival with intent. */
  readonly hasNodeParam: boolean;
  readonly hasLookParam: boolean;
  readonly hasModeParam: boolean;
  readonly reducedMotion: boolean;
  readonly seenThisSession: boolean;
}

/** The reveal runs only on a pristine, motion-tolerant, first entry. */
export function firstLightEligible(gate: FirstLightGate): boolean {
  return (
    !gate.hasNodeParam &&
    !gate.hasLookParam &&
    !gate.hasModeParam &&
    !gate.reducedMotion &&
    !gate.seenThisSession
  );
}

/** One critically-damped spring carries the whole reveal (~2.2 s of motion);
 *  the iris, the crane and the fov ride the SAME value so they can never
 *  drift apart (house rule: springs, never tweens). */
export const FIRST_LIGHT_SPRING: SpringConfig = { stiffness: 4, damping: 4 };

/** Crane start offsets, decayed to zero as the spring settles: the view begins
 *  lifted toward the dome and eases down onto the resting hero frame. */
export const FIRST_LIGHT_YAW_OFFSET_RAD = (8 * Math.PI) / 180;
export const FIRST_LIGHT_PITCH_OFFSET_RAD = (10 * Math.PI) / 180;
export const FIRST_LIGHT_FOV_OFFSET_DEG = 4;

/** The iris: a cool near-black wash that opens to nothing. */
export const FIRST_LIGHT_OVERLAY_MAX_OPACITY = 0.55;

/** If the hero base tier hasn't landed by now, skip the overture — never hold
 *  a slow connection hostage to choreography. */
export const FIRST_LIGHT_FAILSAFE_MS = 6000;
