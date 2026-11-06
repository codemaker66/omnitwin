import type { ScreenPoint } from "./screen-anchors.js";

// ---------------------------------------------------------------------------
// Where the caption sits (T-671 slice 11′; approved spec §6.6 "Following"):
// beside its piece, joined to the pin by a copper hairline; on whichever side
// the screen allows; never over the dock; and when the piece leaves the view,
// docked to the nearest edge with an arrow pointing to it. Pure: canvas
// pixels in, canvas pixels out, written every frame with no spring of its own.
// ---------------------------------------------------------------------------

/** From the pin to the caption's near edge. */
export const CAPTION_GAP_PX = 28;
/** From the screen's edges, and from the dock's top. */
export const CAPTION_MARGIN_PX = 16;

export interface CaptionPlacement {
  readonly x: number;
  readonly y: number;
  readonly side: "right" | "left" | "docked";
  /** The hairline from the pin to the caption, or null when docked. */
  readonly line: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number } | null;
  /** Docked: the arrow's direction to the piece in degrees (0 right, 90 down); null when there is none to give. */
  readonly arrowDeg: number | null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * @param pin    the piece's point on screen
 * @param box    the caption's measured size
 * @param area   the canvas's size
 * @param floor  the top of the dock (or the canvas's height): the caption stays above it
 * @param lost   the piece's direction is unknown (no point at all)
 */
export function placeCaption(
  pin: ScreenPoint,
  box: { readonly width: number; readonly height: number },
  area: { readonly width: number; readonly height: number },
  floor: number,
  lost = false,
): CaptionPlacement {
  const lowestTop = floor - CAPTION_MARGIN_PX - box.height;
  const rightmostLeft = area.width - CAPTION_MARGIN_PX - box.width;

  if (lost) {
    return { x: (area.width - box.width) / 2, y: clamp(lowestTop, CAPTION_MARGIN_PX, lowestTop), side: "docked", line: null, arrowDeg: null };
  }

  if (!pin.visible) {
    const x = clamp(pin.x - box.width / 2, CAPTION_MARGIN_PX, rightmostLeft);
    const y = clamp(pin.y - box.height / 2, CAPTION_MARGIN_PX, lowestTop);
    const dx = pin.x - (x + box.width / 2);
    const dy = pin.y - (y + box.height / 2);
    const arrowDeg = dx === 0 && dy === 0 ? null : Math.atan2(dy, dx) * 180 / Math.PI;
    return { x, y, side: "docked", line: null, arrowDeg };
  }

  const onRight = pin.x + CAPTION_GAP_PX + box.width <= area.width - CAPTION_MARGIN_PX;
  const x = onRight ? pin.x + CAPTION_GAP_PX : clamp(pin.x - CAPTION_GAP_PX - box.width, CAPTION_MARGIN_PX, rightmostLeft);
  const y = clamp(pin.y - box.height / 2, CAPTION_MARGIN_PX, lowestTop);
  const edgeX = onRight ? x : x + box.width;
  const line = { x1: pin.x, y1: pin.y, x2: edgeX, y2: clamp(pin.y, y, y + box.height) };
  return { x, y, side: onRight ? "right" : "left", line, arrowDeg: null };
}
