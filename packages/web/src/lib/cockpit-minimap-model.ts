import type { SpaceDimensions } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Cockpit minimap model — pure top-down plan projection.
//
// The minimap inset is a flat plan of the room: render-space world coordinates
// (X right, Z toward the default camera / "near") map to inset pixels, and a
// click maps back to a world floor point for camera recentring. Far (-Z) reads
// as the top of the plan, near (+Z) as the bottom, matching a conventional
// floor plan with the entrance at the bottom.
// ---------------------------------------------------------------------------

export interface MinimapLayout {
  /** Inset width in pixels. */
  readonly width: number;
  /** Inset height in pixels. */
  readonly height: number;
  /** Pixels per render unit. */
  readonly scale: number;
}

/** Fit the room footprint into a `maxPx` square, preserving aspect ratio. */
export function minimapLayout(dimensions: SpaceDimensions, maxPx: number): MinimapLayout {
  const longest = Math.max(dimensions.width, dimensions.length, 1);
  const scale = maxPx / longest;
  return { width: dimensions.width * scale, height: dimensions.length * scale, scale };
}

/** World render-space (x, z) → minimap pixel (origin top-left of the inset). */
export function minimapProject(
  x: number,
  z: number,
  layout: MinimapLayout,
): { readonly left: number; readonly top: number } {
  return {
    left: layout.width / 2 + x * layout.scale,
    top: layout.height / 2 + z * layout.scale,
  };
}

/** Minimap pixel → world render-space (x, z). Inverse of `minimapProject`. */
export function minimapToWorld(
  left: number,
  top: number,
  layout: MinimapLayout,
): { readonly x: number; readonly z: number } {
  return {
    x: (left - layout.width / 2) / layout.scale,
    z: (top - layout.height / 2) / layout.scale,
  };
}
