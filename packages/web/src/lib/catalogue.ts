import { CANONICAL_ASSETS, type CanonicalAsset, type TableShape } from "@omnitwin/types";
import type { FurnitureCategory } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Catalogue — furniture definitions for the venue planning tool
//
// The canonical source of truth is @omnitwin/types/asset-catalogue.ts.
// This module maps those entries into the CatalogueItem interface the
// editor expects, adding rendering-specific fields (color, meshUrl) and
// lookup helpers. The `id` on each CatalogueItem is the deterministic
// UUID from the canonical catalogue — the same UUID stored in the DB's
// asset_definitions table — so placed-object saves reference valid FKs.
//
// DO NOT add items here. Add them to CANONICAL_ASSETS in @omnitwin/types
// and they'll appear here automatically.
// ---------------------------------------------------------------------------

export type { TableShape };

export interface CatalogueItem {
  /** Deterministic UUID — matches DB asset_definitions.id. */
  readonly id: string;
  /** Developer slug for icon dispatch, test fixtures, logs. */
  readonly slug: string;
  /** Human-readable name shown in the drawer. */
  readonly name: string;
  /** Category for grouping in the drawer tabs. */
  readonly category: FurnitureCategory;
  /** Real-world dimensions in metres (width = X, height = Y, depth = Z). */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Placeholder colour for the proxy cube mesh. */
  readonly color: string;
  /** Shape hint for tables (used by chair snap). Null for non-tables. */
  readonly tableShape: TableShape | null;
  /** Maximum number of this item allowed in the scene. Null = unlimited. */
  readonly maxCount: number | null;
  /** Short subtitle shown in the catalogue panel. */
  readonly subtitle: string;
  /** URL to a .glb model file. Null = use procedural mesh. */
  readonly meshUrl: string | null;
}

function canonicalToCatalogue(a: CanonicalAsset): CatalogueItem {
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    category: a.category,
    width: a.widthM,
    height: a.heightM,
    depth: a.depthM,
    color: a.color,
    tableShape: a.tableShape,
    maxCount: a.maxCount,
    subtitle: a.subtitle,
    meshUrl: null,
  };
}

/** All catalogue items available for placement. */
export const CATALOGUE_ITEMS: readonly CatalogueItem[] =
  CANONICAL_ASSETS.map(canonicalToCatalogue);

// ---------------------------------------------------------------------------
// SVG icon silhouettes for catalogue panel (gold stroke on transparent)
// ---------------------------------------------------------------------------

const ICON_STROKE = "rgba(201,168,76,0.7)";
const ICON_FILL = "rgba(201,168,76,0.08)";

