// -----------------------------------------------------------------------------
// near-bank-geometry — the foreground: the near bank, the jetty and what is
// on it. Authored in the same 1600 x 900 space as the far bank.
//
// The bank holds the bottom-left corner; the jetty runs from it out toward
// the centre so that its end, the mooring post, the traveller and the toll
// box all sit inside the phone crop (592..1008). The traveller is one
// twentieth of the frame's height, standing at the jetty's end and looking
// across at the port: a small figure against a thing too large for the
// frame. Provenance: Pr, drawn by code, 2026-09-06.
// -----------------------------------------------------------------------------
import { byteLength, handDrawn, polylinePath, type ViewBoxPoint } from "./viewbox.js";

const p = (x: number, y: number): ViewBoxPoint => ({ x, y });

/** The near bank, an earth mass with a stony edge, filled to the frame's corner. */
export const BANK_PATH =
  "M 0 632 Q 60 640 110 660 Q 160 680 205 708 Q 240 730 252 762 Q 260 800 262 840 Q 264 870 268 900 L 0 900 Z";
export const BANK_EDGE_PATH = "M 0 632 Q 60 640 110 660 Q 160 680 205 708 Q 240 730 252 762";
export const BANK_STONES = [
  { cx: 232, cy: 748, rx: 9, ry: 4 },
  { cx: 251, cy: 770, rx: 6, ry: 3 },
] as const;

/** The jetty deck: a thin platform seen from a little above, its far edge catching the last light. */
export const DECK = { x0: 150, x1: 762, topY0: 689, topY1: 693, thickness: 10 } as const;
export function deckTopAt(x: number): number {
  return DECK.topY0 + ((x - DECK.x0) / (DECK.x1 - DECK.x0)) * (DECK.topY1 - DECK.topY0);
}
const deckOutline = handDrawn(
  [p(DECK.x0, DECK.topY0), p(DECK.x1, DECK.topY1), p(DECK.x1, DECK.topY1 + DECK.thickness), p(DECK.x0, DECK.topY0 + DECK.thickness)],
  60,
  0.4,
  11,
);
export const DECK_PATH = `${polylinePath(deckOutline)} Z`;
export const DECK_EDGE_PATH = polylinePath(handDrawn([p(DECK.x0, DECK.topY0), p(DECK.x1, DECK.topY1)], 40, 0.3, 5));
/** The piles under the deck, into the water. */
export const PILE_XS: readonly number[] = [200, 340, 480, 620, 752];
export const PILE_WIDTH = 6;
export const PILE_LENGTH = 42;

/** The mooring post at the jetty's end, its top worn round. */
export const MOORING_POST = { x: 738, top: 668, bottom: 700 } as const;
export const MOORING_POST_PATH =
  "M 734 700.4 L 733.8 670.2 Q 734.6 666.2 738 666.8 Q 741.6 666.2 742.2 670.4 L 742 700.4 Z";

/** The port chain hangs from a ring near the post's top and goes into the water. */
export const CHAIN_PIVOT: ViewBoxPoint = { x: 738, y: 671 };
export const CHAIN_LINK_COUNT = 9;
export const CHAIN_LINK_LENGTH = 8.7;
/** Links whose centre lies below this are under the water and drawn fainter. */
export const CHAIN_WATERLINE_Y = 728;

export interface ChainLink {
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  /** Alternate links are seen face-on (an open ring) and edge-on (a bar): the twist of a real chain. */
  readonly faceOn: boolean;
  readonly submerged: boolean;
}

export const CHAIN_LINKS: readonly ChainLink[] = Array.from({ length: CHAIN_LINK_COUNT }, (_, i) => {
  const cy = CHAIN_PIVOT.y + CHAIN_LINK_LENGTH / 2 + i * CHAIN_LINK_LENGTH;
  const faceOn = i % 2 === 0;
  return { cy, rx: faceOn ? 2.3 : 1.25, ry: 4.15, faceOn, submerged: cy > CHAIN_WATERLINE_Y };
});

/** The traveller: one twentieth of the frame's height, base on the deck, facing the port. */
export const TRAVELLER_HEIGHT_UNITS = 45;
export const TRAVELLER = { x: 706, baseY: 693 } as const;
/** Local coordinates: origin at the crown, y down to 45 at the deck. */
export const TRAVELLER_PATH =
  "M -3.2 0.6 Q 0 -0.4 3.4 0.6 L 4.2 3.2 L 7.2 3.6 L 7.2 4.6 L 5.2 4.8 Q 6.4 7 6.6 8.8 L 5.6 10.2 Q 5.4 12.2 3.6 13.2 L 3 14.4 L 8.2 16.6 Q 9.8 22 9.6 28 L 9 37.4 L 3.6 37.6 L 4.4 44.6 L 7.6 44.8 L 7.6 45 L 0.6 45 L 0 39.2 L -1.6 39.2 L -2.4 45 L -8.6 45 L -8.6 44.6 L -5.4 44.4 L -5.8 37.6 L -9.2 37.2 Q -9.6 28 -8.4 20 L -7.8 16.4 L -2.6 14.2 L -3.6 12.6 Q -5.2 8.6 -4.2 4.8 L -6.2 4.6 L -6.2 3.6 L -4 3.2 Z";
