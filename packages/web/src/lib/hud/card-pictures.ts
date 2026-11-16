import type { CardParams } from "../setup-cards.js";

// ---------------------------------------------------------------------------
// The pictures of the hand's setup cards
//
// The same pictures, by the same rule, as setupCardPreviewUrl in
// lib/crafted-furniture.ts: a card's look is its colourway, for Top and Long
// table whether it sets down one trestle or a set, and the chair it seats. A
// seated look on a chair it was never drawn with has no picture.
//
// The rule is written again here, not imported, for as long as this screen is
// behind its flag, because flag-only code may not grow what every planner
// downloads (the design note, "Behind its flag, and nothing more"). Nothing
// else in production calls setupCardPreviewUrl yet, so the bundler leaves it
// out; importing it from here put it back, into the shared file its module is
// built into, which twelve other files of master's build import (14 Nov 2026).
// __tests__/flag-only-copies.test.ts holds this to the shared rule for every
// card, colourway and chair, so the two cannot part. When this screen is the
// planner, import the shared one and delete this.
// ---------------------------------------------------------------------------

/** The version folder of the setup cards' pictures: SETUP_PREVIEW_VERSION in lib/crafted-furniture.ts. */
const PICTURES_VERSION = "setup-v2";

/** A chair's word in a picture's name. */
const PICTURE_CHAIR: Readonly<Record<string, string>> = {
  "chiavari-chair": "chiavari",
  "burgess-turini-18-3": "turini",
};

function look(params: CardParams, chairSlug: string): string | null {
  const chair = PICTURE_CHAIR[chairSlug];
  switch (params.card) {
    case "round": return chair === undefined ? null : `${params.colourway}-${chair}`;
    case "top-table":
    case "long-table": return chair === undefined ? null : `${params.colourway}-${params.trestles > 1 ? "set" : "one"}-${chair}`;
    case "dance-floor": return "floor";
    case "piece": return null;
  }
}

/** The picture of what a setup card sets down with this chair, or null where none was drawn (and for a piece card, whose picture is its own). */
export function handCardPictureUrl(params: CardParams, chairSlug: string): string | null {
  const name = look(params, chairSlug);
  return name === null ? null : `/models/furniture/setup-${params.card}/${PICTURES_VERSION}/${name}.webp`;
}
