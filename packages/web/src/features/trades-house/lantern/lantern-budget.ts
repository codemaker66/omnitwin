// -----------------------------------------------------------------------------
// lantern-budget — the Lantern's frame budget as pure state.
//
// The tripwire from the plan (section 1, "Frames"): thirty frames over 20 ms
// drop the DPR ladder one rung (2 → 1.5 → 1.25 → 1) and the particle count to
// 100. The count is a leaky bucket, not a run: an over-budget frame adds one,
// an under-budget frame takes one away, so a single clean frame in the middle
// of sustained jank does not erase the evidence, while a lone dropped frame
// during a scene change never trips it. Everything here is pure so it can be
// tested without a GPU; Lantern.tsx feeds it real rAF deltas.
// -----------------------------------------------------------------------------
import {
  LANTERN_FRAME_BUDGET_MS,
  LANTERN_MAX_FILL_MEGAPIXELS,
  LANTERN_TRIPWIRE_FRAMES,
  type LanternBudgetState,
} from "./lantern-types.js";

/** The DPR rungs, highest first. The plan allows 2 on high tier, 1.5 elsewhere. */
export const LANTERN_DPR_LADDER: readonly number[] = [2, 1.5, 1.25, 1];

/** The Lantern's default ceiling: at most 1.5 unless the stage says high tier. */
export const LANTERN_DEFAULT_MAX_DPR = 1.5;

/** Particle counts for the presets that have them (weather, embers); the moths read it too. */
export const LANTERN_FULL_PARTICLES = 400;
export const LANTERN_DEGRADED_PARTICLES = 100;

/** Fill per frame in megapixels for a canvas of the given CSS size at a DPR. */
export function lanternFillMegapixels(width: number, height: number, dpr: number): number {
  const w = Math.max(0, width) * Math.max(0, dpr);
  const h = Math.max(0, height) * Math.max(0, dpr);
  return (w * h) / 1_000_000;
}

/**
 * The largest DPR at or below `maxDpr` whose fill stays under the 6 Mpx cap.
 * A 2560×1440 desktop at 1.5 would be 8.3 Mpx; this brings it to 1.28.
 */
export function dprForFill(width: number, height: number, maxDpr: number): number {
  const area = Math.max(1, width) * Math.max(1, height);
  const cap = Math.sqrt((LANTERN_MAX_FILL_MEGAPIXELS * 1_000_000) / area);
  return Math.max(0.5, Math.min(maxDpr, cap));
}

/** The next rung strictly below `dpr`, or the floor when there is none. */
export function nextDprRungBelow(dpr: number): number {
  const floor = LANTERN_DPR_LADDER[LANTERN_DPR_LADDER.length - 1] ?? 1;
  for (const rung of LANTERN_DPR_LADDER) {
    if (rung < dpr) {
      return rung;
    }
  }
  return floor;
}

/** The budget at scene entry: the device's ratio capped at the tier's ceiling. */
export function createLanternBudget(devicePixelRatio: number, maxDpr = LANTERN_DEFAULT_MAX_DPR): LanternBudgetState {
  const dpr = Math.max(0.5, Math.min(devicePixelRatio, maxDpr));
  return { dpr, particles: LANTERN_FULL_PARTICLES, overBudgetFrames: 0, degraded: false };
}

/**
 * One frame of evidence. Returns the same object when nothing changed so a
 * caller can compare by identity.
 */
export function stepLanternBudget(state: LanternBudgetState, frameMs: number): LanternBudgetState {
  if (!Number.isFinite(frameMs) || frameMs <= 0) {
    return state;
  }
  if (frameMs <= LANTERN_FRAME_BUDGET_MS) {
    if (state.overBudgetFrames === 0) {
      return state;
    }
    return { ...state, overBudgetFrames: state.overBudgetFrames - 1 };
  }
  const overBudgetFrames = state.overBudgetFrames + 1;
  if (overBudgetFrames < LANTERN_TRIPWIRE_FRAMES) {
    return { ...state, overBudgetFrames };
  }
  const dpr = nextDprRungBelow(state.dpr);
  return { dpr, particles: LANTERN_DEGRADED_PARTICLES, overBudgetFrames: 0, degraded: true };
}