/** Returns an inline SVG string for the catalogue thumbnail. */
export function catalogueIcon(item: CatalogueItem): string {
  const s = ICON_STROKE;
  const f = ICON_FILL;
  // Dispatch on slug (stable developer ID) rather than UUID.
  switch ((item as CatalogueItem & { slug: string }).slug) {
    case "round-table-6ft":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="14" fill="${f}" stroke="${s}" stroke-width="1.5"/><circle cx="20" cy="20" r="3" fill="${s}" opacity="0.3"/></svg>`;
    case "trestle-6ft":
    case "trestle-4ft":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="12" width="28" height="16" rx="2" fill="${f}" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "poseur-table":
    case "poseur-table-black":
    case "poseur-table-white":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="16" r="8" fill="${f}" stroke="${s}" stroke-width="1.5"/><line x1="20" y1="24" x2="20" y2="36" stroke="${s}" stroke-width="1.5"/><line x1="14" y1="36" x2="26" y2="36" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "banquet-chair":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="6" width="16" height="8" rx="2" fill="${f}" stroke="${s}" stroke-width="1.5"/><rect x="12" y="16" width="16" height="12" rx="2" fill="${f}" stroke="${s}" stroke-width="1.5"/><line x1="14" y1="28" x2="14" y2="34" stroke="${s}" stroke-width="1.5"/><line x1="26" y1="28" x2="26" y2="34" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "platform":
    case "platform-narrow":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="16" width="32" height="12" rx="1" fill="${f}" stroke="${s}" stroke-width="1.5"/><line x1="4" y1="22" x2="36" y2="22" stroke="${s}" stroke-width="0.5" opacity="0.3"/></svg>`;
    case "projector-screen":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="4" width="28" height="22" rx="1" fill="${f}" stroke="${s}" stroke-width="1.5"/><line x1="20" y1="26" x2="20" y2="36" stroke="${s}" stroke-width="1.5"/><line x1="12" y1="36" x2="28" y2="36" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "projector":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="14" width="28" height="12" rx="2" fill="${f}" stroke="${s}" stroke-width="1.5"/><circle cx="28" cy="20" r="4" fill="${f}" stroke="${s}" stroke-width="1"/></svg>`;
    case "laptop":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="24" height="16" rx="2" fill="${f}" stroke="${s}" stroke-width="1.5"/><rect x="4" y="24" width="32" height="8" rx="2" fill="${f}" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "microphone":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="12" r="6" fill="${f}" stroke="${s}" stroke-width="1.5"/><line x1="20" y1="18" x2="20" y2="32" stroke="${s}" stroke-width="1.5"/><circle cx="20" cy="32" r="4" fill="${f}" stroke="${s}" stroke-width="1"/></svg>`;
    case "mic-stand":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="4" x2="20" y2="32" stroke="${s}" stroke-width="1.5"/><circle cx="20" cy="4" r="3" fill="${f}" stroke="${s}" stroke-width="1"/><line x1="12" y1="32" x2="28" y2="32" stroke="${s}" stroke-width="2"/></svg>`;
    case "lectern":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="4" width="16" height="24" rx="2" fill="${f}" stroke="${s}" stroke-width="1.5"/><line x1="14" y1="28" x2="14" y2="36" stroke="${s}" stroke-width="1.5"/><line x1="26" y1="28" x2="26" y2="36" stroke="${s}" stroke-width="1.5"/></svg>`;
    default:
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="24" height="24" rx="4" fill="${f}" stroke="${s}" stroke-width="1.5"/></svg>`;
  }
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** All distinct categories present in the catalogue, in display order. */
export const CATALOGUE_CATEGORIES: readonly FurnitureCategory[] = (() => {
  const seen = new Set<FurnitureCategory>();
  const result: FurnitureCategory[] = [];
  for (const item of CATALOGUE_ITEMS) {
    if (!seen.has(item.category)) {
      seen.add(item.category);
      result.push(item.category);
    }
  }
  return result;
})();

/** Map from item ID (UUID) to CatalogueItem for O(1) lookups. */
const itemById = new Map<string, CatalogueItem>(
  CATALOGUE_ITEMS.map((item) => [item.id, item]),
);

/** Map from slug to CatalogueItem. */
const itemBySlug = new Map<string, CatalogueItem>(
  CATALOGUE_ITEMS.map((item) => [item.slug, item]),
);

/**
 * Returns a catalogue item by ID (UUID), falling back to slug lookup.
 *
 * The primary key is the deterministic UUID. The slug fallback exists
 * because internal functions (checkCollision, computeSurfaceHeight,
 * findNearestTable) call this with the placed item's catalogueItemId,
 * which may be a slug in test fixtures. The API's Zod validation
 * (`z.string().uuid()`) on the save path ensures that production data
 * always uses UUIDs — the slug fallback can't mask a real FK bug.
 */
export function getCatalogueItem(id: string): CatalogueItem | undefined {
  return itemById.get(id) ?? itemBySlug.get(id);
}

/**
 * Returns a catalogue item by slug, or undefined if not found.
 */
export function getCatalogueItemBySlug(slug: string): CatalogueItem | undefined {
  return itemBySlug.get(slug);
}

/**
 * Returns all catalogue items in a given category.
 */
export function getCatalogueByCategory(category: FurnitureCategory): readonly CatalogueItem[] {
  return CATALOGUE_ITEMS.filter((item) => item.category === category);
}

/**
 * Returns true if the item has reached its maximum allowed count in the scene.
 */
export function isAtMaxCount(
  catalogueItemId: string,
  placedItemIds: readonly string[],
): boolean {
  const item = getCatalogueItem(catalogueItemId);
  if (item === undefined || item.maxCount === null) return false;
  let count = 0;
  for (const id of placedItemIds) {
    if (id === catalogueItemId) count++;
  }
  return count >= item.maxCount;
}

/**
 * Human-readable label for a furniture category.
 */
export function categoryLabel(category: FurnitureCategory): string {
  switch (category) {
    case "chair": return "Chairs";
    case "table": return "Tables";
    case "stage": return "Staging";
    case "lectern": return "Lecterns";
    case "barrier": return "Barriers";
    case "decor": return "Decor";
    case "av": return "AV";
    case "lighting": return "Lighting";
    case "other": return "Other";
  }
}
