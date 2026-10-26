// ---------------------------------------------------------------------------
// Which catalogue items are drawn by the crafted models, and the folder of
// their current previews: data only, no 3D code, so the catalogue and the
// dashboard read it (through lib/crafted-furniture) without loading three.
// The furniture rebuild adds slugs here as each crafted model lands.
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

/**
 * The folder of the current crafted previews. Files under a versioned
 * folder are served immutable (vercel.json), so a redesign that changes how
 * a piece looks re-renders the previews into a new folder.
 */
export const CRAFTED_PREVIEW_VERSION = "crafted-v2";
