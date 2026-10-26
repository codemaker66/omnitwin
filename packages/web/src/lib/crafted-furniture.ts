// ---------------------------------------------------------------------------
// Crafted furniture: which catalogue items the planner draws in code
//
// The supplied models (Hyper3D Rodin exports, 50k–217k triangles and up to
// 12 MB each) are replaced on screen by models made from scratch to the same
// designs (components/meshes/crafted). This module only names them and where
// their previews live, so the catalogue and dashboard can show matching
// pictures without loading any 3D code. The canonical catalogue keeps its
// supplied mesh and preview URLs: the database seeds from it and rejects
// changes to either.
// ---------------------------------------------------------------------------

import {
  CRAFTED_FURNITURE_SLUGS,
  CRAFTED_PREVIEW_VERSION,
  type CraftedFurnitureSlug,
} from "../components/meshes/crafted/crafted-slugs.js";
import type { CardParams } from "./setup-cards.js";

// The list and the previews' folder are the furniture rebuild's to change (components/meshes/crafted/crafted-slugs).
export { CRAFTED_FURNITURE_SLUGS, CRAFTED_PREVIEW_VERSION, type CraftedFurnitureSlug };

const CRAFTED: ReadonlySet<string> = new Set(CRAFTED_FURNITURE_SLUGS);

export function isCraftedFurnitureSlug(slug: string): slug is CraftedFurnitureSlug {
  return CRAFTED.has(slug);
}

/** The rendered preview of a crafted piece, or null for any other item. */
export function craftedFurniturePreviewUrl(slug: string): string | null {
  return isCraftedFurnitureSlug(slug) ? `/models/furniture/${slug}/${CRAFTED_PREVIEW_VERSION}/preview.webp` : null;
}

/**
 * The version folder of the setup cards' pictures (card-dock Q-21): each
 * look's whole set (a round with its chairs, a trestle or a set with theirs,
 * a 5 × 5 floor) drawn from the same models in the same studio as the crafted
 * previews, by scripts/render-setup-previews.mjs. Each card has its own folder
 * beside the pieces', `/models/furniture/setup-<card>/<version>/`, so the
 * version sits where the immutable cache rule (vercel.json) reads it.
 */
export const SETUP_PREVIEW_VERSION = "setup-v1";

/**
 * The look a setup card's picture shows: its colourway, and for Top and Long
 * table whether it sets down one trestle or a set. The counts are the card's
 * text. Null for a piece card, whose picture is its crafted preview.
 */
export function setupCardLook(params: CardParams): string | null {
  switch (params.card) {
    case "round": return params.colourway;
    case "top-table":
    case "long-table": return `${params.colourway}-${params.trestles > 1 ? "set" : "one"}`;
    case "dance-floor": return "floor";
    case "piece": return null;
  }
}

/** The picture of what this setup card sets down, as its parameters stand; null for a piece card. */
export function setupCardPreviewUrl(params: CardParams): string | null {
  const look = setupCardLook(params);
  return look === null ? null : `/models/furniture/setup-${params.card}/${SETUP_PREVIEW_VERSION}/${look}.webp`;
}
