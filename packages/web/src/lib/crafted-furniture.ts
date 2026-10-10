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

export const CRAFTED_FURNITURE_SLUGS = [
  "burgess-turini-18-3",
  "checked-banquet-chair",
  "round-table-6ft-white",
  "round-table-6ft-black",
  "cake-cutting-table",
  "trestle-4ft-white",
  "trestle-4ft-black",
  "trestle-6ft-white",
  "trestle-6ft-black",
  "trestle-6ft",
  "trestle-6ft-wooden",
  "ceremony-table",
  "round-cafe-table-white",
  "square-cafe-table-white",
  "poseur-table-white",
  "poseur-table-black",
  "bar-counter",
  "servery-unit",
  "platform",
  "room-divider",
] as const;

export type CraftedFurnitureSlug = (typeof CRAFTED_FURNITURE_SLUGS)[number];

const CRAFTED: ReadonlySet<string> = new Set(CRAFTED_FURNITURE_SLUGS);

export function isCraftedFurnitureSlug(slug: string): slug is CraftedFurnitureSlug {
  return CRAFTED.has(slug);
}

/**
 * The folder of the current crafted previews. Files under a versioned
 * folder are served immutable (vercel.json), so a redesign that changes how
 * a piece looks re-renders the previews into a new folder.
 */
export const CRAFTED_PREVIEW_VERSION = "crafted-v1";

/** The rendered preview of a crafted piece, or null for any other item. */
export function craftedFurniturePreviewUrl(slug: string): string | null {
  return isCraftedFurnitureSlug(slug) ? `/models/furniture/${slug}/${CRAFTED_PREVIEW_VERSION}/preview.webp` : null;
}
