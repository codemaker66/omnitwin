import { barCounterParts, platformParts, roomDividerParts, serveryParts } from "./crafted-cabinets.js";
import { banquetChairParts } from "./crafted-chairs.js";
import {
  bareTrestleParts,
  ceremonyTableParts,
  clothedRoundParts,
  clothedTrestleParts,
  poseurParts,
  roundCafeParts,
  squareCafeParts,
} from "./crafted-tables.js";
import { buildCraftedModel, type CraftedFurnitureInstance, type CraftedPart } from "./crafted-model.js";
import {
  CRAFTED_FURNITURE_SLUGS,
  isCraftedFurnitureSlug,
  type CraftedFurnitureSlug,
} from "../../../lib/crafted-furniture.js";

// ---------------------------------------------------------------------------
// Crafted furniture registry
//
// The factory for each catalogue slug drawn by the crafted models instead of
// the supplied GLBs (lib/crafted-furniture.ts names them). Each factory draws
// to the catalogue's own width, depth and height, so a crafted piece occupies
// exactly the footprint the planner reasons about.
// ---------------------------------------------------------------------------

export interface CraftedSize {
  readonly slug: string;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

type CraftedFactory = (size: CraftedSize) => CraftedPart[];

const FACTORIES: Readonly<Record<CraftedFurnitureSlug, CraftedFactory>> = {
  "burgess-turini-18-3": (size) => banquetChairParts(size, "velvet-coral"),
  "checked-banquet-chair": (size) => banquetChairParts(size, "check-coral"),
  "round-table-6ft-white": (size) => clothedRoundParts(size, "white"),
  "round-table-6ft-black": (size) => clothedRoundParts(size, "black"),
  "cake-cutting-table": (size) => clothedRoundParts(size, "white", 29),
  "trestle-4ft-white": (size) => clothedTrestleParts(size, "white"),
  "trestle-4ft-black": (size) => clothedTrestleParts(size, "black"),
  "trestle-6ft-white": (size) => clothedTrestleParts(size, "white", 7),
  "trestle-6ft-black": (size) => clothedTrestleParts(size, "black", 7),
  "trestle-6ft": (size) => bareTrestleParts(size, "plastic"),
  "trestle-6ft-wooden": (size) => bareTrestleParts(size, "wood"),
  "ceremony-table": (size) => ceremonyTableParts(size),
  "round-cafe-table-white": (size) => roundCafeParts(size),
  "square-cafe-table-white": (size) => squareCafeParts(size),
  "poseur-table-white": (size) => poseurParts(size, "white"),
  "poseur-table-black": (size) => poseurParts(size, "black"),
  "bar-counter": (size) => barCounterParts(size),
  "servery-unit": (size) => serveryParts(size),
  "platform": (size) => platformParts(size),
  "room-divider": (size) => roomDividerParts(size),
};

export { CRAFTED_FURNITURE_SLUGS, isCraftedFurnitureSlug };

/** A new crafted model for a catalogue item; throws for a slug it does not draw. */
export function createCraftedFurniture(size: CraftedSize): CraftedFurnitureInstance {
  if (!isCraftedFurnitureSlug(size.slug)) throw new Error(`No crafted model for ${size.slug}`);
  const factory = FACTORIES[size.slug];
  if (![size.width, size.depth, size.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`Crafted furniture needs positive dimensions (${size.slug})`);
  }
  return buildCraftedModel(`crafted:${size.slug}`, factory(size));
}
