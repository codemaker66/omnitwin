import { TRADES_HALL_GRAND_HALL_DIMENSIONS } from "@omnitwin/types";
import type { SpaceDimensions } from "@omnitwin/types";

/**
 * Visual scale factor applied to room geometry for rendering. Now 1.0 — the
 * scene is authored and rendered in true metres.
 *
 * This was 2.0, borrowed from the first-person convention of inflating
 * interiors 10–20% (Bethesda, Valve, id) to compensate for a screen's missing
 * peripheral vision and binocular depth. That reasoning does not transfer
 * here, for two reasons:
 *
 *  1. This is a dollhouse orbit view, not a first-person camera. There is no
 *     avatar at eye height to feel cramped, so inflating the floor buys no
 *     spaciousness — it only halves every object's height-to-footprint ratio.
 *     A 0.45m wide, 0.90m tall chair rendered at 0.90 × 0.90 is a cube.
 *  2. It was applied to X/Z only, so the Grand Hall — 21 × 10.5 × 7m, a room
 *     whose defining feature is its height and dome — rendered as 42 × 21 × 7.
 *     Six times wider than tall. The scaling flattened the very thing that
 *     makes the room impressive.
 *
 * A venue planner also cannot afford the trade a game makes. Games fake scale
 * freely because nothing depends on the measurement being true; here a planner
 * reading clearance off the screen has to be able to trust it on the day.
 *
 * Perceived spaciousness is earned where it belongs — camera framing, field of
 * view and lighting — not by distorting geometry.
 *
 * The conversion seams are deliberately kept rather than deleted across 45
 * modules: they document where render space and real metres meet, and they are
 * the single place to change if this is ever revisited.
 */
export const RENDER_SCALE = 1.0;

/**
 * Converts a real-world measurement (metres) to render-space units.
 * Use when placing geometry in the scene (X and Z axes).
 * Y axis (height) is NOT scaled — pass height values directly.
 */
export function toRenderSpace(metres: number): number {
  return metres * RENDER_SCALE;
}

/**
 * Converts a render-space measurement back to real-world metres.
 * Use before displaying ANY distance, dimension, or coordinate to the user.
 * Y axis (height) is NOT scaled — pass height values directly.
 */
export function toRealWorld(renderUnits: number): number {
  return renderUnits / RENDER_SCALE;
}

/** Scales a SpaceDimensions object by the render scale factor.
 *  Width and length are scaled for spacious floor area.
 *  Height is kept at real-world value — tall walls look wrong when scaled up. */
export function scaleForRendering(dimensions: SpaceDimensions): SpaceDimensions {
  return {
    width: toRenderSpace(dimensions.width),
    length: toRenderSpace(dimensions.length),
    height: dimensions.height,
  };
}

/**
 * Grand Hall dimensions scaled for comfortable 3D rendering.
 * Real: 21m × 10.5m × 7m → Rendered: 42m × 21m × 7m (height unchanged)
 */
export const GRAND_HALL_RENDER_DIMENSIONS: SpaceDimensions =
  scaleForRendering(TRADES_HALL_GRAND_HALL_DIMENSIONS);
