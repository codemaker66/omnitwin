// -----------------------------------------------------------------------------
// stage-geometry — the pure arithmetic of stage space.
//
// Stage space is the tableau box (the paper's inner rectangle): a prop's box
// is authored in percent of it, a poke's point is reported normalised 0..1 in
// it, and the look for parallax is -1..1 about its centre. Nothing here
// touches the DOM; the components pass rects in and take numbers out, which
// is what lets the mapping be tested under happy-dom, where every rect is 0.
// -----------------------------------------------------------------------------
import type { CSSProperties } from "react";
import type { Prop, StageRow } from "./stage-manifest.js";

export interface PercentBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface StagePoint {
  /** 0..1 across the tableau, left to right. */
  readonly x: number;
  /** 0..1 down the tableau, top to bottom. */
  readonly y: number;
}

/** A rect in CSS px; the subset of DOMRect the stage reads. */
export interface StageRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

/**
 * A percent box to the inline style that positions a prop wrapper. Percent
 * strings, not px, so the wrapper follows the tableau through every resize
 * without a listener; the numbers are fixed to three decimals so React never
 * sees a style string change for a float that did not move.
 */
export function boxToStyle(box: PercentBox): CSSProperties {
  return {
    left: `${box.x.toFixed(3)}%`,
    top: `${box.y.toFixed(3)}%`,
    width: `${box.w.toFixed(3)}%`,
    height: `${box.h.toFixed(3)}%`,
  };
}

/** The centre of a percent box as a normalised stage point. */
export function boxCentre(box: PercentBox): StagePoint {
  return {
    x: clamp01((box.x + box.w / 2) / 100),
    y: clamp01((box.y + box.h / 2) / 100),
  };
}

/** True when the whole box lies inside 0..100 on both axes. */
export function boxInsideStage(box: PercentBox): boolean {
  return box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0
    && box.x + box.w <= 100 + 1e-9 && box.y + box.h <= 100 + 1e-9;
}

/**
 * A client-space point to a normalised stage point, or null when the rect
 * has no area (happy-dom, a display: none ancestor, a zero-size mount), so the
 * caller can fall back to the box centre instead of reporting NaN.
 */
export function clientToStagePoint(clientX: number, clientY: number, rect: StageRect): StagePoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/**
 * The row of a prop's rarity table that a plain count reaches, or null.
 * Condition rows ("distinctProps:n", "conditional:id") are the reaction
 * layer's to fire; the stage only derives the numeric ones, which is enough
 * to paint the reduced-motion colour step for a row the count has reached.
 */
export function rowForCount(prop: Prop, count: number): StageRow | null {
  let best: StageRow | null = null;
  let bestAt = -1;
  for (const row of prop.states) {
    if (typeof row.at === "number" && row.at <= count && row.at > bestAt) {
      best = row;
      bestAt = row.at;
    }
  }
  return best;
}

/** "#e39b3a" to "227 155 58" for `rgb(var(--x) / a)`; null when malformed. */
export function hexToRgbTriplet(hex: string): string | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match === null) return null;
  const channels = match.slice(1, 4).map((pair) => String(parseInt(pair, 16)));
  return channels.join(" ");
}
