import { SETUP_PREVIEW_VERSION } from "./crafted-furniture.js";
import { plannerChairSlug } from "./furniture-defaults.js";
import type { CardParams } from "./setup-cards.js";

// ---------------------------------------------------------------------------
// The setup cards' pictures (card-dock Q-21), in the folder SETUP_PREVIEW_VERSION
// names (lib/crafted-furniture.ts). Apart from the crafted previews, which
// today's planner and the dashboard show, because only the new chrome's cards
// show these: they load with it (T-671).
// ---------------------------------------------------------------------------

/** A chair's word in a picture's name. */
const PICTURE_CHAIR: Readonly<Record<string, string>> = {
  "chiavari-chair": "chiavari",
  "burgess-turini-18-3": "turini",
};

/**
 * The look a setup card's picture shows: its colourway, for Top and Long
 * table whether it sets down one trestle or a set, and the chair it seats
 * (the event's, plannerChairSlug, unless named). The counts are the card's
 * text. Null for a piece card, whose picture is its crafted preview, and for
 * a seated look on a chair it was never drawn with (the hall's checked or red
 * chairs): no picture rather than another chair's.
 */
export function setupCardLook(params: CardParams, chairSlug: string = plannerChairSlug()): string | null {
  const chair = PICTURE_CHAIR[chairSlug];
  switch (params.card) {
    case "round": return chair === undefined ? null : `${params.colourway}-${chair}`;
    case "top-table":
    case "long-table": return chair === undefined ? null : `${params.colourway}-${params.trestles > 1 ? "set" : "one"}-${chair}`;
    case "dance-floor": return "floor";
    case "piece": return null;
  }
}

/** The picture of what this setup card sets down, as its parameters and the chair stand; null where setupCardLook has none. */
export function setupCardPreviewUrl(params: CardParams, chairSlug: string = plannerChairSlug()): string | null {
  const look = setupCardLook(params, chairSlug);
  return look === null ? null : `/models/furniture/setup-${params.card}/${SETUP_PREVIEW_VERSION}/${look}.webp`;
}
