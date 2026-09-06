// -----------------------------------------------------------------------------
// The River Gate — scene 1's tableau, drawn by code (provenance "Pr").
//
// Four SVG planes keyed by the manifest's `src`, the lights the Lantern's
// water reflects, the ink path the skyline draws itself with, and the
// arithmetic that keeps the 16:9 drawing and any tableau aspect agreeing.
// Everything a plane does is a pure function of SvgPlaneProps; nothing here
// reads a store, a clock or a random number.
// -----------------------------------------------------------------------------
import type { PlaneRegistry } from "../../plane-registry.js";
import { FarBank } from "./FarBank.js";
import { Mist } from "./Mist.js";
import { NearBank } from "./NearBank.js";
import { Swallow } from "./Swallow.js";

export { FarBank, Mist, NearBank, Swallow };

/** The scene's SVG planes by their manifest `src`. */
export const RIVER_GATE_REGISTRY: PlaneRegistry = {
  "far-bank": FarBank,
  mist: Mist,
  swallow: Swallow,
  "near-bank": NearBank,
};

/** The planes in depth order, farthest first; the manifest lists them in this order after the Lantern. */
export const RIVER_GATE_PLANE_ORDER = ["far-bank", "mist", "swallow", "near-bank"] as const;

/**
 * Which plane draws each pokeable. The water is the Lantern's (the WebGL
 * plane at depth 0): its rings are `LanternHandle.ripple`, so no SVG plane
 * carries a `data-prop="water"` element.
 */
export const RIVER_GATE_PROP_PLANES = {
  "port-chain": "near-bank",
  water: "lantern",
  lantern: "far-bank",
  swallow: "swallow",
  "toll-box": "near-bank",
  "apple-core": "near-bank",
} as const;

export { RIVER_GATE_INK, RIVER_GATE_INK_BYTES, countPathSegments } from "./ink.js";
export {
  RIVER_GATE_LANTERN_POSITION,
  RIVER_GATE_LIGHTS,
  RIVER_GATE_LIGHT_SOURCES,
  riverGateLanternPositionFor,
  riverGateLightsFor,
} from "./lights.js";
export { RIVER_GATE_PROP_BOXES, RIVER_GATE_PROP_IDS, RIVER_GATE_PROP_RECTS, type RiverGatePropId } from "./prop-boxes.js";
export {
  RIVER_GATE_HORIZON_Y,
  RIVER_GATE_PRESERVE_ASPECT,
  RIVER_GATE_VIEWBOX,
  RIVER_GATE_VIEWBOX_ATTR,
  riverGatePropBoxFor,
  sliceTransform,
  viewBoxRectToTableauPercent,
  viewBoxToTableau,
} from "./viewbox.js";
export { chainSwingAngleDeg, chainSwingEnvelope } from "./pendulum.js";
export { swallowPose, distinctPropsTouched } from "./swallow-flight.js";
export { appleCorePose, tollBoxState, TRAVELLER_HEIGHT_UNITS } from "./near-bank-geometry.js";
export { PALETTE } from "./plane-style.js";
