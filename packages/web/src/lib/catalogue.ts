import type { FurnitureCategory } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Catalogue — local furniture definitions for the venue planning tool
// ---------------------------------------------------------------------------

/**
 * Shape hint for table items. Used by chair auto-snap (Week 3 Prompt 6)
 * to determine radial vs parallel facing.
 */
export type TableShape = "round" | "rectangular";

/**
 * A catalogue entry describing a piece of furniture available for placement.
 *
 * All dimensions are in real-world metres. The renderer converts to
 * render-space via toRenderSpace() when placing geometry.
 *
 * Placeholder items use coloured cubes — meshUrl will be non-null once
 * real 3D models are loaded.
 */
export interface CatalogueItem {
  /** Unique identifier (stable string, not UUID — these are hardcoded). */
  readonly id: string;
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
}

// ---------------------------------------------------------------------------
// Catalogue items — placeholder definitions for Trades Hall Glasgow
// ---------------------------------------------------------------------------

/** All catalogue items available for placement. */
export const CATALOGUE_ITEMS: readonly CatalogueItem[] = [
  // --- Tables ---
  {
    id: "round-table-6ft",
    name: "6ft Round Table",
    category: "table",
    width: 1.83,
    height: 0.76,
    depth: 1.83,
    color: "#c4a882",
    tableShape: "round",
    maxCount: null,
  },
  {
    id: "trestle-6ft",
    name: "6ft Trestle Table",
    category: "table",
    width: 1.83,
    height: 0.74,
    depth: 0.76,
    color: "#b89b72",
    tableShape: "rectangular",
    maxCount: null,
  },
  {
    id: "trestle-4ft",
    name: "4ft Trestle Table",
    category: "table",
    width: 1.22,
    height: 0.74,
    depth: 0.76,
    color: "#b89b72",
    tableShape: "rectangular",
    maxCount: null,
  },

  // --- Chairs ---
  {
    id: "banquet-chair",
    name: "Banquet Chair",
    category: "chair",
    width: 0.45,
    height: 0.90,
    depth: 0.45,
    color: "#a82020",
    tableShape: null,
    maxCount: null,
  },

  // --- Stage ---
  {
    id: "platform",
    name: "Platform",
    category: "stage",
    width: 2.44,
    height: 0.40,
    depth: 1.22,
    color: "#4a4a4a",
    tableShape: null,
    maxCount: null,
  },
  {
    id: "platform-narrow",
    name: "Narrow Platform",
    category: "stage",
    width: 2.44,
    height: 0.40,
    depth: 1.02,
    color: "#4a4a4a",
    tableShape: null,
    maxCount: 1,
  },

  // --- Decor (table dressing) ---
  {
    id: "black-table-cloth",
    name: "Black Table Cloth",
    category: "decor",
    width: 0.5,
    height: 0.01,
    depth: 0.5,
    color: "#1a1a1a",
    tableShape: null,
    maxCount: null,
  },
] as const;

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

/** Map from item ID to CatalogueItem for O(1) lookups. */
const itemById = new Map<string, CatalogueItem>(
  CATALOGUE_ITEMS.map((item) => [item.id, item]),
);

/**
 * Returns a catalogue item by ID, or undefined if not found.
 */
export function getCatalogueItem(id: string): CatalogueItem | undefined {
  return itemById.get(id);
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
