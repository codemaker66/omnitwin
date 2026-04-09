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
  /** Short subtitle shown in the catalogue panel (dimensions, capacity, etc). */
  readonly subtitle: string;
}

// ---------------------------------------------------------------------------
// SVG icon silhouettes for catalogue panel (gold stroke on transparent)
// ---------------------------------------------------------------------------

const ICON_STROKE = "rgba(201,168,76,0.7)";
const ICON_FILL = "rgba(201,168,76,0.08)";

/** Returns an inline SVG string for the catalogue thumbnail. */
export function catalogueIcon(item: CatalogueItem): string {
  const s = ICON_STROKE;
  const f = ICON_FILL;
  switch (item.id) {
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
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="28" height="20" rx="1" fill="${f}" stroke="${s}" stroke-width="1.5"/><line x1="20" y1="26" x2="20" y2="34" stroke="${s}" stroke-width="1.5"/><line x1="14" y1="34" x2="26" y2="34" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "projector":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="14" width="24" height="12" rx="3" fill="${f}" stroke="${s}" stroke-width="1.5"/><circle cx="28" cy="20" r="4" fill="none" stroke="${s}" stroke-width="1"/></svg>`;
    case "laptop":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="10" width="24" height="16" rx="2" fill="${f}" stroke="${s}" stroke-width="1.5"/><rect x="4" y="26" width="32" height="4" rx="1" fill="${f}" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "microphone":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="16" y="6" width="8" height="16" rx="4" fill="${f}" stroke="${s}" stroke-width="1.5"/><path d="M12 18 C12 26, 28 26, 28 18" fill="none" stroke="${s}" stroke-width="1.5"/><line x1="20" y1="26" x2="20" y2="34" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "mic-stand":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="8" r="4" fill="${f}" stroke="${s}" stroke-width="1.5"/><line x1="20" y1="12" x2="20" y2="32" stroke="${s}" stroke-width="1.5"/><path d="M12 32 L20 28 L28 32" fill="none" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "lectern":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path d="M12 8 L28 8 L26 28 L14 28 Z" fill="${f}" stroke="${s}" stroke-width="1.5"/><rect x="14" y="10" width="12" height="6" rx="1" fill="none" stroke="${s}" stroke-width="0.8" opacity="0.4"/><line x1="16" y1="28" x2="16" y2="34" stroke="${s}" stroke-width="1.5"/><line x1="24" y1="28" x2="24" y2="34" stroke="${s}" stroke-width="1.5"/></svg>`;
    case "black-table-cloth":
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path d="M8 14 Q20 10, 32 14 L30 30 Q20 34, 10 30 Z" fill="${f}" stroke="${s}" stroke-width="1.5"/></svg>`;
    default:
      return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="24" height="24" rx="4" fill="${f}" stroke="${s}" stroke-width="1.5"/></svg>`;
  }
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
    subtitle: "1.8m round \u00B7 seats up to 12",
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
    subtitle: "1.8m \u00D7 0.76m \u00B7 seats up to 20",
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
    subtitle: "1.2m \u00D7 0.76m \u00B7 seats up to 12",
  },

  // --- Poseur / Cocktail tables ---
  {
    id: "poseur-table",
    name: "Poseur Table",
    category: "table",
    width: 0.60,
    height: 1.05,
    depth: 0.60,
    color: "#c0c0c8",
    tableShape: "round",
    maxCount: null,
    subtitle: "60cm round \u00B7 standing height",
  },
  {
    id: "poseur-table-black",
    name: "Poseur Table (Black)",
    category: "table",
    width: 0.60,
    height: 1.05,
    depth: 0.60,
    color: "#1a1a1a",
    tableShape: "round",
    maxCount: null,
    subtitle: "60cm round \u00B7 black cloth",
  },
  {
    id: "poseur-table-white",
    name: "Poseur Table (White)",
    category: "table",
    width: 0.60,
    height: 1.05,
    depth: 0.60,
    color: "#f0ede8",
    tableShape: "round",
    maxCount: null,
    subtitle: "60cm round \u00B7 white cloth",
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
    subtitle: "Padded \u00B7 stackable",
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
    subtitle: "2.4m \u00D7 1.2m \u00B7 40cm high",
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
    subtitle: "2.4m \u00D7 1.0m \u00B7 40cm high",
  },

  // --- AV ---
  {
    id: "projector-screen",
    name: "Projector Screen",
    category: "av",
    width: 2.50,
    height: 1.80,
    depth: 0.60,
    color: "#1a1a1a",
    tableShape: null,
    maxCount: null,
    subtitle: "2.5m wide \u00B7 freestanding",
  },
  {
    id: "projector",
    name: "Laser Projector",
    category: "av",
    width: 0.55,
    height: 0.10,
    depth: 0.35,
    color: "#3a3a40",
    tableShape: null,
    maxCount: null,
    subtitle: "55cm \u00B7 table-mountable",
  },
  {
    id: "laptop",
    name: "Laptop",
    category: "av",
    width: 0.36,
    height: 0.25,
    depth: 0.25,
    color: "#2a2a2e",
    tableShape: null,
    maxCount: null,
    subtitle: "36cm \u00B7 table-mountable",
  },
  {
    id: "microphone",
    name: "Table Microphone",
    category: "av",
    width: 0.10,
    height: 0.25,
    depth: 0.10,
    color: "#2a2a2a",
    tableShape: null,
    maxCount: null,
    subtitle: "Gooseneck \u00B7 table-mountable",
  },
  {
    id: "mic-stand",
    name: "Mic Stand",
    category: "av",
    width: 0.50,
    height: 1.60,
    depth: 0.50,
    color: "#2a2a2a",
    tableShape: null,
    maxCount: null,
    subtitle: "1.6m tall \u00B7 freestanding",
  },

  // --- Lecterns ---
  {
    id: "lectern",
    name: "Lectern",
    category: "lectern",
    width: 0.60,
    height: 1.15,
    depth: 0.50,
    color: "#5a3a20",
    tableShape: null,
    maxCount: null,
    subtitle: "60cm \u00D7 50cm \u00B7 wooden",
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
    subtitle: "Drapes over any table",
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