/** The front arm, bent up to hold the stick at the chest. */
export const TRAVELLER_ARM_PATH = "M 7.6 17.4 L 11.2 19.8 L 12.4 22.2 L 10.8 23.4 L 8.4 21.2 L 8.2 18.8 Z";
/** The stick over the shoulder, from the hand to behind the head. */
export const TRAVELLER_STICK_PATH = "M 11.4 21 L -13.6 3.4";
/** The bag knotted at the stick's end. */
export const TRAVELLER_BAG_PATH =
  "M -13.6 3.6 Q -9.4 5.2 -9.8 9.4 Q -10.2 13.4 -14 13.6 Q -18 13.4 -18.2 9.4 Q -18.4 5 -13.6 3.6 Z";

/** The toll box on the deck between the traveller and the bank. */
export const TOLL_BOX = { x: 640, y: 681, w: 22, h: 11 } as const;
export const TOLL_BOX_BODY_PATH = "M 640.2 681 L 662 681.4 L 661.8 692.2 L 640 692 Z";
export const TOLL_BOX_FRONT_EDGE_PATH = "M 640.6 692 L 661.6 692.2";
export const TOLL_BOX_LID_CLOSED_PATH = "M 638.8 678.2 L 663.2 678.6 L 663 681.4 L 639 681 Z";
/** The lid stood up on its hinge at the back. */
export const TOLL_BOX_LID_OPEN_PATH = "M 640 681 L 639.6 661.8 L 643.4 661.4 L 643.6 681 Z";
export const TOLL_BOX_INTERIOR_PATH = "M 643.6 681.8 L 661.4 682 L 661.2 686 L 643.8 685.8 Z";
export const TOLL_BOX_FIRST_COIN = { cx: 652, cy: 684.6, rx: 2.6, ry: 1.2 } as const;
export const TOLL_BOX_MORE_COINS = [
  { cx: 646.4, cy: 685.4, rx: 2.4, ry: 1.1 },
  { cx: 656.6, cy: 683.8, rx: 2.4, ry: 1.1 },
  { cx: 651.2, cy: 686.8, rx: 2.2, ry: 1 },
  { cx: 658.2, cy: 686.2, rx: 2, ry: 0.9 },
] as const;
export const TOLL_BOX_BOLT_PATH = "M 637.8 684.8 L 664.4 685.2 L 664.4 687 L 637.8 686.6 Z";
export const TOLL_BOX_BOLT_KNOB = { cx: 664.6, cy: 685.9, r: 1.4 } as const;

export type TollBoxState = "closed" | "open" | "coin" | "coins" | "bolted";

/** The box's drawn state from its poke count: lid, a coin, a handful, then the bolt. */
export function tollBoxState(count: number): TollBoxState {
  if (count <= 0) return "closed";
  if (count === 1) return "open";
  if (count === 2) return "coin";
  if (count === 3) return "coins";
  return "bolted";
}

/** The apple core in the water beyond the jetty's end. Local coordinates, centred. */
export const APPLE_CORE = { x: 814, y: 740 } as const;
export const APPLE_CORE_PATH =
  "M -2.2 -4.6 L 2.2 -4.6 L 1 -2.4 Q 2.4 0 1 2.4 L 2.2 4.6 L -2.2 4.6 L -1 2.4 Q -2.4 0 -1 -2.4 Z";
export const APPLE_CORE_FLESH_PATH = "M -0.9 -2.2 L 0.9 -2.2 Q 1.6 0 0.9 2.2 L -0.9 2.2 Q -1.6 0 -0.9 -2.2 Z";
export const APPLE_CORE_STEM_PATH = "M 0 -4.6 L 0.6 -6.2";
/** Each poke turns it this much further; on the fourth it goes under. */
export const APPLE_CORE_TURN_DEG = 75;
export const APPLE_CORE_SINKS_AT = 4;

export interface AppleCorePose {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly rotateDeg: number;
}

/** The core's drift and turn, pure over the count and the clock; still under reduced motion. */
export function appleCorePose(count: number, nowMs: number, reducedMotion: boolean): AppleCorePose {
  if (count >= APPLE_CORE_SINKS_AT) return { visible: false, x: APPLE_CORE.x, y: APPLE_CORE.y, rotateDeg: 0 };
  const turn = count * APPLE_CORE_TURN_DEG;
  if (reducedMotion) return { visible: true, x: APPLE_CORE.x, y: APPLE_CORE.y, rotateDeg: turn };
  // Two incommensurate swells so the bob never visibly repeats; a slow wander in the current.
  const bob = 1.2 * Math.sin(nowMs / 2600) + 0.6 * Math.sin(nowMs / 1130);
  const wander = 4 * Math.sin(nowMs / 23000) + 2 * Math.sin(nowMs / 9700);
  return {
    visible: true,
    x: APPLE_CORE.x + wander,
    y: APPLE_CORE.y + bob,
    rotateDeg: turn + 4 * Math.sin(nowMs / 3400),
  };
}

export const NEAR_BANK_BYTES = byteLength(
  BANK_PATH,
  BANK_EDGE_PATH,
  DECK_PATH,
  DECK_EDGE_PATH,
  MOORING_POST_PATH,
  TRAVELLER_PATH,
  TRAVELLER_ARM_PATH,
  TRAVELLER_STICK_PATH,
  TRAVELLER_BAG_PATH,
  TOLL_BOX_BODY_PATH,
  TOLL_BOX_FRONT_EDGE_PATH,
  TOLL_BOX_LID_CLOSED_PATH,
  TOLL_BOX_LID_OPEN_PATH,
  TOLL_BOX_INTERIOR_PATH,
  TOLL_BOX_BOLT_PATH,
  APPLE_CORE_PATH,
  APPLE_CORE_FLESH_PATH,
  APPLE_CORE_STEM_PATH,
);
