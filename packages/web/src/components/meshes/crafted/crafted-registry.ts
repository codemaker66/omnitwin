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
import type { BufferGeometry } from "three";
import type { CraftedMaterialId } from "./crafted-materials.js";
import {
  instantiateCraftedModel,
  mergeCraftedParts,
  type CraftedFurnitureInstance,
  type CraftedPart,
} from "./crafted-model.js";
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

// Building a piece takes 2–80 ms, and the planner mounts the same piece many
// times (instancing templates, the placement ghost, every chair of a brush
// preview), so each size of each piece is built once and shared. Pieces are
// drawn at catalogue sizes, so the cache holds a few dozen entries at most; a
// size evicted past the limit has its GPU buffers released, and three uploads
// them again if a copy still on screen draws it.
const GEOMETRY_CACHE_LIMIT = 48;
const geometryCache = new Map<string, ReadonlyMap<CraftedMaterialId, BufferGeometry>>();

function sharedGeometries(slug: CraftedFurnitureSlug, size: CraftedSize): ReadonlyMap<CraftedMaterialId, BufferGeometry> {
  const key = `${slug}|${String(size.width)}|${String(size.depth)}|${String(size.height)}`;
  const cached = geometryCache.get(key);
  if (cached !== undefined) {
    // Most recently used last.
    geometryCache.delete(key);
    geometryCache.set(key, cached);
    return cached;
  }
  const built = mergeCraftedParts(FACTORIES[slug](size));
  geometryCache.set(key, built);
  for (const [oldest, geometries] of geometryCache) {
    if (geometryCache.size <= GEOMETRY_CACHE_LIMIT) break;
    geometryCache.delete(oldest);
    for (const geometry of geometries.values()) geometry.dispose();
  }
  return built;
}

/** Drops every shared geometry (tests that build a piece afresh). */
export function clearCraftedGeometryCache(): void {
  for (const geometries of geometryCache.values()) {
    for (const geometry of geometries.values()) geometry.dispose();
  }
  geometryCache.clear();
}

/**
 * A crafted model for a catalogue item, drawing the piece's shared geometry
 * with materials of its own; throws for a slug it does not draw.
 */
export function createCraftedFurniture(size: CraftedSize): CraftedFurnitureInstance {
  if (!isCraftedFurnitureSlug(size.slug)) throw new Error(`No crafted model for ${size.slug}`);
  if (![size.width, size.depth, size.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`Crafted furniture needs positive dimensions (${size.slug})`);
  }
  return instantiateCraftedModel(`crafted:${size.slug}`, sharedGeometries(size.slug, size));
}
