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
