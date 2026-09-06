// -----------------------------------------------------------------------------
// prop-boxes — where each pokeable's button sits, derived from the drawing
// so the manifest's boxes cannot drift from the art. Authored as rects in
// drawing units and converted to percent of the 16:9 tableau; for any other
// aspect the stage remaps them with riverGatePropBoxFor (viewbox.ts).
//
// The boxes are generous around small things (a lantern twelve units wide
// gets a box fifty-two wide) because a fingertip is not a pixel, and they
// never overlap one another, which the test holds.
// -----------------------------------------------------------------------------
import { APPLE_CORE, CHAIN_PIVOT, TOLL_BOX } from "./near-bank-geometry.js";
import { LANTERN_FLAME } from "./far-bank-geometry.js";
import {
  RIVER_GATE_VIEWBOX,
  viewBoxRectToTableauPercent,
  type TableauPercentBox,
  type ViewBoxRect,
} from "./viewbox.js";

export const RIVER_GATE_PROP_IDS = ["port-chain", "water", "lantern", "swallow", "toll-box", "apple-core"] as const;
export type RiverGatePropId = (typeof RIVER_GATE_PROP_IDS)[number];

/** Each pokeable's reach in drawing units. */
export const RIVER_GATE_PROP_RECTS: Readonly<Record<RiverGatePropId, ViewBoxRect>> = {
  // The chain from its ring to its last link, with room for a sixteen-degree swing either way.
  "port-chain": { x: CHAIN_PIVOT.x - 22, y: CHAIN_PIVOT.y - 16, w: 60, h: 105 },
  // The open water east of the jetty, clear of the lantern and the core.
  water: { x: 870, y: 540, w: 690, h: 280 },
  // The housing and its standard.
  lantern: { x: LANTERN_FLAME.x - 25, y: LANTERN_FLAME.y - 27, w: 52, h: 56 },
  // The whole of its hunting ground over the town.
  swallow: { x: 456, y: 140, w: 728, h: 130 },
  // The box on the deck, with the lid's full lift.
  "toll-box": { x: TOLL_BOX.x - 24, y: TOLL_BOX.y - 31, w: 80, h: 54 },
  // The core and the whole of its slow wander.
  "apple-core": { x: APPLE_CORE.x - 34, y: APPLE_CORE.y - 28, w: 72, h: 56 },
};

const toPercent = (rect: ViewBoxRect): TableauPercentBox =>
  viewBoxRectToTableauPercent(rect, RIVER_GATE_VIEWBOX.width, RIVER_GATE_VIEWBOX.height);

/** The manifest's boxes: percent of the 16:9 tableau. */
export const RIVER_GATE_PROP_BOXES: Readonly<Record<RiverGatePropId, TableauPercentBox>> = {
  "port-chain": toPercent(RIVER_GATE_PROP_RECTS["port-chain"]),
  water: toPercent(RIVER_GATE_PROP_RECTS.water),
  lantern: toPercent(RIVER_GATE_PROP_RECTS.lantern),
  swallow: toPercent(RIVER_GATE_PROP_RECTS.swallow),
  "toll-box": toPercent(RIVER_GATE_PROP_RECTS["toll-box"]),
  "apple-core": toPercent(RIVER_GATE_PROP_RECTS["apple-core"]),
};
