import type { SpringConfig } from "../../../lib/springs.js";

// ---------------------------------------------------------------------------
// lens-sheet-motion — the pure numbers behind the phone lens sheet.
//
// The sheet moves on the shared spring core (lib/springs.ts). Its own tuning
// lives here rather than in SPRING_PRESETS because only this surface uses it:
// a sheet should arrive firmly and settle without a visible bounce, so the
// damping ratio sits just under critical (40 / (2·√420) ≈ 0.98). From 724 px
// below (a full phone screen) it is within 10 px of seated at 0.32 s and
// within 2 px at 0.40 s, with no overshoot (measured at 60 fps steps).
// ---------------------------------------------------------------------------

export const LENS_SHEET_SPRING: SpringConfig = { stiffness: 420, damping: 40 };

/** Pixels the sheet travels past its own height so its shadow leaves too. */
export const LENS_SHEET_EXIT_MARGIN_PX = 24;

/** A drag must cover this much of the sheet (or 96 px) before it closes. */
const CLOSE_DISTANCE_FRACTION = 0.3;
const CLOSE_DISTANCE_MIN_PX = 96;
/** A downward flick this fast closes from any distance (px/s). */
const CLOSE_FLICK_PX_PER_S = 900;
/** An upward flick this fast keeps it open from any distance (px/s). */
const KEEP_FLICK_PX_PER_S = -300;
/** Pulling the sheet upward gives a little, then stops. */
const UPWARD_GIVE = 0.18;
const UPWARD_LIMIT_PX = 24;

export type LensSheetRelease = "open" | "close";

/**
 * Where a released drag goes. Velocity wins over distance so a short, quick
 * flick closes and a long drag that ends moving back up stays open.
 */
export function resolveLensSheetRelease(input: {
  readonly offsetPx: number;
  readonly velocityPxPerS: number;
  readonly sheetHeightPx: number;
}): LensSheetRelease {
  const { offsetPx, velocityPxPerS, sheetHeightPx } = input;
  if (velocityPxPerS >= CLOSE_FLICK_PX_PER_S && offsetPx > 0) return "close";
  if (velocityPxPerS <= KEEP_FLICK_PX_PER_S) return "open";
  const threshold = Math.max(CLOSE_DISTANCE_MIN_PX, sheetHeightPx * CLOSE_DISTANCE_FRACTION);
  return offsetPx >= threshold ? "close" : "open";
}

/** The sheet follows the finger 1:1 downward and resists upward. */
export function lensSheetDragOffset(rawOffsetPx: number): number {
  if (rawOffsetPx >= 0) return rawOffsetPx;
  return Math.max(-UPWARD_LIMIT_PX, rawOffsetPx * UPWARD_GIVE);
}

/** The scrim fades with the sheet: full when seated, gone when away. */
export function lensSheetScrimOpacity(offsetPx: number, closedOffsetPx: number): number {
  if (closedOffsetPx <= 0) return offsetPx <= 0 ? 1 : 0;
  const opacity = 1 - offsetPx / closedOffsetPx;
  return Math.min(1, Math.max(0, opacity));
}
