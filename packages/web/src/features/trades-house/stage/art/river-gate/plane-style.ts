// -----------------------------------------------------------------------------
// plane-style — the River Gate's palette and the one style every plane's
// <svg> root shares. Ninety percent of the frame is near-black and earth;
// the amber belongs to the windows and, at full saturation, only to the
// Lantern's flame, which this module never paints. No gradient, no filter,
// no shadow: everything here is a flat fill or a stroke.
// -----------------------------------------------------------------------------
import type { CSSProperties } from "react";

export const PALETTE = {
  /** Near-black, warm: silhouettes, strokes, the swallow. */
  ink: "#0b0a08",
  /** The burgh's mass against the ember sky. */
  town: "#100d09",
  /** The quay face at the waterline, a hair lighter than the town. */
  quay: "#17110c",
  /** The Water Port's mouth, darker than anything around it. */
  portMouth: "#050403",
  /** Stone beside the port that the lantern reaches. */
  litStone: "#2b1e12",
  litStoneNear: "#3a2915",
  /** The windows' amber: warm, not the lantern's saturation. */
  window: "#d8a45c",
  /** The near bank and what stands on it. */
  earth: "#0d0b08",
  earthEdge: "#221a12",
  deck: "#0f0c09",
  deckEdge: "#2a2016",
  stone: "#141009",
  box: "#120e0a",
  boxLid: "#16110c",
  boxInterior: "#1e160f",
  boxEdge: "#241a10",
  bolt: "#2c2216",
  boltKnob: "#3a2c1c",
  coin: "#b58b45",
  core: "#2a2015",
  coreFlesh: "#8a7a58",
  /** Slate for the mist, laid at a few percent. */
  mist: "#b9bfcc",
} as const;

/**
 * Every plane fills its parallax wrapper and takes no pointer: the prop
 * buttons above are the only things that hear a hand. Inline rather than a
 * stylesheet so a plane works wherever the stage mounts it, and because no
 * stage selector may carry a transition or a filter (spec section 10).
 */
export const PLANE_SVG_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
  pointerEvents: "none",
};
