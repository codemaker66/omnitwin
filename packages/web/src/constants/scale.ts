import { TRADES_HALL_GRAND_HALL_DIMENSIONS } from "@omnitwin/types";
import type { SpaceDimensions } from "@omnitwin/types";

/**
 * Visual scale factor applied to room geometry for rendering.
 *
 * Real-world dimensions feel cramped in 3D because screens lack peripheral
 * vision, binocular depth cues, and proprioceptive feedback. Game studios
 * (Bethesda, Valve, id Software) routinely scale interiors 10–20% beyond
 * real measurements to compensate.
 *
 * This factor inflates the rendered room while keeping the real dimensions
 * in @omnitwin/types unchanged. Measurement tools divide by this factor
 * to display true meters.
 */
export const RENDER_SCALE = 2.0;

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
 * Real: 21m × 10m × 7m → Rendered: 42m × 20m × 7m (height unchanged)
 */
export const GRAND_HALL_RENDER_DIMENSIONS: SpaceDimensions =
  scaleForRendering(TRADES_HALL_GRAND_HALL_DIMENSIONS);
