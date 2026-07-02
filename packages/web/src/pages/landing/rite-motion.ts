// -----------------------------------------------------------------------------
// rite-motion — the pure motion core of The Rite landing page.
//
// Spring physics (house rule: springs, never tweens, for anything that moves
// in response to input), the scroll dramaturgy math that maps scroll position
// to acts, and the local-dusk heuristic. Everything here is pure and
// unit-tested; the hooks layer feeds it real scroll/pointer/clock values.
//
// Design spec: docs/superpowers/specs/2026-07-01-landing-rite-redesign-design.md
// -----------------------------------------------------------------------------

import type { SpringConfig } from "../../lib/springs.js";

// The spring core (SpringConfig, SpringState, stepSpring, isSpringSettled)
// was promoted to src/lib/springs.ts when the twin walkthrough became its
// second consumer. Re-exported here so every existing landing import keeps
// working unchanged.
export { stepSpring, isSpringSettled } from "../../lib/springs.js";
export type { SpringConfig, SpringState } from "../../lib/springs.js";

/**
 * Per-interaction spring tuning table. Each interaction gets its own feel:
 * the carried light lags like something with mass; the flame recovers with a
 * slight wobble (underdamped on purpose — a steadying candle overshoots).
 */
export const RITE_SPRINGS = {
  /** The cursor-carried light — soft, heavy, deliberate. */
  cursorLight: { stiffness: 42, damping: 14 } as SpringConfig,
  /** Flame intensity recovering after a gust — underdamped, alive. */
  flameIntensity: { stiffness: 60, damping: 9 } as SpringConfig,
  /** rAF scroll-progress fallback when CSS scroll-timelines are absent. */
  scrollFallback: { stiffness: 120, damping: 22 } as SpringConfig,
} as const;

/**
 * Cursor velocity (px/s) → flame disturbance 0..1. A slow drift barely stirs
 * it; a fast sweep guts it to near-dark, and the flameIntensity spring brings
 * it back with a wobble. Tuned so play feels rewarded: the response curve is
 * quadratic below the knee so gentle movement is gentle.
 */
export function flameDisturbance(pxPerSecond: number): number {
  const KNEE = 900; // px/s at which the flame is fully guttered
  const normalized = Math.min(Math.abs(pxPerSecond) / KNEE, 1);
  return normalized * normalized * (3 - 2 * normalized); // smoothstep
}

/** easeOutCubic — used only for count-up numbers (not object motion). */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  const inv = 1 - clamped;
  return 1 - inv * inv * inv;
}

// -----------------------------------------------------------------------------
// Scroll dramaturgy — the page is a fixed sequence of acts measured in
// viewport-heights. One source of truth for both the CSS (section heights)
// and the JS (act progress for the flame, the light, and the wick).
// -----------------------------------------------------------------------------

export type RiteAct =
  | "threshold"
  | "darkness"
  | "magnitude"
  | "contemplation"
  | "return";

/** Scroll distance of each act, in viewport-heights. Order is the dramaturgy. */
export const ACT_HEIGHTS_VH: readonly (readonly [RiteAct, number])[] = [
  ["threshold", 1],
  ["darkness", 2.5],
  ["magnitude", 3],
  ["contemplation", 5],
  ["return", 1.5],
] as const;

/** Total document height in viewport-heights. */
export const TOTAL_RITE_VH: number = ACT_HEIGHTS_VH.reduce(
  (sum, [, h]) => sum + h,
  0,
);

export interface RiteProgress {
  readonly act: RiteAct;
  /** 0..1 within the current act. */
  readonly actProgress: number;
  /** 0..1 across the whole rite (drives the wick). */
  readonly overall: number;
  /** Chapter index 0..3 during contemplation, null elsewhere. */
  readonly chapterIndex: number | null;
}

/**
 * Map absolute scrollY to the current act. `viewportHeight` must be > 0.
 * The scrollable range is (TOTAL_RITE_VH − 1) viewports because the final
 * viewport is on screen, not scrolled past.
 */
export function riteProgress(
  scrollY: number,
  viewportHeight: number,
): RiteProgress {
  const scrollable = (TOTAL_RITE_VH - 1) * viewportHeight;
  const overall = scrollable > 0 ? Math.min(Math.max(scrollY / scrollable, 0), 1) : 0;

  // An act is "current" while the viewport's top edge is inside it, except
  // the last act which owns everything to the end.
  let cursor = 0;
  for (let i = 0; i < ACT_HEIGHTS_VH.length; i += 1) {
    const entry = ACT_HEIGHTS_VH[i];
    if (entry === undefined) {
      break;
    }
    const [act, heightVh] = entry;
    const actSpan = heightVh * viewportHeight;
    const isLast = i === ACT_HEIGHTS_VH.length - 1;
    if (scrollY < cursor + actSpan || isLast) {
      const raw = actSpan > 0 ? (scrollY - cursor) / actSpan : 1;
      const actProgress = Math.min(Math.max(raw, 0), 1);
      const chapterIndex =
        act === "contemplation"
          ? Math.min(Math.floor(actProgress * 4), 3)
          : null;
      return { act, actProgress, overall, chapterIndex };
    }
    cursor += actSpan;
  }
  // Unreachable: the last act owns the tail. Kept for exhaustiveness.
  return { act: "return", actProgress: 1, overall, chapterIndex: null };
}

// -----------------------------------------------------------------------------
// Local dusk — after sunset the ambient hue runs ~2 % warmer. Never announced.
// A monthly sunset table for Glasgow's latitude is plenty: the shift is
// subliminal, so ±20 minutes of error is invisible. Local clock only — no
// geolocation, no permission prompt.
// -----------------------------------------------------------------------------

/** Approximate Glasgow sunset hour (local clock, fractional) by month, Jan..Dec. */
const GLASGOW_SUNSET_HOUR_BY_MONTH: readonly number[] = [
  16.25, 17.25, 18.25, 20.25, 21.25, 22.0,
  21.75, 20.75, 19.5, 18.25, 16.5, 15.75,
] as const;

export function isAfterDusk(now: Date): boolean {
  const sunset = GLASGOW_SUNSET_HOUR_BY_MONTH[now.getMonth()];
  if (sunset === undefined) {
    return false;
  }
  const hour = now.getHours() + now.getMinutes() / 60;
  // Dusk lasts until dawn: early-morning hours count as after dusk too.
  const DAWN_HOUR = 6;
  return hour >= sunset || hour < DAWN_HOUR;
}
